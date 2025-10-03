import { Command } from 'commander';
import { loadConfig, Config } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { execPrompt } from '../shared/utils.js';
import { getOutputLanguage } from '../shared/translation.js';
import { makeEmbeddings } from '../embeddings/provider.js';
import { retrieveForFiles, hasRagDatabase } from '../rag/index.js';
import * as fs from 'fs';
import * as path from 'path';

interface AskOptions {
  projectOnly?: boolean;
  format?: string;
  output?: string;
  limit?: string;
}

type AnalysisMode =
  | 'source-analysis'
  | 'project-only'
  | 'doc-analysis'
  | 'general';
type FileKind = 'doc' | 'code' | 'config' | 'unknown';

interface CodeExample {
  language: string;
  code: string;
  description: string;
}

interface BasePromptContext {
  [key: string]: unknown;
  question: string;
  projectName: string;
  userLanguage: string;
  ragContext?: string;
  mcpContext?: string;
}

interface GeneralPromptContext extends BasePromptContext {
  hasProjectContext: boolean;
}

interface ProjectOnlyPromptContext extends BasePromptContext {
  ragContext: string;
}

interface SourceAnalysisPromptContext extends BasePromptContext {
  sourceContent: string;
  filePath: string;
  fileExtension: string;
}

interface DocAnalysisPromptContext extends BasePromptContext {
  sourceContent: string;
  filePath: string;
  fileExtension: string;
}

interface AskResponse {
  answer: string;
  result?: string;
  confidence?: number;
  language?: string;
  code_examples?: CodeExample[];
  related_topics?: string[];
  project_references?: string[];
  follow_up_suggestions?: string[];
}

