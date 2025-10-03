import { Command } from 'commander';
import { loadConfig, Config } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { execPrompt } from '../shared/utils.js';
import { generateTimestamp } from '../shared/timestamp.js';
import fs from 'fs';
import path from 'path';
import { McpClient } from '../mcp/client.js';

interface StackOptions {
  analyze?: boolean;
  deep?: boolean;
}

interface PromptContext {
  [key: string]: unknown;
  projectName: string;
  timestamp: string;
  userLanguage: string;
  stackData: string;
  analysisDepth: string;
}

interface ModernizationRecommendation {
  category: string;
  current: string;
  recommended: string;
  priority: string;
  reason: string;
}

interface SecurityRecommendation {
  severity: string;
  issue: string;
  solution: string;
}

interface StackSummary {
  primary_language: string;
  project_type: string;
  maturity_level: string;
  complexity_score: number;
}

interface StackRecommendations {
  modernization: ModernizationRecommendation[];
  security: SecurityRecommendation[];
}

interface StackMetadata {
  projectName: string;
  version: string;
  confidence: number;
}

interface StackResponse {
  summary: StackSummary;
  recommendations: StackRecommendations;
  confidence: number;
  metadata: StackMetadata;
}

interface PrimaryStack {
  name: string;
  confidence: number;
}

interface LanguageInfo {
  name: string;
  version?: string;
  confidence: number;
}

interface FrameworkInfo {
  name: string;
  version?: string;
  confidence: number;
}

interface ToolInfo {
  name: string;
  confidence: number;
}

interface StackData {
  primary: PrimaryStack;
  languages: LanguageInfo[];
  frameworks: FrameworkInfo[];
  tools: ToolInfo[];
}

interface JsonReport {
  timestamp: string;
  raw_stack_data: StackData;
  analysis_result?: StackResponse;
  generated_by: string;
  command: string;
}

