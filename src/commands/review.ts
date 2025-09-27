import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Command } from 'commander';

import { loadConfig, Config } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { generateTimestamp } from '../shared/timestamp.js';
import { execPrompt } from '../shared/utils.js';
import { McpClient } from '../mcp/client.js';
import { retrieveForFiles } from '../rag/index.js';
import { makeEmbeddings } from '../embeddings/provider.js';
import {
  getOutputLanguage,
  shouldTranslateReports,
} from '../shared/translation.js';
import { StackDetector } from '../stack/detector.js';
import { getSourceAnalysis } from '../shared/knowledge-base.js';
import { processAskQuery } from './ask.js';

interface ReviewOptions {
  commit?: string;
  tag?: string;
  range?: string;
  branch?: string;
  output?: string;
  outputLanguage: string;
}

interface FileChange {
  filePath: string;
  changeType: string;
  diff?: string;
  ragContext: string;
}

interface FileAnalysisContext {
  target: string;
  mode: string;
  filePath: string;
  changeType: string;
  diff?: string;
  language: string;
  summary: string;
  stackContext: string;
  securityContext: string;
  projectName: string;
  userLanguage: string;
  timestamp: string;
}

interface GroupAnalysisContext {
  target: string;
  mode: string;
  group: string;
  fileAnalyses: FileAnalysisResponse[];
  stackContext: string;
  projectName: string;
  userLanguage: string;
  timestamp: string;
}

interface ConsolidationContext {
  target: string;
  mode: string;
  groupReviews: GroupAnalysisResponse[];
  totalFiles: number;
  stackContext: string;
  projectName: string;
  userLanguage: string;
  timestamp: string;
}

interface FileAnalysisResponse {
  file_path: string;
  change_type: string;
  language: string;
  group: string;
  analysis: {
    purpose: string;
    complexity_score: number;
    security_score: number;
    maintainability_score: number;
    code_quality_score: number;
  };
  issues: {
    security_vulnerabilities: string[];
    code_quality_issues: string[];
    maintainability_concerns: string[];
    performance_concerns: string[];
  };
  recommendations: string[];
  risk_level: 'low' | 'medium' | 'high';
}

interface GroupAnalysisResponse {
  group_name: string;
  files_in_group: string[];
  group_purpose: string;
  consolidated_scores: {
    security_score: number;
    code_quality_score: number;
    maintainability_score: number;
    overall_score: number;
  };
  group_issues: {
    architectural_concerns: string[];
    integration_risks: string[];
    consistency_issues: string[];
  };
  group_recommendations: string[];
  group_risk_level: 'low' | 'medium' | 'high';
}

interface ConsolidationResponse {
  review_summary: {
    target: string;
    mode: string;
    total_files: number;
    total_groups: number;
    timestamp: string;
  };
  overall_assessment: {
    intention: string;
    approach_quality: string;
    architectural_impact: string;
    overall_risk: 'low' | 'medium' | 'high';
  };
  consolidated_metrics: {
    overall_security_score: number;
    overall_code_quality_score: number;
    overall_maintainability_score: number;
    final_score: number;
  };
  decision: {
    recommendation: 'approve' | 'request_changes' | 'reject';
    rationale: string;
    required_changes: string[];
    suggested_improvements: string[];
    next_steps: string[];
  };
  risk_analysis: {
    high_risk_areas: string[];
    medium_risk_areas: string[];
    critical_blockers: string[];
  };
}

