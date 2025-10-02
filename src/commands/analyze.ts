import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Command } from 'commander';
import { loadConfig, getProjectName, Config } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { execPrompt } from '../shared/utils.js';
import { discoverFiles, mergeExcludes } from '../rag/indexer.js';
import { detectLanguage } from '../rag/chunker.js';
import { getStackContext, StackContext } from '../shared/stack-context.js';
import { retrieveForFiles } from '../rag/index.js';
import { generateTimestamp } from '../shared/timestamp.js';
import {
  detectExternalIntegrations,
  analyzeProjectIntegrations,
} from '../shared/external-integrations-detector.js';
import { McpClient } from '../mcp/client.js';
import type {
  SemgrepReport,
  TrivyReport,
  SemgrepFinding,
  TrivyVulnerability,
} from '../mcp/client.js';
import { getSourceAnalysis } from '../shared/knowledge-base.js';
import { processAskQuery } from './ask.js';
import {
  getOutputLanguage,
  shouldTranslateReports,
} from '../shared/translation.js';
import { z } from 'zod';

interface AnalyzeOptions {
  paths?: string[];
  output?: string;
  includeTests?: boolean;
  format?: 'json' | 'markdown' | 'both';
  outputLanguage: string;
  dependencyGraph?: 'mermaid' | 'plantuml' | 'structurizr' | boolean;
  deadCode?: boolean;
}

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
  projectStructure?: {
    entryPoints: string[];
    modules: string[];
    directories: string[];
  };
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
    .description('Comprehensive code quality and security analysis v1.0.0 with dead code detection and dependency mapping')
    .option('-o, --output <path>', 'Output directory for reports')
    .option('--include-tests', 'Include test files in analysis')
    .option('--format <format>', 'Output format: json, markdown, both', 'both')
    .option(
      '--dependency-graph [type]',
      'Generate dependency diagram (mermaid|plantuml|structurizr)',
      'mermaid'
    )
    .option(
      '--dead-code',
      'Detect unused code and exports (uses LLM for enhanced accuracy)'
    )
    .option('--output-language <lang>', 'Output language for reports')
    .action(async (paths: string[], options: AnalyzeOptions) => {
      try {
        await runAnalyze({
          ...options,
          paths: paths.length > 0 ? paths : [process.cwd()],
        });
        process.exit(0);
      } catch (error) {
        getLogger().error('Analysis command failed:', error);
        process.exit(1);
      }
    });
}

async function updateCacheWithFileAnalysis(
  filePath: string,
  llmAnalysis: FullFileAnalysis,
  config: Config
): Promise<void> {
  if (!llmAnalysis || !llmAnalysis.file) {
    return;
  }

  const cache = await loadCache();
  
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const language = detectLanguage(filePath);
    const stats = await fs.promises.stat(filePath);
    const contentHash = generateContentHash(content);
    
    const complexityEstimate = estimateComplexity(content, language);
    const complexityTier = determineComplexityTier(complexityEstimate, stats.size);
    const dependencies = extractDependencies(content, language, filePath);
    
    const fileAnalysis: FileAnalysisData = {
      file: filePath,
      language,
      content: '',
      size: stats.size,
      complexity_estimate: complexityEstimate,
      complexity_tier: complexityTier,
      dependencies,
      exported_symbols: dependencies.exported_functions.concat(
        dependencies.exported_classes,
        dependencies.exported_variables
      ),
      imported_symbols: dependencies.imported_functions.concat(
        dependencies.imported_classes,
        dependencies.imported_variables
      ),
    };

    const optimizedLLMAnalysis = { ...llmAnalysis };
    if (optimizedLLMAnalysis.dependencies) {
      delete optimizedLLMAnalysis.dependencies;
    }

    cache[filePath] = {
      contentHash,
      timestamp: new Date().toISOString(),
      analysis: fileAnalysis,
      fullAnalysis: optimizedLLMAnalysis
    };
    
    await saveCache(cache);
  } catch (error) {
    throw new Error(`Failed to update cache for ${filePath}: ${error}`);
  }
}

async function createAnalysisResult(
  allAnalyses: FullFileAnalysis[],
  totalFiles: number,
  options: AnalyzeOptions,
  filesToProcess: FileAnalysisData[],
  cachedAnalyses: CachedAnalysisEntry[]
): Promise<AnalysisResult> {
  const timestamp = new Date().toISOString();

  const result: AnalysisResult = {
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

  if (options.deadCode) {
    getLogger().info('Starting dead code analysis with LLM...');
    try {
      result.dead_code = await analyzeDeadCodeWithLLM();
      getLogger().info('Dead code analysis completed successfully');
    } catch (error) {
      getLogger().warn('Failed to analyze dead code with LLM:', error);
      try {
        getLogger().info('Falling back to regex-based dead code analysis...');
        result.dead_code = await analyzeDeadCodeFromCache();
        getLogger().info('Fallback dead code analysis completed');
      } catch (fallbackError) {
        getLogger().error('Both LLM and fallback dead code analysis failed:', fallbackError);
      }
    }
  }

  if (options.dependencyGraph) {
    try {
      const logger = getLogger();
      logger.info('Generating dependency graph...');
      
      const allFileData = [
        ...filesToProcess,
        ...cachedAnalyses.map(c => c.analysis)
      ];
      
      logger.info(`Total files for dependency graph: ${allFileData.length}`);
      
      let dependencyNodes: DependencyNode[];

      if (options.deadCode && result.dead_code) {
        logger.info('Using enhanced dependency graph with dead code analysis');
        dependencyNodes = await buildEnhancedDependencyGraph(
          allFileData,
          result.dead_code
        );
      } else {
        logger.info('Building standard dependency graph');
        dependencyNodes = await buildDependencyGraph(allFileData);
      }

      logger.info(`Generated ${dependencyNodes.length} dependency nodes`);

      const format =
        typeof options.dependencyGraph === 'string'
          ? options.dependencyGraph
          : 'mermaid';
      
      logger.info(`Generating ${format} diagram`);
      const diagram = generateDependencyDiagram(dependencyNodes, format);

      result.dependency_graph = {
        format,
        diagram,
        nodes: dependencyNodes,
      };
      
      logger.info('Dependency graph generated successfully');
    } catch (error) {
      getLogger().error('Failed to generate dependency graph:', error);
      throw error;
    }
  }

  return result;
}

function extractCriticalIssues(analyses: FullFileAnalysis[]): string[] {
  const issues: string[] = [];
  for (const analysis of analyses) {
    if (analysis.security_analysis?.vulnerabilities) {
      for (const issue of analysis.security_analysis.vulnerabilities) {
        if (issue.severity === 'high' || issue.severity === 'critical') {
          issues.push(`${analysis.file}: ${issue.description}`);
        }
      }
    }
    if (analysis.priority_actions) {
      for (const action of analysis.priority_actions) {
        if (action.priority === 'critical' || action.priority === 'high') {
          issues.push(`${analysis.file}: ${action.action}`);
        }
      }
    }
  }
  return issues;
}

function extractHighPriorityIssues(analyses: FullFileAnalysis[]): string[] {
  const issues: string[] = [];
  for (const analysis of analyses) {
    if (analysis.priority_actions) {
      for (const action of analysis.priority_actions) {
        if (action.priority === 'high') {
          issues.push(`${analysis.file}: ${action.action}`);
        }
      }
    }
  }
  return issues;
}

function extractImprovementOpportunities(analyses: FullFileAnalysis[]): string[] {
  const opportunities: string[] = [];
  for (const analysis of analyses) {
    if (analysis.priority_actions) {
      for (const action of analysis.priority_actions) {
        if (action.priority === 'medium' || action.priority === 'low') {
          opportunities.push(`${analysis.file}: ${action.action}`);
        }
      }
    }
  }
  return opportunities;
}

function calculateOverallScore(analyses: FullFileAnalysis[]): number {
  if (analyses.length === 0) return 0;
  const sum = analyses.reduce(
    (acc, analysis) => acc + (analysis.overall_score || 0),
    0
  );
  return Math.round(sum / analyses.length);
}

function countTotalIssues(analyses: FullFileAnalysis[]): number {
  let count = 0;
  for (const analysis of analyses) {
    if (analysis.security_analysis?.vulnerabilities) {
      count += analysis.security_analysis.vulnerabilities.length;
    }
    if (analysis.clean_code_analysis?.naming_issues) {
      count += analysis.clean_code_analysis.naming_issues.length;
    }
    if (analysis.clean_code_analysis?.complexity_concerns) {
      count += analysis.clean_code_analysis.complexity_concerns.length;
    }
    if (analysis.clean_code_analysis?.organization_issues) {
      count += analysis.clean_code_analysis.organization_issues.length;
    }
    if (analysis.solid_analysis?.violations) {
      count += analysis.solid_analysis.violations.length;
    }
    if (analysis.performance_analysis?.performance_issues) {
      count += analysis.performance_analysis.performance_issues.length;
    }
  }
  return count;
}

function countFilesWithIssues(analyses: FullFileAnalysis[]): number {
  return analyses.filter((analysis) => {
    return (
      (analysis.security_analysis?.vulnerabilities?.length || 0) > 0 ||
      (analysis.clean_code_analysis?.naming_issues?.length || 0) > 0 ||
      (analysis.clean_code_analysis?.complexity_concerns?.length || 0) > 0 ||
      (analysis.clean_code_analysis?.organization_issues?.length || 0) > 0 ||
      (analysis.solid_analysis?.violations?.length || 0) > 0 ||
      (analysis.performance_analysis?.performance_issues?.length || 0) > 0 ||
      (analysis.overall_score || 0) < 7
    );
  }).length;
}

function extractImmediateActions(analyses: FullFileAnalysis[]): string[] {
  const actions: string[] = [];
  for (const analysis of analyses) {
    if (analysis.priority_actions) {
      for (const action of analysis.priority_actions) {
        if (action.priority === 'critical') {
          actions.push(`${analysis.file}: ${action.action}`);
        }
      }
    }
  }
  return actions;
}

function extractShortTermImprovements(analyses: FullFileAnalysis[]): string[] {
  const improvements: string[] = [];
  for (const analysis of analyses) {
    if (analysis.priority_actions) {
      for (const action of analysis.priority_actions) {
        if (action.priority === 'high') {
          improvements.push(`${analysis.file}: ${action.action}`);
        }
      }
    }
  }
  return improvements;
}

function extractLongTermStrategic(analyses: FullFileAnalysis[]): string[] {
  const strategic: string[] = [];
  for (const analysis of analyses) {
    if (analysis.priority_actions) {
      for (const action of analysis.priority_actions) {
        if (action.priority === 'medium' || action.priority === 'low') {
          strategic.push(`${analysis.file}: ${action.action}`);
        }
      }
    }
  }
  return strategic;
}

interface FileAnalysisData {
  file: string;
  language: string;
  content: string;
  size: number;
  complexity_estimate: number;
  complexity_tier: 'low' | 'medium' | 'high';
  ragContext?: string;
  dependencies?: DependencyInfo;
  exported_symbols?: string[];
  imported_symbols?: string[];
}

interface DependencyInfo {
  internal_imports: string[];
  external_imports: string[];
  exported_functions: string[];
  exported_classes: string[];
  exported_variables: string[];
  imported_functions: string[];
  imported_classes: string[];
  imported_variables: string[];
  private_functions: string[];
  private_classes: string[];
  private_variables: string[];
}

interface DependencyNode {
  file: string;
  dependencies: string[];
  dependents: string[];
  exports: string[];
  imports: string[];
  dead_exports: string[];
}

interface DeadCodeItem {
  name?: string;
  line?: number;
  reason?: string;
  [key: string]: unknown;
}

interface DeadCodeAnalysis {
  unused_functions: string[];
  unused_classes: string[];
  unused_variables: string[];
  unused_files: string[];
  orphaned_exports: string[];
  circular_dependencies: string[];
  unused_private_functions?: Array<string | DeadCodeItem>;
  unused_private_classes?: Array<string | DeadCodeItem>;
  unused_private_variables?: Array<string | DeadCodeItem>;
  unreachable_code?: Array<string | DeadCodeItem>;
  [key: string]: unknown;
}

interface DeadCodeResult {
  analysis: DeadCodeAnalysis;
  summary: {
    total_unused_functions: number;
    total_unused_classes: number;
    total_unused_files: number;
    total_orphaned_exports: number;
    circular_dependency_count: number;
  };
}

interface CacheEntry {
  contentHash: string;
  timestamp: string;
  analysis: FileAnalysisData;
  fullAnalysis?: FullFileAnalysis;
}

interface FullFileAnalysis {
  file: string;
  language: string;
  purpose?: string;
  overall_score?: number;
  priority_actions?: Array<{
    priority: string;
    action: string;
  }>;
  security_analysis?: SecurityAnalysis;
  clean_code_analysis?: CleanCodeAnalysis;
  solid_analysis?: SolidAnalysis;
  maintainability_analysis?: MaintainabilityAnalysis;
  performance_analysis?: PerformanceAnalysis;
  integration_analysis?: IntegrationAnalysis;
  overall_assessment?: OverallAssessment;
  recommendations?: FileRecommendations;
  dependencies?: DependencyInfo;
  [key: string]: unknown;
}

interface SecurityAnalysis {
  score: number;
  vulnerabilities: Array<{
    type: string;
    severity: string;
    description: string;
    line?: number;
    recommendation: string;
    message?: string;
    location?: string;
    fix?: string;
    [key: string]: unknown;
  }>;
  exposed_secrets: Array<{
    type: string;
    location: string;
    severity: string;
    description?: string;
    [key: string]: unknown;
  }>;
  security_concerns: string[];
}

interface CleanCodeAnalysis {
  score: number;
  naming_issues: Array<{
    type: string;
    location: string;
    suggestion: string;
    description?: string;
    message?: string;
    [key: string]: unknown;
  }>;
  complexity_concerns: Array<{
    function: string;
    complexity: number;
    recommendation: string;
    description?: string;
    message?: string;
    suggestion?: string;
    complexity_score?: number;
    [key: string]: unknown;
  }>;
  organization_issues: Array<{
    issue: string;
    suggestion: string;
    description?: string;
    message?: string;
    [key: string]: unknown;
  }>;
}

interface SolidAnalysis {
  score: number;
  violations: Array<{
    principle: string;
    description: string;
    location: string;
    impact: string;
    message?: string;
    suggestion?: string;
    [key: string]: unknown;
  }>;
  architectural_concerns: string[];
  dependency_issues: string[];
}

interface MaintainabilityAnalysis {
  score: number;
  code_duplication: Array<{
    location: string;
    severity: string;
  }>;
  technical_debt: Array<{
    area: string;
    severity: string;
    estimation: string;
  }>;
}

interface PerformanceAnalysis {
  score: number;
  performance_issues: Array<{
    type: string;
    location: string;
    impact: string;
    suggestion: string;
    description?: string;
    message?: string;
    [key: string]: unknown;
  }>;
  optimization_opportunities: Array<{
    area: string;
    potential_gain: string;
    effort: string;
    [key: string]: unknown;
  }>;
  memory_concerns: Array<{
    issue: string;
    location: string;
    recommendation: string;
    [key: string]: unknown;
  }>;
}

interface IntegrationAnalysis {
  external_services: string[];
  integration_points: Array<{
    type: string;
    service: string;
    protocol: string;
  }>;
  api_calls: string[];
}

interface OverallAssessment {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  priority_score: number;
}

interface FileRecommendations {
  security_improvements?: Array<
    string | { message?: string; description?: string }
  >;
  code_quality_improvements?: Array<
    string | { message?: string; description?: string }
  >;
  architectural_improvements?: Array<
    string | { message?: string; description?: string }
  >;
  performance_improvements?: Array<
    string | { message?: string; description?: string }
  >;
  maintenance_improvements?: Array<
    string | { message?: string; description?: string }
  >;
}

interface ConsolidatedFindings {
  critical_issues: string[];
  high_priority_issues: string[];
  improvement_opportunities: string[];
}

interface AnalysisMetrics {
  overall_project_score: number;
  total_issues: number;
  files_with_issues: number;
}

interface ProjectRecommendations {
  immediate_actions: string[];
  short_term_improvements: string[];
  long_term_strategic: string[];
}

interface CachedAnalysisEntry {
  analysis: FileAnalysisData;
  fullAnalysis: FullFileAnalysis;
}

interface SecurityContextData {
  semgrep?: SemgrepReport;
  trivy?: TrivyReport;
}

interface LanguageConfig {
  extensions: string[];
  indexFiles: string[];
}

interface RAGResult {
  content: string;
  metadata?: {
    source: string;
    relevance?: number;
  };
}

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
    getLogger().warn('Failed to load project inspection data:', error);
    return null;
  }
}