export function askCommand(): Command {
  const cmd = new Command('ask');

  cmd
    .description('AI-powered question answering with project context integration v1.0.0')
    .argument('<question>', 'Technical question to ask')
    .option('--project-only', 'Focus only on project context', false)
    .option('--format <type>', 'Response format: markdown or json', 'markdown')
    .option('-o, --output <file>', 'Save response to file', '')
    .option('-k, --limit <number>', 'Maximum RAG contexts to include', '6')
    .action(async (question: string, options: AskOptions) => {
      const logger = getLogger();
      try {
        logger.info('Starting ask command');
        const result = await processAskQuery(question, options);
        await displayAndSaveResponse(result, options);
        logger.info('Ask command completed successfully');
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`❌ Ask command failed: ${errorMessage}`);
        console.log(`❌ Ask command failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return cmd;
}

export async function processAskQuery(
  question: string,
  options?: AskOptions
): Promise<AskResponse> {
  const config = await loadConfig();
  const logger = getLogger();
  const userLanguage = getOutputLanguage(config);

  const questionFilePath = inferFilePathFromQuestion(question);
  const questionFileExt = questionFilePath
    ? questionFilePath.slice(questionFilePath.lastIndexOf('.'))
    : undefined;
  const questionFileKind = kindFromExt(questionFileExt);

  const analysisMode = determineAnalysisMode(
    question,
    options?.projectOnly || false,
    questionFilePath,
    questionFileKind
  );
  logger.info(`Using analysis mode: ${analysisMode}`);

  let result: AskResponse;
  if (analysisMode === 'source-analysis') {
    result = await processSourceAnalysis(
      question,
      questionFilePath!,
      config,
      userLanguage
    );
  } else if (analysisMode === 'doc-analysis') {
    result = await processDocAnalysis(
      question,
      questionFilePath!,
      config,
      userLanguage
    );
  } else if (analysisMode === 'project-only') {
    result = await processProjectOnlyAnalysis(
      question,
      config,
      userLanguage,
      options
    );
  } else {
    result = await processGeneralAnalysis(
      question,
      config,
      userLanguage,
      options
    );
  }
  return result;
}
function displayResult(result: string) {
  console.log(result);
}

async function displayAndSaveResponse(
  result: AskResponse,
  options: AskOptions
) {
  let content: string;
  let extension: string;

  if (options.format === 'json') {
    content = JSON.stringify(result, null, 2);
    extension = '.json';
  } else {
    content = generateMarkdownContent(result);
    extension = '.md';
  }

  displayResult(content);

  if (options.output) {
    await saveResultToFile(content, extension, options);
  }
}

async function saveResultToFile(
  content: string,
  extension: string,
  options: AskOptions
) {
  const logger = getLogger();
  try {
    let fileName = options.output!;
    if (!fileName.includes('.')) {
      fileName += extension;
    }

    const cliaDir = path.join(process.cwd(), '.clia');
    if (!fs.existsSync(cliaDir)) {
      fs.mkdirSync(cliaDir, { recursive: true });
    }

    const outputPath = path.isAbsolute(fileName)
      ? fileName
      : path.join(cliaDir, fileName);

    fs.writeFileSync(outputPath, content, 'utf-8');
    logger.info(`Response saved to: ${outputPath}`);
  } catch (error) {
    throw new Error(`Failed to save response: ${error}`);
  }
}

function generateMarkdownContent(result: AskResponse): string {
  let content = '# AI Assistant Response\n\n';

  content += '## Answer\n\n';
  content += result.answer + '\n\n';

  if (result.confidence) {
    content += `## Confidence: ${result.confidence}%\n\n`;
  }

  if (result.code_examples && result.code_examples.length > 0) {
    content += '## Code Examples\n\n';
    result.code_examples.forEach((example, index) => {
      content += `### Example ${index + 1} (${example.language})\n\n`;
      content += `${example.description}\n\n`;
      content += `\`\`\`${example.language}\n${example.code}\n\`\`\`\n\n`;
    });
  }

  if (result.related_topics && result.related_topics.length > 0) {
    content += '## Related Topics\n\n';
    result.related_topics.forEach((topic) => {
      content += `- ${topic}\n`;
    });
    content += '\n';
  }

  if (result.project_references && result.project_references.length > 0) {
    content += '## Project References\n\n';
    result.project_references.forEach((ref) => {
      content += `- ${ref}\n`;
    });
    content += '\n';
  }

  if (result.follow_up_suggestions && result.follow_up_suggestions.length > 0) {
    content += '## Follow-up Suggestions\n\n';
    result.follow_up_suggestions.forEach((suggestion) => {
      content += `- ${suggestion}\n`;
    });
    content += '\n';
  }

  return content;
}

function determineAnalysisMode(
  question: string,
  projectOnly: boolean,
  filePath?: string,
  fileKind?: FileKind
): AnalysisMode {
  if (filePath && fs.existsSync(filePath)) {
    if (fileKind === 'doc') {
      return 'doc-analysis';
    } else {
      return 'source-analysis';
    }
  }

  if (projectOnly) {
    return 'project-only';
  }

  return 'general';
}

async function processSourceAnalysis(
  question: string,
  filePath: string,
  config: Config,
  userLanguage: string
): Promise<AskResponse> {
  try {
    const sourceContent = fs.readFileSync(filePath, 'utf-8');
    const fileExtension = path.extname(filePath);

    const promptContext: SourceAnalysisPromptContext = {
      question,
      sourceContent,
      filePath,
      fileExtension,
      projectName: config.project?.name || 'Unknown Project',
      userLanguage,
      mcpContext: 'No MCP context available',
    };

    const response = await execPrompt<SourceAnalysisPromptContext, AskResponse>(
      'ask/source-analysis',
      promptContext,
      '1.0.0',
      'default',
      0.3
    );

    return response;
  } catch (error) {
    throw new Error(`Could not read source file: ${filePath}`);
  }
}

async function processDocAnalysis(
  question: string,
  filePath: string,
  config: Config,
  userLanguage: string
): Promise<AskResponse> {
  try {
    const sourceContent = fs.readFileSync(filePath, 'utf-8');
    const fileExtension = path.extname(filePath);

    const promptContext: DocAnalysisPromptContext = {
      question,
      sourceContent,
      filePath,
      fileExtension,
      projectName: config.project?.name || 'Unknown Project',
      userLanguage,
      mcpContext: 'No MCP context available',
    };

    const response = await execPrompt<DocAnalysisPromptContext, AskResponse>(
      'ask/doc-analysis',
      promptContext,
      '1.0.0',
      'default',
      0.3
    );

    return response;
  } catch (error) {
    throw new Error(`Could not read documentation file: ${filePath}`);
  }
}

async function processProjectOnlyAnalysis(
  question: string,
  config: Config,
  userLanguage: string,
  options?: AskOptions
): Promise<AskResponse> {
  const logger = getLogger();

  let ragContextRaw = '';
  let hasProjectContext = false;
  const hasRag = hasRagDatabase(process.cwd());

  if (!hasRag) {
    throw new Error(
      'Project-only mode requires a valid RAG index. Run "clia rag index" first.'
    );
  }

  try {
      const ragConfig = config.project?.rag || { includes: [], excludes: [], chunkSize: 1000, chunkOverlap: 200 };
      const embedder = await makeEmbeddings(ragConfig, config);
      const enhancedQuery = enhanceQuery(question);
    logger.info(
      `Enhanced query: ${enhancedQuery !== question ? 'applied' : 'no enhancement'}`
    );

    const ragResults = await retrieveForFiles(enhancedQuery, [], 15, embedder);
    ragContextRaw = ragResults.join('\n---\n');
    hasProjectContext = ragResults.length > 0;

    logger.info(`Found ${ragResults.length} project context chunks`);

    if (ragResults.length < 3) {
      const lowerQuestion = question.toLowerCase();
      const relevantEnhancement = QUERY_ENHANCEMENTS.find((enhancement) =>
        enhancement.keywords.some((keyword) => lowerQuestion.includes(keyword))
      );

      if (relevantEnhancement) {
        const fallbackResults = await retrieveForFiles(
          relevantEnhancement.enhancement,
          relevantEnhancement.fileHints || [],
          10,
          embedder
        );

        if (fallbackResults.length > 0) {
          ragContextRaw = fallbackResults.join('\n---\n');
          hasProjectContext = true;
          logger.info(
            `Fallback search found ${fallbackResults.length} additional chunks`
          );
        }
      }
    }
  } catch (error) {
    throw new Error('Could not retrieve project context for project-only mode');
  }

  if (!hasProjectContext) {
    throw new Error(
      'No project context found. Ensure RAG index is properly built with "clia rag index".'
    );
  }

  const promptContext: ProjectOnlyPromptContext = {
    question,
    ragContext: ragContextRaw,
    mcpContext: 'No MCP context available',
    projectName: config.project?.name || 'Unknown Project',
    userLanguage,
  };

  const response = await execPrompt<ProjectOnlyPromptContext, AskResponse>(
    'ask/project-only',
    promptContext,
    '1.0.0',
    'default',
    0.3
  );

  return response;
}

async function processGeneralAnalysis(
  question: string,
  config: Config,
  userLanguage: string,
  options?: AskOptions
): Promise<AskResponse> {
  const logger = getLogger();
  let ragContextRaw = 'No RAG context available';
  let hasProjectContext = false;

  try {
    const hasRag = hasRagDatabase(process.cwd());
    if (hasRag) {
      logger.info('RAG database found, loading project context for hybrid response');
      
      const embedder = await makeEmbeddings(config.project?.rag || {}, config);
      const enhancedQuery = enhanceQuery(question);
      
      const ragResults = await retrieveForFiles(enhancedQuery, [], 8, embedder);
      
      if (ragResults.length > 0) {
        ragContextRaw = ragResults.join('\n---\n');
        hasProjectContext = true;
        logger.info(`Loaded ${ragResults.length} project context chunks for hybrid response`);
      }
    }
  } catch (error) {
    logger.warn('Failed to load RAG context, proceeding with general-only response');
  }

  const promptContext: GeneralPromptContext = {
    question,
    ragContext: ragContextRaw,
    mcpContext: 'No MCP context available',
    projectName: config.project?.name || 'Unknown Project',
    userLanguage,
    hasProjectContext,
  };

  const response = await execPrompt<GeneralPromptContext, AskResponse>(
    'ask/general',
    promptContext,
    '1.0.0',
    'default',
    0.8
  );

  return response;
}

function inferFilePathFromQuestion(q: string): string | undefined {
  const m = q.match(
    /['"`]([^'"`]+?\.(?:md|txt|rst|ya?ml|json|ts|js|tsx|jsx|toml|ini|conf))['"`]/i
  );
  return m?.[1];
}

function kindFromExt(ext?: string): FileKind {
  if (!ext) return 'unknown';
  const e = ext.toLowerCase();
  if (['.md', '.txt', '.rst'].includes(e)) return 'doc';
  if (['.json', '.yaml', '.yml', '.toml', '.ini', '.conf'].includes(e))
    return 'config';
  if (
    [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.c',
      '.cpp',
      '.cs',
      '.java',
      '.rb',
      '.py',
      '.go',
      '.php',
      '.rs',
    ].includes(e)
  )
    return 'code';
  return 'unknown';
}

function truncateContext(input: string, maxChars = 8000): string {
  if (!input) return '';
  return input.length <= maxChars
    ? input
    : input.slice(0, maxChars) + '\n...[truncated]';
}

function enhanceQuery(question: string): string {
  const lowerQuestion = question.toLowerCase();

  for (const enhancement of QUERY_ENHANCEMENTS) {
    const hasAllKeywords = enhancement.keywords.every((keyword) =>
      lowerQuestion.includes(keyword)
    );

    if (hasAllKeywords) {
      return `${question} ${enhancement.enhancement}`;
    }
  }

  return question;
}

interface QuestionFile {
  path?: string;
  ext?: string;
  kind: FileKind;
}

interface QueryEnhancement {
  keywords: string[];
  enhancement: string;
  fileHints?: string[];
}

const QUERY_ENHANCEMENTS: QueryEnhancement[] = [
  {
    keywords: ['comando', 'commit'],
    enhancement:
      'commitCommand src/commands/commit.ts CLIA commit generation automatic message conventional',
    fileHints: ['src/commands/commit.ts'],
  },
  {
    keywords: ['rag', 'retrieval'],
    enhancement:
      'RAG retrieval-augmented generation indexing chunking embeddings',
    fileHints: ['src/rag/'],
  },
  {
    keywords: ['config', 'configuração'],
    enhancement: 'configuration setup LLM providers API keys',
    fileHints: ['src/config.ts', 'src/commands/configure.ts'],
  },
  {
    keywords: ['security', 'segurança', 'scan'],
    enhancement: 'security scan vulnerabilities semgrep analysis',
    fileHints: ['src/commands/security-scan.ts'],
  },
];

function extractQuestionFile(raw: string): QuestionFile {
  const quoted = raw.match(/['"]([^'"]+\.[A-Za-z0-9._-]+)['"]/);
  const direct = !quoted
    ? raw.match(/(?:^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9._-]+)(?:\s|$)/)
    : null;
  const p = (quoted?.[1] || direct?.[1])?.trim();
  if (!p) return { kind: 'unknown' };
  const ext = p.split('.').pop()?.toLowerCase() || '';
  const docExts = new Set(['md', 'markdown', 'txt', 'rst', 'adoc']);
  const codeExts = new Set([
    'ts',
    'tsx',
    'js',
    'jsx',
    'py',
    'go',
    'rs',
    'java',
    'cs',
    'rb',
    'php',
    'kt',
    'swift',
  ]);
  const cfgExts = new Set([
    'json',
    'yaml',
    'yml',
    'toml',
    'ini',
    'env',
    'cfg',
    'conf',
    'properties',
  ]);
  let kind: FileKind = 'unknown';
  if (docExts.has(ext)) kind = 'doc';
  else if (codeExts.has(ext)) kind = 'code';
  else if (cfgExts.has(ext)) kind = 'config';
  return { path: p, ext, kind };
}
