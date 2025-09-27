import { Command } from 'commander';
import { loadConfig, Config } from '../config.js';
import {
  analyzeDiff,
  DiffAnalysis,
  FileChange,
} from '../shared/diff-analyzer.js';
import { getLogger } from '../shared/logger.js';
import * as fs from 'fs';

import { execa } from 'execa';
import { getSourceAnalysis } from '../shared/knowledge-base.js';
import { processAskQuery } from './ask.js';
import { execPrompt } from '../shared/utils.js';
import { approxTokensFromText } from '../shared/tokens.js';

/**
 * Aplica middle-out transform inteligente para prompts de commit
 * Focado em comprimir fileAnalysisData mantendo estrutura essencial
 */
function applyCommitMiddleOutTransform(prompt: string, targetTokens: number = 1600000): string {
  const logger = getLogger();
  const originalTokens = approxTokensFromText(prompt);
  
  if (originalTokens <= targetTokens) {
    return prompt;
  }
  
  // Estratégia específica para commits: focar em fileAnalysisData
  const lines = prompt.split('\n');
  let inFileAnalysis = false;
  let fileAnalysisLines: string[] = [];
  let beforeFileAnalysis: string[] = [];
  let afterFileAnalysis: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('fileAnalysisData') && line.includes('[')) {
      inFileAnalysis = true;
      beforeFileAnalysis = lines.slice(0, i + 1);
      continue;
    }
    
    if (inFileAnalysis) {
      if (line.includes('}]') && !line.includes('},')) {
        fileAnalysisLines.push(line);
        afterFileAnalysis = lines.slice(i + 1);
        break;
      }
      fileAnalysisLines.push(line);
    }
  }
  
  // Se não encontrou fileAnalysisData, usar estratégia genérica
  if (fileAnalysisLines.length === 0) {
    const keepStart = Math.floor(lines.length * 0.4);
    const keepEnd = Math.floor(lines.length * 0.3);
    
    const startSection = lines.slice(0, keepStart).join('\n');
    const endSection = lines.slice(-keepEnd).join('\n');
    const middleSection = '\n\n<!-- [COMMIT CONTENT COMPRESSED FOR CONTEXT LIMITS] -->\n\n';
    
    const result = startSection + middleSection + endSection;
    const finalTokens = approxTokensFromText(result);
    logger.info(`🗜️ Basic commit middle-out: ${originalTokens} → ${finalTokens} tokens (${((1 - finalTokens/originalTokens) * 100).toFixed(1)}% reduction)`);
    return result;
  }
  
  // Comprimir fileAnalysisData mantendo estrutura essencial
  const compressedFileAnalysis: string[] = [];
  let currentFile = '';
  let bracketCount = 0;
  let inFileObject = false;
  
  for (const line of fileAnalysisLines) {
    if (line.trim().startsWith('{"file":')) {
      if (currentFile) {
        // Comprimir arquivo anterior
        compressedFileAnalysis.push(compressFileObject(currentFile));
      }
      currentFile = line;
      inFileObject = true;
      bracketCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    } else if (inFileObject) {
      bracketCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      currentFile += '\n' + line;
      
      if (bracketCount === 0) {
        compressedFileAnalysis.push(compressFileObject(currentFile));
        currentFile = '';
        inFileObject = false;
      }
    } else {
      compressedFileAnalysis.push(line);
    }
  }
  
  if (currentFile) {
    compressedFileAnalysis.push(compressFileObject(currentFile));
  }
  
  const result = beforeFileAnalysis.join('\n') + '\n' + compressedFileAnalysis.join('\n') + '\n' + afterFileAnalysis.join('\n');
  const finalTokens = approxTokensFromText(result);
  logger.info(`🗜️ Smart commit file-aware middle-out: ${originalTokens} → ${finalTokens} tokens (${((1 - finalTokens/originalTokens) * 100).toFixed(1)}% reduction)`);
  
  return result;
}

/**
 * Comprime especificamente o fileAnalysisData para commits
 */
