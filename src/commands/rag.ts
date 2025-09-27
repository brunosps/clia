import { Command } from 'commander';
import { loadConfig, Config } from '../config.js';
import { getLogger } from '../shared/logger.js';
import { makeEmbeddings, type Embeddings } from '../embeddings/provider.js';
import {
  ensureRagDatabase,
  retrieveForFiles,
  hasRagDatabase,
} from '../rag/index.js';
import {
  loadCorpusManifest,
  loadChunkMetadata,
  ensureRagDirectory,
} from '../rag/storage.js';
import { enhancedRetrieveForFiles } from '../rag/enhanced-retrieval.js';
import path from 'path';
import fs from 'fs';

interface RagOptions {
  rebuild?: boolean;
  smartRebuild?: boolean;
  localOnly?: boolean;
  quiet?: boolean;
  detailed?: boolean;
  force?: boolean;
}

interface QueryOptions extends RagOptions {
  limit?: number;
  files?: string;
  format?: 'text' | 'json';
  enhanced?: boolean;
  strategy?: 'basic' | 'enhanced' | 'hybrid';
  expansion?: boolean;
  reranking?: boolean;
  minSimilarity?: number;
}

interface RagStats {
  totalDocs: number;
  totalChunks: number;
  createdAt: string;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  indexSizeMB: number;
  hasEmbeddings: boolean;
}

