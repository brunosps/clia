import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Command } from 'commander';
import { loadConfig, getProjectName, Config } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { execPrompt } from '../shared/utils.js';
import { discoverFiles, mergeExcludes } from '../rag/indexer.js';
import { detectLanguage } from '../rag/chunker.js';
import { getStackContext } from '../shared/stack-context.js';
import { retrieveForFiles } from '../rag/index.js';
import { generateTimestamp } from '../shared/timestamp.js';
import {
  detectExternalIntegrations,
  analyzeProjectIntegrations,
} from '../shared/external-integrations-detector.js';

// Interface for project inspection data
interface ProjectInspection {
  summary: {
    primaryLanguage: string;
    projectType: string;
    complexity: string;
    maturityLevel: string;
    ragReadiness: string;
    totalFiles: number;
  };
  languages: Array<{
    name: string;
    files: number;
    confidence: number;
  }>;
  frameworks: Array<{
    name: string;
    language: string;
    version?: string;
    category: string;
  }>;
  packageManagers: Array<{
    name: string;
    configFile: string;
    dependenciesCount?: number;
  }>;
  ragOptimization: {
    directoryStructure: {
      includePaths: string[];
      excludePaths: string[];
    };
    chunkingStrategy: string;
    recommendedIndexingConfig: {
      chunkSize: number;
      chunkOverlap: number;
    };
    estimatedIndexSize: string;
    filePatterns: {
      exclude: string[];
    };
  };
  recommendations: {
    modernization: string[];
    security: string[];
    performance: string[];
    tooling: string[];
    documentation: string[];
  };
  metadata: {
    projectName: string;
    version: string;
    confidence: number;
  };
}

export function registerAnalyzeCommand(program: Command): void {
  program
    .command('analyze [paths...]')
    .alias('analyse')
    .description(
      '🔍 Comprehensive code quality and security analysis with dynamic batch processing'
    )
    .option('-o, --output <path>', 'Output directory for reports')
    .option('--include-tests', 'Include test files in analysis')
    .option('--format <format>', 'Output format: json, markdown, both', 'both')
    .option(
      '--outputLanguage <OUTPUT_LANGUAGE>',
      'Translate to pt-Br or other language'
    )
    .action(async (paths: string[], options: AnalyzeOptions) => {
      try {
        await runAnalyze({
          ...options,
          paths: paths.length > 0 ? paths : [process.cwd()],
        });
        process.exit(0);
      } catch (error) {
        console.error('❌ Analyze command failed:', error);
        process.exit(1);
      }
    });
}

async function updateCacheWithAnalysisResults(
  batchResults: any[],
  config: any
): Promise<void> {
  const logger = getLogger();
  const cache = await loadCache();
  let cacheUpdated = false;

  for (const batchResult of batchResults) {
    if (
      batchResult.analysis &&
      batchResult.analysis.file_analyses &&
      Array.isArray(batchResult.analysis.file_analyses)
    ) {
      for (const analysis of batchResult.analysis.file_analyses) {
        const filePath = analysis.file;
        const cached = cache[filePath];

        if (cached) {
          cached.fullAnalysis = analysis;
          cached.timestamp = new Date().toISOString();
          cacheUpdated = true;
        }
      }
    }
  }

  if (cacheUpdated) {
    await saveCache(cache);
    logger.info('🚀 Cache updated with analysis results');
  }
}

function createAnalysisResult(
  allAnalyses: any[],
  totalFiles: number
): AnalysisResult {
  const timestamp = new Date().toISOString();

  return {
    metadata: {
      projectName: getProjectName(),
      timestamp,
      totalFiles,
      analysisMode: 'cached-optimized',
      promptVersion: '1.0.0',
    },
    file_analyses: allAnalyses,
    consolidated_findings: {
      critical_issues: extractCriticalIssues(allAnalyses),
      high_priority_issues: extractHighPriorityIssues(allAnalyses),
      improvement_opportunities: extractImprovementOpportunities(allAnalyses),
    },
    metrics: {
      overall_project_score: calculateOverallScore(allAnalyses),
      total_issues: countTotalIssues(allAnalyses),
      files_with_issues: countFilesWithIssues(allAnalyses),
    },
    recommendations: {
      immediate_actions: extractImmediateActions(allAnalyses),
      short_term_improvements: extractShortTermImprovements(allAnalyses),
      long_term_strategic: extractLongTermStrategic(allAnalyses),
    },
  };
}

function extractCriticalIssues(analyses: any[]): string[] {
  const issues: string[] = [];
  for (const analysis of analyses) {
    if (analysis.security_analysis?.vulnerabilities) {
      for (const vuln of analysis.security_analysis.vulnerabilities) {
        if (vuln.severity === 'high' || vuln.severity === 'critical') {
          issues.push(`${analysis.file}: ${vuln.description}`);
        }
      }
    }
  }
  return issues;
}

function extractHighPriorityIssues(analyses: any[]): string[] {
  const issues: string[] = [];
  for (const analysis of analyses) {
    if (analysis.overall_assessment?.priority === 'high') {
      issues.push(
        `${analysis.file}: ${analysis.overall_assessment.impact_assessment}`
      );
    }
  }
  return issues;
}

function extractImprovementOpportunities(analyses: any[]): string[] {
  const opportunities: string[] = [];
  for (const analysis of analyses) {
    if (analysis.recommendations?.architectural_improvements) {
      opportunities.push(
        ...analysis.recommendations.architectural_improvements.map(
          (imp: string) => `${analysis.file}: ${imp}`
        )
      );
    }
  }
  return opportunities;
}