function compressCommitFileAnalysisData(fileAnalysisDataStr: string): string {
  try {
    const files = JSON.parse(fileAnalysisDataStr);
    if (!Array.isArray(files)) {
      return fileAnalysisDataStr;
    }
    
    const compressedFiles = files.map(file => compressFileObject(JSON.stringify(file)));
    const result = JSON.stringify(compressedFiles.map(f => JSON.parse(f)));
    
    // Se ainda está muito grande, aplicar compressão adicional
    const tokens = approxTokensFromText(result);
    if (tokens > 200000) { // Threshold muito mais baixo - 200K
      const logger = getLogger();
      logger.warn(`🗜️ Applying aggressive compression (${tokens} tokens still too large)`);
      
      // Separar arquivos importantes dos menos importantes
      const parsed = compressedFiles.map(f => JSON.parse(f));
      const important = parsed.filter(f => 
        !f.file.includes('package-lock.json') && 
        !f.file.includes('node_modules') &&
        f.insertions + f.deletions < 1000 // Arquivos com poucas mudanças
      );
      
      // Se ainda tem muitos arquivos importantes, manter apenas os primeiros 10
      const final = important.slice(0, 10);
      
      // Adicionar um resumo dos arquivos removidos
      if (parsed.length > final.length) {
        final.push({
          file: '...[OTHER_FILES]',
          status: 'M',
          insertions: parsed.reduce((sum, f) => sum + (f.insertions || 0), 0) - final.reduce((sum, f) => sum + (f.insertions || 0), 0),
          deletions: parsed.reduce((sum, f) => sum + (f.deletions || 0), 0) - final.reduce((sum, f) => sum + (f.deletions || 0), 0),
          path: '...[OTHER_FILES]',
          ragContext: `${parsed.length - final.length} additional files with various changes...`,
          diffAnalysis: 'Multiple files with code changes, dependencies, and configuration updates'
        });
      }
      
      return JSON.stringify(final);
    }
    
    // Se ainda está muito grande mesmo após compressão agressiva, fazer ultra-compressão
    const finalTokens = approxTokensFromText(result);
    if (finalTokens > 500000) {
      const logger = getLogger();
      logger.warn(`🗜️ Applying ultra compression (${finalTokens} tokens still exceeds safe limits)`);
      
      // Ultra compressão - apenas 5 arquivos mais importantes
      const ultraParsed = compressedFiles.map(f => JSON.parse(f));
      const ultraImportant = ultraParsed
        .filter(f => !f.file.includes('package-lock.json') && !f.file.includes('.xlsx') && !f.file.includes('.py'))
        .slice(0, 5);
      
      // Adicionar resumo muito simples
      ultraImportant.push({
        file: '...[TRUNCATED]',
        status: 'M',
        insertions: ultraParsed.reduce((sum, f) => sum + (f.insertions || 0), 0),
        deletions: ultraParsed.reduce((sum, f) => sum + (f.deletions || 0), 0),
        path: '...[TRUNCATED]',
        ragContext: 'Multiple files truncated for context limits...',
        diffAnalysis: 'Various changes including dependencies, docs, and source files'
      });
      
      return JSON.stringify(ultraImportant);
    }
    
    return result;
  } catch (e) {
    // Se não conseguir fazer parse, retornar como está
    return fileAnalysisDataStr;
  }
}

/**
 * Comprime um objeto de arquivo de commit mantendo informações essenciais
 */
