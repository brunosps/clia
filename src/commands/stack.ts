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
  projectName: string;
  timestamp: string;
  userLanguage: string;
  stackData: string;
  analysisDepth: string;
}

interface StackResponse {
  summary: {
    primary_language: string;
    project_type: string;
    maturity_level: string;
    complexity_score: number;
  };
  recommendations: {
    modernization: Array<{
      category: string;
      current: string;
      recommended: string;
      priority: string;
      reason: string;
    }>;
    security: Array<{
      severity: string;
      issue: string;
      solution: string;
    }>;
  };
  confidence: number;
  metadata: {
    projectName: string;
    version: string;
    confidence: number;
  };
}

export function stackCommand(): Command {
  const cmd = new Command('stack');

  cmd
    .description(
      `
📊 Technology Stack Analysis v4.0.0

Intelligent system for technology stack detection and analysis
following conventional patterns with Standard Command Structure.

Features:
  • MCP stack-detector integration for real detection
  • AI-powered stack analysis and recommendations
  • Human-readable reports with actionable insights
  • Multi-format output (JSON, Markdown)
  • Standard Command Structure v4.0.0

Examples:
  clia stack                             # Basic stack detection
  clia stack --analyze                   # AI analysis with recommendations
  clia stack --analyze --deep            # Deep analysis with premium LLM`
    )
    .option('--analyze', '🤖 Perform AI-powered analysis of detected stack', false)
    .option('--deep', '🔍 Deep analysis with comprehensive recommendations (requires --analyze)', false)    
    .action(async (options: StackOptions) => {
      const logger = getLogger();
      try {
        await processStackOperation(options);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`❌ Stack analysis failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return cmd;
}

async function processStackOperation(options: StackOptions): Promise<void> {
  const config = await loadConfig();
  const logger = getLogger();

  logger.info('🔍 Starting technology stack analysis');

  const mcpClient = McpClient.fromConfig();
  let stackData;

  try {
    stackData = await mcpClient.detectStack();
    if (!stackData) {
      logger.warn('⚠️ MCP stack-detector not available or returned no data');
      stackData = createFallbackStackData();
    }
  } catch (error) {
    logger.warn('⚠️ MCP stack-detector failed, using fallback detection');
    stackData = createFallbackStackData();
  }

  displayStackInfo(stackData);

  let analysisResult;
  if (options.analyze) {
    logger.info('🤖 Performing AI-powered stack analysis...');
    analysisResult = await analyzeStack(config, stackData, options);
    
    if (analysisResult?.summary) {
      console.log(`\n📊 Analysis completed with ${(analysisResult.confidence * 100).toFixed(1)}% confidence`);
      console.log(`🎯 Project maturity: ${analysisResult.summary.maturity_level}`);
      if (analysisResult.summary.complexity_score !== undefined) {
        console.log(`⚡ Complexity score: ${analysisResult.summary.complexity_score}/10`);
      }
    }
  }

  await generateReports(stackData, analysisResult, config, logger);

  if (options.analyze) {
    logger.info('✅ Technology stack analysis completed with AI insights');
  } else {
    logger.info('✅ Basic stack detection completed');
    console.log('\n💡 Use --analyze for detailed AI-powered analysis');
    console.log('🔍 Use --analyze --deep for comprehensive analysis');
  }
}

function createFallbackStackData(): any {
  return { 
    primary: { name: 'Mixed Project', confidence: 50 },
    languages: [],
    frameworks: [],
    tools: []
  };
}

async function analyzeStack(config: Config, stackData: any, options: StackOptions): Promise<StackResponse> {
  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    timestamp: new Date().toISOString(),
    userLanguage: config.translateReports 
      ? config.language || 'en-us' 
      : 'en-us',
    stackData: JSON.stringify(stackData, null, 2),
    analysisDepth: options.deep ? 'comprehensive' : 'detailed'
  };

  const tier = options.deep ? 'premium' : 'default';

  const response = await execPrompt<PromptContext, StackResponse>(
    'stack/system',
    promptContext,
    '1.0.0',
    tier,
    7,
    3
  );

  return response;
}

function displayStackInfo(stackData: any): void {
  if (stackData.primary) {
    console.log(`\n🎯 Primary Stack: ${stackData.primary.name} (${stackData.primary.confidence?.toFixed(1) || 'N/A'}% confidence)`);
  }

  if (stackData.languages?.length > 0) {
    console.log('\n💻 Languages:');
    stackData.languages.forEach((lang: any) => {
      const confidence = lang.confidence?.toFixed(1) || 'N/A';
      console.log(`   📄 ${lang.name} ${lang.version ? `(${lang.version})` : ''} - ${confidence}%`);
    });
  }

  if (stackData.frameworks?.length > 0) {
    console.log('\n⚛️ Frameworks & Libraries:');
    stackData.frameworks.forEach((fw: any) => {
      const confidence = fw.confidence?.toFixed(1) || 'N/A';
      const version = fw.version ? `v${fw.version}` : 'unknown version';
      console.log(`   📦 ${fw.name} (${version}) - ${confidence}%`);
    });
  }

  if (stackData.tools?.length > 0) {
    console.log('\n🔧 Development Tools:');
    stackData.tools.forEach((tool: any) => {
      const confidence = tool.confidence?.toFixed(1) || 'N/A';
      console.log(`   ⚙️ ${tool.name} - ${confidence}%`);
    });
  }
}

async function generateReports(
  stackData: any, 
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

  const jsonReport = {
    timestamp,
    raw_stack_data: stackData,
    analysis_result: analysisResult,
    generated_by: 'CLIA v4.0.0',
    command: 'stack'
  };

  const jsonPath = path.join(cliaDir, 'stack-analysis.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));

  const markdownReport = generateMarkdownReport(stackData, analysisResult, timestamp);
  const markdownPath = path.join(reportsDir, `${timestamp}_stack.md`);
  fs.writeFileSync(markdownPath, markdownReport);

  logger.info(`📄 Reports saved: ${jsonPath} and ${markdownPath}`);
}

function generateMarkdownReport(
  stackData: any, 
  analysisResult: StackResponse | undefined, 
  timestamp: string
): string {
  const report = `# Technology Stack Analysis Report

**Generated**: ${new Date().toISOString()}
**Timestamp**: ${timestamp}
**Tool**: CLIA v4.0.0

## Stack Detection Results

### Primary Technology
${stackData?.primary ? `**${stackData.primary.name}** (${stackData.primary.confidence?.toFixed(1) || 'N/A'}% confidence)` : 'Not detected'}

### Languages Detected
${stackData?.languages?.map((lang: any) => 
  `- **${lang.name}** ${lang.version ? `(${lang.version})` : ''} - ${lang.confidence?.toFixed(1) || 'N/A'}% confidence`
).join('\n') || 'No languages detected'}

### Frameworks & Libraries
${stackData?.frameworks?.map((fw: any) => 
  `- **${fw.name}** ${fw.version ? `v${fw.version}` : ''} - ${fw.confidence?.toFixed(1) || 'N/A'}% confidence`
).join('\n') || 'No frameworks detected'}

### Development Tools
${stackData?.tools?.map((tool: any) => 
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
${analysisResult.recommendations.modernization.map((rec: any) => 
  `- **${rec.category}**: ${rec.current} → ${rec.recommended} (Priority: ${rec.priority})\n  *${rec.reason}*`
).join('\n\n')}` : ''}

${analysisResult.recommendations?.security?.length > 0 ? `### Security Recommendations
${analysisResult.recommendations.security.map((sec: any) => 
  `- **${sec.severity.toUpperCase()}**: ${sec.issue}\n  *Solution*: ${sec.solution}`
).join('\n\n')}` : ''}` : ''}

---
*Generated by CLIA Technology Stack Analyzer*
`;

  return report;
}