function getExcludePaths(
  inspection: ProjectInspection | null,
  configExcludes: string[] = [],
  config?: any
): string[] {
  const systemExcludes = mergeExcludes(config || {}, null);

  const allExcludes = new Set<string>([...systemExcludes, ...configExcludes]);

  if (inspection?.ragOptimization?.directoryStructure?.excludePaths) {
    inspection.ragOptimization.directoryStructure.excludePaths.forEach(
      (exclude) => {
        allExcludes.add(exclude);
      }
    );
  }

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
  file_analyses: FullFileAnalysis[];
  consolidated_findings: ConsolidatedFindings;
  metrics: AnalysisMetrics;
  recommendations: ProjectRecommendations;
  dead_code?: DeadCodeResult;
  dependency_graph?: {
    format: string;
    diagram: string;
    nodes: DependencyNode[];
  };
}

const FileAnalysisPromptContextSchema = z.object({
  projectName: z.string(),
  fileName: z.string(),
  language: z.string(),
  fileContent: z.string(),
  fileSize: z.string(),
  complexityEstimate: z.string(),
  complexityTier: z.enum(['low', 'medium', 'high']),
  stackContext: z.string(),
  ragContext: z.string(),
  securityContext: z.string(),
  integrationContext: z.string(),
  dependencyInfo: z.string(),
  userLanguage: z.string(),
  enableDeadCodeAnalysis: z.boolean(),
});

const FileAnalysisResponseSchema = z
  .object({
    file: z.string(),
    language: z.string(),
    purpose: z.string().optional(),
    overall_score: z.number().optional(),
    analysis: z
      .object({
        security: z
          .object({
            score: z.number().optional(),
            vulnerabilities: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    severity: z.string().optional(),
                    description: z.string().optional(),
                    message: z.string().optional(),
                    location: z.string().optional(),
                    recommendation: z.string().optional(),
                    fix: z.string().optional(),
                  }),
                ])
              )
              .optional(),
            security_concerns: z.array(z.string()).optional(),
            exposed_secrets: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    description: z.string().optional(),
                    type: z.string().optional(),
                  }),
                ])
              )
              .optional(),
          })
          .optional(),
        clean_code: z
          .object({
            score: z.number().optional(),
            naming_issues: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    description: z.string().optional(),
                    message: z.string().optional(),
                    suggestion: z.string().optional(),
                    location: z.string().optional(),
                  }),
                ])
              )
              .optional(),
            complexity_concerns: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    description: z.string().optional(),
                    message: z.string().optional(),
                    suggestion: z.string().optional(),
                    complexity_score: z.number().optional(),
                  }),
                ])
              )
              .optional(),
            organization_issues: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    description: z.string().optional(),
                    message: z.string().optional(),
                    suggestion: z.string().optional(),
                  }),
                ])
              )
              .optional(),
          })
          .optional(),
        solid_principles: z
          .object({
            violations: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    principle: z.string().optional(),
                    description: z.string().optional(),
                    message: z.string().optional(),
                    impact: z.string().optional(),
                    suggestion: z.string().optional(),
                  }),
                ])
              )
              .optional(),
            architectural_concerns: z.array(z.string()).optional(),
            dependency_issues: z.array(z.string()).optional(),
          })
          .optional(),
        maintainability: z
          .object({
            score: z.number().optional(),
          })
          .optional(),
        performance: z
          .object({
            score: z.number().optional(),
            performance_issues: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    description: z.string().optional(),
                    message: z.string().optional(),
                    severity: z.string().optional(),
                    impact: z.string().optional(),
                  }),
                ])
              )
              .optional(),
            optimization_opportunities: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    description: z.string().optional(),
                    message: z.string().optional(),
                    expected_impact: z.string().optional(),
                  }),
                ])
              )
              .optional(),
            memory_concerns: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    description: z.string().optional(),
                    message: z.string().optional(),
                    impact: z.string().optional(),
                  }),
                ])
              )
              .optional(),
          })
          .optional(),
        dead_code_analysis: z
          .object({
            unused_private_functions: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    name: z.string(),
                    line: z.number().optional(),
                    reason: z.string().optional(),
                  }),
                ])
              )
              .optional(),
            unused_private_classes: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    name: z.string(),
                    line: z.number().optional(),
                    reason: z.string().optional(),
                  }),
                ])
              )
              .optional(),
            unused_private_variables: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    name: z.string(),
                    line: z.number().optional(),
                    reason: z.string().optional(),
                  }),
                ])
              )
              .optional(),
            unreachable_code: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    location: z.string(),
                    reason: z.string().optional(),
                  }),
                ])
              )
              .optional(),
          })
          .optional(),
      })
      .optional(),
    recommendations: z
      .object({
        security_improvements: z
          .array(
            z.union([
              z.string(),
              z.object({
                description: z.string().optional(),
                message: z.string().optional(),
              }),
            ])
          )
          .optional(),
        code_quality_improvements: z
          .array(
            z.union([
              z.string(),
              z.object({
                description: z.string().optional(),
                message: z.string().optional(),
              }),
            ])
          )
          .optional(),
        architectural_improvements: z
          .array(
            z.union([
              z.string(),
              z.object({
                description: z.string().optional(),
                message: z.string().optional(),
              }),
            ])
          )
          .optional(),
        performance_improvements: z
          .array(
            z.union([
              z.string(),
              z.object({
                description: z.string().optional(),
                message: z.string().optional(),
              }),
            ])
          )
          .optional(),
        maintenance_improvements: z
          .array(
            z.union([
              z.string(),
              z.object({
                description: z.string().optional(),
                message: z.string().optional(),
              }),
            ])
          )
          .optional(),
      })
      .optional(),
    priority_actions: z
      .array(
        z.object({
          priority: z.enum(['critical', 'high', 'medium', 'low']),
          action: z.string(),
        })
      )
      .optional(),
  })
  .passthrough();

const DeadCodePromptContextSchema = z.object({
  projectName: z.string(),
  projectData: z.string(),
  stackContext: z.string(),
  userLanguage: z.string(),
  timestamp: z.string(),
});