function compressFileObject(fileObjectStr: string): string {
  try {
    const fileObj = JSON.parse(fileObjectStr);
    
    // Compressão especial para package-lock.json - muito agressiva
    if (fileObj.file === 'package-lock.json' || fileObj.path === 'package-lock.json') {
      return JSON.stringify({
        file: fileObj.file,
        status: fileObj.status,
        insertions: fileObj.insertions || 0,
        deletions: fileObj.deletions || 0,
        path: fileObj.path,
        ragContext: 'Lock file with dependency changes...',
        diffAnalysis: 'Major dependency update with multiple package changes'
      });
    }
    
    // Manter apenas campos essenciais para análise de commit
    const compressed = {
      file: fileObj.file,
      status: fileObj.status,
      insertions: fileObj.insertions || 0,
      deletions: fileObj.deletions || 0,
      path: fileObj.path,
      ragContext: fileObj.ragContext ? fileObj.ragContext.substring(0, 100) + '...' : '', // Reduzido de 200 para 100
      diffAnalysis: fileObj.diffAnalysis ? 
        (fileObj.diffAnalysis.length > 300 ? fileObj.diffAnalysis.substring(0, 300) + '...' : fileObj.diffAnalysis) // Reduzido de 500 para 300
        : null
    };
    
    return JSON.stringify(compressed);
  } catch (e) {
    // Se não conseguir fazer parse, manter como está mas truncar
    return fileObjectStr.length > 500 ? fileObjectStr.substring(0, 500) + '...' : fileObjectStr; // Reduzido de 1000 para 500
  }
}

interface CommitOptions {
  amend: boolean;
  split: boolean;
  autoStage: boolean;
  force: boolean;
  dryRun: boolean;
}

interface CommitMessage {
  commitSubject: string;
  commitBody: string;
  commitFooter: string;
  files: string[];
}

interface CommitResponse {
  commits: CommitMessage[];
}

interface CommitGroup {
  motivation: string;
  scope: string;
  commitMessage: string;
  description: string;
  reasoning: string;
  priority: number;
  dependencies: string[];
  confidence: number;
  files: Array<{
    path: string;
    intent: string;
    motivation: string;
    category: string;
    scope: string;
    confidence: number;
  }>;
}

interface CommitGroupResponse {
  analysis: {
    totalGroups: number;
    groupingStrategy: string;
    confidence: number;
  };
  groups: CommitGroup[];
}

interface FileAnalysis extends FileChange {
  path: string;
  ragContext: string;
  diffAnalysis: string | null;
}

interface PromptContext {
  projectName: string;
  timestamp: string;
  gitBranch: string;
  userLanguage: string;
  candidateCommits?: string;
  totalFiles?: string;
  fileList?: string;
  fileAnalysisData?: string;
  ragContext?: string;
  mcpContext?: string;
  securityContext?: string;
  lastCommitMessage?: string;
}