function calculateOverallScore(analyses: any[]): number {
  if (analyses.length === 0) return 0;
  const sum = analyses.reduce(
    (acc, analysis) => acc + (analysis.overall_assessment?.overall_score || 0),
    0
  );
  return Math.round(sum / analyses.length);
}

function countTotalIssues(analyses: any[]): number {
  let count = 0;
  for (const analysis of analyses) {
    if (analysis.security_analysis?.vulnerabilities) {
      count += analysis.security_analysis.vulnerabilities.length;
    }
    if (analysis.clean_code_analysis?.complexity_concerns) {
      count += analysis.clean_code_analysis.complexity_concerns.length;
    }
  }
  return count;
}

function countFilesWithIssues(analyses: any[]): number {
  return analyses.filter((analysis) => {
    return (
      (analysis.security_analysis?.vulnerabilities?.length || 0) > 0 ||
      (analysis.clean_code_analysis?.complexity_concerns?.length || 0) > 0 ||
      analysis.overall_assessment?.risk_level !== 'low'
    );
  }).length;
}

function extractImmediateActions(analyses: any[]): string[] {
  const actions: string[] = [];
  for (const analysis of analyses) {
    if (analysis.recommendations?.security_improvements) {
      actions.push(
        ...analysis.recommendations.security_improvements.map(
          (imp: string) => `${analysis.file}: ${imp}`
        )
      );
    }
  }
  return actions;
}

function extractShortTermImprovements(analyses: any[]): string[] {
  const improvements: string[] = [];
  for (const analysis of analyses) {
    if (analysis.recommendations?.code_quality_improvements) {
      improvements.push(
        ...analysis.recommendations.code_quality_improvements.map(
          (imp: string) => `${analysis.file}: ${imp}`
        )
      );
    }
  }
  return improvements;
}

function extractLongTermStrategic(analyses: any[]): string[] {
  const strategic: string[] = [];
  for (const analysis of analyses) {
    if (analysis.recommendations?.architectural_improvements) {
      strategic.push(
        ...analysis.recommendations.architectural_improvements.map(
          (imp: string) => `${analysis.file}: ${imp}`
        )
      );
    }
  }
  return strategic;
}
import { McpClient } from '../mcp/client.js';
import { getSourceAnalysis } from '../shared/knowledge-base.js';
import { processAskQuery } from './ask.js';
import {
  getOutputLanguage,
  shouldTranslateReports,
} from '../shared/translation.js';

interface AnalyzeOptions {
  paths?: string[];
  output?: string;
  includeTests?: boolean;
  format?: 'json' | 'markdown' | 'both';
  detailed?: boolean;
  outputLanguage: string;
}

interface FileAnalysisData {
  file: string;
  language: string;
  content: string;
  size: number;
  complexity_estimate: number;
  complexity_tier: 'low' | 'medium' | 'high';
  ragContext?: string;
}

interface FileBatch {
  files: FileAnalysisData[];
  tier: 'low' | 'medium' | 'high';
  batchSize: number;
  totalTokenEstimate: number;
}

interface BatchAnalysisResult {
  batchId: number;
  tier: 'low' | 'medium' | 'high';
  files: string[];
  analysis: any;
}

interface CacheEntry {
  contentHash: string;
  timestamp: string;
  analysis: FileAnalysisData;
  // Cache completo da análise LLM (quando disponível)
  fullAnalysis?: {
    file: string;
    language: string;
    purpose?: string;
    security_analysis?: any;
    clean_code_analysis?: any;
    solid_analysis?: any;
    maintainability_analysis?: any;
    performance_analysis?: any;
    integration_analysis?: any;
    overall_assessment?: any;
    recommendations?: any;
  };
}

/**
 * Load project inspection data to get exclude paths
 */
async function loadProjectInspection(): Promise<ProjectInspection | null> {
  try {
    const inspectionPath = path.join(
      process.cwd(),
      '.clia',
      'project-inspection.json'
    );
    if (!fs.existsSync(inspectionPath)) {
      return null;
    }
    const content = await fs.promises.readFile(inspectionPath, 'utf-8');
    return JSON.parse(content) as ProjectInspection;
  } catch (error) {
    getLogger().warn('⚠️ Failed to load project inspection data:', error);
    return null;
  }
}

/**
 * Get exclude paths from project inspection data
 */
/**
 * Usa sistema centralizado mergeExcludes para exclusões dinâmicas agnósticas
 * Segue o princípio: "100% real data via MCP integration - Zero simulations"
 * Inclui automaticamente exclusão da pasta .clia e outras exclusões sistêmicas
 */
function getExcludePaths(
  inspection: ProjectInspection | null,
  configExcludes: string[] = [],
  config?: any
): string[] {
  // 1. DADOS REAIS: Usar sistema mergeExcludes para exclusões dinâmicas centralizadas
  const systemExcludes = mergeExcludes(config || {}, null);

  // 2. DADOS REAIS: Combinar com exclusões específicas do analyze
  const allExcludes = new Set<string>([...systemExcludes, ...configExcludes]);

  // 3. DADOS REAIS: Adicionar exclusões descobertas na inspeção do projeto (se disponível)
  if (inspection?.ragOptimization?.directoryStructure?.excludePaths) {
    inspection.ragOptimization.directoryStructure.excludePaths.forEach(
      (exclude) => {
        allExcludes.add(exclude);
      }
    );
  }

  // 4. DADOS REAIS: Adicionar padrões de arquivos descobertos (se disponível)
  if (inspection?.ragOptimization?.filePatterns?.exclude) {
    inspection.ragOptimization.filePatterns.exclude.forEach((pattern) => {
      allExcludes.add(pattern);
    });
  }

  return Array.from(allExcludes);
}