export function reviewCommand(): Command {
  return new Command('review')
    .description(`Code review analysis with quality metrics and security assessment
Examples:
  $ clia review                    # Review only staged files (git diff --cached)
  $ clia review --commit abc123    # Review specific commit changes
  $ clia review --tag v1.0.0       # Review changes in git tag
  $ clia review --range HEAD~3..HEAD  # Review commit range
  $ clia review --branch develop   # Review changes compared to branch
Note: Without parameters, only staged files will be reviewed. Use --commit, --tag, or --range to review committed changes.`
    )
    .option('--commit <COMMIT>', 'Specific commit hash to review')
    .option('--tag <TAG>', 'Git tag to review')
    .option('--range <RANGE>', 'Commit range (e.g., "HEAD~5..HEAD")')
    .option('--branch <BRANCH>', 'Branch to compare against (default: main)')
    .option('-o, --output <FILE>', 'Output file path')
    .option(
      '--outputLanguage <OUTPUT_LANGUAGE>',
      'Translate to pt-Br or other language'
    )
    .action(async (options) => {
      const logger = getLogger();
      try {
        await runReviewCommand(options);
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await logger.error(`Review command failed: ${errorMessage}`);
        console.log(`Review command failed: ${errorMessage}`);
        process.exit(1);
      }
    });
}

export async function runReviewCommand(options: ReviewOptions): Promise<void> {
  const startTime = Date.now();
  const logger = getLogger();
  const config = await loadConfig();

  logger.info('Starting code review analysis');

  const { mode, target, files } = await analyzeTarget(options);

  if (files.length === 0) {
    logger.warn('No reviewable files found');
    return;
  }

  const context = await collectContexts(files, config);

  const { consolidatedReview, groupReviews, fileAnalyses } =
    await executeReview(mode, target, files, context, config, options);

  const executionTime = Date.now() - startTime;

  await generateReports(
    consolidatedReview,
    groupReviews,
    fileAnalyses,
    options,
    config,
    executionTime
  );
  displaySummary(consolidatedReview, executionTime);
}

async function analyzeTarget(options: ReviewOptions) {
  let mode: string;
  let target: string;

  if (options.commit) {
    mode = 'commit';
    target = options.commit;
  } else if (options.tag) {
    mode = 'tag';
    target = options.tag;
  } else if (options.range) {
    mode = 'range';
    target = options.range;
  } else if (options.branch) {
    mode = 'branch';
    target = options.branch;
  } else {
    mode = 'working-tree';
    target = 'HEAD';
  }

  const files = await detectChangedFiles(mode, target, options);
  return { mode, target, files };
}

async function detectChangedFiles(
  mode: string,
  target: string,
  options: ReviewOptions
): Promise<FileChange[]> {
  let gitCommand: string;

  switch (mode) {
    case 'commit':
    case 'tag':
      gitCommand = `git show --name-status ${target}`;
      break;
    case 'range':
      gitCommand = `git diff --name-status ${target}`;
      break;
    case 'branch':
      const baseBranch = options.branch || 'main';
      gitCommand = `git diff --name-status ${baseBranch}...HEAD`;
      break;
    default:
      gitCommand = 'git diff --cached --name-status';
      break;
  }

  try {
    const gitOutput = execSync(gitCommand, {
      encoding: 'utf-8',
      cwd: process.cwd(),
    }).trim();

    if (!gitOutput) {
      return [];
    }

    return processGitOutput(gitOutput, mode, target);
  } catch (error) {
    const logger = getLogger();
    logger.error(`Git command failed: ${gitCommand}`);
    return [];
  }
}

async function processGitOutput(
  gitOutput: string,
  mode: string,
  target: string
): Promise<FileChange[]> {
  const files: FileChange[] = [];
  const lines = gitOutput.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    try {
      const parts = line.split('\t');
      const changeType = parts[0];
      const filePath = parts[1] || parts[parts.length - 1];

      if (!isReviewableFile(filePath)) {
        continue;
      }

      let content = '';
      if (
        mode === 'working-tree' &&
        changeType !== 'D' &&
        fs.existsSync(filePath)
      ) {
        content = fs.readFileSync(filePath, 'utf-8');
      } else if (mode !== 'working-tree') {
        try {
          content = execSync(`git show ${target}:${filePath}`, {
            encoding: 'utf-8',
            cwd: process.cwd(),
          });
        } catch {
          content = '';
        }
      }

      const diff = await getFileDiff(filePath, mode, target);

      files.push({
        filePath,
        changeType,
        diff,
        ragContext: await getSourceAnalysis(filePath, processAskQuery),
      });
    } catch (error) {
      continue;
    }
  }

  return files;
}

