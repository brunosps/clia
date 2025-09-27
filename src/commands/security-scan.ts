import { Command } from 'commander';
import { loadConfig, Config } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { execPrompt } from '../shared/utils.js';
import { generateTimestamp } from '../shared/timestamp.js';
import { McpClient, SemgrepReport, TrivyReport } from '../mcp/client.js';
import {
  getOutputLanguage,
  shouldTranslateReports,
} from '../shared/translation.js';
import fs from 'fs';
import path from 'path';

interface SecurityScanOptions {
  target?: string;
  output?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  format?: 'json' | 'markdown';
  includeTests?: boolean;
  trivy?: boolean;
}

interface PromptContext {
  projectName: string;
  mcpContext: string;
  mcpSecurityData: string;
  ragContext: string;
  securityData: string;
  scanOptions: string;
  userLanguage: string;
}

interface SecurityResponse {
  security_report: string;
  security_score: number;
  vulnerabilities: Array<{
    title: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    file?: string;
    solution: string;
    confidence: number;
  }>;
  dependencies: {
    total_analyzed: number;
    vulnerable_packages: Array<{
      package: string;
      version: string;
      vulnerability: string;
      severity: 'critical' | 'high' | 'medium' | 'low';
    }>;
  };
  recommendations: string[];
  confidence: number;
  language: string;
}