interface CacheData {
  [filePath: string]: CacheEntry;
}

interface AnalysisResult {
  metadata: {
    projectName: string;
    timestamp: string;
    totalFiles: number;
    analysisMode: string;
    promptVersion: string;
  };
  file_analyses: any[];
  consolidated_findings: any;
  metrics: any;
  recommendations: any;
}

// Cache functions
function generateContentHash(content: string): string {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

async function loadCache(): Promise<CacheData> {
  const cacheFile = path.join(process.cwd(), '.clia', 'analyze-cache.json');
  try {
    if (fs.existsSync(cacheFile)) {
      const content = await fs.promises.readFile(cacheFile, 'utf8');
      return JSON.parse(content) as CacheData;
    }
  } catch (error) {
    // Just return empty cache on error
  }
  return {};
}

async function saveCache(cache: CacheData): Promise<void> {
  const cliaDir = path.join(process.cwd(), '.clia');
  await fs.promises.mkdir(cliaDir, { recursive: true });

  const cacheFile = path.join(cliaDir, 'analyze-cache.json');
  await fs.promises.writeFile(cacheFile, JSON.stringify(cache, null, 2));
}

function isCacheValid(entry: CacheEntry, currentHash: string): boolean {
  const cacheTime = new Date(entry.timestamp).getTime();
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

  return entry.contentHash === currentHash && now - cacheTime < maxAge;
}

function hasFullAnalysisCache(entry: CacheEntry, currentHash: string): boolean {
  return isCacheValid(entry, currentHash) && entry.fullAnalysis !== undefined;
}

/**
 * Standard Command Structure v1.0.0
 * Pattern: loadConfig → makeLLMForTier → PromptTemplateEngine → Batch Processing
 */
async function runAnalyze(options: AnalyzeOptions): Promise<void> {
  const logger = getLogger();
  const config = loadConfig();

  logger.info('🔍 Starting code analysis');

  try {
    const targetPaths = options.paths || [process.cwd()];
    const { filesToProcess, cachedAnalyses } = await discoverAndPrepareFiles(
      targetPaths,
      config,
      options
    );

    const totalFiles = filesToProcess.length + cachedAnalyses.length;
    if (totalFiles === 0) {
      logger.warn('⚠️ No files found for analysis');
      return;
    }

    if (filesToProcess.length > 0) {
      logger.info(
        `📝 Analyzing ${filesToProcess.length} files (${cachedAnalyses.length} from cache)`
      );
    }

    let batchResults: any[] = [];

    if (filesToProcess.length > 0) {
      const batches = createComplexityBatches(filesToProcess);
      const contexts = await collectContexts(
        [...filesToProcess, ...cachedAnalyses.map((c) => c.analysis)],
        config
      );

      batchResults = await processBatchesInParallel(
        batches,
        contexts,
        config,
        options
      );

      await updateCacheWithAnalysisResults(batchResults, config);
    }

    const allAnalyses = [
      ...cachedAnalyses.map((c) => c.fullAnalysis),
      ...batchResults.flatMap((b) => b.analysis?.file_analyses || []),
    ];

    const analysisResult = createAnalysisResult(allAnalyses, totalFiles);
    await saveAnalysisResults(analysisResult, options, config);
    displaySummary(analysisResult);
  } catch (error) {
    logger.error('❌ Analysis failed:', error);
    throw error;
  }
}

async function discoverAndPrepareFiles(
  targetPaths: string[],
  config: any,
  options: AnalyzeOptions
): Promise<{
  filesToProcess: FileAnalysisData[];
  cachedAnalyses: { analysis: FileAnalysisData; fullAnalysis: any }[];
}> {
  const logger = getLogger();

  // Load project inspection to get exclude paths
  const projectInspection = await loadProjectInspection();
  const excludePaths = getExcludePaths(
    projectInspection,
    config.project?.rag?.excludes || [],
    config
  );

  if (excludePaths.length > 0) {
    logger.info(`🚫 Using exclude paths: ${excludePaths.join(', ')}`);
  }

  // Load existing cache
  const cache = await loadCache();
  let cacheUpdated = false;

  const filesToProcess: FileAnalysisData[] = [];
  const cachedAnalyses: { analysis: FileAnalysisData; fullAnalysis: any }[] =
    [];

  for (const targetPath of targetPaths) {
    const discoveredFiles = await discoverFiles(
      process.cwd(),
      [targetPath],
      excludePaths
    );

    for (const filePath of discoveredFiles) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const language = detectLanguage(filePath);
        const stats = await fs.promises.stat(filePath);
        const maxSizeBytes = 0.1 * 1024 * 1024; // 0.1 MB

        if (stats.size > maxSizeBytes) {
          logger.info(
            `⚠️ Skipping large file: ${stats.size} ${filePath} (${Math.round(stats.size / 1024)}KB)`
          );
          continue;
        }

        const relativePath = path.relative(process.cwd(), filePath);
        const contentHash = generateContentHash(content);

        const cached = cache[relativePath];
        if (cached && hasFullAnalysisCache(cached, contentHash)) {
          cachedAnalyses.push({
            analysis: cached.analysis,
            fullAnalysis: cached.fullAnalysis!,
          });
          continue;
        }

        const complexityEstimate = estimateComplexity(content, language);
        const complexityTier = determineComplexityTier(
          complexityEstimate,
          stats.size
        );

        // Get source analysis using Knowledge Base
        const ragContext = await getSourceAnalysis(
          relativePath,
          processAskQuery
        );

        const fileAnalysis: FileAnalysisData = {
          file: relativePath,
          language,
          content:
            content.length <= 8000
              ? content
              : content.substring(0, 8000) + '...\n[Content truncated]', // Limit content size
          size: stats.size,
          complexity_estimate: complexityEstimate,
          complexity_tier: complexityTier,
          ragContext,
        };

        filesToProcess.push(fileAnalysis);

        // Update cache with basic analysis
        cache[relativePath] = {
          contentHash,
          timestamp: new Date().toISOString(),
          analysis: fileAnalysis,
        };
        cacheUpdated = true;
      } catch (error) {
        throw new Error(`Failed to read file ${filePath}: ${error}`);
      }
    }
  }

  if (cacheUpdated) {
    await saveCache(cache);
  }

  // Sort files to process by complexity (high first) for priority processing
  const sortedFilesToProcess = filesToProcess.sort(
    (a, b) => b.complexity_estimate - a.complexity_estimate
  );

  return { filesToProcess: sortedFilesToProcess, cachedAnalyses };
}