function isReviewableFile(filePath: string): boolean {
  return (
    filePath.match(
      /\.(ts|js|tsx|jsx|py|java|c|cpp|cs|go|rs|php|rb|swift|kt|scala|sh|yaml|yml|json|xml|sql|md|vue|svelte)$/
    ) !== null
  );
}

async function getFileDiff(
  filePath: string,
  mode: string,
  target: string
): Promise<string> {
  try {
    let diffCommand: string;

    switch (mode) {
      case 'commit':
        diffCommand = `git show ${target} -- ${filePath}`;
        break;
      case 'working-tree':
        diffCommand = `git diff --cached -- ${filePath}`;
        break;
      default:
        diffCommand = `git diff ${target} -- ${filePath}`;
    }

    return execSync(diffCommand, { encoding: 'utf-8', cwd: process.cwd() });
  } catch {
    return '';
  }
}

async function collectContexts(files: FileChange[], config: Config) {
  const logger = getLogger();
  const filePaths = files.map((f) => f.filePath);

  let ragContext = '';
  try {
    const embedder = await makeEmbeddings(
      config.project?.rag || { provider: 'openai' },
      config
    );
    const ragQuery = `Code review context for files: ${filePaths.join(', ')}`;
    const ragResults = await retrieveForFiles(
      ragQuery,
      filePaths,
      filePaths.length,
      embedder
    );
    ragContext = ragResults.join('\n\n---\n\n');
  } catch (error) {
    logger.warn('RAG context unavailable');
    ragContext = 'RAG context unavailable';
  }

  let stackContext: Record<string, unknown> | null = null;
  let projectContext: Record<string, unknown> | null = null;
  let securityContext = '';

  // Load stack analysis from file if available
  try {
    const stackAnalysisPath = path.join(
      process.cwd(),
      '.clia/stack-analysis.json'
    );
    if (fs.existsSync(stackAnalysisPath)) {
      const stackData = JSON.parse(fs.readFileSync(stackAnalysisPath, 'utf-8'));
      stackContext = {
        languages: stackData.raw_stack_data?.secondary
          ?.filter((s: any) => s.type === 'language')
          ?.map((l: any) => l.name) || ['Unknown'],
        frameworks:
          stackData.raw_stack_data?.secondary
            ?.filter((s: any) => s.type === 'framework')
            ?.map((f: any) => f.name) || [],
        build_tools:
          stackData.raw_stack_data?.secondary
            ?.filter(
              (s: any) => s.type === 'tool' || s.type === 'package_manager'
            )
            ?.map((t: any) => t.name) || [],
        primary_runtime:
          ((
            (
              (stackData as Record<string, unknown>).raw_stack_data as Record<
                string,
                unknown
              >
            )?.primary as Record<string, unknown>
          )?.name as string) || 'Unknown',
        confidence: 'high',
      };
    } else {
      const stackDetector = new StackDetector(process.cwd());
      const detectionResult = await stackDetector.detectStack();
      stackContext = {
        languages: detectionResult.languages?.map((l) => l.name) || [],
        frameworks: detectionResult.frameworks?.map((f) => f.name) || [],
        build_tools: detectionResult.tools?.map((t) => t.name) || [],
        confidence: detectionResult.confidence || 'medium',
      };
    }
  } catch (stackError) {
    logger.warn('Stack analysis unavailable, using defaults');
    stackContext = {
      languages: ['Unknown'],
      frameworks: [],
      build_tools: [],
      confidence: 'low',
    };
  }

  // Load project inspection data if available
  try {
    const projectInspectionPath = path.join(
      process.cwd(),
      '.clia/project-inspection.json'
    );
    if (fs.existsSync(projectInspectionPath)) {
      projectContext = JSON.parse(
        fs.readFileSync(projectInspectionPath, 'utf-8')
      );
    }
  } catch (error) {
    projectContext = null;
  }

  try {
    const mcpClient = McpClient.fromConfig();

    const [semgrepResult, trivyResult] = await Promise.allSettled([
      mcpClient.semgrepScan(process.cwd()),
      mcpClient.trivyScan(process.cwd()),
    ]);

    const securityData: Record<string, unknown> = {
      findings: [],
      vulnerabilities: [],
    };

    if (semgrepResult.status === 'fulfilled') {
      securityData.semgrep = {
        findings: semgrepResult.value.findings?.length || 0,
        rules: semgrepResult.value.findings?.map((f) => f.ruleId) || [],
      };
    }

    if (trivyResult.status === 'fulfilled') {
      securityData.trivy = {
        vulnerabilities: trivyResult.value.vulnerabilities?.length || 0,
        severities:
          trivyResult.value.vulnerabilities?.map((v) => v.Severity) || [],
      };
    }

    securityContext = JSON.stringify(securityData.findings);
  } catch (error) {
    logger.warn('Security scanning unavailable');
    securityContext = JSON.stringify({
      error: 'Security scanning unavailable',
    });
  }

  return { ragContext, stackContext, projectContext, securityContext };
}