export function stackCommand(): Command {
  const cmd = new Command('stack');

  cmd
    .description('Technology stack detection and AI-powered analysis v1.0.0')  
    .action(async () => {
      const logger = getLogger();
      try {
        await processStackOperation({
          analyze: true,
          deep: true,
        });
        process.exit(0);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`❌ Stack analysis failed: ${errorMessage}`);
        console.log(`❌ Stack analysis failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return cmd;
}

async function processStackOperation(options: StackOptions): Promise<void> {
  const config = await loadConfig();
  const logger = getLogger();

  logger.info('Starting technology stack analysis');

  const mcpClient = McpClient.fromConfig();
  let stackData: StackData;

  try {
    const stackInfo = await mcpClient.detectStack();
    stackData = stackInfo as unknown as StackData;
    if (!stackData) {
      logger.warn('MCP stack-detector not available or returned no data');
      stackData = createFallbackStackData();
    }
  } catch (error) {
    logger.warn('MCP stack-detector failed, using fallback detection');
    stackData = createFallbackStackData();
  }

  displayStackInfo(stackData);

  let analysisResult: StackResponse | undefined;
  if (options.analyze) {
    logger.info('Performing AI-powered stack analysis');
    analysisResult = await analyzeStack(config, stackData, options);
    
    if (analysisResult?.summary) {
      console.log(`\nAnalysis completed with ${(analysisResult.confidence * 100).toFixed(1)}% confidence`);
      console.log(`Project maturity: ${analysisResult.summary.maturity_level}`);
      if (analysisResult.summary.complexity_score !== undefined) {
        console.log(`Complexity score: ${analysisResult.summary.complexity_score}/10`);
      }
    }
  }

  await generateReports(stackData, analysisResult, config, logger);

  if (options.analyze) {
    logger.info('Technology stack analysis completed with AI insights');
  } else {
    logger.info('Basic stack detection completed');
    console.log('\nUse --analyze for detailed AI-powered analysis');
    console.log('Use --analyze --deep for comprehensive analysis');
  }
}

function createFallbackStackData(): StackData {
  return { 
    primary: { name: 'Mixed Project', confidence: 50 },
    languages: [],
    frameworks: [],
    tools: []
  };
}

async function analyzeStack(config: Config, stackData: StackData, options: StackOptions): Promise<StackResponse> {
  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    timestamp: generateTimestamp(),
    userLanguage: config.translateReports 
      ? config.language || 'en-us' 
      : 'en-us',
    stackData: JSON.stringify(stackData, null, 2),
    analysisDepth: options.deep ? 'comprehensive' : 'detailed'
  };

  const tier = 'default';

  const response = await execPrompt<PromptContext, StackResponse>(
    'stack',
    promptContext,
    '1.0.0',
    tier,
    0.3
  );

  return response;
}

function displayStackInfo(stackData: StackData): void {
  const primary = stackData.primary;
  if (primary) {
    const confidence = primary.confidence;
    console.log(`\nPrimary Stack: ${primary.name} (${confidence?.toFixed(1) || 'N/A'}% confidence)`);
  }

  const languages = stackData.languages;
  if (languages?.length > 0) {
    console.log('\nLanguages:');
    languages.forEach((lang: LanguageInfo) => {
      const confidence = lang.confidence?.toFixed(1) || 'N/A';
      console.log(`   ${lang.name} ${lang.version ? `(${lang.version})` : ''} - ${confidence}%`);
    });
  }

  const frameworks = stackData.frameworks;
  if (frameworks?.length > 0) {
    console.log('\nFrameworks & Libraries:');
    frameworks.forEach((fw: FrameworkInfo) => {
      const confidence = fw.confidence?.toFixed(1) || 'N/A';
      const version = fw.version ? `v${fw.version}` : 'unknown version';
      console.log(`   ${fw.name} (${version}) - ${confidence}%`);
    });
  }

  const tools = stackData.tools;
  if (tools?.length > 0) {
    console.log('\nDevelopment Tools:');
    tools.forEach((tool: ToolInfo) => {
      const confidence = tool.confidence?.toFixed(1) || 'N/A';
      console.log(`   ${tool.name} - ${confidence}%`);
    });
  }
}

async function generateReports(
  stackData: StackData, 
  analysisResult: StackResponse | undefined, 
  config: Config, 
  logger: ReturnType<typeof getLogger>
): Promise<void> {
  const cliaDir = path.join(process.cwd(), '.clia');
  const reportsDir = path.join(
    process.cwd(),
    config.reports?.outputDir || '.clia/reports'
  );

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = generateTimestamp();

  const jsonReport: JsonReport = {
    timestamp,
    raw_stack_data: stackData,
    analysis_result: analysisResult,
    generated_by: 'CLIA v1.0.0',
    command: 'stack'
  };

  const jsonPath = path.join(cliaDir, 'stack-analysis.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));

  const markdownReport = generateMarkdownReport(stackData, analysisResult, timestamp);
  const markdownPath = path.join(reportsDir, `${timestamp}_stack.md`);
  fs.writeFileSync(markdownPath, markdownReport);

  logger.info(`Reports saved: ${jsonPath} and ${markdownPath}`);
}

function generateMarkdownReport(
  stackData: StackData, 
  analysisResult: StackResponse | undefined, 
  timestamp: string
): string {
  const primary = stackData?.primary;
  const languages = stackData?.languages;
  const frameworks = stackData?.frameworks;
  const tools = stackData?.tools;
  
  const report = `# Technology Stack Analysis Report

**Generated**: ${new Date().toISOString()}
**Timestamp**: ${timestamp}
**Tool**: CLIA v1.0.0

## Stack Detection Results

### Primary Technology
${primary ? `**${primary.name}** (${primary.confidence?.toFixed(1) || 'N/A'}% confidence)` : 'Not detected'}

### Languages Detected
${languages?.map((lang: LanguageInfo) => 
  `- **${lang.name}** ${lang.version ? `(${lang.version})` : ''} - ${lang.confidence?.toFixed(1) || 'N/A'}% confidence`
).join('\n') || 'No languages detected'}

### Frameworks & Libraries
${frameworks?.map((fw: FrameworkInfo) => 
  `- **${fw.name}** ${fw.version ? `v${fw.version}` : ''} - ${fw.confidence?.toFixed(1) || 'N/A'}% confidence`
).join('\n') || 'No frameworks detected'}

### Development Tools
${tools?.map((tool: ToolInfo) => 
  `- **${tool.name}** - ${tool.confidence?.toFixed(1) || 'N/A'}% confidence`
).join('\n') || 'No tools detected'}

${analysisResult ? `## AI Analysis Results

### Summary
- **Primary Language**: ${analysisResult.summary?.primary_language || 'Unknown'}
- **Project Type**: ${analysisResult.summary?.project_type || 'Mixed'}
- **Maturity Level**: ${analysisResult.summary?.maturity_level || 'Stable'}
- **Complexity Score**: ${analysisResult.summary?.complexity_score || 'N/A'}/10
- **Analysis Confidence**: ${(analysisResult.confidence * 100 || 50).toFixed(1)}%

${analysisResult.recommendations?.modernization?.length > 0 ? `### Modernization Recommendations
${analysisResult.recommendations.modernization.map((rec) => 
  `- **${rec.category}**: ${rec.current} → ${rec.recommended} (Priority: ${rec.priority})\n  *${rec.reason}*`
).join('\n\n')}` : ''}

${analysisResult.recommendations?.security?.length > 0 ? `### Security Recommendations
${analysisResult.recommendations.security.map((sec) => 
  `- **${sec.severity.toUpperCase()}**: ${sec.issue}\n  *Solution*: ${sec.solution}`
).join('\n\n')}` : ''}` : ''}

---
*Generated by CLIA Technology Stack Analyzer*
`;

  return report;
}