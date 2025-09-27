import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { loadConfig, Config } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { generateTimestamp } from '../shared/timestamp.js';
import { glob } from 'glob';
import { McpClient } from '../mcp/client.js';
import { execPrompt } from '../shared/utils.js';
import { mergeExcludes } from '../rag/indexer.js';
import mm from 'micromatch';
import { z } from 'zod';

interface InspectOptions {
  output?: string;
  includeTests?: boolean;
  depth?: 'basic' | 'detailed' | 'comprehensive';
  format?: 'human' | 'json';
}

interface PromptContext {
  projectName: string;
  timestamp: string;
  userLanguage: string;
  projectStructure: string;
  stackData: string;
  analysisDepth: string;
}

interface InspectResponse {
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
    documentationFiles: {
      discoveredPaths: string[];
      recommendedPaths: string[];
      chunkingStrategy: string;
      recommendedChunkSize: number;
      recommendedChunkOverlap: number;
    };
    chunkingStrategy: string;
    recommendedIndexingConfig: {
      chunkSize: number;
      chunkOverlap: number;
    };
    estimatedIndexSize: string;
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

const SENSITIVE_PATTERNS = [
  // Environment and secrets
  '.env*',
  '*.env',
  '.environment',
  '*.environment',

  // Security files
  '*.pem',
  '*.key',
  '*.crt',
  '*.p12',
  '*.pfx',
  '*.jks',
  'keystore*',
  'id_rsa*',
  'id_dsa*',
  'id_ecdsa*',
  'id_ed25519*',

  // Configuration with secrets
  'secrets.*',
  'credentials.*',
  'auth.*',
  'tokens.*',
  'config/*.prod.*',
  'config/production.*',
  'docker-compose*.prod.yml',
  'docker-compose.production.yml',

  // Build and cache directories that might contain sensitive data
  '**/coverage/**',
  '**/.pytest_cache/**',
  '**/.gradle/**',
  '**/logs/**',
  '**/log/**',
  '**/*.log',

  // Backup files
  '*.bak',
  '*.backup',
  '*.old',
  '*.orig',

  // Database files
  '*.db',
  '*.sqlite',
  '*.sqlite3',
  'database.yml',

  // Cloud provider configs
  '.aws/credentials',
  '.azure/**',
  '.gcloud/**',

  // IDE temp files that might contain sensitive info
  '*.swp',
  '*.swo',
  '*~',
  '.vscode/settings.json',
];

const CONFIG_PATTERNS = [
  // JS/TS
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'tsconfig*.json',
  '.eslintrc*',
  '.prettierrc*',
  'webpack*.{js,ts,cjs,mjs}',
  'vite.config.{js,ts}',
  'rollup.config.{js,ts}',
  'next.config.{js,ts}',
  'nuxt.config.{js,ts}',
  'svelte.config.{js,ts}',
  // Python
  'pyproject.toml',
  'requirements*.txt',
  'Pipfile*',
  'setup.{py,cfg}',
  'tox.ini',
  'pytest.ini',
  // Java
  'pom.xml',
  'build.gradle*',
  'settings.gradle*',
  // .NET
  '*.csproj',
  '*.sln',
  '*.vbproj',
  '*.fsproj',
  'Directory.*.props',
  // Ruby
  'Gemfile*',
  'Rakefile',
  // Go
  'go.{mod,sum,work}',
  // Rust
  'Cargo.{toml,lock}',
  // PHP
  'composer.{json,lock}',
  'phpunit.xml',
  'artisan',
  // General
  '.env*',
  'docker-compose*.yml',
  'Dockerfile*',
  'Makefile',
  'CMakeLists.txt',
  '.gitignore',
];

const DOCUMENTATION_PATTERNS = [
  // Main documentation files
  'README*',
  'readme*',
  'README.md',
  'README.rst',
  'README.txt',
  'CHANGELOG*',
  'changelog*',
  'CHANGELOG.md',
  'HISTORY.md',
  'RELEASES.md',
  'NEWS.md',

  // License and legal
  'LICENSE*',
  'LICENCE*',
  'COPYING*',
  'COPYRIGHT*',
  'NOTICE*',
  'AUTHORS*',
  'CONTRIBUTORS*',

  // Project documentation
  'CONTRIBUTING*',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT*',
  'SECURITY*',
  'SUPPORT*',
  'GOVERNANCE*',

  // API and technical docs
  'API.md',
  'api.md',
  'INSTALL*',
  'INSTALLATION*',
  'SETUP*',
  'USAGE*',
  'QUICKSTART*',
  'GETTING_STARTED*',
  'TUTORIAL*',
  'GUIDE*',
  'MIGRATION*',
  'UPGRADE*',
  'FAQ*',
  'TROUBLESHOOTING*',

  // Directory patterns for documentation
  'docs/**/*.md',
  'doc/**/*.md',
  'documentation/**/*.md',
  'wiki/**/*.md',
  'guides/**/*.md',
  'tutorials/**/*.md',
  'examples/**/*.md',
  'samples/**/*.md',
  'manual/**/*.md',

  // Alternative formats
  'docs/**/*.rst',
  'docs/**/*.txt',
  'docs/**/*.adoc',
  'docs/**/*.asciidoc',
  'docs/**/*.org',

  // Markdown files in common locations
  '*.md',
  'src/**/*.md',
  'lib/**/*.md',
  '.github/**/*.md',
  '.gitlab/**/*.md',

  // Code documentation
  'ARCHITECTURE*',
  'DESIGN*',
  'SPECIFICATION*',
  'TECHNICAL*',
  'DEVELOPMENT*',
  'CODING_STANDARDS*',
  'STYLE_GUIDE*',
];

// Zod schema for response validation
const InspectSchema = z
  .object({
    metadata: z.object({
      projectName: z.string(),
      version: z.string(),
      confidence: z.number(),
    }),
    summary: z.object({
      primaryLanguage: z.string(),
      projectType: z.string(),
      complexity: z.enum(['low', 'medium', 'high', 'very_high']),
      maturityLevel: z.enum([
        'experimental',
        'development',
        'stable',
        'mature',
      ]),
      ragReadiness: z.enum(['poor', 'fair', 'good', 'excellent']),
      totalFiles: z.number(),
    }),
    ragOptimization: z.object({
      directoryStructure: z.object({
        includePaths: z.array(z.string()),
        excludePaths: z.array(z.string()),
      }),
      documentationFiles: z.object({
        discoveredPaths: z.array(z.string()),
        recommendedPaths: z.array(z.string()),
        chunkingStrategy: z.string(),
        recommendedChunkSize: z.number(),
        recommendedChunkOverlap: z.number(),
      }),
      recommendedIndexingConfig: z.object({
        chunkSize: z.number(),
        chunkOverlap: z.number(),
      }),
      chunkingStrategy: z.string(),
    }),
  })
  .passthrough();

function assertInspectResponse(obj: unknown): InspectResponse {
  const res = InspectSchema.safeParse(obj);
  if (!res.success) {
    throw new Error(`Invalid inspect response JSON: ${res.error.message}`);
  }
  return obj as InspectResponse;
}

function parsePackageJsonVersions(packagePath: string) {
  try {
    const content = fs.readFileSync(packagePath, 'utf-8');
    const pkg = JSON.parse(content);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const pick = (name: string) => deps?.[name] || null;

    return {
      react: pick('react'),
      next: pick('next'),
      vue: pick('vue'),
      angular: pick('@angular/core'),
      svelte: pick('svelte'),
      vite: pick('vite'),
      webpack: pick('webpack'),
      jest: pick('jest'),
      vitest: pick('vitest'),
      eslint: pick('eslint'),
      prettier: pick('prettier'),
      typescript: pick('typescript'),
      express: pick('express'),
      fastify: pick('fastify'),
      nest: pick('@nestjs/core'),
    };
  } catch {
    return {};
  }
}

function parsePythonVersions(projectPath: string) {
  const versions: Record<string, string> = {};

  const pyprojectPath = path.join(projectPath, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      const djangoMatch = content.match(/django[^"]*"([^"]+)"/i);
      if (djangoMatch) versions.django = djangoMatch[1];

      const fastapiMatch = content.match(/fastapi[^"]*"([^"]+)"/i);
      if (fastapiMatch) versions.fastapi = fastapiMatch[1];

      const flaskMatch = content.match(/flask[^"]*"([^"]+)"/i);
      if (flaskMatch) versions.flask = flaskMatch[1];
    } catch {}
  }

  const reqPath = path.join(projectPath, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(
          /^(django|fastapi|flask|pandas|numpy)==([^#\s]+)/i
        );
        if (match && !versions[match[1].toLowerCase()]) {
          versions[match[1].toLowerCase()] = match[2];
        }
      }
    } catch {}
  }

  return versions;
}

function parseJavaVersions(projectPath: string) {
  const versions: Record<string, string> = {};

  const pomPath = path.join(projectPath, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    try {
      const content = fs.readFileSync(pomPath, 'utf-8');
      const springBootMatch = content.match(/<spring-boot\.version>([^<]+)</i);
      if (springBootMatch) versions.springboot = springBootMatch[1];
    } catch {}
  }

  const gradlePath = path.join(projectPath, 'build.gradle');
  if (fs.existsSync(gradlePath)) {
    try {
      const content = fs.readFileSync(gradlePath, 'utf-8');
      const springBootMatch = content.match(
        /org\.springframework\.boot[^']*'([^']+)'/i
      );
      if (springBootMatch) versions.springboot = springBootMatch[1];
    } catch {}
  }

  return versions;
}

function parseGoVersions(projectPath: string) {
  const goModPath = path.join(projectPath, 'go.mod');
  if (!fs.existsSync(goModPath)) return {};

  try {
    const content = fs.readFileSync(goModPath, 'utf-8');
    const versions: Record<string, string> = {};

    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(
        /^\s*(github\.com\/gin-gonic\/gin|github\.com\/gorilla\/mux|github\.com\/labstack\/echo)\s+v([^\s]+)/
      );
      if (match) {
        const pkg = match[1].split('/').pop() || match[1];
        versions[pkg] = match[2];
      }
    }

    return versions;
  } catch {
    return {};
  }
}

function parseRustVersions(projectPath: string) {
  const cargoPath = path.join(projectPath, 'Cargo.toml');
  if (!fs.existsSync(cargoPath)) return {};

  try {
    const content = fs.readFileSync(cargoPath, 'utf-8');
    const versions: Record<string, string> = {};

    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(
        /^(actix-web|rocket|warp|axum|tokio|serde)\s*=\s*"([^"]+)"/
      );
      if (match) {
        versions[match[1]] = match[2];
      }
    }

    return versions;
  } catch {
    return {};
  }
}

/**
 * Gera configuração RAG dinâmica baseada em dados reais do projeto
 * Segue o princípio: "100% real data via MCP integration - Zero simulations"
 */
function generateRealRagConfig(structure: any, config?: any) {
  // 1. DADOS REAIS: Detectar diretórios de inclusão baseados na estrutura real
  const realIncludePaths = detectRealIncludePaths(structure);

  // 2. DADOS REAIS: Usar sistema mergeExcludes para exclusões dinâmicas
  const realExcludes = mergeExcludes(config || {}, null);

  // 3. DADOS REAIS: Arquivos de documentação descobertos dinamicamente
  const documentationFiles = structure?.documentationFiles || [];
  const discoveredDocPaths = documentationFiles.slice(0, 30); // Aumentado de 20 para 30

  // 4. DADOS REAIS: Caminhos recomendados baseados nos descobertos
  const recommendedDocPaths = generateRecommendedDocPaths(documentationFiles);

  // 5. DADOS REAIS: Configuração de chunking baseada no tamanho real do projeto
  const chunkingConfig = calculateRealChunkingConfig(structure);

  // 6. DADOS REAIS: Arquivos prioritários descobertos dinamicamente
  const priorityFiles = detectRealPriorityFiles(documentationFiles, structure);

  // 7. DADOS REAIS: Estimativa de tamanho baseada no projeto real
  const estimatedSize = calculateRealIndexSize(structure);

  return {
    directoryStructure: {
      includePaths: realIncludePaths,
      excludePaths: realExcludes,
    },
    documentationFiles: {
      discoveredPaths: discoveredDocPaths,
      recommendedPaths: recommendedDocPaths,
      chunkingStrategy: 'semantic-markdown',
      recommendedChunkSize: chunkingConfig.docChunkSize,
      recommendedChunkOverlap: chunkingConfig.docChunkOverlap,
    },
    filePatterns: { exclude: realExcludes },
    recommendedIndexingConfig: {
      chunkSize: chunkingConfig.codeChunkSize,
      chunkOverlap: chunkingConfig.codeChunkOverlap,
    },
    chunkingStrategy: 'semantic+sliding-window',
    priorityFiles,
    estimatedIndexSize: estimatedSize,
  };
}

/**
 * Detecta caminhos de inclusão reais baseados na estrutura do projeto
 */
function detectRealIncludePaths(structure: any): string[] {
  const directories = structure?.directories || [];
  const commonSourceDirs = [
    'src',
    'lib',
    'app',
    'pages',
    'components',
    'utils',
    'services',
  ];
  const commonDocDirs = ['docs', 'documentation', 'guides', 'wiki'];
  const commonScriptDirs = ['scripts', 'tools', 'bin'];

  const realPaths: string[] = [];

  // Detectar diretórios de código fonte reais
  for (const dir of directories) {
    const dirName = dir.split('/')[0]; // Pegar apenas o primeiro nível
    if (
      commonSourceDirs.includes(dirName) ||
      commonDocDirs.includes(dirName) ||
      commonScriptDirs.includes(dirName)
    ) {
      if (!realPaths.includes(dirName)) {
        realPaths.push(dirName);
      }
    }
  }

  // Fallback: se não encontrou nenhum, usar estrutura descoberta
  if (realPaths.length === 0) {
    const topLevelDirs = directories
      .map((d: string) => d.split('/')[0])
      .filter((d: string) => !d.startsWith('.') && d !== 'node_modules')
      .slice(0, 5); // Máximo 5 diretórios
    realPaths.push(...(Array.from(new Set(topLevelDirs)) as string[]));
  }

  return realPaths.length > 0 ? realPaths : ['.'];
}

/**
 * Gera caminhos recomendados baseados na documentação descoberta
 */
function generateRecommendedDocPaths(documentationFiles: string[]): string[] {
  const discoveredPaths = new Set<string>();

  // Adicionar caminhos baseados nos arquivos descobertos
  for (const file of documentationFiles) {
    const dir = path.dirname(file);
    if (dir !== '.') {
      discoveredPaths.add(`${dir}/**/*.md`);
    }
    if (file.toLowerCase().includes('readme')) {
      discoveredPaths.add(file);
    }
  }

  // Adicionar padrões comuns apenas se encontrados na estrutura real
  const commonPatterns = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md'];
  for (const pattern of commonPatterns) {
    if (
      documentationFiles.some((f) =>
        f.toLowerCase().includes(pattern.toLowerCase())
      )
    ) {
      discoveredPaths.add(pattern);
    }
  }

  return Array.from(discoveredPaths);
}

/**
 * Calcula configuração de chunking baseada no tamanho real do projeto
 */
function calculateRealChunkingConfig(structure: any) {
  const totalFiles = structure?.totalFiles || 0;
  const sourceFiles = structure?.sourceFiles?.length || 0;
  const docFiles = structure?.documentationFiles?.length || 0;

  // Configuração adaptativa baseada no tamanho real
  if (totalFiles > 1000) {
    // Projeto grande
    return {
      codeChunkSize: 1200,
      codeChunkOverlap: 200,
      docChunkSize: 1600,
      docChunkOverlap: 300,
    };
  } else if (totalFiles > 100) {
    // Projeto médio
    return {
      codeChunkSize: 1000,
      codeChunkOverlap: 150,
      docChunkSize: 1400,
      docChunkOverlap: 250,
    };
  } else {
    // Projeto pequeno
    return {
      codeChunkSize: 800,
      codeChunkOverlap: 120,
      docChunkSize: 1200,
      docChunkOverlap: 200,
    };
  }
}

/**
 * Detecta arquivos prioritários reais do projeto
 */
function detectRealPriorityFiles(
  documentationFiles: string[],
  structure: any
): string[] {
  const priorities: string[] = [];

  // Priorizar arquivos de documentação descobertos
  const importantDocs = documentationFiles.filter((file) => {
    const name = file.toLowerCase();
    return (
      name.includes('readme') ||
      name.includes('getting') ||
      name.includes('start') ||
      name.includes('guide') ||
      name.includes('api')
    );
  });

  priorities.push(...importantDocs.slice(0, 5));

  // Adicionar padrões de documentação descobertos
  const docDirs =
    structure?.directories?.filter(
      (d: string) => d.includes('docs') || d.includes('documentation')
    ) || [];

  for (const dir of docDirs.slice(0, 3)) {
    priorities.push(`${dir}/**/*.md`);
  }

  return priorities;
}

/**
 * Calcula estimativa real do tamanho do índice
 */
function calculateRealIndexSize(structure: any): string {
  const totalFiles = structure?.totalFiles || 0;
  const sourceFiles = structure?.sourceFiles?.length || 0;

  if (totalFiles > 2000 || sourceFiles > 500) {
    return '~large';
  } else if (totalFiles > 500 || sourceFiles > 100) {
    return '~medium';
  } else {
    return '~small';
  }
}

export function inspectCommand(): Command {
  const cmd = new Command('inspect');

  cmd
    .description(
      `
🔍 Project Analysis v1.0.0

Intelligent system for complete project analysis and RAG optimization
following conventional patterns with Standard Command Structure.

Features:
  • Complete project structure analysis
  • Technology stack detection via MCP
  • RAG indexing optimization recommendations
  • Human-readable reports with actionable insights
  • Multi-format output (JSON, Markdown)
  • Standard Command Structure v1.0.0

Examples:
  clia inspect                           # Basic project analysis
  clia inspect --depth comprehensive     # Deep analysis with premium LLM
  clia inspect --format json            # JSON output only
  clia inspect -o custom-report.md      # Custom output file`
    )
    .option('-o, --output <file>', '📁 Output file path')
    .option('--include-tests', '🧪 Include test files in analysis', false)
    .option('-f, --format <type>', '📋 Output format: human|json', 'human')
    .action(async (options) => {
      const logger = getLogger();

      try {
        const inspectOptions: InspectOptions = {
          output: options.output,
          includeTests: options.includeTests || false,
          depth: 'detailed',
          format: options.format || 'human',
        };

        await processInspectOperation(inspectOptions);
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.debug(errorMessage);
        await logger.error(`❌ Inspect operation failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return cmd;
}

async function processInspectOperation(options: InspectOptions): Promise<void> {
  const config = await loadConfig();
  const logger = getLogger();
  logger.debug('🔍 processInspectOperation started');
  logger.debug('🔍 config loaded successfully');
  logger.debug('🔍 logger initialized');

  const tier = options.depth === 'comprehensive' ? 'premium' : 'default';
  logger.debug(`🔍 using tier: ${tier}`);

  logger.info(`🔍 Starting project inspection with ${tier} tier`);

  logger.debug('🔍 calling collectProjectStructure...');
  const projectStructure = await collectProjectStructure();
  logger.debug('🔍 collectProjectStructure completed');

  logger.debug('🔍 starting MCP stack detection...');
  let stackData = {};
  try {
    logger.debug('🔍 creating MCP client...');
    const mcpClient = McpClient.fromConfig();
    logger.debug('🔍 MCP client created, calling detectStack...');
    stackData = await mcpClient.detectStack();
    logger.debug('🔍 stack detection completed successfully');
  } catch (error) {
    logger.debug('🔍 stack detection failed:', error);
    stackData = { message: 'Stack detection not available' };
  }

  // Enhance stackData with parsed versions
  logger.debug('🔍 parsing versions from project files...');
  const cwd = process.cwd();
  logger.debug(`🔍 current working directory: ${cwd}`);
  const parsedVersions = {
    javascript: parsePackageJsonVersions(path.join(cwd, 'package.json')),
    python: parsePythonVersions(cwd),
    java: parseJavaVersions(cwd),
    go: parseGoVersions(cwd),
    rust: parseRustVersions(cwd),
  };
  logger.debug('🔍 version parsing completed');

  logger.debug('🔍 enhancing stack data...');
  const enhancedStackData = {
    ...stackData,
    parsedVersions,
  };
  logger.debug('🔍 stack data enhanced');

  logger.debug('🔍 creating prompt context...');
  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    timestamp: new Date().toISOString(),
    userLanguage: config.translateReports
      ? config.language || 'en-us'
      : 'en-us',
    projectStructure: JSON.stringify(projectStructure, null, 2),
    stackData: JSON.stringify(enhancedStackData, null, 2),
    analysisDepth: options.depth || 'detailed',
  };
  logger.debug('🔍 prompt context created, calling LLM...');

  let result = await execPrompt<PromptContext, InspectResponse>(
    'inspect/system',
    promptContext,
    '1.0.0',
    tier,
    5,
    3
  );
  logger.debug('🔍 LLM call completed successfully');

  try {
    result = assertInspectResponse(result);
  } catch (error) {
    logger.warn(
      `⚠️ LLM response validation failed, applying defaults: ${error}`
    );
    // Apply real RAG config if validation fails
    const realRag = generateRealRagConfig(projectStructure, config);
    result = {
      ...result,
      ragOptimization: {
        ...result.ragOptimization,
        ...realRag,
      },
    };
  }

  if (
    !result.ragOptimization.directoryStructure.excludePaths.includes('.clia')
  ) {
    result.ragOptimization.directoryStructure.excludePaths.push('.clia');
  }

  logger.info('🔄 Calling saveResults...');
  await saveResults(result, config, options, logger);
  logger.info('✅ saveResults completed');

  logger.info('✅ Project inspection completed successfully');

  // Forçar saída do processo se necessário
  setTimeout(() => {
    logger.info('🔚 Forcing process exit after timeout');
    process.exit(0);
  }, 1000);
}

// Function to read and parse .gitignore patterns
function parseGitignore(): string[] {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        // Convert gitignore patterns to glob patterns
        if (line.endsWith('/')) {
          return `${line}**`;
        }
        if (!line.includes('/') && !line.includes('*')) {
          return `**/${line}/**`;
        }
        return line;
      });
  } catch (error) {
    console.warn('Warning: Could not read .gitignore file');
    return [];
  }
}

async function collectProjectStructure(): Promise<object> {
  const logger = getLogger();
  const cwd = process.cwd();

  // Read .gitignore patterns
  const gitignorePatterns = parseGitignore();
  logger.debug(
    `🔍 Found ${gitignorePatterns.length} gitignore patterns:`,
    gitignorePatterns
  );

  logger.debug('🔍 Starting glob search...');
  const startTime = Date.now();
  const allFiles = await glob('**/*', {
    cwd,
    dot: true,
    ignore: [
      // Add gitignore patterns first
      ...gitignorePatterns,

      // Version control
      '.git/**',
      '.svn/**',
      '.hg/**',

      // JavaScript/TypeScript
      'node_modules/**',
      'dist/**',
      'build/**',
      '.next/**',
      '.nuxt/**',

      // Python
      '__pycache__/**',
      '*.pyc',
      '.venv/**',
      'venv/**',
      '.env/**',
      'env/**',
      'site-packages/**',
      '.pytest_cache/**',
      'htmlcov/**',

      // Java
      'target/**',
      '.gradle/**',
      'build/**',
      '.m2/**',
      '*.class',

      // C#/.NET
      'bin/**',
      'obj/**',
      'packages/**',
      '.vs/**',
      '*.dll',
      '*.exe',

      // Ruby
      '.bundle/**',
      'vendor/bundle/**',
      'vendor/gems/**',

      // Go
      'vendor/**',
      'bin/**',

      // Rust
      'target/**',
      'Cargo.lock',

      // PHP
      'vendor/**',
      'storage/logs/**',
      'storage/framework/**',

      // General build/cache directories
      'tmp/**',
      'temp/**',
      'cache/**',
      'logs/**',
      'log/**',

      // IDE/Editor files
      '.vscode/**',
      '.idea/**',
      '*.swp',
      '*.swo',
      '*~',

      // OS files
      '.DS_Store',
      'Thumbs.db',
      'desktop.ini',

      // CLIA specific
      '.clia/**',
    ],
  });
  const globTime = Date.now() - startTime;
  logger.debug(
    `🔍 Glob completed in ${globTime}ms, found ${allFiles.length} files`
  );

  logger.debug('🔍 Starting file categorization...');
  const directories: string[] = [];
  const files: string[] = [];
  const configFiles: string[] = [];
  const sourceFiles: string[] = [];
  const sensitiveFiles: string[] = [];
  const documentationFiles: string[] = [];

  for (const filePath of allFiles) {
    const fullPath = path.join(cwd, filePath);
    const stat = fs.existsSync(fullPath) ? fs.lstatSync(fullPath) : null;

    if (stat?.isDirectory()) {
      directories.push(filePath);
    } else if (stat?.isFile()) {
      files.push(filePath);

      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();

      if (isConfigFile(fileName)) {
        configFiles.push(filePath);
      }

      if (isSourceFile(ext)) {
        sourceFiles.push(filePath);
      }

      if (isDocumentationFile(filePath)) {
        documentationFiles.push(filePath);
      }

      if (isSensitive(filePath)) {
        sensitiveFiles.push(filePath);
      }
    }
  }
  logger.debug('🔍 File categorization completed');
  logger.debug(
    `🔍 Found ${directories.length} dirs, ${files.length} files, ${configFiles.length} config, ${sourceFiles.length} source, ${documentationFiles.length} documentation, ${sensitiveFiles.length} sensitive`
  );

  logger.debug('🔍 Starting file sampling...');
  const { sampled: sampledFiles, dropped: droppedFilesCount } =
    sampleFilesByDir(files, 50);
  const { sampled: sampledDirectories, dropped: droppedDirsCount } =
    sampleFilesByDir(directories, 30);
  const { sampled: sampledConfigFiles, dropped: droppedConfigCount } =
    sampleFilesByDir(configFiles, 20);
  const { sampled: sampledSourceFiles, dropped: droppedSourceCount } =
    sampleFilesByDir(sourceFiles, 50);
  const {
    sampled: sampledDocumentationFiles,
    dropped: droppedDocumentationCount,
  } = sampleFilesByDir(documentationFiles, 30);
  const { sampled: sampledSensitiveFiles, dropped: droppedSensitiveCount } =
    sampleFilesByDir(sensitiveFiles, 10);

  return {
    directories: sampledDirectories,
    files: sampledFiles,
    configFiles: sampledConfigFiles,
    sourceFiles: sampledSourceFiles,
    documentationFiles: sampledDocumentationFiles,
    sensitiveFiles: sampledSensitiveFiles,
    totalFiles: files.length,
    totalDirectories: directories.length,
    droppedCounts: {
      files: droppedFilesCount,
      directories: droppedDirsCount,
      configFiles: droppedConfigCount,
      sourceFiles: droppedSourceCount,
      documentationFiles: droppedDocumentationCount,
      sensitiveFiles: droppedSensitiveCount,
      totalDropped:
        droppedFilesCount +
        droppedDirsCount +
        droppedConfigCount +
        droppedSourceCount +
        droppedDocumentationCount +
        droppedSensitiveCount,
    },
  };
}

function sampleFilesByDir(files: string[], perDir = 50) {
  const buckets = new Map<string, string[]>();
  for (const f of files) {
    const dir = path.dirname(f);
    if (!buckets.has(dir)) buckets.set(dir, []);
    const arr = buckets.get(dir)!;
    if (arr.length < perDir) arr.push(f);
  }
  const sampled = Array.from(buckets.values()).flat();
  const dropped = files.length - sampled.length;
  return { sampled, dropped };
}

function isConfigFile(fileName: string): boolean {
  return mm.isMatch(fileName, CONFIG_PATTERNS, { nocase: true });
}

function isSensitive(filePath: string): boolean {
  return mm.isMatch(filePath, SENSITIVE_PATTERNS, { dot: true, nocase: true });
}

function isDocumentationFile(filePath: string): boolean {
  return mm.isMatch(filePath, DOCUMENTATION_PATTERNS, {
    nocase: true,
    dot: true,
  });
}

function isSourceFile(ext: string): boolean {
  const sourceExtensions = [
    // JavaScript/TypeScript
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.mjs',
    '.cjs',
    '.vue',
    '.svelte',

    // Python
    '.py',
    '.pyx',
    '.pyi',
    '.pyw',

    // Java
    '.java',
    '.kt',
    '.scala',
    '.groovy',

    // C#/.NET
    '.cs',
    '.vb',
    '.fs',
    '.fsx',

    // C/C++
    '.c',
    '.cpp',
    '.cc',
    '.cxx',
    '.h',
    '.hpp',
    '.hxx',

    // Go
    '.go',

    // Rust
    '.rs',

    // Ruby
    '.rb',
    '.rake',
    '.gemspec',

    // PHP
    '.php',
    '.phtml',
    '.php3',
    '.php4',
    '.php5',
    '.phps',

    // Shell/Scripts
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    '.ps1',
    '.bat',
    '.cmd',

    // Web
    '.html',
    '.htm',
    '.css',
    '.scss',
    '.sass',
    '.less',

    // Mobile
    '.swift',
    '.m',
    '.mm',
    '.dart',
    '.kt',

    // Database
    '.sql',
    '.plsql',
    '.psql',

    // Other
    '.xml',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
  ];

  return sourceExtensions.includes(ext.toLowerCase());
}

async function saveResults(
  result: InspectResponse,
  config: Config,
  options: InspectOptions,
  logger: ReturnType<typeof getLogger>
): Promise<void> {
  logger.info('🔄 Starting saveResults function...');

  const cliaDir = path.join(process.cwd(), '.clia');
  logger.info(`📁 Creating .clia directory: ${cliaDir}`);
  if (!fs.existsSync(cliaDir)) {
    fs.mkdirSync(cliaDir, { recursive: true });
  }

  const reportsDir = path.join(
    process.cwd(),
    config.reports?.outputDir || '.clia/reports'
  );
  logger.info(`📁 Creating reports directory: ${reportsDir}`);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = generateTimestamp();
  logger.info(`⏰ Generated timestamp: ${timestamp}`);

  // JSON files: only save without timestamp for consistent access
  const ragJsonFile = path.join(cliaDir, `project-inspection.json`);
  logger.info(`💾 Saving JSON file: ${ragJsonFile}`);

  try {
    fs.writeFileSync(ragJsonFile, JSON.stringify(result, null, 2));
    logger.info('✅ JSON file saved successfully');
  } catch (error) {
    logger.error(`❌ Error saving JSON file: ${error}`);
    throw error;
  }

  if (options.format === 'human' || !options.format) {
    logger.info('📝 Generating human report...');

    try {
      const humanReport = generateHumanReport(result, config);
      logger.info(`✅ Human report generated (${humanReport.length} chars)`);

      const humanReportFile =
        options.output || path.join(reportsDir, `${timestamp}_inspect.md`);
      logger.info(`💾 Saving human report: ${humanReportFile}`);

      fs.writeFileSync(humanReportFile, humanReport);
      logger.info('✅ Human report saved successfully');
    } catch (error) {
      logger.error(`❌ Failed to generate or save human report: ${error}`);
      // Don't throw, just warn - JSON is the important part
      logger.warn(`⚠️ Continuing without human report`);
    }
  }

  logger.info('✅ saveResults function completed');
}

function generateHumanReport(
  analysis: InspectResponse,
  config: Config
): string {
  const startTime = Date.now();
  const MAX_GENERATION_TIME = 5000; // 5 segundos máximo

  try {
    const locale = (config.language || 'en-us').toLowerCase().startsWith('pt')
      ? 'pt-BR'
      : 'en-US';
    const timestamp = new Date().toLocaleString(locale);
    const isPortuguese = locale === 'pt-BR';

    // Enhanced labels for comprehensive reporting
    const labels = isPortuguese
      ? {
          title: '# 🔍 Relatório Completo de Inspeção do Projeto',
          project: 'Projeto',
          generatedAt: 'Gerado em',
          confidence: 'Confiança',
          executiveSummary: '## 📊 Resumo Executivo',
          primaryLanguage: 'Linguagem Principal',
          projectType: 'Tipo de Projeto',
          complexity: 'Complexidade',
          ragReadiness: 'Prontidão para RAG',
          totalFiles: 'Total de Arquivos',
          sourceFiles: 'Arquivos de Código',
          configFiles: 'Arquivos de Configuração',
          documentationFiles: 'Arquivos de Documentação',
          discoveredDocumentation: 'Documentação Descoberta',
          recommendedDocPaths: 'Caminhos Recomendados',
          docChunkingStrategy: 'Estratégia de Chunk para Docs',
          docChunkSize: 'Tamanho de Chunk para Docs',
          docChunkOverlap: 'Sobreposição para Docs',
          architecture: '## 🏗️ Arquitetura do Projeto',
          type: 'Tipo',
          patterns: 'Padrões Arquiteturais',
          modules: 'Módulos Principais',
          entryPoints: 'Pontos de Entrada',
          isMonorepo: 'Monorepo',
          ragOptimization: '## 🎯 Otimização RAG Detalhada',
          includedPaths: 'Caminhos Incluídos:',
          excludedPaths: 'Caminhos Excluídos:',
          indexingConfig: 'Configuração de Indexação:',
          strategy: 'Estratégia',
          chunkSize: 'Tamanho do Chunk',
          chunkOverlap: 'Sobreposição de Chunk',
          estimatedSize: 'Tamanho Estimado do Índice',
          priorityFiles: 'Arquivos Prioritários',
          languageExclusions: 'Exclusões Específicas por Linguagem',
          sensitiveFiles: '### 🔒 Arquivos Sensíveis Detectados',
          noSensitiveFiles: '_Nenhum arquivo sensível detectado_',
          techStack: '## 🛠️ Stack Tecnológico Completo',
          detectedLanguages: '### Linguagens Detectadas',
          frameworks: '### Frameworks e Bibliotecas',
          packageManagers: '### Gerenciadores de Pacotes',
          dependencies: '### Análise de Dependências',
          production: '**Produção:**',
          development: '**Desenvolvimento:**',
          outdated: '**Desatualizadas:**',
          vulnerable: '**Com Vulnerabilidades:**',
          noOutdated: '_Todas as dependências estão atualizadas_',
          noVulnerable: '_Nenhuma vulnerabilidade detectada_',
          tools: '### Ferramentas e Utilitários',
          buildTools: '**Ferramentas de Build:**',
          testFrameworks: '**Frameworks de Teste:**',
          linters: '**Linters:**',
          formatters: '**Formatadores:**',
          bundlers: '**Bundlers:**',
          cicd: '**CI/CD:**',
          noneDetected: '_Nenhuma detectada_',
          unknownVersion: 'versão desconhecida',
          recommendations: '## 💡 Recomendações Detalhadas',
          modernization: '### 🚀 Modernização',
          security: '### 🔒 Segurança',
          performance: '### ⚡ Performance',
          tooling: '### 🔧 Ferramentas',
          documentation: '### 📖 Documentação',
          reportGenerated: '_Relatório completo gerado pelo CLIA',
          yes: 'Sim',
          no: 'Não',
          files: 'arquivos',
          confidenceLabel: 'confiança',
          dependenciesCount: 'dependências',
        }
      : {
          title: '# 🔍 Comprehensive Project Inspection Report',
          project: 'Project',
          generatedAt: 'Generated at',
          confidence: 'Confidence',
          executiveSummary: '## 📊 Executive Summary',
          primaryLanguage: 'Primary Language',
          projectType: 'Project Type',
          complexity: 'Complexity',
          ragReadiness: 'RAG Readiness',
          totalFiles: 'Total Files',
          sourceFiles: 'Source Files',
          configFiles: 'Config Files',
          documentationFiles: 'Documentation Files',
          discoveredDocumentation: 'Discovered Documentation',
          recommendedDocPaths: 'Recommended Documentation Paths',
          docChunkingStrategy: 'Documentation Chunking Strategy',
          docChunkSize: 'Documentation Chunk Size',
          docChunkOverlap: 'Documentation Chunk Overlap',
          architecture: '## 🏗️ Project Architecture',
          type: 'Type',
          patterns: 'Architectural Patterns',
          modules: 'Main Modules',
          entryPoints: 'Entry Points',
          isMonorepo: 'Monorepo',
          ragOptimization: '## 🎯 Detailed RAG Optimization',
          includedPaths: 'Included Paths:',
          excludedPaths: 'Excluded Paths:',
          indexingConfig: 'Indexing Configuration:',
          strategy: 'Strategy',
          chunkSize: 'Chunk Size',
          chunkOverlap: 'Chunk Overlap',
          estimatedSize: 'Estimated Index Size',
          priorityFiles: 'Priority Files',
          languageExclusions: 'Language-specific Exclusions',
          sensitiveFiles: '### 🔒 Detected Sensitive Files',
          noSensitiveFiles: '_No sensitive files detected_',
          techStack: '## 🛠️ Complete Technology Stack',
          detectedLanguages: '### Detected Languages',
          frameworks: '### Frameworks and Libraries',
          packageManagers: '### Package Managers',
          dependencies: '### Dependencies Analysis',
          production: '**Production:**',
          development: '**Development:**',
          outdated: '**Outdated:**',
          vulnerable: '**Vulnerable:**',
          noOutdated: '_All dependencies are up to date_',
          noVulnerable: '_No vulnerabilities detected_',
          tools: '### Tools and Utilities',
          buildTools: '**Build Tools:**',
          testFrameworks: '**Test Frameworks:**',
          linters: '**Linters:**',
          formatters: '**Formatters:**',
          bundlers: '**Bundlers:**',
          cicd: '**CI/CD:**',
          noneDetected: '_None detected_',
          unknownVersion: 'unknown version',
          recommendations: '## 💡 Detailed Recommendations',
          modernization: '### 🚀 Modernization',
          security: '### 🔒 Security',
          performance: '### ⚡ Performance',
          tooling: '### 🔧 Tooling',
          documentation: '### 📖 Documentation',
          reportGenerated: '_Comprehensive report generated by CLIA',
          yes: 'Yes',
          no: 'No',
          files: 'files',
          confidenceLabel: 'confidence',
          dependenciesCount: 'dependencies',
        };

    // Safely access nested properties with fallbacks
    const safeGet = (obj: any, path: string, defaultValue: any = null) => {
      return (
        path.split('.').reduce((current, key) => current?.[key], obj) ??
        defaultValue
      );
    };

    // Architecture section
    const architectureSection = safeGet(analysis, 'architecture')
      ? `
${labels.architecture}

- **${labels.type}**: ${safeGet(analysis, 'architecture.type', 'N/A')}
- **${labels.isMonorepo}**: ${safeGet(analysis, 'architecture.isMonorepo') ? labels.yes : labels.no}

**${labels.patterns}**
${
  safeGet(analysis, 'architecture.patterns', [])
    .map((pattern: string) => `- ${pattern}`)
    .join('\n') || `- ${labels.noneDetected}`
}

**${labels.modules}**
${
  safeGet(analysis, 'architecture.modules', [])
    .map((module: string) => `- \`${module}\``)
    .join('\n') || `- ${labels.noneDetected}`
}

**${labels.entryPoints}**
${
  safeGet(analysis, 'architecture.entryPoints', [])
    .map((entry: string) => `- \`${entry}\``)
    .join('\n') || `- ${labels.noneDetected}`
}

---`
      : '';

    // Enhanced RAG Optimization section
    const priorityFilesSection = safeGet(
      analysis,
      'ragOptimization.priorityFiles'
    )
      ? `
**${labels.priorityFiles}**
${safeGet(analysis, 'ragOptimization.priorityFiles', [])
  .map((file: string) => `- \`${file}\``)
  .join('\n')}
`
      : '';

    const languageExclusionsSection = safeGet(
      analysis,
      'ragOptimization.languageSpecificExclusions'
    )
      ? `
**${labels.languageExclusions}**
${Object.entries(
  safeGet(analysis, 'ragOptimization.languageSpecificExclusions', {})
)
  .map(
    ([lang, exclusions]: [string, any]) =>
      `- **${lang}**: ${Array.isArray(exclusions) ? exclusions.map((e) => `\`${e}\``).join(', ') : exclusions}`
  )
  .join('\n')}
`
      : '';

    // Package Managers section
    const packageManagersSection = safeGet(analysis, 'packageManagers')
      ? `
${labels.packageManagers}
${safeGet(analysis, 'packageManagers', [])
  .map(
    (pm: any) =>
      `- **${pm.name}**: \`${pm.configFile}\` (${pm.dependenciesCount || 0} ${labels.dependenciesCount})`
  )
  .join('\n')}
`
      : '';

    // Dependencies section
    const dependenciesSection = safeGet(analysis, 'dependencies')
      ? `
${labels.dependencies}

${labels.production}
${
  safeGet(analysis, 'dependencies.production', [])
    .map((dep: string) => `- \`${dep}\``)
    .join('\n') || `- ${labels.noneDetected}`
}

${labels.development}
${
  safeGet(analysis, 'dependencies.development', [])
    .map((dep: string) => `- \`${dep}\``)
    .join('\n') || `- ${labels.noneDetected}`
}

${labels.outdated}
${
  safeGet(analysis, 'dependencies.outdated', [])
    .map((dep: string) => `- \`${dep}\``)
    .join('\n') || labels.noOutdated
}

${labels.vulnerable}
${
  safeGet(analysis, 'dependencies.vulnerable', [])
    .map((dep: string) => `- ⚠️ \`${dep}\``)
    .join('\n') || labels.noVulnerable
}
`
      : '';

    // Tools section
    const toolsSection = safeGet(analysis, 'tools')
      ? `
${labels.tools}

${labels.buildTools} ${safeGet(analysis, 'tools.buildTools', []).join(', ') || labels.noneDetected}
${labels.testFrameworks} ${safeGet(analysis, 'tools.testFrameworks', []).join(', ') || labels.noneDetected}
${labels.linters} ${safeGet(analysis, 'tools.linters', []).join(', ') || labels.noneDetected}
${labels.formatters} ${safeGet(analysis, 'tools.formatters', []).join(', ') || labels.noneDetected}
${labels.bundlers} ${safeGet(analysis, 'tools.bundlers', []).join(', ') || labels.noneDetected}
${labels.cicd} ${safeGet(analysis, 'tools.cicd', []).join(', ') || labels.noneDetected}
`
      : '';

    return `${labels.title}

**${labels.project}**: ${analysis.metadata?.projectName || 'Unknown'}  
**${labels.generatedAt}**: ${timestamp}  
**${labels.confidence}**: ${(analysis.metadata.confidence * 100).toFixed(1)}%

---

${labels.executiveSummary}

- **${labels.primaryLanguage}**: ${analysis.summary.primaryLanguage}
- **${labels.projectType}**: ${analysis.summary.projectType}
- **${labels.complexity}**: ${analysis.summary.complexity}
- **${labels.ragReadiness}**: ${analysis.summary.ragReadiness}
- **${labels.totalFiles}**: ${analysis.summary.totalFiles}
${safeGet(analysis, 'summary.sourceFiles') ? `- **${labels.sourceFiles}**: ${safeGet(analysis, 'summary.sourceFiles')}` : ''}
${safeGet(analysis, 'summary.configFiles') ? `- **${labels.configFiles}**: ${safeGet(analysis, 'summary.configFiles')}` : ''}
${safeGet(analysis, 'summary.documentationFiles') ? `- **${labels.documentationFiles}**: ${safeGet(analysis, 'summary.documentationFiles')}` : ''}

${architectureSection}

${labels.ragOptimization}

**${labels.includedPaths}**
${analysis.ragOptimization.directoryStructure.includePaths.map((path: string) => `- \`${path}\``).join('\n')}

**${labels.excludedPaths}**
${analysis.ragOptimization.directoryStructure.excludePaths.map((path: string) => `- \`${path}\``).join('\n')}

### 📚 ${labels.discoveredDocumentation || 'Discovered Documentation'}

**${labels.recommendedDocPaths || 'Recommended Documentation Paths'}**
${
  safeGet(analysis, 'ragOptimization.documentationFiles.recommendedPaths', [])
    .map((path: string) => `- \`${path}\``)
    .join('\n') || '- README.md\n- docs/**/*.md'
}

**${labels.docChunkingStrategy || 'Documentation Chunking Strategy'}**: ${safeGet(analysis, 'ragOptimization.documentationFiles.chunkingStrategy', 'semantic-markdown')}
**${labels.docChunkSize || 'Documentation Chunk Size'}**: ${safeGet(analysis, 'ragOptimization.documentationFiles.recommendedChunkSize', 1200)}
**${labels.docChunkOverlap || 'Documentation Chunk Overlap'}**: ${safeGet(analysis, 'ragOptimization.documentationFiles.recommendedChunkOverlap', 200)}

**Discovered Documentation Files**
${
  safeGet(analysis, 'ragOptimization.documentationFiles.discoveredPaths', [])
    .slice(0, 10)
    .map((path: string) => `- \`${path}\``)
    .join('\n') || '_No documentation files found_'
}

**${labels.indexingConfig}**
- **${labels.strategy}**: ${analysis.ragOptimization.chunkingStrategy}
- **${labels.chunkSize}**: ${analysis.ragOptimization.recommendedIndexingConfig.chunkSize}
- **${labels.chunkOverlap}**: ${analysis.ragOptimization.recommendedIndexingConfig.chunkOverlap}
${safeGet(analysis, 'ragOptimization.estimatedIndexSize') ? `- **${labels.estimatedSize}**: ${safeGet(analysis, 'ragOptimization.estimatedIndexSize')}` : ''}

${priorityFilesSection}${languageExclusionsSection}${labels.sensitiveFiles}
${
  analysis.ragOptimization.directoryStructure.excludePaths.filter(
    (path) =>
      path.includes('.env') ||
      path.includes('secret') ||
      path.includes('key') ||
      path.includes('credential')
  ).length > 0
    ? analysis.ragOptimization.directoryStructure.excludePaths
        .filter(
          (path) =>
            path.includes('.env') ||
            path.includes('secret') ||
            path.includes('key') ||
            path.includes('credential')
        )
        .map((path: string) => `- \`${path}\` ⚠️`)
        .join('\n')
    : labels.noSensitiveFiles
}

---

${labels.techStack}

${labels.detectedLanguages}
${analysis.languages
  .map(
    (lang) =>
      `- **${lang.name}**: ${lang.files} ${labels.files} (${lang.confidence}% ${labels.confidenceLabel})`
  )
  .join('\n')}

${labels.frameworks}
${analysis.frameworks
  .map(
    (fw) =>
      `- **${fw.name}** (${fw.language}): ${fw.version || labels.unknownVersion}${fw.category ? ` - ${fw.category}` : ''}`
  )
  .join('\n')}

${packageManagersSection}${dependenciesSection}${toolsSection}---

${labels.recommendations}

${labels.modernization}
${analysis.recommendations.modernization.map((rec: string) => `- ${rec}`).join('\n')}

${labels.security}
${analysis.recommendations.security.map((rec: string) => `- ${rec}`).join('\n')}

${labels.performance}
${analysis.recommendations.performance.map((rec: string) => `- ${rec}`).join('\n')}

${
  safeGet(analysis, 'recommendations.tooling')
    ? `
${labels.tooling}
${safeGet(analysis, 'recommendations.tooling', [])
  .map((rec: string) => `- ${rec}`)
  .join('\n')}
`
    : ''
}

${
  safeGet(analysis, 'recommendations.documentation')
    ? `
${labels.documentation}
${safeGet(analysis, 'recommendations.documentation', [])
  .map((rec: string) => `- ${rec}`)
  .join('\n')}
`
    : ''
}

---

${labels.reportGenerated} v${analysis.metadata.version} ${isPortuguese ? 'em' : 'at'} ${timestamp}_
`;
  } catch (error) {
    // Se der erro na geração do relatório, retornar uma versão simplificada
    return `# Project Inspection Report

**Project**: ${analysis.metadata?.projectName || 'Unknown'}
**Generated**: ${new Date().toISOString()}
**Error**: Report generation failed: ${error}

## Summary
- **Primary Language**: ${analysis.summary.primaryLanguage}
- **Project Type**: ${analysis.summary.projectType}
- **Total Files**: ${analysis.summary.totalFiles}

## RAG Configuration
**Included Paths**: ${analysis.ragOptimization.directoryStructure.includePaths.join(', ')}
**Excluded Paths**: ${analysis.ragOptimization.directoryStructure.excludePaths.join(', ')}
**Chunk Size**: ${analysis.ragOptimization.recommendedIndexingConfig.chunkSize}
**Chunk Overlap**: ${analysis.ragOptimization.recommendedIndexingConfig.chunkOverlap}

_Simplified report due to generation error_
`;
  }
}