const DeadCodeResponseSchema = z
  .object({
    deadCode: z
      .object({
        unusedFiles: z
          .array(
            z.object({
              path: z.string(),
              reason: z.string().optional(),
            })
          )
          .optional(),
        unusedExports: z
          .array(
            z.object({
              file: z.string(),
              export: z.string(),
              type: z.enum(['function', 'class', 'variable']),
              reason: z.string().optional(),
            })
          )
          .optional(),
      })
      .optional(),
    dependencies: z
      .object({
        circularDependencies: z
          .array(
            z.object({
              cycle: z.array(z.string()),
              impact: z.string().optional(),
            })
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

type FileAnalysisPromptContext = z.infer<
  typeof FileAnalysisPromptContextSchema
>;
type FileAnalysisResponse = z.infer<typeof FileAnalysisResponseSchema>;
type DeadCodePromptContext = z.infer<typeof DeadCodePromptContextSchema>;
type DeadCodeResponse = z.infer<typeof DeadCodeResponseSchema>;

function assertFileAnalysisResponse(obj: unknown): FileAnalysisResponse {
  const res = FileAnalysisResponseSchema.safeParse(obj);
  if (!res.success) {
    getLogger().warn(
      `File analysis response validation failed: ${res.error.message}`
    );
    return obj as FileAnalysisResponse;
  }
  return res.data;
}

function assertDeadCodeResponse(obj: unknown): DeadCodeResponse {
  const res = DeadCodeResponseSchema.safeParse(obj);
  if (!res.success) {
    getLogger().warn(
      `Dead code analysis response validation failed: ${res.error.message}`
    );
    return obj as DeadCodeResponse;
  }
  return res.data;
}

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
  const maxAge = 30 * 24 * 60 * 60 * 1000;

  return entry.contentHash === currentHash && now - cacheTime < maxAge;
}

function hasFullAnalysisCache(entry: CacheEntry, currentHash: string): boolean {
  return isCacheValid(entry, currentHash) && entry.fullAnalysis !== undefined;
}

async function runAnalyze(options: AnalyzeOptions): Promise<void> {
  const logger = getLogger();
  const config = loadConfig();

  logger.info('Starting comprehensive code analysis');

  try {
    const targetPaths = options.paths || [process.cwd()];
    const { filesToProcess, cachedAnalyses } = await discoverAndPrepareFiles(
      targetPaths,
      config,
      options
    );

    const totalFiles = filesToProcess.length + cachedAnalyses.length;
    if (totalFiles === 0) {
      logger.warn('No files found for analysis');
      return;
    }

    logger.info(
      `Analyzing ${filesToProcess.length} files (${cachedAnalyses.length} from cache)`
    );

    const fileResults: FileAnalysisResponse[] = [];

    if (filesToProcess.length > 0) {
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        logger.info(
          `Processing file ${i + 1}/${filesToProcess.length}: ${file.file}`
        );

        try {
          const analysis = await processFile(file, config, options);
          fileResults.push(analysis);

          await updateCacheWithFileAnalysis(file.file, analysis, config);
        } catch (error) {
          logger.error(`Failed to analyze file ${file.file}:`, error);
        }
      }
    }

    const allAnalyses = [
      ...cachedAnalyses.map((c) => c.fullAnalysis),
      ...fileResults,
    ];

    const analysisResult = await createAnalysisResult(
      allAnalyses,
      totalFiles,
      options,
      filesToProcess,
      cachedAnalyses
    );

    await saveAnalysisResults(analysisResult, options, config);
    displaySummary(analysisResult);

    console.log('Analysis completed successfully');
  } catch (error) {
    logger.error('Analysis failed:', error);
    throw error;
  }
}

async function discoverAndPrepareFiles(
  targetPaths: string[],
  config: Config,
  options: AnalyzeOptions
): Promise<{
  filesToProcess: FileAnalysisData[];
  cachedAnalyses: CachedAnalysisEntry[];
}> {
  const logger = getLogger();

  const projectInspection = await loadProjectInspection();
  const excludePaths = getExcludePaths(
    projectInspection,
    config.project?.rag?.excludes || [],
    config
  );

  if (excludePaths.length > 0) {
    logger.info(`Using exclude paths: ${excludePaths.join(', ')}`);
  }

  const cache = await loadCache();
  let cacheUpdated = false;

  const filesToProcess: FileAnalysisData[] = [];
  const cachedAnalyses: CachedAnalysisEntry[] =
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
        const maxSizeBytes = 0.1 * 1024 * 1024;

        if (stats.size > maxSizeBytes) {
          logger.info(
            `Skipping large file: ${filePath} (${Math.round(stats.size / 1024)}KB)`
          );
          continue;
        }

        const relativePath = path.relative(process.cwd(), filePath);
        const contentHash = generateContentHash(content);

        const cached = cache[relativePath];
        if (cached && hasFullAnalysisCache(cached, contentHash)) {
          const restoredAnalysis = { 
            ...cached.analysis, 
            content: content,
            ragContext: await getSourceAnalysis(relativePath, processAskQuery)
          };
          
          cachedAnalyses.push({
            analysis: restoredAnalysis,
            fullAnalysis: cached.fullAnalysis!,
          });
          continue;
        }

        const complexityEstimate = estimateComplexity(content, language);
        const complexityTier = determineComplexityTier(
          complexityEstimate,
          stats.size
        );

        const dependencies = extractDependencies(
          content,
          language,
          relativePath
        );

        const ragContext = await getSourceAnalysis(
          relativePath,
          processAskQuery
        );

        const fileAnalysis: FileAnalysisData = {
          file: relativePath,
          language,
          content,
          size: stats.size,
          complexity_estimate: complexityEstimate,
          complexity_tier: complexityTier,
          ragContext,
          dependencies,
          exported_symbols: dependencies.exported_functions.concat(
            dependencies.exported_classes,
            dependencies.exported_variables
          ),
          imported_symbols: dependencies.imported_functions.concat(
            dependencies.imported_classes,
            dependencies.imported_variables
          ),
        };

        filesToProcess.push(fileAnalysis);

      } catch (error) {
        throw new Error(`Failed to read file ${filePath}: ${error}`);
      }
    }
  }


  const sortedFilesToProcess = filesToProcess.sort(
    (a, b) => b.complexity_estimate - a.complexity_estimate
  );

  return { filesToProcess: sortedFilesToProcess, cachedAnalyses };
}

function determineComplexityTier(
  complexity: number,
  fileSize: number
): 'low' | 'medium' | 'high' {
  if (complexity > 500 || fileSize > 20000) {
    return 'high';
  }
  if (complexity > 150 || fileSize > 5000) {
    return 'medium';
  }
  return 'low';
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
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

async function processFile(
  file: FileAnalysisData,
  config: Config,
  options: AnalyzeOptions
): Promise<FileAnalysisResponse> {
  const outputLanguage = resolveOutputLanguage(options, config);

  const contexts = await collectContextsForFile(file, config);

  const promptData: FileAnalysisPromptContext = {
    projectName: getProjectName(),
    fileName: file.file,
    language: file.language,
    fileContent: file.content,
    fileSize: file.size.toString(),
    complexityEstimate: file.complexity_estimate.toString(),
    complexityTier: file.complexity_tier,
    stackContext: contexts.stackContext,
    ragContext: file.ragContext || 'No RAG context available',
    securityContext: contexts.securityContext,
    integrationContext: contexts.integrationContext,
    dependencyInfo: JSON.stringify(file.dependencies || {}, null, 2),
    userLanguage: outputLanguage,
    enableDeadCodeAnalysis: options.deadCode || false,
  };

  try {
    const result = await execPrompt<
      FileAnalysisPromptContext,
      FileAnalysisResponse
    >('analyze/consolidated-analysis', promptData, '1.0.0', 'default', 0.3, 3);

    return assertFileAnalysisResponse(result);
  } catch (error) {
    throw new Error(`Failed to process file ${file.file}: ${error}`);
  }
}

let securityReportsCache: {
  semgrep?: SemgrepReport;
  trivy?: TrivyReport;
  timestamp?: number;
} = {};

const SECURITY_CACHE_TTL = 5 * 60 * 1000;

async function getSecurityReports() {
  const now = Date.now();
  
  if (securityReportsCache.timestamp && 
      (now - securityReportsCache.timestamp) < SECURITY_CACHE_TTL &&
      securityReportsCache.semgrep && securityReportsCache.trivy) {
    return {
      semgrepReport: securityReportsCache.semgrep,
      trivyReport: securityReportsCache.trivy
    };
  }

  try {
    const mcpClient = McpClient.fromConfig();
    const semgrepReport = await mcpClient.semgrepScan();
    const trivyReport = await mcpClient.trivyScan();
    
    securityReportsCache = {
      semgrep: semgrepReport,
      trivy: trivyReport,
      timestamp: now
    };
    
    return { semgrepReport, trivyReport };
  } catch (error) {
    if (securityReportsCache.semgrep && securityReportsCache.trivy) {
      return {
        semgrepReport: securityReportsCache.semgrep,
        trivyReport: securityReportsCache.trivy
      };
    }
    throw error;
  }
}

async function collectContextsForFile(file: FileAnalysisData, config: Config) {
  const stackContext = await getStackContext();

  let securityContext = '';
  try {
    const { semgrepReport, trivyReport } = await getSecurityReports();

    const fileSpecificFindings = semgrepReport?.findings?.filter((finding) => 
      finding.path && (
        finding.path.includes(file.file) || 
        path.resolve(finding.path) === path.resolve(file.file) ||
        path.relative(process.cwd(), finding.path) === file.file
      )
    ) || [];

    if (fileSpecificFindings.length > 0) {
      securityContext = JSON.stringify(
        {
          file_findings: fileSpecificFindings,
          findings_summary: `${fileSpecificFindings.length} security issues found in this file`,
          global_scan_summary: `${semgrepReport?.findings?.length || 0} total semgrep + ${trivyReport?.vulnerabilities?.length || 0} trivy findings in project`,
        },
        null,
        2
      );
    } else {

      securityContext = JSON.stringify({
        file_findings: [],
        findings_summary: 'No security issues found in this file',
        global_scan_summary: `${semgrepReport?.findings?.length || 0} total semgrep + ${trivyReport?.vulnerabilities?.length || 0} trivy findings in project`,
      }, null, 2);
    }
  } catch (error) {
    securityContext = 'Security context unavailable - MCP offline';
  }

  let integrationContext = '';
  try {
    const integrationAnalysis = detectExternalIntegrations(
      file.file,
      file.content,
      file.language
    );

    if (integrationAnalysis.integrations.length > 0) {
      integrationContext = JSON.stringify(
        {
          file_integration: integrationAnalysis,
          detection_summary: `${integrationAnalysis.integrations.length} integrations detected in file`,
        },
        null,
        2
      );
    } else {
      integrationContext = 'No external integrations detected in this file';
    }
  } catch (error) {
    integrationContext = `Integration detection failed: ${error}`;
  }

  return {
    stackContext: JSON.stringify(stackContext, null, 2),
    securityContext,
    integrationContext,
  };
}

async function collectContexts(files: FileAnalysisData[], config: Config) {
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
      ragContext?.map((r: RAGResult) => r.content).join('\n\n') ||
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
    const markdownContent = generateMarkdownReport(result);
    await fs.promises.writeFile(markdownPath, markdownContent);
  }

  if (result.dependency_graph) {
    const graphExtension =
      result.dependency_graph.format === 'plantuml'
        ? 'puml'
        : result.dependency_graph.format === 'structurizr'
          ? 'dsl'
          : 'mmd';
    const graphPath = path.join(
      reportsDir,
      `${baseFilename}_dependencies.${graphExtension}`
    );
    await fs.promises.writeFile(graphPath, result.dependency_graph.diagram);

    getLogger().info(`Dependency graph saved to: ${graphPath}`);
  }
}

function generateMarkdownReport(result: AnalysisResult): string {
  const executionTime = result.metadata.timestamp
    ? `**Execution Time**: Analysis completed at ${new Date(result.metadata.timestamp).toLocaleString()}`
    : '';

  let markdown = `# Code Analysis Report

## Summary

**Project**: ${result.metadata.projectName}  
**Files Analyzed**: ${result.metadata.totalFiles}  
**Analysis Mode**: ${result.metadata.analysisMode}  
**Date**: ${new Date(result.metadata.timestamp).toLocaleString()}  
**Overall Score**: ${result.metrics.overall_project_score}/10  
${executionTime}

## Metrics

- **Overall Project Score**: ${result.metrics.overall_project_score}/10
- **Total Issues Found**: ${result.metrics.total_issues}
- **Files with Issues**: ${result.metrics.files_with_issues || 0}

## 🚨 Critical Findings

${result.consolidated_findings.critical_issues?.map((issue: string) => `- ${issue}`).join('\n') || 'No critical issues found'}

## Recommendations

### Immediate Actions
${result.recommendations.immediate_actions?.map((action: string) => `- ${action}`).join('\n') || 'No immediate actions required'}

### Short-term Improvements  
${result.recommendations.short_term_improvements?.map((improvement: string) => `- ${improvement}`).join('\n') || 'No short-term improvements suggested'}

### Long-term Strategic
${result.recommendations.long_term_strategic?.map((strategic: string) => `- ${strategic}`).join('\n') || 'No long-term strategic recommendations'}`;

  if (result.dependency_graph) {
    markdown += `\n\n## Dependency Graph (${result.dependency_graph.format.toUpperCase()})

\`\`\`${result.dependency_graph.format}
${result.dependency_graph.diagram}
\`\`\`

### Graph Statistics
- **Total Nodes**: ${result.dependency_graph.nodes.length}
- **Total Dependencies**: ${result.dependency_graph.nodes.reduce((sum, node) => sum + node.dependencies.length, 0)}
- **Files with Dependencies**: ${result.dependency_graph.nodes.filter((node) => node.dependencies.length > 0).length}
- **Files with Dependents**: ${result.dependency_graph.nodes.filter((node) => node.dependents.length > 0).length}`;
  }

  if (result.file_analyses && result.file_analyses.length > 0) {
    markdown += `\n\n---

## 📄 File-by-File Analysis

`;

    result.file_analyses.forEach((fileAnalysis: FullFileAnalysis, index: number) => {
      const scores = fileAnalysis.clean_code_analysis?.score || 'N/A';
      const securityScore = fileAnalysis.security_analysis?.score || 'N/A';
      const maintainabilityScore =
        fileAnalysis.maintainability_analysis?.score || 'N/A';
      const performanceScore =
        fileAnalysis.performance_analysis?.score || 'N/A';

      markdown += `### ${index + 1}. \`${fileAnalysis.file}\`

| Property | Value |
|----------|-------|
| **Language** | ${fileAnalysis.language} |
| **Overall Score** | ${fileAnalysis.overall_score || 'N/A'}/10 |

#### Quality Scores

| Metric | Score |
|--------|-------|
| Security | ${securityScore}/10 |
| Code Quality | ${scores}/10 |
| Maintainability | ${maintainabilityScore}/10 |
| Performance | ${performanceScore}/10 |

#### Purpose

${fileAnalysis.purpose || 'No purpose description available'}

#### Security Analysis

${formatSecurityAnalysis(fileAnalysis.security_analysis!)}

#### Clean Code Issues

${formatCleanCodeAnalysis(fileAnalysis.clean_code_analysis!)}

#### SOLID Analysis

${formatSolidAnalysis(fileAnalysis.solid_analysis!)}

#### Performance Analysis

${formatPerformanceAnalysis(fileAnalysis.performance_analysis!)}

#### Recommendations

${formatRecommendations(fileAnalysis.recommendations!)}

---

`;
    });
  }

  if (result.dead_code) {
    markdown += `\n\n## 🧹 Dead Code Analysis

### Summary
- **Unused Functions**: ${result.dead_code.summary.total_unused_functions}
- **Unused Classes**: ${result.dead_code.summary.total_unused_classes}  
- **Unused Files**: ${result.dead_code.summary.total_unused_files}
- **Orphaned Exports**: ${result.dead_code.summary.total_orphaned_exports}
- **Circular Dependencies**: ${result.dead_code.summary.circular_dependency_count}

### Unused Functions
${
  result.dead_code.analysis.unused_functions.length > 0
    ? result.dead_code.analysis.unused_functions
        .map((fn) => `- ${fn}`)
        .join('\n')
    : 'No unused functions found'
}

### Unused Classes  
${
  result.dead_code.analysis.unused_classes.length > 0
    ? result.dead_code.analysis.unused_classes
        .map((cls) => `- ${cls}`)
        .join('\n')
    : 'No unused classes found'
}

### Unused Files
${
  result.dead_code.analysis.unused_files.length > 0
    ? result.dead_code.analysis.unused_files
        .map((file) => `- ${file}`)
        .join('\n')
    : 'No unused files found'
}

### Orphaned Exports
${
  result.dead_code.analysis.orphaned_exports.length > 0
    ? result.dead_code.analysis.orphaned_exports
        .map((exp) => `- ${exp}`)
        .join('\n')
    : 'No orphaned exports found'
}

### Circular Dependencies
${
  result.dead_code.analysis.circular_dependencies.length > 0
    ? result.dead_code.analysis.circular_dependencies
        .map((cycle) => `- ${cycle}`)
        .join('\n')
    : 'No circular dependencies found'
}`;
  }

  markdown += `\n*Analysis generated by CLIA v1.0.0*\n`;

  return markdown;
}