function determineComplexityTier(
  complexity: number,
  fileSize: number
): 'low' | 'medium' | 'high' {
  // High complexity: complex files or large files
  if (complexity > 500 || fileSize > 20000) {
    return 'high';
  }
  // Medium complexity: moderate complexity
  if (complexity > 150 || fileSize > 5000) {
    return 'medium';
  }
  // Low complexity: simple files
  return 'low';
}

function createComplexityBatches(files: FileAnalysisData[]): FileBatch[] {
  const batches: FileBatch[] = [];
  const filesByTier = {
    low: files.filter((f) => f.complexity_tier === 'low'),
    medium: files.filter((f) => f.complexity_tier === 'medium'),
    high: files.filter((f) => f.complexity_tier === 'high'),
  };

  // Process high complexity files individually (1 per batch)
  filesByTier.high.forEach((file) => {
    batches.push({
      files: [file],
      tier: 'high',
      batchSize: 1,
      totalTokenEstimate: estimateTokens(file.content),
    });
  });

  // Process medium complexity files in small batches (max 3)
  const mediumBatches = createBatchesForTier(filesByTier.medium, 3, 6000);
  batches.push(
    ...mediumBatches.map((batch) => ({
      files: batch,
      tier: 'medium' as const,
      batchSize: batch.length,
      totalTokenEstimate: batch.reduce(
        (sum, f) => sum + estimateTokens(f.content),
        0
      ),
    }))
  );

  // Process low complexity files in larger batches (max 5)
  const lowBatches = createBatchesForTier(filesByTier.low, 5, 8000);
  batches.push(
    ...lowBatches.map((batch) => ({
      files: batch,
      tier: 'low' as const,
      batchSize: batch.length,
      totalTokenEstimate: batch.reduce(
        (sum, f) => sum + estimateTokens(f.content),
        0
      ),
    }))
  );

  return batches;
}