async function executeReview(
  mode: string,
  target: string,
  files: FileChange[],
  context: {
    ragContext: string;
    stackContext: Record<string, unknown> | null;
    projectContext: Record<string, unknown> | null;
    securityContext: string;
  },
  config: Config,
  options: ReviewOptions
): Promise<{
  consolidatedReview: ConsolidationResponse;
  groupReviews: GroupAnalysisResponse[];
  fileAnalyses: FileAnalysisResponse[];
}> {
  const outputLanguage = resolveOutputLanguage(options, config);
  const timestamp = new Date().toISOString();
  const logger = getLogger();

  logger.info(`Analyzing ${files.length} files individually`);
  const fileAnalyses: FileAnalysisResponse[] = [];

  for (const file of files) {
    const promptContext: FileAnalysisContext = {
      target,
      mode,
      filePath: file.filePath,
      changeType: file.changeType,
      diff: file.diff,
      language: detectFileLanguage(file.filePath),
      summary: file.ragContext,
      stackContext: JSON.stringify(context.stackContext, null, 2),
      securityContext:
        context.securityContext || 'No security context available',
      projectName: config.project?.name || 'Unknown Project',
      userLanguage: outputLanguage,
      timestamp,
    };

    const fileAnalysis = await execPrompt<
      FileAnalysisContext,
      FileAnalysisResponse
    >('review/analyse-source', promptContext, '1.0.0', 'default', 0.3);

    fileAnalyses.push(fileAnalysis);
  }

  // Step 2: Group files by functionality and analyze each group
  const groupedFiles = groupFilesByFunctionality(fileAnalyses);
  const groupReviews: GroupAnalysisResponse[] = [];

  logger.info(
    `Analyzing ${Object.keys(groupedFiles).length} functional groups`
  );

  for (const [groupName, groupFiles] of Object.entries(groupedFiles)) {
    const promptContext: GroupAnalysisContext = {
      target,
      mode,
      group: groupName,
      fileAnalyses: groupFiles,
      stackContext: JSON.stringify(context.stackContext, null, 2),
      projectName:
        ((context.projectContext?.metadata as Record<string, unknown>)
          ?.projectName as string) ||
        config.project?.name ||
        'Unknown Project',
      userLanguage: outputLanguage,
      timestamp,
    };

    const groupReview = await execPrompt<
      GroupAnalysisContext,
      GroupAnalysisResponse
    >('review/analyse-review-group', promptContext, '1.0.0', 'default', 0.3);

    groupReviews.push(groupReview);
  }

  // Step 3: Consolidate all reviews and provide final decision
  logger.info('Consolidating review and generating final decision');

  const promptContext: ConsolidationContext = {
    target,
    mode,
    groupReviews,
    totalFiles: files.length,
    stackContext: JSON.stringify(context.stackContext, null, 2),
    projectName:
      ((context.projectContext?.metadata as Record<string, unknown>)
        ?.projectName as string) ||
      config.project?.name ||
      'Unknown Project',
    userLanguage: outputLanguage,
    timestamp,
  };

  const consolidatedReview = await execPrompt<
    ConsolidationContext,
    ConsolidationResponse
  >(
    'review/sumary-and-opinion-consolidate',
    promptContext,
    '1.0.0',
    'default',
    0.3
  );

  return { consolidatedReview, groupReviews, fileAnalyses };
}