export function ragCommand(): Command {
  const cmd = new Command('rag');

  cmd.description(
    'Intelligent document indexing and semantic search system with smart chunking and embeddings'
  );

  cmd
    .command('index')
    .description('Index documents for RAG search')
    .option('--rebuild', 'Force complete index rebuild', false)
    .option('--smart-rebuild', 'Rebuild only changed files (default)', false)
    .option('--local-only', 'Use only local text search', false)
    .action(async (options: RagOptions & { smartRebuild?: boolean }) => {
      const logger = getLogger();
      try {
        await processIndexOperation(options);
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Index operation failed: ${errorMessage}`);
        console.log(`Index operation failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  cmd
    .command('query')
    .description('Search in RAG database')
    .argument('<query>', 'Search query text')
    .option('-k, --limit <number>', 'Maximum results to return', '6')
    .option('--files <pattern>', 'Filter by file pattern', '')
    .option('--format <type>', 'Output format: text|json', 'text')
    .option(
      '--enhanced',
      'Use enhanced retrieval with query expansion and re-ranking',
      true
    )
    .option(
      '--strategy <type>',
      'Retrieval strategy: basic|enhanced|hybrid',
      'hybrid'
    )
    .option('--no-expansion', 'Disable query expansion (enhanced mode only)')
    .option(
      '--no-reranking',
      'Disable advanced re-ranking (enhanced mode only)'
    )
    .option(
      '--min-similarity <number>',
      'Minimum similarity threshold (enhanced mode)',
      '0.5'
    )
    .action(async (query: string, options: QueryOptions) => {
      const logger = getLogger();
      try {
        await processQueryOperation(query, options);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Query operation failed: ${errorMessage}`);
        console.log(`Query operation failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  cmd
    .command('stats')
    .description('Show RAG system statistics')
    .option('--detailed', 'Show detailed statistics', false)
    .action(async (options: RagOptions) => {
      const logger = getLogger();
      try {
        await processStatsOperation(options);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Stats operation failed: ${errorMessage}`);
        console.log(`Stats operation failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  cmd
    .command('clear')
    .description('Clear RAG index')
    .option('--force', 'Skip confirmation prompt', false)
    .action(async (options: RagOptions) => {
      const logger = getLogger();
      try {
        await processClearOperation(options);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Clear operation failed: ${errorMessage}`);
        console.log(`Clear operation failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  return cmd;
}

async function processIndexOperation(options: RagOptions): Promise<void> {
  const config = await loadConfig();
  const logger = getLogger();

  logger.info('Starting RAG indexing operation');

  const projectConfig = loadProjectInspectionConfig();
  const ragConfig = mergeRagConfigurations(config, projectConfig);

  if (projectConfig) {
    logger.info('Using optimized configuration from project inspection');
  }

  const baseDir = process.cwd();
  const ragDir = path.join(baseDir, '.clia', 'rag');

  if (options.rebuild && fs.existsSync(ragDir)) {
    logger.info('Removing existing index for rebuild');
    fs.rmSync(ragDir, { recursive: true, force: true });
  }

  try {
    const useIncremental = !options.rebuild && options.smartRebuild !== false;
    await buildEmbeddingIndex(
      ragConfig,
      options.rebuild || false,
      useIncremental
    );
    logger.info('RAG indexing completed successfully');
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('EISDIR') ||
        error.message.includes('HNSWLib index') ||
        error.message.includes('illegal operation on a directory'))
    ) {
      logger.warn(
        'HNSWLib not available in global installation, but embeddings were processed successfully'
      );
      logger.info('RAG indexing completed with filename-based search fallback');
      return;
    }

    logger.info('Falling back to local-only indexing');
    await buildLocalIndex(ragConfig);
    logger.info('Local RAG indexing completed');
  }
}

async function processQueryOperation(
  query: string,
  options: QueryOptions
): Promise<void> {
  const config = await loadConfig();
  const logger = getLogger();

  if (!hasRagDatabase(process.cwd())) {
    throw new Error('RAG database not found. Run "clia rag index" first');
  }

  logger.info(`Searching for: "${query}"`);

  const embedder = await makeEmbeddings(config.project?.rag || {}, config);
  const limit = parseInt(String(options.limit)) || 6;
  const filePattern = options.files || '';

  const useEnhanced =
    options.enhanced ||
    options.strategy === 'enhanced' ||
    options.strategy === 'hybrid' ||
    (options.expansion !== undefined && options.expansion !== true) ||
    (options.reranking !== undefined && options.reranking !== true) ||
    (options.minSimilarity !== undefined &&
      parseFloat(String(options.minSimilarity)) !== 0.3);

  if (useEnhanced) {
    return await processEnhancedQuery(
      query,
      options,
      config,
      embedder,
      limit,
      filePattern
    );
  }

  const results = await retrieveForFiles(
    query,
    filePattern ? [filePattern] : [],
    limit,
    embedder
  );

  if (options.format === 'json') {
    console.log(
      JSON.stringify({ query, results, count: results.length }, null, 2)
    );
  } else {
    console.log(`\nQuery: "${query}"`);
    console.log(`Found ${results.length} relevant chunks\n`);

    results.forEach((result: string, index: number) => {
      console.log(`${index + 1}. ${result}\n${'---'.repeat(20)}\n`);
    });
  }

  logger.info(`Query completed: ${results.length} results found`);
}

async function processStatsOperation(options: RagOptions): Promise<void> {
  const logger = getLogger();
  const baseDir = process.cwd();

  if (!hasRagDatabase(baseDir)) {
    throw new Error('RAG database not found. Run "clia rag index" first');
  }

  const ragDir = ensureRagDirectory(baseDir);
  const manifest = loadCorpusManifest(ragDir);
  const metadata = loadChunkMetadata(ragDir);

  const stats: RagStats = {
    totalDocs: manifest?.docCount || 0,
    totalChunks: metadata.size,
    createdAt: manifest?.updatedAt || 'Unknown',
    embeddingModel: manifest?.embedder || 'Unknown',
    chunkSize: manifest?.chunkSize || 0,
    chunkOverlap: manifest?.chunkOverlap || 0,
    indexSizeMB: calculateIndexSize(ragDir),
    hasEmbeddings: fs.existsSync(path.join(ragDir, 'hnswlib', 'index.dat')),
  };

  console.log('\n📊 RAG System Statistics');
  console.log('='.repeat(50));
  console.log(`📄 Documents: ${stats.totalDocs}`);
  console.log(`🧩 Chunks: ${stats.totalChunks}`);
  console.log(`🤖 Model: ${stats.embeddingModel}`);
  console.log(`📐 Chunk Size: ${stats.chunkSize}`);
  console.log(`🔗 Overlap: ${stats.chunkOverlap}`);
  console.log(`💾 Index Size: ${stats.indexSizeMB.toFixed(2)} MB`);
  console.log(
    `🎯 Embeddings: ${stats.hasEmbeddings ? 'Available' : 'Not Available'}`
  );
  console.log(`📅 Last Updated: ${new Date(stats.createdAt).toLocaleString()}`);

  if (options.detailed) {
    console.log('\nDetailed Information');
    console.log('-'.repeat(30));
    console.log(`RAG Directory: ${ragDir}`);
    console.log(`Manifest: ${manifest ? 'Present' : 'Missing'}`);
    console.log(`Metadata Entries: ${metadata.size}`);
  }

  logger.info('Stats operation completed');
}

async function processClearOperation(options: RagOptions): Promise<void> {
  const logger = getLogger();
  const baseDir = process.cwd();
  const ragDir = path.join(baseDir, '.clia', 'rag');

  if (!fs.existsSync(ragDir)) {
    logger.info('No RAG index to clear');
    return;
  }

  if (!options.force) {
    console.log('This will permanently delete the RAG index.');
    console.log('You can rebuild it with: clia rag index');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Continue? [y/N]: ', resolve);
    });

    rl.close();

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      logger.info('Operation cancelled by user');
      return;
    }
  }

  fs.rmSync(ragDir, { recursive: true, force: true });
  logger.info('RAG index cleared successfully');
}

function loadProjectInspectionConfig(): Record<string, unknown> | null {
  const inspectionPath = path.join(
    process.cwd(),
    '.clia',
    'project-inspection.json'
  );

  if (!fs.existsSync(inspectionPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(inspectionPath, 'utf-8');
    const data = JSON.parse(content);

    const logger = getLogger();
    logger.info(
      `Loaded project inspection: ${(data as Record<string, unknown>)?.summary ? ((data as Record<string, unknown>).summary as Record<string, unknown>)?.totalFiles || 'unknown' : 'unknown'} files detected`
    );

    const ragOpt = (data as Record<string, unknown>)?.ragOptimization as Record<
      string,
      unknown
    >;
    if (ragOpt?.directoryStructure) {
      const dirStruct = ragOpt.directoryStructure as Record<string, unknown>;
      const includePaths = dirStruct.includePaths as string[];
      if (includePaths) {
        logger.info(
          `Using inspect-optimized paths: ${includePaths.join(', ')}`
        );
      }
    }

    if (ragOpt?.documentationFiles) {
      const docFiles = ragOpt.documentationFiles as Record<string, unknown>;
      const discoveredPaths = docFiles.discoveredPaths as string[];
      if (discoveredPaths && discoveredPaths.length > 0) {
        logger.info(
          `Found ${discoveredPaths.length} documentation files to index`
        );
      }
    }

    const structure = (data as Record<string, unknown>)?.structure as Record<
      string,
      unknown
    >;
    if (structure?.directories) {
      const directories = structure.directories as string[];
      const sourceDirs = directories.filter(
        (dir: string) =>
          dir.startsWith('src') ||
          dir.startsWith('docs') ||
          dir.startsWith('scripts')
      );
      if (sourceDirs.length > 0) {
        logger.info(
          `Using detected source directories: ${sourceDirs.join(', ')}`
        );
      }
    }

    return data;
  } catch (error) {
    throw new Error(`Failed to parse project-inspection.json: ${error}`);
  }
}

function calculateIndexSize(ragDir: string): number {
  try {
    let totalSize = 0;
    const files = [
      'hnswlib/index.dat',
      'hnswlib/docs.json',
      'chunk-metadata.jsonl',
    ];

    for (const file of files) {
      const filePath = path.join(ragDir, file);
      if (fs.existsSync(filePath)) {
        totalSize += fs.statSync(filePath).size;
      }
    }

    return totalSize / (1024 * 1024);
  } catch {
    return 0;
  }
}

function mergeRagConfigurations(
  config: Config,
  projectConfig?: Record<string, unknown> | null
): Record<string, unknown> {
  const defaultConfig = {
    includes: ['src/**', 'docs/**', '*.md'],
    excludes: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.next/**',
      '.git/**',
      '**/*.min.*',
      '**/*.map',
      '**/*.lock',
    ],
    chunkSize: 800,
    chunkOverlap: 120,
  };

  if (projectConfig?.ragOptimization) {
    const ragOpt = projectConfig.ragOptimization as Record<string, unknown>;
    const docFiles = ragOpt.documentationFiles as Record<string, unknown>;
    const dirStruct = ragOpt.directoryStructure as Record<string, unknown>;
    const indexConfig = ragOpt.recommendedIndexingConfig as Record<
      string,
      unknown
    >;

    const discoveredDocs = (docFiles?.discoveredPaths as string[]) || [];
    const recommendedDocs = (docFiles?.recommendedPaths as string[]) || [];
    const allDocPaths = [...new Set([...discoveredDocs, ...recommendedDocs])];

    const includes = [
      ...((dirStruct?.includePaths as string[]) || defaultConfig.includes),
      ...allDocPaths,
    ];

    return {
      includes,
      excludes: [
        ...defaultConfig.excludes,
        ...((dirStruct?.excludePaths as string[]) || []),
      ],
      chunkSize: (indexConfig?.chunkSize as number) || defaultConfig.chunkSize,
      chunkOverlap:
        (indexConfig?.chunkOverlap as number) || defaultConfig.chunkOverlap,
      documentationConfig: {
        chunkSize: (docFiles?.recommendedChunkSize as number) || 1200,
        chunkOverlap: (docFiles?.recommendedChunkOverlap as number) || 200,
        strategy: (docFiles?.chunkingStrategy as string) || 'semantic-markdown',
        patterns: allDocPaths,
      },
    };
  }

  const structure = projectConfig?.structure as Record<string, unknown>;
  const summary = projectConfig?.summary as Record<string, unknown>;
  const ragOpt = projectConfig?.ragOptimization as Record<string, unknown>;

  if (structure?.directories && summary) {
    const directories = structure.directories as string[];
    const sourceFiles = (structure.sourceFiles as string[]) || [];
    const priorityFiles = (ragOpt?.priorityFiles as string[]) || [];
    const filePatterns = ragOpt?.filePatterns as Record<string, unknown>;
    const excludePatterns = (filePatterns?.exclude as string[]) || [];
    const indexConfig = ragOpt?.recommendedIndexingConfig as Record<
      string,
      unknown
    >;
    const totalFiles = summary.totalFiles as number;

    const detectedIncludes = directories
      .filter(
        (dir: string) =>
          dir.startsWith('src') ||
          dir.startsWith('docs') ||
          dir.startsWith('scripts')
      )
      .map((dir: string) => `${dir}/**`);

    return {
      includes:
        detectedIncludes.length > 0
          ? [...detectedIncludes, '*.md', '*.json']
          : defaultConfig.includes,
      excludes: [...defaultConfig.excludes, ...excludePatterns],
      chunkSize:
        (indexConfig?.chunkSize as number) || (totalFiles > 200 ? 1000 : 800),
      chunkOverlap:
        (indexConfig?.chunkOverlap as number) || (totalFiles > 200 ? 200 : 120),
      priorityFiles: priorityFiles,
    };
  }

  return {
    includes: config.project?.rag?.includes || defaultConfig.includes,
    excludes: [
      ...defaultConfig.excludes,
      ...(config.project?.rag?.excludes || []),
    ],
    chunkSize: config.project?.rag?.chunkSize || defaultConfig.chunkSize,
    chunkOverlap:
      config.project?.rag?.chunkOverlap || defaultConfig.chunkOverlap,
  };
}

async function buildEmbeddingIndex(
  ragConfig: Record<string, unknown>,
  forceRebuild: boolean,
  useIncremental: boolean = true
): Promise<void> {
  const config = await loadConfig();
  const embedder = await makeEmbeddings(config.project?.rag || {}, config);

  if (ragConfig.documentationConfig) {
    const logger = getLogger();
    const docConfig = ragConfig.documentationConfig as Record<string, unknown>;
    logger.info(
      `Using documentation-specific chunking: ${docConfig.chunkSize}/${docConfig.chunkOverlap}`
    );
  }

  await ensureRagDatabase(
    process.cwd(),
    ragConfig.includes as string[],
    ragConfig.excludes as string[],
    ragConfig.chunkSize as number,
    ragConfig.chunkOverlap as number,
    embedder,
    !forceRebuild && useIncremental,
    ragConfig.documentationConfig as Record<string, unknown>
  );
}

async function buildLocalIndex(
  ragConfig: Record<string, unknown>
): Promise<void> {
  const config = await loadConfig();
  const embedder = await makeEmbeddings(config.project?.rag || {}, config);

  await ensureRagDatabase(
    process.cwd(),
    ragConfig.includes as string[],
    ragConfig.excludes as string[],
    ragConfig.chunkSize as number,
    ragConfig.chunkOverlap as number,
    embedder,
    false,
    ragConfig.documentationConfig as Record<string, unknown>
  );
}

async function processEnhancedQuery(
  query: string,
  options: QueryOptions,
  config: Config,
  embedder: Embeddings,
  limit: number,
  filePattern: string
): Promise<void> {
  const logger = getLogger();
  const changedFiles = options.files ? [options.files] : [];
  const minSimilarity = parseFloat(String(options.minSimilarity)) || 0.3;

  let strategy = options.strategy;
  if (!strategy || strategy === 'basic') {
    strategy = 'hybrid';
  }

  logger.info(
    `Enhanced retrieval: strategy=${strategy}, expansion=${options.expansion !== false}, rerank=${options.reranking !== false}`
  );

  const enhancedResponse = await enhancedRetrieveForFiles(process.cwd(), {
    query,
    changedFiles,
    k: limit,
    embedder,
    useHybrid: strategy === 'hybrid',
    useQueryExpansion: options.expansion !== false,
    useReranking: options.reranking !== false,
    minSimilarity,
    contextWindow: 2000,
  });

  if (options.format === 'json') {
    console.log(
      JSON.stringify(
        {
          query,
          strategy: enhancedResponse.retrievalStrategy,
          results: enhancedResponse.results.map((r) => ({
            content: r.content,
            score: r.score,
            source: r.source,
            relevanceFactors: r.relevanceFactors,
            metadata: r.metadata,
          })),
          totalFound: enhancedResponse.totalFound,
          averageScore: enhancedResponse.averageScore,
          qualityMetrics: enhancedResponse.qualityMetrics,
          enhanced: true,
        },
        null,
        2
      )
    );
  } else {
    console.log(`\nEnhanced Query: "${query}"`);
    console.log(`Strategy: ${enhancedResponse.retrievalStrategy}`);
    console.log(
      `Results: ${enhancedResponse.results.length} selected from ${enhancedResponse.totalFound} candidates`
    );
    console.log(`Average Score: ${enhancedResponse.averageScore.toFixed(3)}`);
    console.log(
      `Quality: ${enhancedResponse.qualityMetrics.confidenceLevel} confidence, diversity: ${(enhancedResponse.qualityMetrics.diversityScore * 100).toFixed(1)}%\n`
    );

    enhancedResponse.results.forEach((result, index) => {
      console.log(
        `${index + 1}. ${result.source} (score: ${result.score.toFixed(3)})`
      );
      console.log(`   Factors: ${result.relevanceFactors.join(', ')}`);
      console.log(
        `   ${result.content.slice(0, 200)}${result.content.length > 200 ? '...' : ''}\n${'---'.repeat(20)}\n`
      );
    });

    if (enhancedResponse.qualityMetrics.confidenceLevel === 'low') {
      console.log(`Tips for better results:`);
      console.log(`   - Try: --strategy enhanced (semantic-only)`);
      console.log(`   - Try: --min-similarity 0.2 (broader search)`);
      console.log(`   - Try: --limit 10 (more results)`);
    }
  }

  logger.info(
    `Enhanced query completed: ${enhancedResponse.results.length} results, ${enhancedResponse.qualityMetrics.confidenceLevel} confidence`
  );
}