function createBatchesForTier(
  files: FileAnalysisData[],
  maxFiles: number,
  maxTokens: number
): FileAnalysisData[][] {
  const batches: FileAnalysisData[][] = [];
  let currentBatch: FileAnalysisData[] = [];
  let currentTokens = 0;

  for (const file of files) {
    const fileTokens = estimateTokens(file.content);

    if (
      currentBatch.length >= maxFiles ||
      (currentTokens + fileTokens > maxTokens && currentBatch.length > 0)
    ) {
      batches.push(currentBatch);
      currentBatch = [file];
      currentTokens = fileTokens;
    } else {
      currentBatch.push(file);
      currentTokens += fileTokens;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

async function processBatchesInParallel(
  batches: FileBatch[],
  contexts: any,
  config: any,
  options: AnalyzeOptions
): Promise<BatchAnalysisResult[]> {
  const results: BatchAnalysisResult[] = [];

  const highBatches = batches.filter((b) => b.tier === 'high');
  const otherBatches = batches.filter((b) => b.tier !== 'high');

  for (let i = 0; i < highBatches.length; i++) {
    const batch = highBatches[i];
    const analysis = await processBatch(
      batch,
      contexts,
      config,
      i + 1,
      options
    );
    results.push({
      batchId: i + 1,
      tier: batch.tier,
      files: batch.files.map((f) => f.file),
      analysis,
    });
  }

  const concurrencyLimit = 3;
  for (let i = 0; i < otherBatches.length; i += concurrencyLimit) {
    const batchGroup = otherBatches.slice(i, i + concurrencyLimit);
    const groupResults = await Promise.all(
      batchGroup.map(async (batch, index) => {
        const batchId = highBatches.length + i + index + 1;
        const analysis = await processBatch(
          batch,
          contexts,
          config,
          batchId,
          options
        );
        return {
          batchId,
          tier: batch.tier,
          files: batch.files.map((f) => f.file),
          analysis,
        };
      })
    );
    results.push(...groupResults);
  }

  return results;
}

function resolveOutputLanguage(
  options: AnalyzeOptions,
  config: Config
): string {
  return (
    options.outputLanguage ||
    (shouldTranslateReports(config) ? getOutputLanguage(config) : 'en-us')
  );
}

async function processBatch(
  batch: FileBatch,
  contexts: any,
  config: any,
  batchId: number,
  options: AnalyzeOptions
): Promise<any> {
  const outputLanguage = resolveOutputLanguage(options, config);
  const promptData = {
    projectName: getProjectName(),
    batchId: batchId.toString(),
    complexityTier: batch.tier,
    totalFiles: batch.files.length.toString(),
    fileAnalysisData: JSON.stringify(batch.files, null, 2),
    stackContext: contexts.stackContext,
    ragContext: batch.files.map((f) => f.ragContext).join('\n\n'),
    securityContext: contexts.securityContext,
    integrationContext: contexts.integrationContext,
    userLanguage: outputLanguage,
  };

  try {
    return await execPrompt<any, any>(
      'analyze/system',
      promptData,
      '1.0.0',
      'default',
      7,
      3
    );
  } catch (error) {
    throw new Error(
      `Failed to process batch ${batchId} (${batch.tier} complexity): ${error}`
    );
  }
}

async function collectContexts(files: FileAnalysisData[], config: any) {
  const stackContext = await getStackContext();

  const filePaths = files.map((f: FileAnalysisData) => f.file);
  let ragContext;
  try {
    ragContext =
      filePaths.length > 0
        ? await retrieveForFiles('code analysis context', filePaths, 6)
        : [];
  } catch (error) {
    ragContext = [];
  }

  let securityContext = '';
  try {
    const mcpClient = McpClient.fromConfig();
    const semgrepReport = await mcpClient.semgrepScan();
    const trivyReport = await mcpClient.trivyScan();

    securityContext = JSON.stringify(
      {
        semgrep_findings: semgrepReport?.findings || [],
        trivy_findings: trivyReport?.vulnerabilities || [],
        scan_summary: `${semgrepReport?.findings?.length || 0} semgrep + ${trivyReport?.vulnerabilities?.length || 0} trivy findings`,
      },
      null,
      2
    );
  } catch (error) {
    securityContext = 'Security context unavailable - MCP offline';
  }

  let integrationContext = '';
  try {
    const fileIntegrationAnalyses = [];

    for (const file of files) {
      const integrationAnalysis = detectExternalIntegrations(
        file.file,
        file.content,
        file.language
      );

      if (integrationAnalysis.integrations.length > 0) {
        fileIntegrationAnalyses.push(integrationAnalysis);
      }
    }

    if (fileIntegrationAnalyses.length > 0) {
      const projectIntegrationAnalysis = analyzeProjectIntegrations(
        fileIntegrationAnalyses
      );

      integrationContext = JSON.stringify(
        {
          file_integrations: fileIntegrationAnalyses,
          project_summary: projectIntegrationAnalysis,
          detection_summary: `${projectIntegrationAnalysis.totalIntegrations} integrations detected across ${fileIntegrationAnalyses.length} files`,
        },
        null,
        2
      );
    } else {
      integrationContext =
        'No external integrations detected in analyzed files';
    }
  } catch (error) {
    throw new Error(`Integration detection failed: ${error}`);
  }

  return {
    stackContext: JSON.stringify(stackContext, null, 2),
    ragContext:
      ragContext?.map((r: any) => r.content).join('\n\n') ||
      'No RAG context available',
    securityContext,
    integrationContext,
  };
}

async function saveAnalysisResults(
  result: AnalysisResult,
  options: AnalyzeOptions,
  config: any
) {
  const cliaDir = path.join(process.cwd(), '.clia');
  const reportsDir = path.join(cliaDir, 'reports');
  await fs.promises.mkdir(reportsDir, { recursive: true });

  const timestamp = generateTimestamp();
  const baseFilename = `${timestamp}_analyze`;

  const jsonPath = path.join(reportsDir, `${baseFilename}.json`);
  await fs.promises.writeFile(jsonPath, JSON.stringify(result, null, 2));

  if (
    options.format === 'markdown' ||
    options.format === 'both' ||
    !options.format
  ) {
    const markdownPath = path.join(reportsDir, `${baseFilename}.md`);
    const markdownContent = generateMarkdownReport(result, true);
    await fs.promises.writeFile(markdownPath, markdownContent);
  }
}

function generateMarkdownReport(
  result: AnalysisResult,
  detailed: boolean = true
): string {
  const executionTime = result.metadata.timestamp
    ? `**Execution Time**: Analysis completed at ${new Date(result.metadata.timestamp).toLocaleString()}`
    : '';

  let markdown = `# 🔍 Code Analysis Report

## 📋 Summary

**Project**: ${result.metadata.projectName}  
**Files Analyzed**: ${result.metadata.totalFiles}  
**Analysis Mode**: ${result.metadata.analysisMode}  
**Date**: ${new Date(result.metadata.timestamp).toLocaleString()}  
**Overall Score**: ${result.metrics.overall_project_score}/10  
${executionTime}

## 📊 Metrics

- **Overall Project Score**: ${result.metrics.overall_project_score}/10
- **Total Issues Found**: ${result.metrics.total_issues}
- **Files with Issues**: ${result.metrics.files_with_issues || 0}

## 🚨 Critical Findings

${result.consolidated_findings.critical_issues?.map((issue: string) => `- ${issue}`).join('\n') || 'No critical issues found'}

## 🔧 Recommendations

### Immediate Actions
${result.recommendations.immediate_actions?.map((action: string) => `- ${action}`).join('\n') || 'No immediate actions required'}

### Short-term Improvements  
${result.recommendations.short_term_improvements?.map((improvement: string) => `- ${improvement}`).join('\n') || 'No short-term improvements suggested'}

### Long-term Strategic
${result.recommendations.long_term_strategic?.map((strategic: string) => `- ${strategic}`).join('\n') || 'No long-term strategic recommendations'}`;

  // Add detailed file-by-file analysis
  if (detailed && result.file_analyses && result.file_analyses.length > 0) {
    markdown += `\n\n---

## 📄 File-by-File Analysis

`;

    result.file_analyses.forEach((fileAnalysis: any, index: number) => {
      const riskLevel = getRiskLevelEmoji(
        fileAnalysis.overall_assessment?.risk_level
      );
      const scores =
        fileAnalysis.clean_code_analysis?.clean_code_score || 'N/A';
      const securityScore =
        fileAnalysis.security_analysis?.security_score || 'N/A';
      const maintainabilityScore =
        fileAnalysis.maintainability_analysis?.maintainability_score || 'N/A';
      const performanceScore =
        fileAnalysis.performance_analysis?.performance_score || 'N/A';

      markdown += `### ${index + 1}. \`${fileAnalysis.file}\`

| Property | Value |
|----------|-------|
| **Language** | ${fileAnalysis.language} |
| **Risk Level** | ${riskLevel} ${fileAnalysis.overall_assessment?.risk_level?.toUpperCase() || 'UNKNOWN'} |

#### 📊 Quality Scores

| Metric | Score |
|--------|-------|
| Security | ${securityScore}/10 |
| Code Quality | ${scores}/10 |
| Maintainability | ${maintainabilityScore}/10 |
| Performance | ${performanceScore}/10 |

#### 🎯 Purpose

${fileAnalysis.purpose || 'No purpose description available'}

#### 🚨 Security Analysis

${formatSecurityAnalysis(fileAnalysis.security_analysis)}

#### 🧹 Clean Code Issues

${formatCleanCodeAnalysis(fileAnalysis.clean_code_analysis)}

#### 🏗️ SOLID Analysis

${formatSolidAnalysis(fileAnalysis.solid_analysis)}

#### 🔧 Performance Analysis

${formatPerformanceAnalysis(fileAnalysis.performance_analysis)}

#### 💡 Recommendations

${formatRecommendations(fileAnalysis.recommendations)}

---

`;
    });
  }

  markdown += `\n*Analysis generated by CLIA v1.0.0*\n`;

  return markdown;
}

function getRiskLevelEmoji(riskLevel: string): string {
  switch (riskLevel?.toLowerCase()) {
    case 'critical':
      return '🔴';
    case 'high':
      return '🔥';
    case 'medium':
      return '🟡';
    case 'low':
      return '🟢';
    default:
      return '⚪';
  }
}

function formatSecurityAnalysis(securityAnalysis: any): string {
  if (!securityAnalysis) return 'No security analysis available';

  let content = '';

  if (
    securityAnalysis.vulnerabilities &&
    securityAnalysis.vulnerabilities.length > 0
  ) {
    content += '**Vulnerabilities:**\n';
    securityAnalysis.vulnerabilities.forEach((vuln: any) => {
      // Handle both string and object formats
      if (typeof vuln === 'string') {
        content += `- ${vuln}\n`;
      } else {
        const severity = vuln.severity?.toUpperCase() || 'MEDIUM';
        const description =
          vuln.description ||
          vuln.message ||
          'Security vulnerability identified';
        content += `- **${severity}**: ${description}\n`;
        if (vuln.location) content += `  *Location*: ${vuln.location}\n`;
        if (vuln.recommendation || vuln.fix)
          content += `  *Fix*: ${vuln.recommendation || vuln.fix}\n`;
      }
    });
    content += '\n';
  }

  if (
    securityAnalysis.security_concerns &&
    securityAnalysis.security_concerns.length > 0
  ) {
    content += '**Security Concerns:**\n';
    securityAnalysis.security_concerns.forEach((concern: string) => {
      content += `- ${concern}\n`;
    });
  }

  if (
    securityAnalysis.exposed_secrets &&
    securityAnalysis.exposed_secrets.length > 0
  ) {
    content += '**Exposed Secrets:**\n';
    securityAnalysis.exposed_secrets.forEach((secret: any) => {
      if (typeof secret === 'string') {
        content += `- ${secret}\n`;
      } else {
        content += `- ${secret.description || secret.type || 'Potential secret detected'}\n`;
      }
    });
  }

  return content || 'No security issues identified';
}

function formatCleanCodeAnalysis(cleanCodeAnalysis: any): string {
  if (!cleanCodeAnalysis) return 'No clean code analysis available';

  let content = '';

  if (
    cleanCodeAnalysis.naming_issues &&
    cleanCodeAnalysis.naming_issues.length > 0
  ) {
    content += '**Naming Issues:**\n';
    cleanCodeAnalysis.naming_issues.forEach((issue: any) => {
      if (typeof issue === 'string') {
        content += `- ${issue}\n`;
      } else {
        content += `- ${issue.description || issue.message || 'Naming issue detected'}\n`;
        if (issue.suggestion)
          content += `  *Suggestion*: ${issue.suggestion}\n`;
        if (issue.location) content += `  *Location*: ${issue.location}\n`;
      }
    });
    content += '\n';
  }

  if (
    cleanCodeAnalysis.complexity_concerns &&
    cleanCodeAnalysis.complexity_concerns.length > 0
  ) {
    content += '**Complexity Concerns:**\n';
    cleanCodeAnalysis.complexity_concerns.forEach((concern: any) => {
      if (typeof concern === 'string') {
        content += `- ${concern}\n`;
      } else {
        content += `- ${concern.description || concern.message || 'Complexity concern identified'}\n`;
        if (concern.suggestion)
          content += `  *Suggestion*: ${concern.suggestion}\n`;
        if (concern.complexity_score)
          content += `  *Complexity Score*: ${concern.complexity_score}\n`;
      }
    });
    content += '\n';
  }

  if (
    cleanCodeAnalysis.organization_issues &&
    cleanCodeAnalysis.organization_issues.length > 0
  ) {
    content += '**Organization Issues:**\n';
    cleanCodeAnalysis.organization_issues.forEach((issue: any) => {
      if (typeof issue === 'string') {
        content += `- ${issue}\n`;
      } else {
        content += `- ${issue.description || issue.message || 'Organization issue detected'}\n`;
        if (issue.suggestion)
          content += `  *Suggestion*: ${issue.suggestion}\n`;
      }
    });
  }

  return content || 'No code quality issues identified';
}

function formatSolidAnalysis(solidAnalysis: any): string {
  if (!solidAnalysis) return 'No SOLID analysis available';

  let content = '';

  if (solidAnalysis.violations && solidAnalysis.violations.length > 0) {
    content += '**SOLID Violations:**\n';
    solidAnalysis.violations.forEach((violation: any) => {
      // Handle both string and object formats
      if (typeof violation === 'string') {
        content += `- ${violation}\n`;
      } else {
        const principle = violation.principle || 'General';
        const description =
          violation.description ||
          violation.message ||
          'SOLID principle violation detected';
        content += `- **${principle}**: ${description}\n`;
        if (violation.impact) content += `  *Impact*: ${violation.impact}\n`;
        if (violation.suggestion)
          content += `  *Suggestion*: ${violation.suggestion}\n`;
      }
    });
    content += '\n';
  }

  if (
    solidAnalysis.architectural_concerns &&
    solidAnalysis.architectural_concerns.length > 0
  ) {
    content += '**Architectural Concerns:**\n';
    solidAnalysis.architectural_concerns.forEach((concern: string) => {
      content += `- ${concern}\n`;
    });
  }

  if (
    solidAnalysis.dependency_issues &&
    solidAnalysis.dependency_issues.length > 0
  ) {
    content += '**Dependency Issues:**\n';
    solidAnalysis.dependency_issues.forEach((issue: string) => {
      content += `- ${issue}\n`;
    });
  }

  return content || 'No SOLID violations identified';
}

function formatPerformanceAnalysis(performanceAnalysis: any): string {
  if (!performanceAnalysis) return 'No performance analysis available';

  let content = '';

  if (
    performanceAnalysis.performance_issues &&
    performanceAnalysis.performance_issues.length > 0
  ) {
    content += '**Performance Issues:**\n';
    performanceAnalysis.performance_issues.forEach((issue: any) => {
      if (typeof issue === 'string') {
        content += `- ${issue}\n`;
      } else {
        content += `- ${issue.description || issue.message || 'Performance issue detected'}\n`;
        if (issue.severity) content += `  *Severity*: ${issue.severity}\n`;
        if (issue.impact) content += `  *Impact*: ${issue.impact}\n`;
      }
    });
    content += '\n';
  }

  if (
    performanceAnalysis.optimization_opportunities &&
    performanceAnalysis.optimization_opportunities.length > 0
  ) {
    content += '**Optimization Opportunities:**\n';
    performanceAnalysis.optimization_opportunities.forEach(
      (opportunity: any) => {
        if (typeof opportunity === 'string') {
          content += `- ${opportunity}\n`;
        } else {
          content += `- ${opportunity.description || opportunity.message || 'Optimization opportunity identified'}\n`;
          if (opportunity.expected_impact)
            content += `  *Expected Impact*: ${opportunity.expected_impact}\n`;
        }
      }
    );
    content += '\n';
  }

  if (
    performanceAnalysis.memory_concerns &&
    performanceAnalysis.memory_concerns.length > 0
  ) {
    content += '**Memory Concerns:**\n';
    performanceAnalysis.memory_concerns.forEach((concern: any) => {
      if (typeof concern === 'string') {
        content += `- ${concern}\n`;
      } else {
        content += `- ${concern.description || concern.message || 'Memory concern identified'}\n`;
        if (concern.impact) content += `  *Impact*: ${concern.impact}\n`;
      }
    });
  }

  return content || 'No performance issues identified';
}

function formatRecommendations(recommendations: any): string {
  if (!recommendations) return 'No specific recommendations available';

  let content = '';

  if (
    recommendations.security_improvements &&
    recommendations.security_improvements.length > 0
  ) {
    content += '**Security Improvements:**\n';
    recommendations.security_improvements.forEach((improvement: any) => {
      const text =
        typeof improvement === 'string'
          ? improvement
          : improvement.description ||
            improvement.message ||
            'Security improvement recommended';
      content += `- ${text}\n`;
    });
    content += '\n';
  }

  if (
    recommendations.code_quality_improvements &&
    recommendations.code_quality_improvements.length > 0
  ) {
    content += '**Code Quality Improvements:**\n';
    recommendations.code_quality_improvements.forEach((improvement: any) => {
      const text =
        typeof improvement === 'string'
          ? improvement
          : improvement.description ||
            improvement.message ||
            'Code quality improvement recommended';
      content += `- ${text}\n`;
    });
    content += '\n';
  }

  if (
    recommendations.architectural_improvements &&
    recommendations.architectural_improvements.length > 0
  ) {
    content += '**Architectural Improvements:**\n';
    recommendations.architectural_improvements.forEach((improvement: any) => {
      const text =
        typeof improvement === 'string'
          ? improvement
          : improvement.description ||
            improvement.message ||
            'Architectural improvement recommended';
      content += `- ${text}\n`;
    });
    content += '\n';
  }

  if (
    recommendations.performance_improvements &&
    recommendations.performance_improvements.length > 0
  ) {
    content += '**Performance Improvements:**\n';
    recommendations.performance_improvements.forEach((improvement: any) => {
      const text =
        typeof improvement === 'string'
          ? improvement
          : improvement.description ||
            improvement.message ||
            'Performance improvement recommended';
      content += `- ${text}\n`;
    });
    content += '\n';
  }

  if (
    recommendations.maintenance_improvements &&
    recommendations.maintenance_improvements.length > 0
  ) {
    content += '**Maintenance Improvements:**\n';
    recommendations.maintenance_improvements.forEach((improvement: any) => {
      const text =
        typeof improvement === 'string'
          ? improvement
          : improvement.description ||
            improvement.message ||
            'Maintenance improvement recommended';
      content += `- ${text}\n`;
    });
  }

  return content || 'No specific recommendations available';
}

function displaySummary(result: AnalysisResult) {
  const logger = getLogger();

  logger.info('📊 Analysis completed');
  logger.info(`   📝 Files: ${result.metadata.totalFiles}`);
  logger.info(`   📊 Score: ${result.metrics.overall_project_score}/10`);
  logger.info(`   🚨 Issues: ${result.metrics.total_issues}`);
}

// Utility functions
function estimateComplexity(content: string, language: string): number {
  const lines = content.split('\n').length;

  // Language-agnostic complexity patterns following COMPLETE_DEVELOPMENT_GUIDE.md
  const complexityPatterns = getComplexityPatternsForLanguage(language);

  let structureCount = 0;
  for (const pattern of complexityPatterns) {
    const matches = content.match(pattern) || [];
    structureCount += matches.length;
  }

  // Base complexity: lines + weighted structures
  const complexity = lines + structureCount * 10;
  return complexity;
}

/**
 * Get complexity detection patterns for each supported language
 * Based on CLIA supported languages: C#, Java, JS/TS, Ruby, Rust, Python, PHP, Go
 */
function getComplexityPatternsForLanguage(language: string): RegExp[] {
  const basePatterns: RegExp[] = [];

  switch (language.toLowerCase()) {
    case 'javascript':
    case 'typescript':
      return [
        /\b(function|class|interface|type|enum)\s+\w+/g,
        /\b(const|let|var)\s+\w+\s*=\s*\(/g, // Arrow functions
        /\bexport\s+(class|function|interface|type)/g,
        /\basync\s+(function|\w+)/g,
      ];

    case 'python':
      return [
        /^\s*(def|class|async\s+def)\s+\w+/gm,
        /^@\w+/gm, // Decorators
        /^\s*with\s+\w+/gm,
        /^\s*try:/gm,
      ];

    case 'java':
      return [
        /\b(public|private|protected)\s+(class|interface|enum)/g,
        /\b(public|private|protected)\s+.*\s+\w+\s*\(/g, // Methods
        /\b@\w+/g, // Annotations
        /\btry\s*\{/g,
      ];

    case 'csharp':
    case 'c#':
      return [
        /\b(public|private|protected|internal)\s+(class|interface|struct|enum)/g,
        /\b(public|private|protected|internal)\s+.*\s+\w+\s*\(/g, // Methods
        /\[[\w\s,()]+\]/g, // Attributes
        /\btry\s*\{/g,
      ];

    case 'rust':
      return [
        /\b(fn|struct|enum|trait|impl)\s+\w+/g,
        /\bmacro_rules!\s*\w+/g,
        /\bmatch\s+\w+/g,
        /\bmod\s+\w+/g,
      ];

    case 'ruby':
      return [
        /^\s*(def|class|module)\s+\w+/gm,
        /^\s*private\s*$/gm,
        /^\s*protected\s*$/gm,
        /\bbegin\s*$/gm,
      ];

    case 'php':
      return [
        /\b(function|class|interface|trait)\s+\w+/g,
        /\b(public|private|protected)\s+function/g,
        /\btry\s*\{/g,
        /\bnamespace\s+\w+/g,
      ];

    case 'go':
      return [
        /\bfunc\s+(\w+\s*)?\(/g,
        /\btype\s+\w+\s+(struct|interface)/g,
        /\bpackage\s+\w+/g,
        /\bdefer\s+\w+/g,
      ];

    case 'markdown':
      return [
        /^#{1,6}\s+/gm, // Headers
        /```[\w]*$/gm, // Code blocks
        /^\*\s+/gm, // Lists
        /^\d+\.\s+/gm, // Numbered lists
      ];

    case 'json':
    case 'yaml':
    case 'toml':
      return [
        /^\s*"[\w-]+"\s*:/gm, // JSON keys
        /^\s*[\w-]+\s*:/gm, // YAML/TOML keys
        /^\s*-\s+/gm, // YAML arrays
      ];

    default:
      // Generic patterns for unknown languages
      return [
        /\b(function|def|class|struct|enum|interface)\s+\w+/g,
        /\{[\s\S]*?\}/g, // Block structures
        /\([\s\S]*?\)/g, // Function calls
      ];
  }
}
