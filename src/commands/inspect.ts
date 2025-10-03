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
  [key: string]: unknown;
  projectName: string;
  timestamp: string;
  userLanguage: string;
  projectStructure: string;
  stackData: string;
  analysisDepth: string;
}

interface LanguageInfo {
  name: string;
  files: number;
  confidence: number;
}

interface FrameworkInfo {
  name: string;
  language: string;
  version?: string;
  category: string;
}

interface PackageManagerInfo {
  name: string;
  configFile: string;
  dependenciesCount?: number;
}

interface DirectoryStructure {
  includePaths: string[];
  excludePaths: string[];
}

interface DocumentationFiles {
  discoveredPaths: string[];
  recommendedPaths: string[];
  chunkingStrategy: string;
  recommendedChunkSize: number;
  recommendedChunkOverlap: number;
}

interface IndexingConfig {
  chunkSize: number;
  chunkOverlap: number;
}

interface RagOptimization {
  directoryStructure: DirectoryStructure;
  documentationFiles: DocumentationFiles;
  chunkingStrategy: string;
  recommendedIndexingConfig: IndexingConfig;
  estimatedIndexSize: string;
}

interface ProjectSummary {
  primaryLanguage: string;
  projectType: string;
  complexity: string;
  maturityLevel: string;
  ragReadiness: string;
  totalFiles: number;
}

interface Recommendations {
  modernization: string[];
  security: string[];
  performance: string[];
  tooling: string[];
  documentation: string[];
}

interface ProjectMetadata {
  projectName: string;
  version: string;
  confidence: number;
}

interface InspectResponse {
  summary: ProjectSummary;
  languages: LanguageInfo[];
  frameworks: FrameworkInfo[];
  packageManagers: PackageManagerInfo[];
  ragOptimization: RagOptimization;
  recommendations: Recommendations;
  metadata: ProjectMetadata;
}

interface ProjectStructure {
  directories: string[];
  files: string[];
  configFiles: string[];
  sourceFiles: string[];
  documentationFiles: string[];
  sensitiveFiles: string[];
  totalFiles: number;
  totalDirectories: number;
  droppedCounts: DroppedCounts;
}

interface DroppedCounts {
  files: number;
  directories: number;
  configFiles: number;
  sourceFiles: number;
  documentationFiles: number;
  sensitiveFiles: number;
  totalDropped: number;
}

interface SampledResult {
  sampled: string[];
  dropped: number;
}

interface ParsedVersions {
  javascript: Record<string, string | null>;
  python: Record<string, string>;
  java: Record<string, string>;
  go: Record<string, string>;
  rust: Record<string, string>;
}

interface EnhancedStackData {
  parsedVersions: ParsedVersions;
  [key: string]: unknown;
}

interface ChunkingConfig {
  codeChunkSize: number;
  codeChunkOverlap: number;
  docChunkSize: number;
  docChunkOverlap: number;
}

interface RealRagConfig {
  directoryStructure: DirectoryStructure;
  documentationFiles: DocumentationFiles;
  filePatterns: { exclude: string[] };
  recommendedIndexingConfig: IndexingConfig;
  chunkingStrategy: string;
  priorityFiles: string[];
  estimatedIndexSize: string;
}


const SENSITIVE_PATTERNS = [
  '.env*',
  '*.env',
  '.environment',
  '*.environment',
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
  'secrets.*',
  'credentials.*',
  'auth.*',
  'tokens.*',
  'config/*.prod.*',
  'config/production.*',
  'docker-compose*.prod.yml',
  'docker-compose.production.yml',
  '**/coverage/**',
  '**/.pytest_cache/**',
  '**/.gradle/**',
  '**/logs/**',
  '**/log/**',
  '**/*.log',
  '*.bak',
  '*.backup',
  '*.old',
  '*.orig',
  '*.db',
  '*.sqlite',
  '*.sqlite3',
  'database.yml',
  '.aws/credentials',
  '.azure/**',
  '.gcloud/**',
  '*.swp',
  '*.swo',
  '*~',
  '.vscode/settings.json',
];

