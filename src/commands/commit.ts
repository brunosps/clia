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
import { execPrompt } from '../shared/utils.js';

interface CommitOptions {
  amend: boolean;
  split: boolean;
  autoStage: boolean;
  force: boolean;
  dryRun: boolean;
}

interface FileCommitAnalysis {
  commitSubject: string;
  commitBody: string;
  commitFooter: string;
  intent: string;
  category: string;
  scope: string;
  file: string;
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

interface PromptContext {
  [key: string]: unknown;
  projectName: string;
  timestamp: string;
  gitBranch: string;
  userLanguage: string;
  candidateCommits?: string;
  lastCommitMessage?: string;
  filePath?: string;
  changeType?: string;
  diff?: string;
  language?: string;
}

export function commitCommand(): Command {
  const command = new Command('commit');

  command
    .description('Generate conventional commit messages with intelligent change analysis v1.0.0')
    .argument('[taskId]', 'Task/ticket ID for tracking (Jira, Trello, etc.)', '')
    .option('--amend', 'Amend last commit with new message', false)
    .option('--split', 'Split into multiple commits', false)
    .option('--auto-stage', 'Auto-stage all files before analysis', false)
    .option('--force', 'Force commit', false)
    .option('--dry-run', 'Execute analysis without committing, returns JSON with suggested commits', false)
    .action(async (taskId, options) => {
      const logger = getLogger();
      try {
        await processCommitOperation(options, taskId);
        process.exit(0);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await logger.error(`❌ Commit operation failed: ${errorMessage}`);
        console.log(`❌ Commit operation failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return command;
}

async function processCommitOperation(options: CommitOptions, taskId: string): Promise<void> {
  const logger = getLogger();
  const [stagedFiles, diffAnalysis] = await manageStagingArea(options);

  if (diffAnalysis.files.length === 0) {
    throw new Error(`No changes detected for commit.
    Tip: Use \`git add <files>\` to stage files for commit.
    Or use \`clia commit --auto-stage\` to automatically stage all modified files.`);
  }

  if (!options.force && diffAnalysis.files.length > 50) {
    throw new Error(`Too many files selected (${diffAnalysis.files.length}), use --force option or stage fewer files`);
  }

  if (options.amend && options.split) {
    throw new Error('Amend option cannot be used together with split');
  }

  logger.info(`Analyzing ${diffAnalysis.files.length} changed files`);
  const commits = await executeCommits(diffAnalysis, options, taskId);

  if (options.dryRun) {
    console.log(JSON.stringify({ commits }, null, 2));
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

async function manageStagingArea(options: CommitOptions): Promise<[string[], DiffAnalysis]> {
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
  return result.stdout.split('\n').filter((file) => file.trim().length > 0).join();
}

async function applyCommit(message: string, amend: boolean = false): Promise<void> {
  const logger = getLogger();
  try {
    let stagedStatus;
    try {
      stagedStatus = await execa('git', ['diff', '--cached', '--name-only']);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Git status check failed: ${errorMessage}`);
    }

    if (!stagedStatus.stdout.trim()) {
      throw new Error('No files staged for commit');
    }

    logger.info(`Files staged for commit: ${stagedStatus.stdout.trim().split('\n').join(', ')}`);

    const commitOptions = ['commit'];
    if (amend) {
      commitOptions.push('--amend');
    }
    commitOptions.push('-m', message);

    await execa('git', commitOptions);
    logger.info(`Commit applied successfully${amend ? ' (amended)' : ''}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Git commit failed: ${errorMessage}`);
  }
}

function detectFileLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'TypeScript',
    js: 'JavaScript',
    py: 'Python',
    java: 'Java',
    cs: 'C#',
    rb: 'Ruby',
    rs: 'Rust',
    go: 'Go',
    php: 'PHP',
    md: 'Markdown',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
  };
  return langMap[ext || ''] || 'Unknown';
}

async function analyzeFileForCommit(file: FileChange, config: Config): Promise<FileCommitAnalysis> {
  const filePath = file.file || '';

  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    timestamp: new Date().toISOString(),
    gitBranch: await getCurrentBranch(),
    userLanguage: 'en-us',
    filePath,
    changeType: file.status || 'M',
    diff: file.diff,
    language: detectFileLanguage(filePath),
  };

  const response = await execPrompt<PromptContext, FileCommitAnalysis>(
    'commit/analyze-file',
    promptContext,
    '1.0.0',
    'default',
    0.8
  );

  return {
    ...response,
    file: filePath,
  };
}

async function executeCommits(
  diffAnalysis: DiffAnalysis,
  options: CommitOptions,
  taskId: string
): Promise<CommitMessage[]> {
  const config = await loadConfig();
  const logger = getLogger();

  logger.info('Analyzing individual file changes');
  const fileAnalyses: FileCommitAnalysis[] = [];

  for (const file of diffAnalysis.files) {
    const analysis = await analyzeFileForCommit(file, config);
    fileAnalyses.push(analysis);
    logger.info(`Analyzed ${analysis.file}: ${analysis.category}(${analysis.scope})`);
  }

  logger.info('Aggregating similar commits');
  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    timestamp: new Date().toISOString(),
    gitBranch: await getCurrentBranch(),
    userLanguage: config.translateReports ? config.language || 'en-us' : 'en-us',
    candidateCommits: JSON.stringify(fileAnalyses.map(fa => ({
      commitSubject: fa.commitSubject,
      commitBody: fa.commitBody,
      commitFooter: fa.commitFooter,
      files: [fa.file]
    }))),
  };

  const aggregated = await execPrompt<PromptContext, CommitResponse>(
    'commit/aggregate-similar',
    promptContext,
    '1.0.0',
    'default',
    0.3
  );

  let finalCommits: CommitMessage[];

  if (!options.split) {
    logger.info('Consolidating into single commit');
    const consolidated = await execPrompt<PromptContext, CommitResponse>(
      'commit/single-aggregate',
      {
        ...promptContext,
        candidateCommits: JSON.stringify(aggregated.commits),
        lastCommitMessage: options.amend ? await getLastMessage() : '',
      },
      '1.0.0',
      'default',
      0.3
    );
    finalCommits = consolidated.commits;
  } else {
    finalCommits = aggregated.commits;
  }

  if (!options.dryRun) {
    logger.info(`Executing ${finalCommits.length} commit${finalCommits.length > 1 ? 's' : ''}`);

    for (let index = 0; index < finalCommits.length; index++) {
      const commit = finalCommits[index];
      const fullCommitMessage = `${taskId ? '#' + taskId + ': ' : ''}${commit.commitSubject}\n\n${commit.commitBody}\n\n(${commit.commitFooter})`;

      const validFiles = (commit.files || []).filter(
        (file: string) => file && typeof file === 'string' && file.trim() !== ''
      );

      if (validFiles.length === 0) {
        logger.warn(`Skipping commit ${index + 1} with no valid files: ${commit.commitSubject}`);
        continue;
      }

      logger.info(`Processing commit ${index + 1}/${finalCommits.length}: ${commit.commitSubject} (${validFiles.length} files)`);

      for (const file of validFiles) {
        try {
          if (fs.existsSync(file)) {
            await execa('git', ['add', file]);
            logger.info(`Staged ${file}`);
          } else {
            await execa('git', ['rm', '--cached', '--ignore-unmatch', '--', file]);
            logger.info(`Staged deletion of ${file}`);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Git staging failed for file ${file}: ${errorMessage}`);
        }
      }

      await applyCommit(fullCommitMessage, options.amend);
    }

    logger.info(`Successfully committed ${finalCommits.length} commit${finalCommits.length > 1 ? 's' : ''}`);
  }

  return finalCommits;
}