export function securityScanCommand(): Command {
  const command = new Command('security-scan');

  command
    .description(
      `
🛡️ Security Analysis v1.0.0

Intelligent security vulnerability detection system with MCP integration
following Standard Command Structure v1.0.0.

Features:
  • Static code analysis for security vulnerabilities
  • MCP integration for Semgrep and Trivy scanners
  • Dependency vulnerability detection
  • AI-powered security recommendations
  • Multi-format reporting (JSON, Markdown)
  • Severity filtering and data optimization

Examples:
  clia security-scan                     # Basic security analysis
  clia security-scan --trivy             # Include dependency scan
  clia security-scan --format json       # JSON output
  clia security-scan -o report.md        # Custom output file`
    )
    .option(
      '-t, --target <path>',
      '📁 Target directory (default: current project)',
      '.'
    )
    .option('-o, --output <file>', '📄 Output file path')
    .option(
      '-s, --severity <level>',
      '⚠️ Minimum severity: low|medium|high|critical',
      'medium'
    )
    .option(
      '-f, --format <format>',
      '📋 Output format: json|markdown',
      'markdown'
    )
    .option('--include-tests', '🧪 Include test files in analysis', false)
    .option('--trivy', '📦 Enable Trivy scanner for dependencies', false)
    .action(async (options) => {
      const logger = getLogger();
      try {
        await processSecurityScanOperation(options);
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`❌ Security scan failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return command;
}

async function processSecurityScanOperation(
  options: SecurityScanOptions
): Promise<void> {
  const config = await loadConfig();
  const logger = getLogger();

  logger.info(
    '🛡️ Starting security analysis with Standard Command Structure v1.0.0'
  );

  const [mcpContext, securityContext] = await Promise.all([
    collectMCPSecurityData(options),
    collectSecurityRelevantData(),
  ]);

  const semgrepFindings = mcpContext.semgrep?.findings?.length || 0;
  const trivyVulns = mcpContext.trivy?.vulnerabilities?.length || 0;
  const trivyMisconfigs = mcpContext.trivy?.misconfigurations?.length || 0;

  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    userLanguage: shouldTranslateReports(config)
      ? getOutputLanguage(config) || 'en-US'
      : 'en-US',
    mcpContext: JSON.stringify({
      available: mcpContext.available,
      summary: {
        semgrep_findings: semgrepFindings,
        trivy_vulnerabilities: trivyVulns,
        trivy_misconfigurations: trivyMisconfigs,
        severity_filter: options.severity || 'medium',
      },
    }),
    mcpSecurityData: JSON.stringify(mcpContext, null, 2),
    ragContext: `Project Analysis Context:
- Architecture: ${securityContext.architecture.type || 'Unknown'}
- Known Security Issues: ${securityContext.securityIssues.length} identified
- Config Files: ${securityContext.configFiles.length} security-relevant files
- Vulnerable Dependencies: ${securityContext.vulnerableDependencies.length} found`,
    securityData: JSON.stringify(
      {
        configFiles: securityContext.configFiles,
        securityIssues: securityContext.securityIssues,
        vulnerableDependencies: securityContext.vulnerableDependencies,
        architecture: securityContext.architecture,
      },
      null,
      2
    ),
    scanOptions: JSON.stringify(options),
  };

  logger.info(
    `🎯 Processing ${semgrepFindings + trivyVulns + trivyMisconfigs} total security findings`
  );

  const result = await execPrompt<PromptContext, SecurityResponse>(
    'security-scan/system',
    promptContext,
    '1.0.0',
    'default',
    0.5,
    3
  );

  await saveResults(result, config, options, logger);

  logger.info('✅ Security analysis completed successfully');
}

async function collectSecurityRelevantData(): Promise<{
  configFiles: any[];
  securityIssues: string[];
  vulnerableDependencies: any[];
  architecture: any;
}> {
  const logger = getLogger();
  const securityData = {
    configFiles: [] as any[],
    securityIssues: [] as string[],
    vulnerableDependencies: [] as any[],
    architecture: {},
  };

  try {
    const inspectionPath = path.join(
      process.cwd(),
      '.clia',
      'project-inspection.json'
    );
    if (fs.existsSync(inspectionPath)) {
      const inspection = JSON.parse(fs.readFileSync(inspectionPath, 'utf-8'));

      securityData.configFiles = [
        ...(inspection.structure?.configFiles || []),
        ...(inspection.ragOptimization?.priorityFiles || []),
      ].filter(
        (file) =>
          file.includes('config') ||
          file.includes('.env') ||
          file.includes('docker')
      );

      securityData.architecture = inspection.architecture || {};

      if (inspection.dependencies?.vulnerable?.length > 0) {
        securityData.vulnerableDependencies =
          inspection.dependencies.vulnerable;
      }

      if (inspection.recommendations?.security?.length > 0) {
        securityData.securityIssues = inspection.recommendations.security;
      }
    }

    const stackPath = path.join(process.cwd(), '.clia', 'stack-analysis.json');
    if (fs.existsSync(stackPath)) {
      const stack = JSON.parse(fs.readFileSync(stackPath, 'utf-8'));

      if (
        stack.analysis_result?.dependencies?.critical_vulnerabilities?.length >
        0
      ) {
        securityData.vulnerableDependencies.push(
          ...stack.analysis_result.dependencies.critical_vulnerabilities
        );
      }

      if (stack.analysis_result?.recommendations?.security?.length > 0) {
        securityData.securityIssues.push(
          ...stack.analysis_result.recommendations.security.map((rec: any) =>
            typeof rec === 'string'
              ? rec
              : rec.solution || rec.issue || JSON.stringify(rec)
          )
        );
      }
    }

    logger.info(
      `🔍 Security context: ${securityData.configFiles.length} config files, ${securityData.securityIssues.length} known issues`
    );
  } catch (error) {
    logger.warn(
      '⚠️ Could not load security context from analysis files:',
      error
    );
  }

  return securityData;
}

async function collectMCPSecurityData(
  options: SecurityScanOptions
): Promise<any> {
  const logger = getLogger();
  const mcpClient = McpClient.fromConfig();

  const mcpData = {
    semgrep: null as SemgrepReport | null,
    trivy: null as TrivyReport | null,
    available: {
      semgrep: false,
      trivy: false,
    },
  };

  try {
    logger.info('🔍 Executing Semgrep scan via MCP...');
    const semgrepResult = await mcpClient.semgrepScan(options.target || '.');

    if (semgrepResult?.findings) {
      const minSeverity = options.severity || 'medium';
      
      // Map user severity to Semgrep severity levels
      const severityMapping = {
        'low': ['INFO', 'WARNING', 'ERROR'],
        'medium': ['WARNING', 'ERROR'],
        'high': ['ERROR'],
        'critical': ['ERROR'] // Semgrep doesn't have CRITICAL, treat as ERROR
      };
      
      const allowedSeverities = severityMapping[minSeverity as keyof typeof severityMapping] || ['WARNING', 'ERROR'];
      
      const filteredFindings = semgrepResult.findings
        .filter(f => allowedSeverities.includes(f.severity))
        .slice(0, 50); // Limit to 50 most relevant findings
      
      mcpData.semgrep = {
        ...semgrepResult,
        findings: filteredFindings,
      };
      mcpData.available.semgrep = true;
      
      const totalFindings = semgrepResult.findings.length;
      logger.info(
        `✅ Semgrep: ${filteredFindings.length}/${totalFindings} findings found (${minSeverity}+ severity)`
      );
    }
  } catch (error) {
    logger.warn(
      '⚠️ Semgrep MCP not available, continuing with static analysis:',
      error
    );
  }

  if (options.trivy) {
    try {
      logger.info('🔍 Executing Trivy scan via MCP...');
      const trivyResult = await mcpClient.trivyScan(options.target || '.');

      if (trivyResult) {
        // Trivy executou com sucesso, mesmo se não encontrou vulnerabilidades
        mcpData.trivy = trivyResult;
        mcpData.available.trivy = true;

        const vulnsCount = trivyResult.vulnerabilities?.length || 0;
        const misconfigsCount = trivyResult.misconfigurations?.length || 0;
        
        if (vulnsCount > 0 || misconfigsCount > 0) {
          logger.info(
            `✅ Trivy: ${vulnsCount} vulnerabilities, ${misconfigsCount} misconfigurations found`
          );
        } else {
          logger.info('✅ Trivy: No vulnerabilities or misconfigurations found (clean project)');
        }
      }
    } catch (error) {
      logger.warn(
        '⚠️ Trivy MCP not available, analysis will focus on static code:',
        error
      );
    }
  }

  return mcpData;
}

async function saveResults(
  result: SecurityResponse,
  config: Config,
  options: SecurityScanOptions,
  logger: ReturnType<typeof getLogger>
): Promise<void> {
  const cliaDir = path.join(process.cwd(), '.clia');
  if (!fs.existsSync(cliaDir)) {
    fs.mkdirSync(cliaDir, { recursive: true });
  }

  const reportsDir = path.join(
    process.cwd(),
    config.reports?.outputDir || '.clia/reports'
  );
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = generateTimestamp();

  if (options.output) {
    const outputContent =
      options.format === 'json'
        ? JSON.stringify(result, null, 2)
        : generateMarkdownReport(result);

    fs.writeFileSync(options.output, outputContent, 'utf-8');
    logger.info(`📄 Security report saved: ${options.output}`);
  } else {
    // Always save JSON in .clia for integration (no timestamp)
    const integrationJsonFile = path.join(cliaDir, 'security-scan.json');
    fs.writeFileSync(
      integrationJsonFile,
      JSON.stringify(result, null, 2),
      'utf-8'
    );

    // Save timestamped markdown report in configured reports directory
    const mdFile = path.join(reportsDir, `${timestamp}_security-scan.md`);
    fs.writeFileSync(mdFile, generateMarkdownReport(result), 'utf-8');

    logger.info(`📄 Reports saved: ${integrationJsonFile}, ${mdFile}`);
  }

  displaySecuritySummary(result);
}

function generateMarkdownReport(result: SecurityResponse): string {
  const timestamp = new Date().toLocaleString();

  return `# Security Analysis Report

**Generated:** ${timestamp}  
**Security Score:** ${result.security_score}/10  
**Confidence:** ${(result.confidence * 100).toFixed(1)}%

## Summary
${result.security_report}

## Vulnerabilities (${result.vulnerabilities.length})

${result.vulnerabilities
  .map(
    (vuln, i) => `
### ${i + 1}. ${vuln.title} (${vuln.severity.toUpperCase()})

**File:** ${vuln.file || 'N/A'}  
**Confidence:** ${(vuln.confidence * 100).toFixed(1)}%

**Description:** ${vuln.description}

**Solution:** ${vuln.solution}

---
`
  )
  .join('')}

## Dependencies (${result.dependencies.total_analyzed} analyzed)

${
  result.dependencies.vulnerable_packages.length > 0
    ? result.dependencies.vulnerable_packages
        .map(
          (dep, i) => `
### ${i + 1}. ${dep.package}@${dep.version} (${dep.severity.toUpperCase()})
**Vulnerability:** ${dep.vulnerability}
`
        )
        .join('')
    : 'No vulnerable dependencies found.'
}

## Recommendations

${result.recommendations.map((rec, i) => `${i + 1}. ${rec}`).join('\n')}

---
*Generated by CLIA Security Scanner v1.0.0*
`;
}

function displaySecuritySummary(result: SecurityResponse): void {
  const logger = getLogger();

  console.log('\n🛡️ Security Analysis Summary');
  console.log('='.repeat(50));

  const scoreEmoji =
    result.security_score >= 8
      ? '🟢'
      : result.security_score >= 6
        ? '🟡'
        : '🔴';

  console.log(`📊 Security Score: ${scoreEmoji} ${result.security_score}/10`);
  console.log(`🔍 Total Findings: ${result.vulnerabilities.length}`);
  console.log(`📈 Confidence: ${(result.confidence * 100).toFixed(1)}%`);

  if (result.vulnerabilities.length > 0) {
    const severityCounts = result.vulnerabilities.reduce(
      (acc, vuln) => {
        acc[vuln.severity] = (acc[vuln.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log('\n🚨 Vulnerabilities by Severity:');
    Object.entries(severityCounts).forEach(([severity, count]) => {
      const emoji =
        severity === 'critical'
          ? '🔴'
          : severity === 'high'
            ? '🟠'
            : severity === 'medium'
              ? '🟡'
              : '🟢';
      console.log(`   ${emoji} ${severity}: ${count}`);
    });
  }

  console.log('\n💡 Next Steps:');
  console.log('   🔍 Review identified vulnerabilities');
  console.log('   🛠️  Implement security recommendations');
  console.log('   🔄 Re-run scan after fixes');
}