const CONFIG_PATTERNS = [
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
  'pyproject.toml',
  'requirements*.txt',
  'Pipfile*',
  'setup.{py,cfg}',
  'tox.ini',
  'pytest.ini',
  'pom.xml',
  'build.gradle*',
  'settings.gradle*',
  '*.csproj',
  '*.sln',
  '*.vbproj',
  '*.fsproj',
  'Directory.*.props',
  'Gemfile*',
  'Rakefile',
  'go.{mod,sum,work}',
  'Cargo.{toml,lock}',
  'composer.{json,lock}',
  'phpunit.xml',
  'artisan',
  '.env*',
  'docker-compose*.yml',
  'Dockerfile*',
  'Makefile',
  'CMakeLists.txt',
  '.gitignore',
];

const DOCUMENTATION_PATTERNS = [
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
  'LICENSE*',
  'LICENCE*',
  'COPYING*',
  'COPYRIGHT*',
  'NOTICE*',
  'AUTHORS*',
  'CONTRIBUTORS*',
  'CONTRIBUTING*',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT*',
  'SECURITY*',
  'SUPPORT*',
  'GOVERNANCE*',
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
  'docs/**/*.md',
  'doc/**/*.md',
  'documentation/**/*.md',
  'wiki/**/*.md',
  'guides/**/*.md',
  'tutorials/**/*.md',
  'examples/**/*.md',
  'samples/**/*.md',
  'manual/**/*.md',
  'docs/**/*.rst',
  'docs/**/*.txt',
  'docs/**/*.adoc',
  'docs/**/*.asciidoc',
  'docs/**/*.org',
  '*.md',
  'src/**/*.md',
  'lib/**/*.md',
  '.github/**/*.md',
  '.gitlab/**/*.md',
  'ARCHITECTURE*',
  'DESIGN*',
  'SPECIFICATION*',
  'TECHNICAL*',
  'DEVELOPMENT*',
  'CODING_STANDARDS*',
  'STYLE_GUIDE*',
];


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