function groupFilesByFunctionality(
  fileAnalyses: FileAnalysisResponse[]
): Record<string, FileAnalysisResponse[]> {
  const groups: Record<string, FileAnalysisResponse[]> = {};

  for (const analysis of fileAnalyses) {
    const groupName = analysis.group || 'uncategorized';
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(analysis);
  }

  return groups;
}

function detectFileLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: { [key: string]: string } = {
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

async function generateReports(
  consolidatedReview: ConsolidationResponse,
  groupReviews: GroupAnalysisResponse[],
  fileAnalyses: FileAnalysisResponse[],
  options: ReviewOptions,
  config: Config,
  executionTime: number
): Promise<void> {
  const timestamp = generateTimestamp();
  const targetSafe = consolidatedReview.review_summary.target.replace(
    /[/\\:~]/g,
    '-'
  );

  const reportsDir = path.join(
    process.cwd(),
    config.reports?.outputDir || '.clia/reports'
  );
  const reviewsDir = path.join(process.cwd(), '.clia/reviews');

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  if (!fs.existsSync(reviewsDir)) {
    fs.mkdirSync(reviewsDir, { recursive: true });
  }

  const markdownContent = generateMarkdownReport(
    consolidatedReview,
    groupReviews,
    fileAnalyses,
    executionTime
  );
  const markdownFile = path.join(
    reportsDir,
    `${timestamp}_review-${targetSafe}.md`
  );
  const jsonFile = path.join(
    reviewsDir,
    `${timestamp}_review-${targetSafe}.json`
  );

  const fullReviewData = {
    consolidatedReview,
    groupReviews,
    fileAnalyses,
    executionTime,
    executionTimeFormatted: formatExecutionTime(executionTime),
  };

  if (options.output) {
    if (options.output.endsWith('.md')) {
      fs.writeFileSync(options.output, markdownContent, 'utf-8');
      console.log(`Markdown report saved: ${options.output}`);
    } else if (options.output.endsWith('.json')) {
      fs.writeFileSync(
        options.output,
        JSON.stringify(fullReviewData, null, 2),
        'utf-8'
      );
      console.log(`JSON report saved: ${options.output}`);
    }
  } else {
    fs.writeFileSync(markdownFile, markdownContent, 'utf-8');
    fs.writeFileSync(
      jsonFile,
      JSON.stringify(fullReviewData, null, 2),
      'utf-8'
    );
    console.log(`Markdown report saved: ${markdownFile}`);
    console.log(`JSON report saved: ${jsonFile}`);
  }
}

function generateMarkdownReport(
  consolidatedReview: ConsolidationResponse,
  groupReviews: GroupAnalysisResponse[],
  fileAnalyses: FileAnalysisResponse[],
  executionTime: number
): string {
  const decision = consolidatedReview.decision.recommendation;
  const decisionText =
    decision === 'approve'
      ? 'APPROVE'
      : decision === 'request_changes'
        ? 'REQUEST CHANGES'
        : 'REJECT';

  let markdown = `# Code Review Report\n\n`;

  markdown += `## Decision: ${decisionText}\n\n`;
  markdown += `**Target**: ${consolidatedReview.review_summary.target}\n\n`;
  markdown += `**Mode**: ${consolidatedReview.review_summary.mode}\n\n`;
  markdown += `**Files Analyzed**: ${consolidatedReview.review_summary.total_files}\n\n`;
  markdown += `**Groups**: ${consolidatedReview.review_summary.total_groups}\n\n`;
  markdown += `**Overall Score**: ${consolidatedReview.consolidated_metrics.final_score}/10\n\n`;
  markdown += `**Execution Time**: ${formatExecutionTime(executionTime)}\n\n`;
  markdown += `**Date**: ${new Date(consolidatedReview.review_summary.timestamp).toLocaleString()}\n\n`;

  markdown += `## Summary\n\n`;
  markdown += `**Intention**: ${consolidatedReview.overall_assessment.intention}\n\n`;
  markdown += `**Approach Quality**: ${consolidatedReview.overall_assessment.approach_quality}\n\n`;
  markdown += `**Architectural Impact**: ${consolidatedReview.overall_assessment.architectural_impact}\n\n`;
  markdown += `**Overall Risk**: ${consolidatedReview.overall_assessment.overall_risk.toUpperCase()}\n\n`;

  markdown += `## Quality Metrics\n\n`;
  markdown += `| Metric | Score |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Security | ${consolidatedReview.consolidated_metrics.overall_security_score}/10 |\n`;
  markdown += `| Code Quality | ${consolidatedReview.consolidated_metrics.overall_code_quality_score}/10 |\n`;
  markdown += `| Maintainability | ${consolidatedReview.consolidated_metrics.overall_maintainability_score}/10 |\n\n`;

  // Add group details
  if (groupReviews.length > 0) {
    markdown += `## Group Analysis\n\n`;
    groupReviews.forEach((group) => {
      markdown += `### ${group.group_name}\n`;
      markdown += `**Purpose**: ${group.group_purpose}\n\n`;
      markdown += `**Files**:\n - ${group.files_in_group.join('\n - ')}\n\n`;
      markdown += `**Risk Level**: ${group.group_risk_level.toUpperCase()}\n\n`;
      markdown += `**Score**: ${group.consolidated_scores.overall_score}/10\n\n`;
    });
  }

  if (consolidatedReview.decision.required_changes.length > 0) {
    markdown += `## Required Changes\n\n`;
    consolidatedReview.decision.required_changes.forEach((change) => {
      markdown += `- ${change}\n`;
    });
    markdown += `\n`;
  }

  if (consolidatedReview.decision.suggested_improvements.length > 0) {
    markdown += `## Suggested Improvements\n\n`;
    consolidatedReview.decision.suggested_improvements.forEach(
      (improvement) => {
        markdown += `- ${improvement}\n`;
      }
    );
    markdown += `\n`;
  }

  markdown += `## Decision Rationale\n\n`;
  markdown += `${consolidatedReview.decision.rationale}\n\n`;

  if (consolidatedReview.decision.next_steps.length > 0) {
    markdown += `**Next Steps**:\n`;
    consolidatedReview.decision.next_steps.forEach((step) => {
      markdown += `- ${step}\n`;
    });
    markdown += `\n`;
  }

  markdown += `\n---\n\n`;
  markdown += `## File-by-File Analysis\n\n`;

  if (fileAnalyses.length === 0) {
    markdown += `*No individual file analyses available.*\n\n`;
  } else {
    fileAnalyses.forEach((file, index) => {
      markdown += `### ${index + 1}. \`${file.file_path}\`\n\n`;

      // Metadados do arquivo
      markdown += `| Property | Value |\n`;
      markdown += `|----------|-------|\n`;
      markdown += `| **Group** | ${file.group} |\n`;
      markdown += `| **Change Type** | ${file.change_type} |\n`;
      markdown += `| **Language** | ${file.language} |\n`;
      markdown += `| **Risk Level** | 🔥 ${file.risk_level.toUpperCase()} |\n\n`;

      // Scores
      markdown += `#### 📊 Quality Scores\n\n`;
      markdown += `| Metric | Score |\n`;
      markdown += `|--------|-------|\n`;
      markdown += `| Complexity | ${file.analysis.complexity_score}/10 |\n`;
      markdown += `| Security | ${file.analysis.security_score}/10 |\n`;
      markdown += `| Maintainability | ${file.analysis.maintainability_score}/10 |\n`;
      markdown += `| Code Quality | ${file.analysis.code_quality_score}/10 |\n\n`;

      // Purpose
      markdown += `#### 🎯 Purpose\n\n`;
      markdown += `${file.analysis.purpose}\n\n`;

      // Recommendations
      if (file.recommendations && file.recommendations.length > 0) {
        markdown += `#### 💡 Recommendations\n\n`;
        file.recommendations.forEach((rec, recIndex) => {
          markdown += `${recIndex + 1}. ${rec}\n`;
        });
        markdown += `\n`;
      }

      // Issues
      const hasIssues =
        [
          ...file.issues.security_vulnerabilities,
          ...file.issues.code_quality_issues,
          ...file.issues.maintainability_concerns,
          ...file.issues.performance_concerns,
        ].length > 0;

      if (hasIssues) {
        markdown += `#### ⚠️ Issues Found\n\n`;

        if (file.issues.security_vulnerabilities.length > 0) {
          markdown += `**🔒 Security Vulnerabilities:**\n`;
          file.issues.security_vulnerabilities.forEach((issue) => {
            markdown += `- ${issue}\n`;
          });
          markdown += `\n`;
        }

        if (file.issues.code_quality_issues.length > 0) {
          markdown += `**🎨 Code Quality Issues:**\n`;
          file.issues.code_quality_issues.forEach((issue) => {
            markdown += `- ${issue}\n`;
          });
          markdown += `\n`;
        }

        if (file.issues.maintainability_concerns.length > 0) {
          markdown += `**Maintainability Concerns:**\n`;
          file.issues.maintainability_concerns.forEach((issue) => {
            markdown += `- ${issue}\n`;
          });
          markdown += `\n`;
        }

        if (file.issues.performance_concerns.length > 0) {
          markdown += `**Performance Concerns:**\n`;
          file.issues.performance_concerns.forEach((issue) => {
            markdown += `- ${issue}\n`;
          });
          markdown += `\n`;
        }
      } else {
        markdown += `#### No Issues Found\n\n`;
        markdown += `This file passed all quality checks without significant issues.\n\n`;
      }

      // Separador entre arquivos
      if (index < fileAnalyses.length - 1) {
        markdown += `---\n\n`;
      }
    });
  }

  markdown += `\n---\n\n`;
  markdown += `*Report generated by CLIA Review v1.0.0*\n`;
  markdown += `*Execution time: ${formatExecutionTime(executionTime)}*\n`;
  markdown += `*Generated on: ${new Date().toLocaleString()}*\n`;
  return markdown;
}

function displaySummary(
  consolidatedReview: ConsolidationResponse,
  executionTime?: number
): void {
  const decision = consolidatedReview.decision.recommendation;

  console.log('\nReview Summary:');
  console.log(`   Decision: ${decision.toUpperCase()}`);
  console.log(
    `   Final Score: ${consolidatedReview.consolidated_metrics.final_score}/10`
  );
  console.log(`   Files: ${consolidatedReview.review_summary.total_files}`);
  console.log(`   Groups: ${consolidatedReview.review_summary.total_groups}`);
  console.log(
    `   Security: ${consolidatedReview.consolidated_metrics.overall_security_score}/10`
  );
  console.log(
    `   Code Quality: ${consolidatedReview.consolidated_metrics.overall_code_quality_score}/10`
  );
  console.log(
    `   Maintainability: ${consolidatedReview.consolidated_metrics.overall_maintainability_score}/10`
  );

  if (executionTime) {
    console.log(`   Execution Time: ${formatExecutionTime(executionTime)}`);
  }

  if (consolidatedReview.decision.required_changes.length > 0) {
    console.log(
      `   Required Changes: ${consolidatedReview.decision.required_changes.length}`
    );
  }

  if (consolidatedReview.risk_analysis.critical_blockers.length > 0) {
    console.log(
      `   Critical Blockers: ${consolidatedReview.risk_analysis.critical_blockers.length}`
    );
  }

  console.log();
}

function resolveOutputLanguage(options: ReviewOptions, config: Config): string {
  return (
    options.outputLanguage ||
    (shouldTranslateReports(config) ? getOutputLanguage(config) : 'en-us')
  );
}

function formatExecutionTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const remainingMs = milliseconds % 1000;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  } else if (seconds > 0) {
    return `${seconds}.${Math.floor(remainingMs / 100)}s`;
  } else {
    return `${milliseconds}ms`;
  }
}