export function commitCommand(): Command {
  const command = new Command('commit');

  command
    .description(
      'Intelligent commit message generation with conventional patterns and Standard Command Structure v1.0.0'
    )
    .argument(
      '[taskId]',
      'Task/ticket ID for tracking (Jira, Trello, etc.)',
      ''
    )
    .option('--amend', 'Amend last commit with new message', false)
    .option('--split', 'Split into multiple commits', false)
    .option('--auto-stage', 'Auto-stage all files before analysis', false)
    .option('--force', 'Force commit', false)
    .option(
      '--dry-run',
      'Execute analysis without committing, returns JSON with suggested commits',
      false
    )
    .action(async (taskId, options) => {
      const logger = getLogger();
      try {
        await processCommitOperation(options, taskId);
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await logger.error(`❌ Commit operation failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return command;
}

async function processCommitOperation(
  options: CommitOptions,
  taskId: string
): Promise<void> {
  const logger = getLogger();
  const [targetFiles, diffAnalysis] = await manageStagingArea(options);

  if (diffAnalysis.files.length === 0) {
    const errorMessage = `No changes detected for commit.
    Tip: Use \`git add <files>\` to stage files for commit.
    Or use \`clia commit --auto-stage\` to automatically stage all modified files.
    `;
    throw new Error(errorMessage);
  }

  if (!options.force && diffAnalysis.files.length > 15) {
    const errorMessage = `Too many files selected (${diffAnalysis.files.length}), use --force option or stage fewer files (limit: 15 with intelligent batching)`;
    throw new Error(errorMessage);
  }

  if (options.amend && options.split) {
    throw new Error('Amend option cannot be used together with split');
  }

  logger.info(`Analyzing ${diffAnalysis.files.length} changed files`);
  const result = await executeCommits(diffAnalysis, options, taskId);

  if (options.dryRun) {
    console.log(JSON.stringify({ commits: [result] }, null, 2));
    return;
  }

  logger.info('Commit operation completed successfully');
}

async function getCurrentBranch(): Promise<string> {
  try {
    const result = await execa('git', ['branch', '--show-current']);
    return result.stdout.trim() || 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

async function getCurrentlyStagedFiles(): Promise<string[]> {
  try {
    const result = await execa('git', ['diff', '--cached', '--name-only']);
    return result.stdout.split('\n').filter((file) => file.trim().length > 0);
  } catch (error) {
    return [];
  }
}

async function manageStagingArea(
  options: CommitOptions
): Promise<[string[], DiffAnalysis]> {
  const logger = getLogger();

  if (options.autoStage) {
    logger.info('Auto-staging all modified files');
    await execa('git', ['add', '-A']);
  }

  const stagedFiles = await getCurrentlyStagedFiles();
  const diffAnalysis = await analyzeDiff(true);

  if (options.split) {
    logger.info('Preparing split commit mode');
    await execa('git', ['reset', 'HEAD']);
  }

  return [stagedFiles, diffAnalysis];
}

async function getLastMessage(): Promise<string> {
  const result = await execa('git', ['log', '-1', '--pretty=%B']);
  return result.stdout
    .split('\n')
    .filter((file) => file.trim().length > 0)
    .join();
}

async function applyCommit(
  message: string,
  amend: boolean = false
): Promise<void> {
  const logger = getLogger();
  try {
    let stagedStatus;
    try {
      stagedStatus = await execa('git', ['diff', '--cached', '--name-only']);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Git status check failed: ${errorMessage}`);
    }

    if (!stagedStatus.stdout.trim()) {
      throw new Error('No files staged for commit');
    }

    logger.debug(
      `Files staged for commit: ${stagedStatus.stdout.trim().split('\n').join(', ')}`
    );

    const commitOptions = ['commit'];

    if (amend) {
      commitOptions.push('--amend');
    }

    commitOptions.push('-m');
    commitOptions.push(message);

    await execa('git', commitOptions);
    logger.info(`Commit applied successfully${amend ? ' (amended)' : ''}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Git commit failed: ${errorMessage}`);
  }
}

async function createIntelligentBatches(
  files: FileChange[],
  logger: ReturnType<typeof getLogger>
): Promise<FileChange[][]> {
  const MAX_BATCH_TOKENS = 300000; // ~300k tokens por batch (mais conservador)
  const LARGE_FILE_THRESHOLD = 30000; // 30kb (mais conservador)
  const LARGE_DIFF_LINES = 300; // 300 linhas de diff (mais conservador)

  const batches: FileChange[][] = [];
  let currentBatch: FileChange[] = [];
  let currentBatchTokens = 0;

  for (const file of files) {
    const filePath = file.file || '';
    let estimatedTokens = 0;

    try {
      // Estimar tokens baseado no tamanho do arquivo e diff
      if (file.status === 'D') {
        estimatedTokens = 100; // Arquivo deletado, contexto mínimo
      } else if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;

        // Estimar tokens do arquivo (aproximadamente 4 chars por token)
        const fileTokens = Math.ceil(fileSize / 4);

        // Adicionar tokens do diff (se existir)
        const diffLines =
          file.hunks?.reduce(
            (total, hunk) => total + (hunk.lines?.length || 0),
            0
          ) || 0;
        const diffTokens = diffLines * 20; // ~20 tokens por linha de diff

        estimatedTokens = fileTokens + diffTokens;

        logger.debug(
          `File ${filePath}: ${fileSize} bytes, ${diffLines} diff lines, ~${estimatedTokens} tokens`
        );
      } else {
        // Arquivo novo, estimar baseado no diff
        const diffLines =
          file.hunks?.reduce(
            (total, hunk) => total + (hunk.lines?.length || 0),
            0
          ) || 0;
        estimatedTokens = diffLines * 20;
      }

      // Verificar se é um arquivo grande que deve ser processado sozinho
      const isLargeFile =
        estimatedTokens > LARGE_FILE_THRESHOLD * 4 || // >50kb em tokens
        (file.hunks?.reduce(
          (total, hunk) => total + (hunk.lines?.length || 0),
          0
        ) || 0) > LARGE_DIFF_LINES;

      if (isLargeFile) {
        // Finalizar batch atual se não estiver vazio
        if (currentBatch.length > 0) {
          batches.push([...currentBatch]);
          currentBatch = [];
          currentBatchTokens = 0;
        }

        // Adicionar arquivo grande sozinho
        batches.push([file]);
        logger.debug(
          `Large file processed alone: ${filePath} (~${estimatedTokens} tokens)`
        );
      } else {
        // Verificar se adicionar este arquivo excederia o limite do batch
        if (
          currentBatchTokens + estimatedTokens > MAX_BATCH_TOKENS &&
          currentBatch.length > 0
        ) {
          // Finalizar batch atual
          batches.push([...currentBatch]);
          currentBatch = [];
          currentBatchTokens = 0;
        }

        // Adicionar arquivo ao batch atual
        currentBatch.push(file);
        currentBatchTokens += estimatedTokens;
      }
    } catch (error) {
      logger.warn(`Error estimating tokens for ${filePath}: ${error}`);
      // Em caso de erro, tratar como arquivo pequeno
      if (
        currentBatchTokens + 10000 > MAX_BATCH_TOKENS &&
        currentBatch.length > 0
      ) {
        batches.push([...currentBatch]);
        currentBatch = [];
        currentBatchTokens = 0;
      }
      currentBatch.push(file);
      currentBatchTokens += 10000; // Estimativa conservadora
    }
  }

  // Adicionar último batch se não estiver vazio
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  logger.info(
    `Created ${batches.length} intelligent batches from ${files.length} files`
  );
  batches.forEach((batch, idx) => {
    const fileNames = batch.map((f) => f.file || 'unknown').join(', ');
    logger.debug(`Batch ${idx + 1}: ${batch.length} files - ${fileNames}`);
  });

  return batches;
}

async function executeCommits(
  diffAnalysis: DiffAnalysis,
  options: CommitOptions,
  taskId: string
): Promise<CommitMessage[]> {
  const config = await loadConfig();
  const logger = getLogger();

  const fileBatches = await createIntelligentBatches(
    diffAnalysis.files,
    logger
  );

  let commits: CommitMessage[] = [];

  for (let batchIndex = 0; batchIndex < fileBatches.length; batchIndex++) {
    const batch = fileBatches[batchIndex];
    logger.debug(
      `Processing batch ${batchIndex + 1}/${fileBatches.length} with ${batch.length} files`
    );

    const files = await Promise.all(
      batch.map(async (f: FileChange): Promise<FileAnalysis> => {
        const path = f.file || f.file;
        const fileAnalysis: FileAnalysis = {
          ...f,
          path,
          ragContext: await getSourceAnalysis(path, processAskQuery),
          diffAnalysis:
            f.status === 'D'
              ? 'File Deleted'
              : f.status === 'M'
                ? (await execa('git', ['diff', path])).stdout
                : f.hunks && f.hunks[0] && f.hunks[0].lines
                  ? f.hunks[0].lines.map((line) => line.content).join('')
                  : null,
        };

        return fileAnalysis;
      })
    );

    const generatedCommits = await generateCommits(files, config, logger);
    commits = [...commits, ...generatedCommits];
  }

  const commitFiles = [];

  commitFiles.push(...commits.map((f) => f.files));

  const response = await aggregateSimilar(commits, config, options);
  let countFiles = 0;

  if (!options.dryRun) {
    logger.info(
      `Executing ${response.commits.length} commit${response.commits.length > 1 ? 's' : ''}`
    );

    for (let index = 0; index < response.commits.length; index++) {
      const commit = response.commits[index];
      const fullCommitMessage = `${taskId ? '#' + taskId + ': ' : ''}${commit.commitSubject}\n\n${commit.commitBody}\n\n(${commit.commitFooter})`;

      const validFiles = (commit.files || []).filter(
        (file: string) => file && typeof file === 'string' && file.trim() !== ''
      );

      if (validFiles.length === 0) {
        logger.warn(
          `Skipping commit ${index + 1} with no valid files: ${commit.commitSubject}`
        );
        continue;
      }

      logger.info(
        `Processing commit ${index + 1}/${response.commits.length}: ${commit.commitSubject} (${validFiles.length} files)`
      );

      let stagedFilesCount = 0;
      const stagedFilesList: string[] = [];

      for (const file of validFiles) {
        try {
          if (fs.existsSync(file)) {
            await execa('git', ['add', file]);

            logger.debug(`Staged ${file}`);
          } else {
            await execa('git', [
              'rm',
              '--cached',
              '--ignore-unmatch',
              '--',
              file,
            ]);

            logger.debug(`Staged deletion of ${file}`);
          }

          stagedFilesCount++;
          stagedFilesList.push(file);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `Git staging failed for file ${file}: ${errorMessage}`
          );
        }
      }

      if (stagedFilesCount > 0) {
        countFiles += stagedFilesCount;
        logger.debug(
          `Staged ${stagedFilesCount} files: ${stagedFilesList.join(', ')}`
        );

        await applyCommit(fullCommitMessage, options.amend);
      } else {
        logger.warn(`No files were staged for commit: ${commit.commitSubject}`);
      }
    }

    logger.info(
      `Successfully processed ${countFiles} files in ${response.commits.length} commit${response.commits.length > 1 ? 's' : ''}`
    );
  }

  return commits;
}

async function aggregateSimilar(
  commits: CommitMessage[],
  config: Config,
  options: CommitOptions
): Promise<CommitResponse> {
  const logger = getLogger();

  // Debug: log input commits
  logger.info(`aggregateSimilar received ${commits.length} commits`);
  commits.forEach((commit, i) => {
    logger.debug(`Commit ${i}: ${commit.commitSubject} with ${commit.files?.length || 0} files: ${JSON.stringify(commit.files)}`);
  });

  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    timestamp: new Date().toISOString(),
    gitBranch: await getCurrentBranch(),
    userLanguage: config.translateReports
      ? config.language || 'en-us'
      : 'en-us',
    candidateCommits: JSON.stringify(commits),
  };

  const response = await execPrompt<PromptContext, CommitResponse>(
    'commit/aggregate-similar',
    promptContext,
    '1.0.0',
    'default',
    0.2,
    3
  );

  if (!options.split) {
    // Debug: log what goes into single-aggregate
    logger.info(`Sending to single-aggregate: ${JSON.stringify(response).substring(0, 200)}...`);
    
    const unique = await execPrompt<PromptContext, CommitResponse>(
      'commit/single-aggregate',
      {
        ...promptContext,
        candidateCommits: JSON.stringify(response),
        lastCommitMessage: options.amend ? await getLastMessage() : '',
      },
      '1.0.0',
      'default',
      0.2,
      3
    );

    // Debug: log what comes back from single-aggregate
    logger.info(`Received from single-aggregate: ${unique.commits?.length || 0} commits`);
    unique.commits?.forEach((commit, i) => {
      logger.debug(`Final commit ${i}: ${commit.commitSubject} with ${commit.files?.length || 0} files: ${JSON.stringify(commit.files)}`);
    });

    return unique;
  }

  return response;
}

async function generateCommits(
  files: FileAnalysis[],
  config: Config,
  logger: ReturnType<typeof getLogger>
): Promise<CommitMessage[]> {
  if (!Array.isArray(files) || files.length === 0) {
    logger.warn('No valid files provided to generateCommits');
    return [];
  }

  const validFiles = files.filter(
    (f) => f && typeof f === 'object' && f.path && typeof f.path === 'string'
  );

  if (validFiles.length === 0) {
    logger.warn('No files with valid path property found');
    return [];
  }

  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    timestamp: new Date().toISOString(),
    gitBranch: await getCurrentBranch(),
    totalFiles: validFiles.length.toString(),
    fileList: validFiles.map((f: FileAnalysis) => f.path).join(', '),
    userLanguage: config.translateReports
      ? config.language || 'en-us'
      : 'en-us',
    fileAnalysisData: JSON.stringify(validFiles),
    ragContext: '', // RAG context not needed for basic split
    mcpContext: JSON.stringify(
      {
        gitBranch: await getCurrentBranch(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    ),
    securityContext: '',
  };

  if (
    !promptContext.fileAnalysisData ||
    promptContext.fileAnalysisData === '[]'
  ) {
    throw new Error('No valid file analysis data to send to LLM');
  }

  // Usar execPrompt com compressão customizada se necessário
  let response: CommitGroupResponse;
  const prompt = JSON.stringify(promptContext);
  const estimatedTokens = approxTokensFromText(prompt);
  
  if (estimatedTokens > 300000) { // Reduzido para 300K - muito mais agressivo
    logger.warn(`🗜️ Large context detected (${estimatedTokens} tokens), applying commit-specific compression`);
    // Aplicar compressão diretamente no promptContext
    const compressedContext = {
      ...promptContext,
      fileAnalysisData: compressCommitFileAnalysisData(promptContext.fileAnalysisData || '[]')
    };
    
    response = await execPrompt<PromptContext, CommitGroupResponse>(
      'commit/split-grouping',
      compressedContext,
      '1.0.0',
      'default',
      0.8,
      3
    );
  } else {
    response = await execPrompt<PromptContext, CommitGroupResponse>(
      'commit/split-grouping',
      promptContext,
      '1.0.0',
      'default',
      0.8,
      3
    );
  }

  // Debug: log LLM response
  logger.info(`generateCommits received LLM response with ${response?.groups?.length || 0} groups`);
  logger.debug(`Full LLM response: ${JSON.stringify(response).substring(0, 500)}...`);

  if (!response || !response.groups || !Array.isArray(response.groups)) {
    logger.error('Invalid LLM response structure:', JSON.stringify(response, null, 2));
    throw new Error(
      'Invalid response structure: LLM must return JSON with "analysis" and "groups" properties. Got: ' +
        JSON.stringify(response).substring(0, 200) +
        '...'
    );
  }

  // Validar que cada grupo tem files válidos
  for (let i = 0; i < response.groups.length; i++) {
    const group = response.groups[i];
    if (!group.files || !Array.isArray(group.files)) {
      logger.error(`Group ${i} has invalid files property:`, group);
      throw new Error(`Group ${i} is missing valid files array. Got: ${typeof group.files}`);
    }
  }

  const commits = response.groups.map((group: CommitGroup, index: number): CommitMessage => {
    // Debug: log each group processing
    logger.debug(`Processing group ${index}: ${group.commitMessage} with ${group.files?.length || 0} files`);
    logger.debug(`Group files: ${JSON.stringify(group.files)}`);

    const commitSubject = `${group.commitMessage}`;
    const commitBody = `${group.description}\n${group.files
      .map((file: any) => {
        const path = typeof file === 'string' ? file : file.path;
        const intent = typeof file === 'string' ? 'updated' : file.intent;
        return ` - ${path}: ${intent}`;
      })
      .join('\n')}`;

    const commitFooter = `${group.reasoning}`;
    // Handle both string array and object array formats
    const files = group.files.map((file: any) => 
      typeof file === 'string' ? file : file.path
    );

    // Debug: log what we're creating
    logger.debug(`Created commit: subject="${commitSubject}" with ${files.length} files: ${JSON.stringify(files)}`);

    return {
      commitSubject,
      commitBody,
      commitFooter,
      files,
    };
  });

  return commits;
}