function parsePackageJsonVersions(
  packagePath: string
): Record<string, string | null> {
  try {
    const content = fs.readFileSync(packagePath, 'utf-8');
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const pick = (name: string): string | null => deps?.[name] || null;

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

function parsePythonVersions(projectPath: string): Record<string, string> {
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

function parseJavaVersions(projectPath: string): Record<string, string> {
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

function parseGoVersions(projectPath: string): Record<string, string> {
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

function parseRustVersions(projectPath: string): Record<string, string> {
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

function generateRealRagConfig(
  structure: ProjectStructure,
  config: Config
): RealRagConfig {
  const realIncludePaths = detectRealIncludePaths(structure);
  const realExcludes = mergeExcludes(config, null);
  const documentationFiles = structure.documentationFiles || [];
  const discoveredDocPaths = documentationFiles.slice(0, 30);
  const recommendedDocPaths = generateRecommendedDocPaths(documentationFiles);
  const chunkingConfig = calculateRealChunkingConfig(structure);
  const priorityFiles = detectRealPriorityFiles(documentationFiles, structure);
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

function detectRealIncludePaths(structure: ProjectStructure): string[] {
  const directories = structure.directories || [];
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

  for (const dir of directories) {
    const dirName = dir.split('/')[0];
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

  if (realPaths.length === 0) {
    const topLevelDirs = directories
      .map((d: string) => d.split('/')[0])
      .filter((d: string) => !d.startsWith('.') && d !== 'node_modules')
      .slice(0, 5);
    realPaths.push(...Array.from(new Set(topLevelDirs)));
  }

  return realPaths.length > 0 ? realPaths : ['.'];
}

function generateRecommendedDocPaths(documentationFiles: string[]): string[] {
  const discoveredPaths = new Set<string>();

  for (const file of documentationFiles) {
    const dir = path.dirname(file);
    if (dir !== '.') {
      discoveredPaths.add(`${dir}/**/*.md`);
    }
    if (file.toLowerCase().includes('readme')) {
      discoveredPaths.add(file);
    }
  }

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

function calculateRealChunkingConfig(structure: ProjectStructure): ChunkingConfig {
  const totalFiles = structure.totalFiles || 0;

  if (totalFiles > 1000) {
    return {
      codeChunkSize: 1200,
      codeChunkOverlap: 200,
      docChunkSize: 1600,
      docChunkOverlap: 300,
    };
  } else if (totalFiles > 100) {
    return {
      codeChunkSize: 1000,
      codeChunkOverlap: 150,
      docChunkSize: 1400,
      docChunkOverlap: 250,
    };
  } else {
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
  structure: ProjectStructure
): string[] {
  const priorities: string[] = [];

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

  const docDirs = (structure.directories || []).filter(
    (d: string) => d.includes('docs') || d.includes('documentation')
  );

  for (const dir of docDirs.slice(0, 3)) {
    priorities.push(`${dir}/**/*.md`);
  }

  return priorities;
}

function calculateRealIndexSize(structure: ProjectStructure): string {
  const totalFiles = structure.totalFiles || 0;
  const sourceFiles = structure.sourceFiles?.length || 0;

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
    .description('Project analysis with stack detection and RAG optimization v1.0.0')
    .option('-o, --output <file>', 'Output file path')
    .option('--include-tests', 'Include test files in analysis', false)
    .option('-f, --format <type>', 'Output format: human|json', 'human')
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
        logger.error(`❌ Inspect operation failed: ${errorMessage}`);
        console.log(`❌ Inspect operation failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return cmd;
}

async function processInspectOperation(options: InspectOptions): Promise<void> {
  const config = await loadConfig();
  const logger = getLogger();

  const tier = options.depth === 'comprehensive' ? 'premium' : 'default';
  logger.info(`Starting project inspection with ${tier} tier`);

  const projectStructure = await collectProjectStructure();

  let stackData: Record<string, unknown> = {};
  try {
    const mcpClient = McpClient.fromConfig();
    const stackInfo = await mcpClient.detectStack();
    stackData = stackInfo as unknown as Record<string, unknown>;
    logger.info('Stack detection completed successfully');
  } catch (error) {
    logger.warn('Stack detection not available, proceeding without MCP data');
    stackData = { message: 'Stack detection not available' };
  }

  const cwd = process.cwd();
  const parsedVersions = {
    javascript: parsePackageJsonVersions(path.join(cwd, 'package.json')),
    python: parsePythonVersions(cwd),
    java: parseJavaVersions(cwd),
    go: parseGoVersions(cwd),
    rust: parseRustVersions(cwd),
  };

  const enhancedStackData = {
    ...stackData,
    parsedVersions,
  };

  const promptContext: PromptContext = {
    projectName: config.project?.name || 'Unknown Project',
    timestamp: generateTimestamp(),
    userLanguage: config.translateReports
      ? config.language || 'en-us'
      : 'en-us',
    projectStructure: JSON.stringify(projectStructure, null, 2),
    stackData: JSON.stringify(enhancedStackData, null, 2),
    analysisDepth: options.depth || 'detailed',
  };

  let result = await execPrompt<PromptContext, InspectResponse>(
    'inspect',
    promptContext,
    '1.0.0',
    tier,
    0.3
  );
  logger.info('Project analysis completed successfully');

  try {
    result = assertInspectResponse(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Response validation failed, applying defaults: ${errorMessage}`);
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

  await saveResults(result, config, options, logger);
  logger.info('Project inspection completed successfully');
}

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
        if (line.endsWith('/')) {
          return `${line}**`;
        }
        if (!line.includes('/') && !line.includes('*')) {
          return `**/${line}/**`;
        }
        return line;
      });
  } catch (error) {
    return [];
  }
}

async function collectProjectStructure(): Promise<ProjectStructure> {
  const logger = getLogger();
  const cwd = process.cwd();

  const gitignorePatterns = parseGitignore();
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

function sampleFilesByDir(files: string[], perDir: number = 50): SampledResult {
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
  logger.info(`Generated timestamp: ${timestamp}`);

  const ragJsonFile = path.join(cliaDir, `project-inspection.json`);
  logger.info(`Saving JSON file: ${ragJsonFile}`);

  try {
    fs.writeFileSync(ragJsonFile, JSON.stringify(result, null, 2));
    logger.info('JSON file saved successfully');
  } catch (error) {
    throw new Error(`Failed to save JSON file: ${error}`);
  }

  if (options.format === 'human' || !options.format) {
    logger.info('Generating human report');

    try {
      const humanReport = generateHumanReport(result, config);
      logger.info(`Human report generated (${humanReport.length} chars)`);

      const humanReportFile =
        options.output || path.join(reportsDir, `${timestamp}_inspect.md`);
      logger.info(`Saving human report: ${humanReportFile}`);

      fs.writeFileSync(humanReportFile, humanReport);
      logger.info('Human report saved successfully');
    } catch (error) {
      logger.warn(`Failed to generate human report: ${error}`);
      logger.warn('Continuing without human report');
    }
  }

  logger.info('Project inspection results saved successfully');
}

function generateHumanReport(
  analysis: InspectResponse,
  config: Config
): string {
  const timestamp = new Date().toLocaleString();

  try {
    return `# Project Inspection Report

**Project**: ${analysis.metadata?.projectName || 'Unknown'}
**Generated**: ${timestamp}
**Confidence**: ${Math.round(analysis.metadata.confidence * 100)}%

## Summary

- **Primary Language**: ${analysis.summary.primaryLanguage}
- **Project Type**: ${analysis.summary.projectType}
- **Complexity**: ${analysis.summary.complexity}
- **Maturity Level**: ${analysis.summary.maturityLevel}
- **RAG Readiness**: ${analysis.summary.ragReadiness}
- **Total Files**: ${analysis.summary.totalFiles} files

## Technologies

### Languages
${analysis.languages.map(lang => `- ${lang.name} (${lang.files} files, ${Math.round(lang.confidence * 100)}% confidence)`).join('\n')}

### Frameworks
${analysis.frameworks.map(fw => `- ${fw.name} (${fw.language}${fw.version ? ` v${fw.version}` : ''})`).join('\n')}

### Package Managers
${analysis.packageManagers.map(pm => `- ${pm.name}: ${pm.configFile}${pm.dependenciesCount ? ` (${pm.dependenciesCount} dependencies)` : ''}`).join('\n')}

## RAG Optimization

### Directory Structure
**Include Paths:**
${analysis.ragOptimization.directoryStructure.includePaths.map(path => `- ${path}`).join('\n')}

**Exclude Paths:**
${analysis.ragOptimization.directoryStructure.excludePaths.map(path => `- ${path}`).join('\n')}

### Documentation Files
**Discovered:**
${analysis.ragOptimization.documentationFiles.discoveredPaths.slice(0, 10).map(path => `- ${path}`).join('\n')}

**Recommended Configuration:**
- Chunk Size: ${analysis.ragOptimization.documentationFiles.recommendedChunkSize}
- Chunk Overlap: ${analysis.ragOptimization.documentationFiles.recommendedChunkOverlap}
- Strategy: ${analysis.ragOptimization.documentationFiles.chunkingStrategy}

## Recommendations

### Modernization
${analysis.recommendations.modernization.map(rec => `- ${rec}`).join('\n')}

### Security
${analysis.recommendations.security.map(rec => `- ${rec}`).join('\n')}

### Performance
${analysis.recommendations.performance.map(rec => `- ${rec}`).join('\n')}

### Tooling
${analysis.recommendations.tooling.map(rec => `- ${rec}`).join('\n')}

### Documentation
${analysis.recommendations.documentation.map(rec => `- ${rec}`).join('\n')}

---

*Report generated by CLIA v1.0.0 at ${timestamp}*
`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `# Project Inspection Report

**Project**: ${analysis.metadata?.projectName || 'Unknown'}
**Generated**: ${new Date().toISOString()}
**Error**: Report generation failed: ${errorMessage}

## Summary
- **Primary Language**: ${analysis.summary.primaryLanguage}
- **Project Type**: ${analysis.summary.projectType}
- **Total Files**: ${analysis.summary.totalFiles}

## RAG Configuration
**Included Paths**: ${analysis.ragOptimization.directoryStructure.includePaths.join(', ')}
**Excluded Paths**: ${analysis.ragOptimization.directoryStructure.excludePaths.join(', ')}
**Chunk Size**: ${analysis.ragOptimization.recommendedIndexingConfig.chunkSize}
**Chunk Overlap**: ${analysis.ragOptimization.recommendedIndexingConfig.chunkOverlap}

*Simplified report due to generation error*
`;
  }
}
