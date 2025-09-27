import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { execPrompt } from '../shared/utils.js';
import { getOutputLanguage } from '../shared/translation.js';
import { makeEmbeddings } from '../embeddings/provider.js';
import { retrieveForFiles, hasRagDatabase } from '../rag/index.js';
import * as fs from 'fs';
import * as path from 'path';

interface BasePromptContext {
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
  // RAG context is required for project-only mode
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
  code_examples?: Array<{
    language: string;
    code: string;
    description: string;
  }>;
  related_topics?: string[];
  project_references?: string[];
  follow_up_suggestions?: string[];
}

export function askCommand(): Command {
  const cmd = new Command('ask');

  cmd
    .description(
      `
🤖 AI Question Assistant v1.0.0

Intelligent system for technical question answering with AI assistance
and external knowledge enrichment via Standard Command Structure.

Features:
  • Natural language question processing
  • Project-specific context integration via RAG
  • Multilingual query support and translation
  • Code examples and practical solutions
  • Focus mode for project-only context
  • Standard Command Structure v1.0.0

Examples:
  clia ask "How to implement JWT authentication?"
  clia ask "What's the best way to handle async operations?"
  clia ask "Como configurar um servidor Express.js?"
  clia ask "What are the security best practices for APIs?"
  clia ask "How to optimize database queries in this project?"`
    )
    .argument(
      '<question>',
      '❓ Technical question to ask (you can quote a file path)'
    )
    .option(
      '--project-only',
      '📁 Focus only on project context and avoid external/general knowledge',
      false
    )
    .option(
      '--format <type>',
      '📄 Response format: markdown or json (default: markdown)',
      'markdown'
    )
    .option(
      '-o, --output <file>',
      '💾 Save response to file (default: console only)',
      ''
    )
    .option('-k, --limit <number>', '🔢 Maximum RAG contexts to include', '6')
    .action(async (question: string, options) => {
      const logger = getLogger();
      try {
        logger.info('🚀 Starting ask command');
        const result = await processAskQuery(question, options, logger);
        await displayAndSaveResponse(result, options, logger);
        logger.info('✅ Ask command completed successfully');
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`❌ Ask command failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return cmd;
}

export async function processAskQuery(
  question: string,
  options?: any,
  logger?: any
): Promise<AskResponse> {
  const config = await loadConfig();
  const loggerInstance = logger || getLogger();
  const userLanguage = getOutputLanguage(config);

  const questionFilePath = inferFilePathFromQuestion(question);
  const questionFileExt = questionFilePath
    ? questionFilePath.slice(questionFilePath.lastIndexOf('.'))
    : undefined;
  const questionFileKind = kindFromExt(questionFileExt);

  const analysisMode = determineAnalysisMode(
    question,
    options?.projectOnly,
    questionFilePath,
    questionFileKind
  );
  loggerInstance.info(`🎯 Using analysis mode: ${analysisMode}`);

  let result;
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
  console.log('\n🤖 AI Assistant Response (JSON):');
  console.log('='.repeat(60));
  console.log(result);
  console.log('='.repeat(60));
}

async function displayAndSaveResponse(
  result: AskResponse,
  options: any,
  logger: any
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
    await saveResultToFile(content, extension, options, logger);
  }
}

async function saveResultToFile(
  content: string,
  extension: string,
  options: any,
  logger: any
) {
  try {
    let fileName = options.output;
    if (!fileName.includes('.')) {
      fileName += extension;
    }

    // Ensure .clia directory exists
    const cliaDir = path.join(process.cwd(), '.clia');
    if (!fs.existsSync(cliaDir)) {
      fs.mkdirSync(cliaDir, { recursive: true });
    }

    // If relative path, save in .clia directory
    const outputPath = path.isAbsolute(fileName)
      ? fileName
      : path.join(cliaDir, fileName);

    fs.writeFileSync(outputPath, content, 'utf-8');
    logger.info(`💾 Response saved to: ${outputPath}`);
  } catch (error) {
    logger.error(`❌ Failed to save response: ${error}`);
  }
}

function generateMarkdownContent(result: AskResponse): string {
  let content = '# 🤖 AI Assistant Response\n\n';

  content += '## 💬 Answer\n\n';
  content += result.answer + '\n\n';

  if (result.confidence) {
    content += `## 🎯 Confidence: ${result.confidence}%\n\n`;
  }

  if (result.code_examples && result.code_examples.length > 0) {
    content += '## 💻 Code Examples\n\n';
    result.code_examples.forEach((example, index) => {
      content += `### 📝 Example ${index + 1} (${example.language})\n\n`;
      content += `${example.description}\n\n`;
      content += `\`\`\`${example.language}\n${example.code}\n\`\`\`\n\n`;
    });
  }

  if (result.related_topics && result.related_topics.length > 0) {
    content += '## 🔗 Related Topics\n\n';
    result.related_topics.forEach((topic) => {
      content += `- ${topic}\n`;
    });
    content += '\n';
  }

  if (result.project_references && result.project_references.length > 0) {
    content += '## 📁 Project References\n\n';
    result.project_references.forEach((ref) => {
      content += `- ${ref}\n`;
    });
    content += '\n';
  }

  if (result.follow_up_suggestions && result.follow_up_suggestions.length > 0) {
    content += '## 💡 Follow-up Suggestions\n\n';
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
  fileKind?: 'doc' | 'code' | 'config' | 'unknown'
): 'source-analysis' | 'project-only' | 'doc-analysis' | 'general' {
  // If a specific file is referenced and it exists, analyze by file type
  if (filePath && fs.existsSync(filePath)) {
    if (fileKind === 'doc') {
      return 'doc-analysis';
    } else {
      return 'source-analysis';
    }
  }

  // If --project-only flag is used
  if (projectOnly) {
    return 'project-only';
  }

  // Default to general analysis
  return 'general';
}

async function processSourceAnalysis(
  question: string,
  filePath: string,
  config: any,
  userLanguage: string
): Promise<AskResponse> {
  const logger = getLogger();

  try {
    // Read the complete source file
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
      5,
      3
    );

    return response;
  } catch (error) {
    logger.error(`❌ Failed to read source file ${filePath}: ${error}`);
    throw new Error(`Could not read source file: ${filePath}`);
  }
}

async function processDocAnalysis(
  question: string,
  filePath: string,
  config: any,
  userLanguage: string
): Promise<AskResponse> {
  const logger = getLogger();

  try {
    // Read the complete documentation file
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
      5,
      3
    );

    return response;
  } catch (error) {
    logger.error(`❌ Failed to read documentation file ${filePath}: ${error}`);
    throw new Error(`Could not read documentation file: ${filePath}`);
  }
}

async function processProjectOnlyAnalysis(
  question: string,
  config: any,
  userLanguage: string,
  options: any
): Promise<AskResponse> {
  const logger = getLogger();

  let ragContextRaw = '';
  let hasProjectContext = false;
  let hasRag = hasRagDatabase(process.cwd());

  if (!hasRag) {
    throw new Error(
      'Project-only mode requires a valid RAG index. Run "clia rag index" first.'
    );
  }

  try {
    const embedder = await makeEmbeddings(config.project?.rag || {}, config);

    // Enhanced query for better context retrieval in project-only mode
    let enhancedQuery = question;

    // If asking about a specific command, include related terms
    if (
      question.toLowerCase().includes('comando') &&
      question.toLowerCase().includes('commit')
    ) {
      enhancedQuery = `${question} commitCommand src/commands/commit.ts CLIA commit generation automatic message conventional`;
    }

    // Get more context for project-only mode - up to 15 chunks for better coverage
    const ragResults = await retrieveForFiles(enhancedQuery, [], 15, embedder);
    ragContextRaw = ragResults.join('\n---\n');
    hasProjectContext = ragResults.length > 0;

    logger.info(`✅ Found ${ragResults.length} project context chunks`);

    // If still no relevant context found and question is about commit command,
    // try specific file-based search
    if (ragResults.length < 3 && question.toLowerCase().includes('commit')) {
      const commitQuery = 'commitCommand Command commit src/commands/commit';
      const fallbackResults = await retrieveForFiles(
        commitQuery,
        [],
        10,
        embedder
      );

      if (fallbackResults.length > 0) {
        ragContextRaw = fallbackResults.join('\n---\n');
        hasProjectContext = true;
      }
    }
  } catch (error) {
    logger.error(
      'Failed to retrieve RAG context for project-only mode:',
      error
    );
    throw new Error('Could not retrieve project context for project-only mode');
  }

  if (!hasProjectContext) {
    throw new Error(
      'No project context found. Ensure RAG index is properly built with "clia rag index".'
    );
  }

  // Don't truncate context for project-only mode - use full RAG context
  const promptContext: ProjectOnlyPromptContext = {
    question,
    ragContext: ragContextRaw, // Full context for project-only mode
    mcpContext: 'No MCP context available',
    projectName: config.project?.name || 'Unknown Project',
    userLanguage,
  };

  const response = await execPrompt<ProjectOnlyPromptContext, AskResponse>(
    'ask/project-only',
    promptContext,
    '1.0.0',
    'default',
    5,
    3
  );

  return response;
}

async function processGeneralAnalysis(
  question: string,
  config: any,
  userLanguage: string,
  options: any
): Promise<AskResponse> {
  const logger = getLogger();

  const promptContext: GeneralPromptContext = {
    question,
    ragContext: 'No RAG context available',
    mcpContext: 'No MCP context available',
    projectName: config.project?.name || 'Unknown Project',
    userLanguage,
    hasProjectContext: false,
  };

  const response = await execPrompt<GeneralPromptContext, AskResponse>(
    'ask/general',
    promptContext,
    '1.0.0',
    'default',
    5,
    3
  );

  return response;
}

// --- helpers ---------------------------------------------------------------
// 1) Helpers: inferir file path/ext/kind a partir da pergunta
function inferFilePathFromQuestion(q: string): string | undefined {
  // exemplos: "What does the file 'docs/COMPLETE_DEVELOPMENT_GUIDE.md' do?"
  const m = q.match(
    /['"`]([^'"`]+?\.(?:md|txt|rst|ya?ml|json|ts|js|tsx|jsx|toml|ini|conf))['"`]/i
  );
  return m?.[1];
}

function kindFromExt(ext?: string): 'doc' | 'code' | 'config' | 'unknown' {
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

// 2) Truncador de contexto (mantém o RAG "magro")
function truncateContext(input: string, maxChars = 8000): string {
  if (!input) return '';
  return input.length <= maxChars
    ? input
    : input.slice(0, maxChars) + '\n...[truncated]';
}

function extractQuestionFile(raw: string): {
  path?: string;
  ext?: string;
  kind: 'doc' | 'code' | 'config' | 'unknown';
} {
  // tenta achar 'algum/arquivo.ext' entre aspas simples/dobras OU sem aspas
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
  let kind: 'doc' | 'code' | 'config' | 'unknown' = 'unknown';
  if (docExts.has(ext)) kind = 'doc';
  else if (codeExts.has(ext)) kind = 'code';
  else if (cfgExts.has(ext)) kind = 'config';
  return { path: p, ext, kind };
}