function formatSecurityAnalysis(securityAnalysis: SecurityAnalysis): string {
  if (!securityAnalysis) return 'No security analysis available';

  let content = '';

  if (
    securityAnalysis.vulnerabilities &&
    securityAnalysis.vulnerabilities.length > 0
  ) {
    content += '**Vulnerabilities:**\n';
    securityAnalysis.vulnerabilities.forEach((vuln) => {
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
    securityAnalysis.exposed_secrets.forEach((secret) => {
      if (typeof secret === 'string') {
        content += `- ${secret}\n`;
      } else {
        content += `- ${secret.description || secret.type || 'Potential secret detected'}\n`;
      }
    });
  }

  return content || 'No security issues identified';
}

function formatCleanCodeAnalysis(cleanCodeAnalysis: CleanCodeAnalysis): string {
  if (!cleanCodeAnalysis) return 'No clean code analysis available';

  let content = '';

  if (
    cleanCodeAnalysis.naming_issues &&
    cleanCodeAnalysis.naming_issues.length > 0
  ) {
    content += '**Naming Issues:**\n';
    cleanCodeAnalysis.naming_issues.forEach((issue) => {
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
    cleanCodeAnalysis.complexity_concerns.forEach((concern) => {
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
    cleanCodeAnalysis.organization_issues.forEach((issue) => {
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

function formatSolidAnalysis(solidAnalysis: SolidAnalysis): string {
  if (!solidAnalysis) return 'No SOLID analysis available';

  let content = '';

  if (solidAnalysis.violations && solidAnalysis.violations.length > 0) {
    content += '**SOLID Violations:**\n';
    solidAnalysis.violations.forEach((violation) => {
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

function formatPerformanceAnalysis(performanceAnalysis: PerformanceAnalysis): string {
  if (!performanceAnalysis) return 'No performance analysis available';

  let content = '';

  if (
    performanceAnalysis.performance_issues &&
    performanceAnalysis.performance_issues.length > 0
  ) {
    content += '**Performance Issues:**\n';
    performanceAnalysis.performance_issues.forEach((issue) => {
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
      (opportunity: string | { area: string; potential_gain: string; effort: string; description?: string; message?: string; expected_impact?: string; [key: string]: unknown }) => {
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
    performanceAnalysis.memory_concerns.forEach((concern) => {
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

function formatDeadCodeAnalysis(deadCodeAnalysis: DeadCodeAnalysis): string {
  if (!deadCodeAnalysis) return 'No dead code analysis available';

  let content = '';

  if (
    deadCodeAnalysis.unused_private_functions &&
    deadCodeAnalysis.unused_private_functions.length > 0
  ) {
    content += '**Unused Private Functions:**\n';
    deadCodeAnalysis.unused_private_functions.forEach((func: string | DeadCodeItem) => {
      if (typeof func === 'string') {
        content += `- ${func}\n`;
      } else {
        content += `- ${func.name}`;
        if (func.line) content += ` (line ${func.line})`;
        content += '\n';
        if (func.reason) content += `  *Reason*: ${func.reason}\n`;
      }
    });
    content += '\n';
  }

  if (
    deadCodeAnalysis.unused_private_classes &&
    deadCodeAnalysis.unused_private_classes.length > 0
  ) {
    content += '**Unused Private Classes:**\n';
    deadCodeAnalysis.unused_private_classes.forEach((cls: string | DeadCodeItem) => {
      if (typeof cls === 'string') {
        content += `- ${cls}\n`;
      } else {
        content += `- ${cls.name}`;
        if (cls.line) content += ` (line ${cls.line})`;
        content += '\n';
        if (cls.reason) content += `  *Reason*: ${cls.reason}\n`;
      }
    });
    content += '\n';
  }

  if (
    deadCodeAnalysis.unused_private_variables &&
    deadCodeAnalysis.unused_private_variables.length > 0
  ) {
    content += '**Unused Private Variables:**\n';
    deadCodeAnalysis.unused_private_variables.forEach((variable: string | DeadCodeItem) => {
      if (typeof variable === 'string') {
        content += `- ${variable}\n`;
      } else {
        content += `- ${variable.name}`;
        if (variable.line) content += ` (line ${variable.line})`;
        content += '\n';
        if (variable.reason) content += `  *Reason*: ${variable.reason}\n`;
      }
    });
    content += '\n';
  }

  if (
    deadCodeAnalysis.unreachable_code &&
    deadCodeAnalysis.unreachable_code.length > 0
  ) {
    content += '**Unreachable Code:**\n';
    deadCodeAnalysis.unreachable_code.forEach((code: string | DeadCodeItem) => {
      if (typeof code === 'string') {
        content += `- ${code}\n`;
      } else {
        content += `- ${code.location}\n`;
        if (code.reason) content += `  *Reason*: ${code.reason}\n`;
      }
    });
  }

  return content || 'No dead code identified in this file';
}

function formatRecommendations(recommendations: FileRecommendations): string {
  if (!recommendations) return 'No specific recommendations available';

  let content = '';

  if (
    recommendations.security_improvements &&
    recommendations.security_improvements.length > 0
  ) {
    content += '**Security Improvements:**\n';
    recommendations.security_improvements.forEach((improvement: string | { message?: string; description?: string }) => {
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
    recommendations.code_quality_improvements.forEach((improvement: string | { message?: string; description?: string }) => {
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
    recommendations.architectural_improvements.forEach((improvement: string | { message?: string; description?: string }) => {
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
    recommendations.performance_improvements.forEach((improvement: string | { message?: string; description?: string }) => {
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
    recommendations.maintenance_improvements.forEach((improvement: string | { message?: string; description?: string }) => {
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

function displaySummary(result: AnalysisResult): void {
  const logger = getLogger();

  logger.info('Analysis completed');
  logger.info(`Files: ${result.metadata.totalFiles}`);
  logger.info(
    `Score: ${(result.metrics as { overall_project_score: number }).overall_project_score}/10`
  );
  logger.info(
    `Issues: ${(result.metrics as { total_issues: number }).total_issues}`
  );
}

function estimateComplexity(content: string, language: string): number {
  const lines = content.split('\n').length;

  const complexityPatterns = getComplexityPatternsForLanguage(language);

  let structureCount = 0;
  for (const pattern of complexityPatterns) {
    const matches = content.match(pattern) || [];
    structureCount += matches.length;
  }

  const complexity = lines + structureCount * 10;
  return complexity;
}

function getComplexityPatternsForLanguage(language: string): RegExp[] {
  const basePatterns: RegExp[] = [];

  switch (language.toLowerCase()) {
    case 'javascript':
    case 'typescript':
      return [
        /\b(function|class|interface|type|enum)\s+\w+/g,
        /\b(const|let|var)\s+\w+\s*=\s*\(/g,
        /\bexport\s+(class|function|interface|type)/g,
        /\basync\s+(function|\w+)/g,
      ];

    case 'python':
      return [
        /^\s*(def|class|async\s+def)\s+\w+/gm,
        /^@\w+/gm,
        /^\s*with\s+\w+/gm,
        /^\s*try:/gm,
      ];

    case 'java':
      return [
        /\b(public|private|protected)\s+(class|interface|enum)/g,
        /\b(public|private|protected)\s+.*\s+\w+\s*\(/g,
        /\b@\w+/g,
        /\btry\s*\{/g,
      ];

    case 'csharp':
    case 'c#':
      return [
        /\b(public|private|protected|internal)\s+(class|interface|struct|enum)/g,
        /\b(public|private|protected|internal)\s+.*\s+\w+\s*\(/g,
        /\[[\w\s,()]+\]/g,
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
        /^#{1,6}\s+/gm,
        /```[\w]*$/gm,
        /^\*\s+/gm,
        /^\d+\.\s+/gm,
      ];

    case 'json':
    case 'yaml':
    case 'toml':
      return [
        /^\s*"[\w-]+"\s*:/gm,
        /^\s*[\w-]+\s*:/gm,
        /^\s*-\s+/gm,
      ];

    default:
      return [
        /\b(function|def|class|struct|enum|interface)\s+\w+/g,
        /\{[\s\S]*?\}/g,
        /\([\s\S]*?\)/g,
      ];
  }
}

function extractDependencies(
  content: string,
  language: string,
  filePath: string
): DependencyInfo {
  const dependencies: DependencyInfo = {
    internal_imports: [],
    external_imports: [],
    exported_functions: [],
    exported_classes: [],
    exported_variables: [],
    imported_functions: [],
    imported_classes: [],
    imported_variables: [],
    private_functions: [],
    private_classes: [],
    private_variables: [],
  };

  switch (language.toLowerCase()) {
    case 'typescript':
    case 'javascript':
      extractJavaScriptDependencies(content, dependencies, filePath);
      break;
    case 'python':
      extractPythonDependencies(content, dependencies, filePath);
      break;
    case 'java':
      extractJavaDependencies(content, dependencies, filePath);
      break;
    case 'csharp':
    case 'c#':
      extractCSharpDependencies(content, dependencies, filePath);
      break;
    case 'ruby':
      extractRubyDependencies(content, dependencies, filePath);
      break;
    case 'rust':
      extractRustDependencies(content, dependencies, filePath);
      break;
    case 'php':
      extractPhpDependencies(content, dependencies, filePath);
      break;
    case 'go':
    case 'golang':
      extractGoDependencies(content, dependencies, filePath);
      break;
    default:
      extractGenericDependencies(content, dependencies);
  }

  return dependencies;
}

function extractJavaScriptDependencies(
  content: string,
  dependencies: DependencyInfo,
  filePath: string
): void {
  const importRegex =
    /import\s+(?:type\s+)?(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"`]([^'"`]+)['"`]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[4];
    const isInternal = importPath.startsWith('.') || importPath.startsWith('/');

    if (isInternal) {
      dependencies.internal_imports.push(importPath);
    } else {
      dependencies.external_imports.push(importPath);
    }

    if (match[1]) {
      const namedImports = match[1]
        .split(',')
        .map((imp) => imp.trim().replace(/^type\s+/, ''));
      dependencies.imported_functions.push(...namedImports);
    } else if (match[2]) {
      dependencies.imported_variables.push(match[2]);
    } else if (match[3]) {
      dependencies.imported_variables.push(match[3]);
    }
  }

  const typeImportRegex =
    /import\s+type\s+\{([^}]+)\}\s+from\s+['"`]([^'"`]+)['"`]/g;
  while ((match = typeImportRegex.exec(content)) !== null) {
    const importPath = match[2];
    const isInternal = importPath.startsWith('.') || importPath.startsWith('/');

    if (isInternal && !dependencies.internal_imports.includes(importPath)) {
      dependencies.internal_imports.push(importPath);
    } else if (
      !isInternal &&
      !dependencies.external_imports.includes(importPath)
    ) {
      dependencies.external_imports.push(importPath);
    }

    const namedImports = match[1].split(',').map((imp) => imp.trim());
    namedImports.forEach((imp) => {
      if (!dependencies.imported_functions.includes(imp)) {
        dependencies.imported_functions.push(imp);
      }
    });
  }

  const individualTypeImportRegex =
    /import\s+type\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/g;
  while ((match = individualTypeImportRegex.exec(content)) !== null) {
    const importPath = match[2];
    const typeName = match[1];
    const isInternal = importPath.startsWith('.') || importPath.startsWith('/');

    if (isInternal && !dependencies.internal_imports.includes(importPath)) {
      dependencies.internal_imports.push(importPath);
    } else if (
      !isInternal &&
      !dependencies.external_imports.includes(importPath)
    ) {
      dependencies.external_imports.push(importPath);
    }

    if (!dependencies.imported_variables.includes(typeName)) {
      dependencies.imported_variables.push(typeName);
    }
  }

  const exportFunctionRegex = /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g;
  while ((match = exportFunctionRegex.exec(content)) !== null) {
    dependencies.exported_functions.push(match[1]);
  }

  const exportClassRegex = /export\s+(?:default\s+)?class\s+(\w+)/g;
  while ((match = exportClassRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  const exportVariableRegex = /export\s+(?:default\s+)?(const|let|var)\s+(\w+)/g;
  while ((match = exportVariableRegex.exec(content)) !== null) {
    dependencies.exported_variables.push(match[2]);
  }

  const exportInterfaceRegex = /export\s+(?:default\s+)?interface\s+(\w+)/g;
  while ((match = exportInterfaceRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  const exportTypeRegex = /export\s+(?:default\s+)?type\s+(\w+)/g;
  while ((match = exportTypeRegex.exec(content)) !== null) {
    dependencies.exported_variables.push(match[1]);
  }

  const namedExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(name => name.trim().replace(/\s+as\s+\w+$/, ''));
    names.forEach(name => {
      if (name && !name.includes(' ')) {
        dependencies.exported_variables.push(name);
      }
    });
  }

  const privateFunctionRegex =
    /(?<!export\s+)(?<!export\s+default\s+)function\s+(\w+)/g;
  while ((match = privateFunctionRegex.exec(content)) !== null) {
    const name = match[1];
    if (!dependencies.exported_functions.includes(name)) {
      dependencies.private_functions.push(name);
    }
  }

  const arrowFunctionRegex =
    /(?<!export\s+)(const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)\s*=>|\w+\s*=>|async\s*\([^)]*\)\s*=>|async\s+\w+\s*=>)/g;
  while ((match = arrowFunctionRegex.exec(content)) !== null) {
    const name = match[2];
    if (
      !dependencies.exported_functions.includes(name) &&
      !dependencies.exported_variables.includes(name)
    ) {
      dependencies.private_functions.push(name);
    }
  }

  const functionExpressionRegex =
    /(?<!export\s+)(const|let|var)\s+(\w+)\s*=\s*function/g;
  while ((match = functionExpressionRegex.exec(content)) !== null) {
    const name = match[2];
    if (
      !dependencies.exported_functions.includes(name) &&
      !dependencies.exported_variables.includes(name)
    ) {
      dependencies.private_functions.push(name);
    }
  }

  const privateClassRegex =
    /(?<!export\s+)(?<!export\s+default\s+)class\s+(\w+)/g;
  while ((match = privateClassRegex.exec(content)) !== null) {
    const name = match[1];
    if (!dependencies.exported_classes.includes(name)) {
      dependencies.private_classes.push(name);
    }
  }

  const privateVarRegex = /(?<!export\s+)(const|let|var)\s+(\w+)\s*=/g;
  while ((match = privateVarRegex.exec(content)) !== null) {
    const name = match[2];
    if (!dependencies.exported_variables.includes(name)) {
      dependencies.private_variables.push(name);
    }
  }

  const privateInterfaceRegex = /(?<!export\s+)interface\s+(\w+)/g;
  while ((match = privateInterfaceRegex.exec(content)) !== null) {
    const name = match[1];
    if (!dependencies.exported_classes.includes(name)) {
      dependencies.private_classes.push(name);
    }
  }

  const privateTypeRegex = /(?<!export\s+)type\s+(\w+)\s*=/g;
  while ((match = privateTypeRegex.exec(content)) !== null) {
    const name = match[1];
    if (!dependencies.exported_variables.includes(name)) {
      dependencies.private_variables.push(name);
    }
  }
}

function extractPythonDependencies(
  content: string,
  dependencies: DependencyInfo,
  filePath: string
): void {
  const importRegex = /^(?:from\s+(\S+)\s+)?import\s+(.+)$/gm;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const fromModule = match[1];
    const imports = match[2].split(',').map((imp) => imp.trim());

    if (fromModule) {
      const isInternal =
        fromModule.startsWith('.') || !fromModule.includes('.');
      if (isInternal) {
        dependencies.internal_imports.push(fromModule);
      } else {
        dependencies.external_imports.push(fromModule);
      }
    }

    dependencies.imported_functions.push(...imports);
  }

  const functionRegex = /^def\s+(\w+)/gm;
  while ((match = functionRegex.exec(content)) !== null) {
    const name = match[1];
    if (name.startsWith('_')) {
      dependencies.private_functions.push(name);
    } else {
      dependencies.exported_functions.push(name);
    }
  }

  const classRegex = /^class\s+(\w+)/gm;
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    if (name.startsWith('_')) {
      dependencies.private_classes.push(name);
    } else {
      dependencies.exported_classes.push(name);
    }
  }

  const variableRegex = /^(\w+)\s*=\s*[^=]/gm;
  while ((match = variableRegex.exec(content)) !== null) {
    const name = match[1];
    if (
      ![
        'import',
        'from',
        'def',
        'class',
        'if',
        'for',
        'while',
        'with',
        'try',
      ].includes(name)
    ) {
      if (name.startsWith('_')) {
        dependencies.private_variables.push(name);
      } else {
        dependencies.exported_variables.push(name);
      }
    }
  }
}

function extractJavaDependencies(
  content: string,
  dependencies: DependencyInfo,
  filePath: string
): void {
  const importRegex = /import\s+(?:static\s+)?([^;]+);/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const isInternal =
      !importPath.includes('java.') && !importPath.includes('javax.');

    if (isInternal) {
      dependencies.internal_imports.push(importPath);
    } else {
      dependencies.external_imports.push(importPath);
    }
  }

  const classRegex = /(public|private|protected)?\s*class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    const visibility = match[1] || 'package';
    const name = match[2];
    if (visibility === 'private') {
      dependencies.private_classes.push(name);
    } else {
      dependencies.exported_classes.push(name);
    }
  }

  const methodRegex =
    /(public|private|protected)?\s*(?:static\s+)?[\w<>]+\s+(\w+)\s*\(/g;
  while ((match = methodRegex.exec(content)) !== null) {
    const visibility = match[1] || 'package';
    const name = match[2];
    if (visibility === 'private') {
      dependencies.private_functions.push(name);
    } else {
      dependencies.exported_functions.push(name);
    }
  }
}

function extractCSharpDependencies(
  content: string,
  dependencies: DependencyInfo,
  filePath: string
): void {
  const usingRegex = /using\s+([^;]+);/g;
  let match;

  while ((match = usingRegex.exec(content)) !== null) {
    const usingPath = match[1];
    const isInternal =
      !usingPath.startsWith('System') && !usingPath.startsWith('Microsoft');

    if (isInternal) {
      dependencies.internal_imports.push(usingPath);
    } else {
      dependencies.external_imports.push(usingPath);
    }
  }

  const classRegex = /(public|private|internal|protected)?\s*class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    const visibility = match[1] || 'internal';
    const name = match[2];
    if (visibility === 'private') {
      dependencies.private_classes.push(name);
    } else {
      dependencies.exported_classes.push(name);
    }
  }

  const methodRegex =
    /(public|private|protected|internal)?\s*(?:static\s+)?[\w<>]+\s+(\w+)\s*\(/g;
  while ((match = methodRegex.exec(content)) !== null) {
    const visibility = match[1] || 'internal';
    const name = match[2];
    if (visibility === 'private') {
      dependencies.private_functions.push(name);
    } else {
      dependencies.exported_functions.push(name);
    }
  }
}

function extractRubyDependencies(
  content: string,
  dependencies: DependencyInfo,
  filePath: string
): void {
  const requireRegex = /require\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = requireRegex.exec(content)) !== null) {
    const requirePath = match[1];
    const isInternal =
      requirePath.startsWith('.') || !requirePath.includes('/');

    if (isInternal) {
      dependencies.internal_imports.push(requirePath);
    } else {
      dependencies.external_imports.push(requirePath);
    }
  }

  const gemRegex = /gem\s+['"]([^'"]+)['"]/g;
  while ((match = gemRegex.exec(content)) !== null) {
    dependencies.external_imports.push(match[1]);
  }

  const classRegex = /^\s*class\s+(\w+)/gm;
  while ((match = classRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  const methodRegex = /^\s*def\s+(\w+)/gm;
  const privateMethodRegex = /private[\s\S]*?def\s+(\w+)/g;
  const privateMethods = new Set<string>();

  while ((match = privateMethodRegex.exec(content)) !== null) {
    privateMethods.add(match[1]);
  }

  content.replace(methodRegex, (match, name) => {
    if (privateMethods.has(name)) {
      dependencies.private_functions.push(name);
    } else {
      dependencies.exported_functions.push(name);
    }
    return match;
  });

  const moduleRegex = /^\s*module\s+(\w+)/gm;
  while ((match = moduleRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  const instanceVarRegex = /@(\w+)/g;
  while ((match = instanceVarRegex.exec(content)) !== null) {
    dependencies.private_variables.push(`@${match[1]}`);
  }
}

function extractRustDependencies(
  content: string,
  dependencies: DependencyInfo,
  filePath: string
): void {
  const useRegex = /use\s+([^;]+);/g;
  let match;

  while ((match = useRegex.exec(content)) !== null) {
    const usePath = match[1];
    const isInternal =
      usePath.startsWith('crate::') ||
      usePath.startsWith('super::') ||
      usePath.startsWith('self::');

    if (isInternal) {
      dependencies.internal_imports.push(usePath);
    } else {
      dependencies.external_imports.push(usePath);
    }

    const importedItem = usePath.split('::').pop()?.replace(/[{}]/g, '');
    if (importedItem) {
      dependencies.imported_functions.push(importedItem);
    }
  }

  const publicFunctionRegex = /pub\s+fn\s+(\w+)/g;
  const privateFunctionRegex = /(?<!pub\s+)fn\s+(\w+)/g;

  while ((match = publicFunctionRegex.exec(content)) !== null) {
    dependencies.exported_functions.push(match[1]);
  }

  while ((match = privateFunctionRegex.exec(content)) !== null) {
    const name = match[1];
    if (!dependencies.exported_functions.includes(name)) {
      dependencies.private_functions.push(name);
    }
  }

  const publicStructRegex = /pub\s+struct\s+(\w+)/g;
  const privateStructRegex = /(?<!pub\s+)struct\s+(\w+)/g;

  while ((match = publicStructRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  while ((match = privateStructRegex.exec(content)) !== null) {
    const name = match[1];
    if (!dependencies.exported_classes.includes(name)) {
      dependencies.private_classes.push(name);
    }
  }

  const publicEnumRegex = /pub\s+enum\s+(\w+)/g;
  const privateEnumRegex = /(?<!pub\s+)enum\s+(\w+)/g;

  while ((match = publicEnumRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  while ((match = privateEnumRegex.exec(content)) !== null) {
    const name = match[1];
    if (!dependencies.exported_classes.includes(name)) {
      dependencies.private_classes.push(name);
    }
  }

  const publicTraitRegex = /pub\s+trait\s+(\w+)/g;
  const privateTraitRegex = /(?<!pub\s+)trait\s+(\w+)/g;

  while ((match = publicTraitRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  while ((match = privateTraitRegex.exec(content)) !== null) {
    const name = match[1];
    if (!dependencies.exported_classes.includes(name)) {
      dependencies.private_classes.push(name);
    }
  }
}

function extractPhpDependencies(
  content: string,
  dependencies: DependencyInfo,
  filePath: string
): void {
  const useRegex = /use\s+([^;]+);/g;
  let match;

  while ((match = useRegex.exec(content)) !== null) {
    const usePath = match[1];
    const isInternal =
      !usePath.includes('\\\\') && !usePath.match(/^[A-Z][a-zA-Z]+\\/);

    if (isInternal) {
      dependencies.internal_imports.push(usePath);
    } else {
      dependencies.external_imports.push(usePath);
    }
  }

  const requireRegex =
    /(?:require|include)(?:_once)?\s*\(?['"]([^'"]+)['"]\)?/g;
  while ((match = requireRegex.exec(content)) !== null) {
    const requirePath = match[1];
    const isInternal =
      requirePath.startsWith('.') || !requirePath.includes('vendor/');

    if (isInternal) {
      dependencies.internal_imports.push(requirePath);
    } else {
      dependencies.external_imports.push(requirePath);
    }
  }

  const classRegex = /(?:abstract\s+)?class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  const functionRegex = /function\s+(\w+)/g;
  while ((match = functionRegex.exec(content)) !== null) {
    dependencies.exported_functions.push(match[1]);
  }

  const privateMethodRegex = /private\s+function\s+(\w+)/g;
  const protectedMethodRegex = /protected\s+function\s+(\w+)/g;
  const publicMethodRegex = /public\s+function\s+(\w+)/g;

  while ((match = privateMethodRegex.exec(content)) !== null) {
    dependencies.private_functions.push(match[1]);
  }

  while ((match = protectedMethodRegex.exec(content)) !== null) {
    dependencies.private_functions.push(match[1]);
  }

  while ((match = publicMethodRegex.exec(content)) !== null) {
    dependencies.exported_functions.push(match[1]);
  }

  const privatePropertyRegex = /private\s+\$(\w+)/g;
  while ((match = privatePropertyRegex.exec(content)) !== null) {
    dependencies.private_variables.push(`$${match[1]}`);
  }

  const interfaceRegex = /interface\s+(\w+)/g;
  while ((match = interfaceRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }

  const traitRegex = /trait\s+(\w+)/g;
  while ((match = traitRegex.exec(content)) !== null) {
    dependencies.exported_classes.push(match[1]);
  }
}

function extractGoDependencies(
  content: string,
  dependencies: DependencyInfo,
  filePath: string
): void {
  const importRegex = /import\s+(?:\(([^)]+)\)|['"]([^'"]+)['"])/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) {
      const imports = match[1]
        .split('\n')
        .map((line) => {
          const importMatch = line.match(/['"]([^'"]+)['"]/);
          return importMatch ? importMatch[1] : null;
        })
        .filter(Boolean);

      imports.forEach((importPath) => {
        if (importPath) {
          const isInternal =
            importPath.startsWith('.') || !importPath.includes('.');
          if (isInternal) {
            dependencies.internal_imports.push(importPath);
          } else {
            dependencies.external_imports.push(importPath);
          }
        }
      });
    } else if (match[2]) {
      const importPath = match[2];
      const isInternal =
        importPath.startsWith('.') || !importPath.includes('.');

      if (isInternal) {
        dependencies.internal_imports.push(importPath);
      } else {
        dependencies.external_imports.push(importPath);
      }
    }
  }

  const functionRegex = /func\s+(\w+)/g;
  while ((match = functionRegex.exec(content)) !== null) {
    const name = match[1];
    if (name[0] === name[0].toUpperCase()) {
      dependencies.exported_functions.push(name);
    } else {
      dependencies.private_functions.push(name);
    }
  }

  const typeRegex = /type\s+(\w+)\s+(?:struct|interface)/g;
  while ((match = typeRegex.exec(content)) !== null) {
    const name = match[1];
    if (name[0] === name[0].toUpperCase()) {
      dependencies.exported_classes.push(name);
    } else {
      dependencies.private_classes.push(name);
    }
  }

  const varRegex = /var\s+(\w+)\s+/g;
  while ((match = varRegex.exec(content)) !== null) {
    const name = match[1];
    if (name[0] === name[0].toUpperCase()) {
      dependencies.exported_variables.push(name);
    } else {
      dependencies.private_variables.push(name);
    }
  }

  const constRegex = /const\s+(\w+)\s+/g;
  while ((match = constRegex.exec(content)) !== null) {
    const name = match[1];
    if (name[0] === name[0].toUpperCase()) {
      dependencies.exported_variables.push(name);
    } else {
      dependencies.private_variables.push(name);
    }
  }
}

function extractGenericDependencies(
  content: string,
  dependencies: DependencyInfo
): void {
  const includeRegex = /#include\s+[<"]([^>"]+)[>"]/g;
  let match;

  while ((match = includeRegex.exec(content)) !== null) {
    dependencies.external_imports.push(match[1]);
  }
}

async function buildDependencyGraph(
  files: FileAnalysisData[]
): Promise<DependencyNode[]> {
  const logger = getLogger();
  const nodes: DependencyNode[] = [];
  const fileMap = new Map<string, FileAnalysisData>();

  files.forEach((file) => {
    fileMap.set(file.file, file);
    const normalized = path.normalize(file.file);
    fileMap.set(normalized, file);
  });

  logger.info(`Building dependency graph for ${files.length} files`);

  for (const file of files) {
    const dependencies: string[] = [];
    const dependents: string[] = [];

    if (file.dependencies) {
      logger.debug(`Processing ${file.file}: ${file.dependencies.internal_imports.length} internal imports`);
      
      for (const internalImport of file.dependencies.internal_imports) {
        const resolvedPath = resolveImportPath(internalImport, file.file, fileMap);
        
        if (resolvedPath && fileMap.has(resolvedPath)) {
          dependencies.push(resolvedPath);
          logger.debug(`  ✓ Resolved: ${internalImport} -> ${resolvedPath}`);
        } else {
          logger.debug(`  ✗ Unresolved: ${internalImport} (tried: ${resolvedPath})`);
        }
      }
    }

    for (const otherFile of files) {
      if (otherFile.file !== file.file && otherFile.dependencies) {
        for (const internalImport of otherFile.dependencies.internal_imports) {
          const resolvedPath = resolveImportPath(
            internalImport,
            otherFile.file,
            fileMap
          );
          if (resolvedPath === file.file) {
            dependents.push(otherFile.file);
          }
        }
      }
    }

    nodes.push({
      file: file.file,
      dependencies,
      dependents,
      exports: file.exported_symbols || [],
      imports: file.imported_symbols || [],
      dead_exports: [],
    });
  }

  const nodesWithDeps = nodes.filter(n => n.dependencies.length > 0 || n.dependents.length > 0);
  logger.info(`Dependency graph: ${nodes.length} nodes, ${nodesWithDeps.length} with dependencies`);

  return nodes;
}

function resolveImportPath(
  importPath: string, 
  fromFile: string,
  fileMap: Map<string, FileAnalysisData>
): string | null {
  if (!importPath.startsWith('.')) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  
  let cleanImport = importPath;
  if (importPath.endsWith('.js')) {
    cleanImport = importPath.slice(0, -3);
  }
  
  const basePath = path.join(fromDir, cleanImport);
  
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx'];
  
  for (const ext of extensions) {
    const candidatePath = basePath + ext;
    
    if (fileMap.has(candidatePath)) {
      return candidatePath;
    }
    
    const normalizedCandidate = path.normalize(candidatePath);
    if (fileMap.has(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }
  
  const indexExtensions = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  for (const indexFile of indexExtensions) {
    const indexPath = path.join(basePath, indexFile);
    
    if (fileMap.has(indexPath)) {
      return indexPath;
    }
    
    const normalizedIndex = path.normalize(indexPath);
    if (fileMap.has(normalizedIndex)) {
      return normalizedIndex;
    }
  }
  
  return null;
}function generateMermaidDiagram(nodes: DependencyNode[]): string {
  let diagram = 'graph TD\n\n';

  const nodesWithDeps = nodes.filter(
    (node) => node.dependencies.length > 0 || node.dependents.length > 0
  );

  if (nodesWithDeps.length === 0) {
    diagram += '  A["No dependencies found"]\n';
    return diagram;
  }

  const addedNodes = new Set<string>();
  nodesWithDeps.forEach((node) => {
    const safeName = node.file.replace(/[^a-zA-Z0-9]/g, '_');
    if (!addedNodes.has(safeName)) {
      const displayName =
        node.file.length > 30 ? '...' + node.file.slice(-27) : node.file;
      diagram += `  ${safeName}["${displayName}"]\n`;
      addedNodes.add(safeName);
    }
  });

  diagram += '\n';

  nodesWithDeps.forEach((node) => {
    const safeName = node.file.replace(/[^a-zA-Z0-9]/g, '_');
    node.dependencies.forEach((dep) => {
      const depSafeName = dep.replace(/[^a-zA-Z0-9]/g, '_');
      if (addedNodes.has(depSafeName)) {
        diagram += `  ${safeName} --> ${depSafeName}\n`;
      }
    });
  });

  return diagram;
}

function analyzeDeadCode(nodes: DependencyNode[]): DeadCodeAnalysis {
  const analysis: DeadCodeAnalysis = {
    unused_functions: [],
    unused_classes: [],
    unused_variables: [],
    unused_files: [],
    orphaned_exports: [],
    circular_dependencies: [],
  };

  const unusedFiles = nodes.filter(
    (node) => node.dependents.length === 0 && !isEntryPoint(node.file)
  );
  analysis.unused_files = unusedFiles.map((node) => node.file);

  nodes.forEach((node) => {
    const allImports = new Set<string>();
    nodes.forEach((otherNode) => {
      if (otherNode.file !== node.file) {
        otherNode.imports.forEach((imp) => allImports.add(imp));
      }
    });

    const orphanedExports = node.exports.filter((exp) => !allImports.has(exp));
    analysis.orphaned_exports.push(
      ...orphanedExports.map((exp) => `${node.file}:${exp}`)
    );
  });

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function detectCycle(node: DependencyNode, path: string[]): void {
    if (recursionStack.has(node.file)) {
      const cycleStart = path.indexOf(node.file);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart).concat(node.file).join(' -> ');
        analysis.circular_dependencies.push(cycle);
      }
      return;
    }

    if (visited.has(node.file)) {
      return;
    }

    visited.add(node.file);
    recursionStack.add(node.file);

    node.dependencies.forEach((depFile) => {
      const depNode = nodes.find((n) => n.file === depFile);
      if (depNode) {
        detectCycle(depNode, [...path, node.file]);
      }
    });

    recursionStack.delete(node.file);
  }

  nodes.forEach((node) => {
    if (!visited.has(node.file)) {
      detectCycle(node, []);
    }
  });

  return analysis;
}

async function analyzeDeadCodeFromCache(): Promise<DeadCodeResult> {
  const cache = await loadCache();
  const analysis: DeadCodeAnalysis = {
    unused_functions: [],
    unused_classes: [],
    unused_variables: [],
    unused_files: [],
    orphaned_exports: [],
    circular_dependencies: [],
  };

  const allExports = new Map<string, { file: string; type: string }>();
  const allImports = new Set<string>();
  const fileImports = new Map<string, string[]>();
  const fileDependencies = new Map<string, string[]>();

  for (const [filePath, cacheEntry] of Object.entries(cache)) {
    if (!cacheEntry.analysis?.dependencies) continue;

    const deps = cacheEntry.analysis.dependencies;

    deps.exported_functions?.forEach((fn) => {
      allExports.set(fn, { file: filePath, type: 'function' });
    });
    deps.exported_classes?.forEach((cls) => {
      allExports.set(cls, { file: filePath, type: 'class' });
    });
    deps.exported_variables?.forEach((v) => {
      allExports.set(v, { file: filePath, type: 'variable' });
    });

    const imports = [
      ...(deps.imported_functions || []),
      ...(deps.imported_classes || []),
      ...(deps.imported_variables || []),
    ];
    imports.forEach((imp) => allImports.add(imp));
    fileImports.set(filePath, imports);

    fileDependencies.set(filePath, deps.internal_imports || []);
  }

  for (const [exportName, exportInfo] of allExports) {
    if (!allImports.has(exportName)) {
      analysis.orphaned_exports.push(
        `${exportInfo.file}:${exportName} (${exportInfo.type})`
      );
    }
  }

  for (const [filePath, cacheEntry] of Object.entries(cache)) {
    if (!cacheEntry.analysis?.dependencies) continue;

    const deps = cacheEntry.analysis.dependencies;

    deps.private_functions?.forEach((fn) => {
      const isUsedInFile =
        cacheEntry.analysis.content?.includes(`${fn}(`) || false;
      if (!isUsedInFile) {
        analysis.unused_functions.push(`${filePath}:${fn}`);
      }
    });

    deps.private_classes?.forEach((cls) => {
      const isUsedInFile =
        cacheEntry.analysis.content?.includes(`new ${cls}`) ||
        cacheEntry.analysis.content?.includes(`${cls}.`) ||
        false;
      if (!isUsedInFile) {
        analysis.unused_classes.push(`${filePath}:${cls}`);
      }
    });

    deps.private_variables?.forEach((v) => {
      const isUsedInFile = cacheEntry.analysis.content?.includes(v) || false;
      if (!isUsedInFile) {
        analysis.unused_variables.push(`${filePath}:${v}`);
      }
    });
  }

  const allFiles = Object.keys(cache);
  const referencedFiles = new Set<string>();

  for (const deps of fileDependencies.values()) {
    deps.forEach((dep) => {
      const resolvedPath = resolveImportPathForDeadCode(dep, allFiles);
      if (resolvedPath) {
        referencedFiles.add(resolvedPath);
      }
    });
  }

  for (const filePath of allFiles) {
    const isSourceFile =
      filePath.match(/\.(ts|js|tsx|jsx)$/) &&
      filePath.startsWith('src/') &&
      !filePath.includes('.d.ts');

    if (
      isSourceFile &&
      !referencedFiles.has(filePath) &&
      !isEntryPoint(filePath)
    ) {
      analysis.unused_files.push(filePath);
    }
  }

  analysis.circular_dependencies = findCircularDependencies(fileDependencies);

  const summary = {
    total_unused_functions: analysis.unused_functions.length,
    total_unused_classes: analysis.unused_classes.length,
    total_unused_files: analysis.unused_files.length,
    total_orphaned_exports: analysis.orphaned_exports.length,
    circular_dependency_count: analysis.circular_dependencies.length,
  };

  return { analysis, summary };
}

function resolveImportPathForDeadCode(
  importPath: string,
  allFiles: string[]
): string | null {
  if (importPath.startsWith('.')) {
    let basePath = importPath;
    if (basePath.endsWith('.js')) {
      basePath = basePath.slice(0, -3);
    }

    const extensions = ['.ts', '.js', '.tsx', '.jsx'];

    for (const ext of extensions) {
      const candidate = basePath + ext;
      if (allFiles.includes(candidate)) {
        return candidate;
      }
    }

    const indexExtensions = [
      '/index.ts',
      '/index.js',
      '/index.tsx',
      '/index.jsx',
    ];
    for (const ext of indexExtensions) {
      const candidate = basePath + ext;
      if (allFiles.includes(candidate)) {
        return candidate;
      }
    }

    if (allFiles.includes(importPath)) {
      return importPath;
    }
  }
  return null;
}

function findCircularDependencies(
  fileDependencies: Map<string, string[]>
): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[] = [];

  function dfs(file: string, path: string[]): void {
    if (recursionStack.has(file)) {
      const cycleStart = path.indexOf(file);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart).concat(file).join(' -> ');
        cycles.push(cycle);
      }
      return;
    }

    if (visited.has(file)) return;

    visited.add(file);
    recursionStack.add(file);

    const dependencies = fileDependencies.get(file) || [];
    for (const dep of dependencies) {
      const resolvedDep = resolveImportPathForDeadCode(
        dep,
        Array.from(fileDependencies.keys())
      );
      if (resolvedDep) {
        dfs(resolvedDep, [...path, file]);
      }
    }

    recursionStack.delete(file);
  }

  for (const file of fileDependencies.keys()) {
    if (!visited.has(file)) {
      dfs(file, []);
    }
  }

  return cycles;
}

function generateDependencyDiagram(
  nodes: DependencyNode[],
  format: string
): string {
  switch (format) {
    case 'plantuml':
      return generatePlantUMLDiagram(nodes);
    case 'structurizr':
      return generateStructurizrDiagram(nodes);
    case 'mermaid':
    default:
      return generateMermaidDiagram(nodes);
  }
}

function generatePlantUMLDiagram(nodes: DependencyNode[]): string {
  let diagram = '@startuml\n';
  diagram += '!theme plain\n';
  diagram += 'title Dependency Diagram\n\n';

  nodes.forEach((node) => {
    const componentName = path.basename(node.file, path.extname(node.file));
    diagram += `component "${componentName}" as ${componentName.replace(/[^a-zA-Z0-9]/g, '_')}\n`;
  });

  diagram += '\n';

  nodes.forEach((node) => {
    const fromName = path
      .basename(node.file, path.extname(node.file))
      .replace(/[^a-zA-Z0-9]/g, '_');
    node.dependencies.forEach((dep) => {
      const toName = path
        .basename(dep, path.extname(dep))
        .replace(/[^a-zA-Z0-9]/g, '_');
      diagram += `${fromName} --> ${toName}\n`;
    });
  });

  diagram += '@enduml\n';
  return diagram;
}

function generateStructurizrDiagram(nodes: DependencyNode[]): string {
  let diagram = 'workspace {\n\n';
  diagram += '    model {\n';
  diagram += '        softwareSystem = softwareSystem "Application" {\n';

  nodes.forEach((node) => {
    const fullPath = node.file.replace(/^\.\//, '').replace(/\\/g, '/');
    const fileName = path.basename(fullPath);
    const isHiddenFile = fileName.startsWith('.');
    
    let displayName: string;
    if (isHiddenFile && !fileName.includes('.', 1)) {
      displayName = fullPath;
    } else {
      displayName = fullPath.replace(/\.[^/.]+$/, '');
    }
    
    const safeName = displayName.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown_file';
    const extension = path.extname(node.file).substring(1) || 'unknown';
    
    diagram += `            ${safeName} = container "${displayName}" {\n`;
    diagram += `                technology "${extension}"\n`;
    diagram += '            }\n';
  });

  diagram += '        }\n\n';

  diagram += '        # Relationships\n';
  const uniqueRelationships = new Set<string>();
  
  nodes.forEach((node) => {
    const fromPath = node.file.replace(/^\.\//, '').replace(/\\/g, '/');
    const fromFileName = path.basename(fromPath);
    const isFromHidden = fromFileName.startsWith('.');
    
    let fromDisplay: string;
    if (isFromHidden && !fromFileName.includes('.', 1)) {
      fromDisplay = fromPath;
    } else {
      fromDisplay = fromPath.replace(/\.[^/.]+$/, '');
    }
    const fromName = fromDisplay.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown_file';
    
    node.dependencies.forEach((dep) => {
      const toPath = dep.replace(/^\.\//, '').replace(/\\/g, '/');
      const toFileName = path.basename(toPath);
      const isToHidden = toFileName.startsWith('.');
      
      let toDisplay: string;
      if (isToHidden && !toFileName.includes('.', 1)) {
        toDisplay = toPath;
      } else {
        toDisplay = toPath.replace(/\.[^/.]+$/, '');
      }
      const toName = toDisplay.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown_file';
      
      const relationshipKey = `${fromName}->${toName}`;
      if (!uniqueRelationships.has(relationshipKey)) {
        uniqueRelationships.add(relationshipKey);
        diagram += `        ${fromName} -> ${toName} "depends on"\n`;
      }
    });
  });

  diagram += '    }\n\n';
  diagram += '    views {\n';
  diagram += '        container softwareSystem {\n';
  diagram += '            include *\n';
  diagram += '            autoLayout\n';
  diagram += '        }\n';
  diagram += '    }\n';
  diagram += '}\n';

  return diagram;
}

function isEntryPoint(filePath: string): boolean {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath);

  const entryPoints = [
    'index.js',
    'index.ts',
    'main.js',
    'main.ts',
    'app.js',
    'app.ts',
    'server.js',
    'server.ts',
    'index.html',
    'main.py',
    '__main__.py',
  ];

  const configFiles = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    '.eslintrc.js',
    '.prettierrc',
    '.gitignore',
    '.npmignore',
    '.env.exemple',
    'config.sample.json',
  ];

  const docFiles = ['README.md', 'README-PTBR.md', 'LICENSE'];

  const isConfigFile =
    configFiles.includes(fileName) ||
    fileName.startsWith('.') ||
    (extension === '.json' &&
      (fileName.includes('config') || fileName.includes('package')));

  const isDocFile =
    docFiles.includes(fileName) ||
    extension === '.md' ||
    filePath.includes('docs/') ||
    filePath.includes('.github/');

  const isPromptFile = filePath.includes('src/prompts/') && extension === '.md';

  const isGitHook = filePath.includes('.git/hooks/');

  const isScriptFile =
    filePath.includes('scripts/') ||
    fileName.endsWith('.py') ||
    fileName.endsWith('.sh');

  const isTestFile =
    filePath.includes('test/') ||
    fileName.includes('.test.') ||
    fileName.includes('.spec.');

  return (
    entryPoints.includes(fileName) ||
    filePath.includes('bin/') ||
    isConfigFile ||
    isDocFile ||
    isPromptFile ||
    isGitHook ||
    isScriptFile ||
    isTestFile
  );
}

function selectDeadCodePrompt(stackContext: StackContext): string {
  const primaryLanguage =
    stackContext?.stackInfo?.primary?.name?.toLowerCase() ||
    stackContext?.summary?.primary?.toLowerCase() ||
    '';

  const languagePromptMap: Record<string, string> = {
    typescript: 'analyze/dead-code-typescript',
    javascript: 'analyze/dead-code-javascript',
    python: 'analyze/dead-code-python',
    php: 'analyze/dead-code-php',
    csharp: 'analyze/dead-code-csharp',
    'c#': 'analyze/dead-code-csharp',
    ruby: 'analyze/dead-code-ruby',
    rust: 'analyze/dead-code-rust',
    nodejs: 'analyze/dead-code-javascript',
    node: 'analyze/1.0.0/dead-code-javascript',
  };

  const selectedPrompt =
    languagePromptMap[primaryLanguage] || languagePromptMap['typescript'];

  getLogger().info(
    `Dead code analysis: detected language '${primaryLanguage}', using prompt '${selectedPrompt}'`
  );

  return selectedPrompt;
}

async function analyzeDeadCodeWithLLM(): Promise<DeadCodeResult> {
  const cache = await loadCache();
  const logger = getLogger();
  const stackContext = await getStackContext(logger);
  const projectData = extractStructuredDataFromCache(cache);
  const config = await loadConfig();
  const promptName = selectDeadCodePrompt(stackContext);



  try {
    const promptData: DeadCodePromptContext = {
      projectName: getProjectName(),
      projectData: JSON.stringify(projectData, null, 2),
      stackContext: JSON.stringify(stackContext, null, 2),
      userLanguage: config.language || 'en-US',
      timestamp: new Date().toISOString(),
    };

    const llmAnalysis = await execPrompt<
      DeadCodePromptContext,
      DeadCodeResponse
    >(promptName, promptData, '1.0.0', 'default', 0.3, 3);

    const validatedResponse = assertDeadCodeResponse(llmAnalysis);
    const result = convertLLMResponseToDeadCodeResult(validatedResponse);

    const orphanFilesFromCache = await detectOrphanFilesFromCache();
    
    for (const orphanFile of orphanFilesFromCache) {
      if (!result.analysis.unused_files.includes(orphanFile)) {
        result.analysis.unused_files.push(orphanFile);
        result.summary.total_unused_files++;
      }
    }

    getLogger().info(`Dead code analysis: LLM found ${result.analysis.unused_files.length - orphanFilesFromCache.length} unused files, cache analysis found ${orphanFilesFromCache.length} additional orphan files`);

    return result;
  } catch (error) {
    getLogger().error('LLM-based dead code analysis failed:', error);
    throw error;
  }
}

interface ExtractedFileData {
  path: string;
  size: number;
  language: string;
  exports: {
    functions: string[];
    classes: string[];
    variables: string[];
  };
  imports: {
    internal: string[];
    external: string[];
    functions: string[];
    classes: string[];
    variables: string[];
  };
  private: {
    functions: string[];
    classes: string[];
    variables: string[];
  };
}

interface ExtractedProjectData {
  files: ExtractedFileData[];
}

function extractStructuredDataFromCache(cache: CacheData): ExtractedProjectData {
  const project: ExtractedProjectData = {
    files: [],
  };

  for (const [filePath, cacheEntry] of Object.entries(cache)) {
    if (!cacheEntry.analysis?.dependencies) continue;

    const deps = cacheEntry.analysis.dependencies;
    const fileData = {
      path: filePath,
      size: cacheEntry.analysis.size,
      language: cacheEntry.analysis.language,
      exports: {
        functions: deps.exported_functions || [],
        classes: deps.exported_classes || [],
        variables: deps.exported_variables || [],
      },
      imports: {
        internal: deps.internal_imports || [],
        external: deps.external_imports || [],
        functions: deps.imported_functions || [],
        classes: deps.imported_classes || [],
        variables: deps.imported_variables || [],
      },
      private: {
        functions: deps.private_functions || [],
        classes: deps.private_classes || [],
        variables: deps.private_variables || [],
      },
    };

    project.files.push(fileData);
  }

  return project;
}

function convertLLMResponseToDeadCodeResult(
  llmAnalysis: DeadCodeResponse
): DeadCodeResult {
  const analysis: DeadCodeAnalysis = {
    unused_functions: [],
    unused_classes: [],
    unused_variables: [],
    unused_files: llmAnalysis.deadCode?.unusedFiles?.map((f) => f.path) || [],
    orphaned_exports:
      llmAnalysis.deadCode?.unusedExports?.map(
        (e) => `${e.file}:${e.export} (${e.type})`
      ) || [],
    circular_dependencies: [],
  };

  llmAnalysis.deadCode?.unusedExports?.forEach((exportItem) => {
    const identifier = `${exportItem.file}:${exportItem.export}`;
    switch (exportItem.type) {
      case 'function':
        analysis.unused_functions.push(identifier);
        break;
      case 'class':
        analysis.unused_classes.push(identifier);
        break;
      case 'variable':
        analysis.unused_variables.push(identifier);
        break;
    }
  });

  const summary = {
    total_unused_functions: analysis.unused_functions.length,
    total_unused_classes: analysis.unused_classes.length,
    total_unused_files: analysis.unused_files.length,
    total_orphaned_exports: analysis.orphaned_exports.length,
    circular_dependency_count: analysis.circular_dependencies.length,
  };

  return { analysis, summary };
}

async function detectOrphanFilesFromCache(): Promise<string[]> {
  const cache = await loadCache();
  const orphanFiles: string[] = [];
  const importedFiles = new Set<string>();
  
  const projectInspection = await loadProjectInspection();
  const entryPoints = projectInspection?.projectStructure?.entryPoints || ['src/index.ts'];
  
  const LANGUAGE_PATTERNS = {
    typescript: { extensions: ['.ts', '.tsx'], indexFiles: ['index.ts', 'main.ts', 'app.ts'] },
    javascript: { extensions: ['.js', '.jsx'], indexFiles: ['index.js', 'main.js', 'app.js'] },
    
    python: { extensions: ['.py'], indexFiles: ['__init__.py', '__main__.py', 'main.py', 'app.py'] },
    
    csharp: { extensions: ['.cs'], indexFiles: ['Program.cs', 'Startup.cs', 'Global.asax.cs'] },
    
    java: { extensions: ['.java'], indexFiles: ['Main.java', 'Application.java'] },
    
    ruby: { extensions: ['.rb'], indexFiles: ['main.rb', 'application.rb', 'config.ru'] },
    
    rust: { extensions: ['.rs'], indexFiles: ['main.rs', 'lib.rs', 'mod.rs'] },
    
    php: { extensions: ['.php'], indexFiles: ['index.php', 'bootstrap.php', 'autoload.php'] },
    
    go: { extensions: ['.go'], indexFiles: ['main.go'] }
  };

  const primaryLanguage = projectInspection?.summary?.primaryLanguage || 'typescript';
  const languageConfig = LANGUAGE_PATTERNS[primaryLanguage as keyof typeof LANGUAGE_PATTERNS] || LANGUAGE_PATTERNS.typescript;

  const FRAMEWORK_ENTRY_POINTS = [
    'pages/', 'app/', 'routes/', 'controllers/', 'views/',
    'config/', 'settings/', 'env/',
    'webpack.config', 'vite.config', 'jest.config', 'babel.config',
    'bin/', 'cli/', 'scripts/',
    'docs/', 'README', 'LICENSE'
  ];

  const isEntryPoint = (filePath: string): boolean => {
    if (entryPoints.some((ep: string) => filePath.includes(ep))) return true;
    
    if (languageConfig.indexFiles.some(idx => filePath.includes(idx))) return true;
    
    if (FRAMEWORK_ENTRY_POINTS.some(pattern => filePath.includes(pattern))) return true;
    
    const fileName = path.basename(filePath);
    if (filePath.split('/').length <= 2 && (
      fileName.startsWith('index.') || 
      fileName.startsWith('main.') ||
      fileName.startsWith('app.') ||
      fileName.startsWith('server.')
    )) return true;

    return false;
  };

  const isConfigurationFile = (filePath: string): boolean => {
    const configPatterns = [
      'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
      'Cargo.toml', 'Cargo.lock', 'pom.xml', 'build.gradle', 'Gemfile', 'Gemfile.lock',
      'composer.json', 'composer.lock', 'go.mod', 'go.sum', 'requirements.txt', 'Pipfile',
      'pyproject.toml', '*.csproj', 'packages.config',
      
      'tsconfig.json', 'eslint.config', '.eslintrc', '.prettierrc', 'jest.config',
      'babel.config', 'webpack.config', 'vite.config', 'next.config', 'nuxt.config',
      'tailwind.config', 'postcss.config', 'rollup.config', 'svelte.config',
      
      '.env', '.gitignore', '.npmignore', 'Dockerfile', 'docker-compose',
      'vercel.json', 'netlify.toml', '.github/', '.gitlab-ci.yml',
      
      '*.md', 'docs/', 'LICENSE'
    ];
    
    return configPatterns.some(pattern => 
      filePath.includes(pattern) || 
      path.basename(filePath).includes(pattern.replace('*', ''))
    );
  };

  const isTestFile = (filePath: string): boolean => {
    const testPatterns = [
      '.test.', '.spec.', '__tests__/', 'test/', 'tests/', 'spec/',
      '_test.py', '_spec.rb', '_test.go', 'Test.java', 'Tests.cs'
    ];
    
    return testPatterns.some(pattern => filePath.includes(pattern));
  };

  for (const [filePath, cacheEntry] of Object.entries(cache)) {
    if (!cacheEntry.analysis?.dependencies) continue;
    
    const deps = cacheEntry.analysis.dependencies;
    if (deps.internal_imports) {
      for (const imp of deps.internal_imports) {
        const resolvedPaths = resolveImportPathForLanguage(imp, filePath, primaryLanguage, languageConfig);
        resolvedPaths.forEach(resolved => importedFiles.add(resolved));
      }
    }
  }

  for (const [filePath, cacheEntry] of Object.entries(cache)) {
    if (!cacheEntry.analysis?.dependencies) continue;
    
    const deps = cacheEntry.analysis.dependencies;
    const hasExports = (deps.exported_functions?.length > 0) ||
                      (deps.exported_classes?.length > 0) ||
                      (deps.exported_variables?.length > 0);

    if (hasExports) {
      const isImported = isFileImported(filePath, importedFiles, languageConfig);

      if (!isImported && 
          !isEntryPoint(filePath) && 
          !isConfigurationFile(filePath) && 
          !isTestFile(filePath)) {
        
        orphanFiles.push(filePath);
      }
    }
  }

  return orphanFiles;
}

function resolveImportPathForLanguage(
  importPath: string, 
  fromFile: string, 
  language: string, 
  languageConfig: any
): string[] {
  const resolvedPaths: string[] = [];
  
  switch (language) {
    case 'typescript':
    case 'javascript':
      if (importPath.startsWith('../') || importPath.startsWith('./')) {
        const dir = path.dirname(fromFile);
        let absolutePath = path.normalize(path.join(dir, importPath)).replace(/\\/g, '/');
        
        if (absolutePath.endsWith('.js')) {
          absolutePath = absolutePath.replace('.js', '.ts');
        }
        
        resolvedPaths.push(absolutePath);
        
        const withoutExt = absolutePath.replace(/\.(js|ts|tsx|jsx)$/, '');
        languageConfig.extensions.forEach((ext: string) => {
          resolvedPaths.push(withoutExt + ext);
        });
      }
      break;
      
    case 'python':
      if (importPath.startsWith('.')) {
        const dir = path.dirname(fromFile);
        const modulePath = importPath.replace(/\./g, '/') + '.py';
        const absolutePath = path.normalize(path.join(dir, modulePath));
        resolvedPaths.push(absolutePath);
      } else {
        const packagePath = importPath.replace(/\./g, '/') + '.py';
        resolvedPaths.push(packagePath);
      }
      break;
      
    case 'java':
      const packagePath = importPath.replace(/\./g, '/') + '.java';
      resolvedPaths.push(packagePath);
      break;
      
    case 'csharp':
      const namespacePath = importPath.replace(/\./g, '/') + '.cs';
      resolvedPaths.push(namespacePath);
      break;
      
    case 'ruby':
      if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const dir = path.dirname(fromFile);
        const absolutePath = path.normalize(path.join(dir, importPath + '.rb'));
        resolvedPaths.push(absolutePath);
      } else {
        resolvedPaths.push(importPath + '.rb');
      }
      break;
      
    case 'rust':
      if (importPath.startsWith('crate::') || importPath.startsWith('super::') || importPath.startsWith('self::')) {
        const modulePath = importPath.replace(/::/g, '/').replace('crate/', 'src/') + '.rs';
        resolvedPaths.push(modulePath);
      }
      break;
      
    case 'php':
      if (importPath.includes('\\')) {
        const namespacePath = importPath.replace(/\\/g, '/') + '.php';
        resolvedPaths.push(namespacePath);
      } else {
        resolvedPaths.push(importPath);
      }
      break;
      
    case 'go':
      if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const dir = path.dirname(fromFile);
        const absolutePath = path.normalize(path.join(dir, importPath));
        resolvedPaths.push(absolutePath);
      }
      break;
  }
  
  return resolvedPaths;
}

function isFileImported(filePath: string, importedFiles: Set<string>, languageConfig: LanguageConfig): boolean {
  if (importedFiles.has(filePath)) return true;
  
  const withoutExt = filePath.replace(/\.\w+$/, '');
  if (importedFiles.has(withoutExt)) return true;
  
  for (const ext of languageConfig.extensions) {
    if (importedFiles.has(withoutExt + ext)) return true;
  }
  
  const basename = path.basename(filePath, path.extname(filePath));
  const dir = path.dirname(filePath);
  
  for (const imported of importedFiles) {
    const importedBasename = path.basename(imported, path.extname(imported));
    const importedDir = path.dirname(imported);
    
    if (importedBasename === basename && (
      importedDir === dir || 
      path.resolve(importedDir) === path.resolve(dir)
    )) {
      return true;
    }
  }
  
  return false;
}

async function buildEnhancedDependencyGraph(
  filesToProcess: FileAnalysisData[],
  deadCodeResult: DeadCodeResult
): Promise<DependencyNode[]> {
  const logger = getLogger();
  const nodes: DependencyNode[] = [];
  
  const usedFiles = filesToProcess.filter(
    (file) => !deadCodeResult.analysis.unused_files.includes(file.file)
  );

  const fileMap = new Map<string, FileAnalysisData>();
  usedFiles.forEach((file) => {
    fileMap.set(file.file, file);
    const normalized = path.normalize(file.file);
    fileMap.set(normalized, file);
  });

  logger.info(`Building enhanced dependency graph for ${usedFiles.length} files (excluding ${deadCodeResult.analysis.unused_files.length} unused files)`);

  for (const file of usedFiles) {
    const resolvedDependencies: string[] = [];
    const dependents: string[] = [];

    if (file.dependencies) {
      logger.debug(`Processing ${file.file}: ${file.dependencies.internal_imports.length} internal imports`);
      
      for (const internalImport of file.dependencies.internal_imports) {
        const resolvedPath = resolveImportPath(internalImport, file.file, fileMap);
        
        if (resolvedPath && fileMap.has(resolvedPath)) {
          resolvedDependencies.push(resolvedPath);
          logger.debug(`  ✓ Resolved: ${internalImport} -> ${resolvedPath}`);
        } else {
          logger.debug(`  ✗ Unresolved: ${internalImport}`);
        }
      }
    }

    for (const otherFile of usedFiles) {
      if (otherFile.file !== file.file && otherFile.dependencies) {
        for (const internalImport of otherFile.dependencies.internal_imports) {
          const resolvedPath = resolveImportPath(
            internalImport,
            otherFile.file,
            fileMap
          );
          if (resolvedPath === file.file) {
            dependents.push(otherFile.file);
          }
        }
      }
    }

    const deadExports = deadCodeResult.analysis.orphaned_exports
      .filter((export_) => export_.startsWith(file.file + ':'))
      .map((export_) => export_.split(':')[1]);

    nodes.push({
      file: file.file,
      dependencies: resolvedDependencies,
      dependents,
      exports: file.exported_symbols || [],
      imports: file.imported_symbols || [],
      dead_exports: deadExports,
    });
  }

  const nodesWithDeps = nodes.filter(n => n.dependencies.length > 0 || n.dependents.length > 0);
  logger.info(`Enhanced dependency graph: ${nodes.length} nodes, ${nodesWithDeps.length} with dependencies, ${nodes.reduce((sum, n) => sum + n.dead_exports.length, 0)} dead exports`);

  return nodes;
}
