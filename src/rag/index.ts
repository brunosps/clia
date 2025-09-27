import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { createRequire } from 'module';

// Criar função require para ES modules
const require = createRequire(import.meta.url);

// HNSWLib para banco vetorial - OBRIGATÓRIO para funcionar
let HierarchicalNSW: any = null;

/**
 * Inicialização rigorosa de dependências conforme COMPLETE_DEVELOPMENT_GUIDE.md
 * - HNSWLib é OBRIGATÓRIO para operações de vetor
 * - Verificação de dependências ANTES do processamento
 * - Falha rápida se dependências não estão disponíveis
 */
function validateRequiredDependencies() {
  try {
    const pkg = require('hnswlib-node');
    HierarchicalNSW = pkg.HierarchicalNSW;
    return true;
  } catch (error) {
    throw new Error(
      `❌ DEPENDÊNCIA OBRIGATÓRIA FALTANDO: hnswlib-node não está disponível.\n` +
      `   Instale com: npm install -g hnswlib-node\n` +
      `   Erro: ${error}`
    );
  }
}

/**
 * Validação do provider de embeddings - APENAS Ollama permitido
 * Conforme especificação: "embed" tier exclusivo para RAG (local Ollama)
 */
function validateEmbeddingProvider(embedder: any) {
  if (!embedder.name.includes('ollama')) {
    throw new Error(
      `❌ PROVIDER INVÁLIDO: RAG requer provider Ollama para embeddings.\n` +
      `   Provider atual: ${embedder.name}\n` +
      `   Configure o tier 'embed' para usar Ollama local.`
    );
  }
}

import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import type { Embeddings } from '../embeddings/provider.js';
import { getLogger } from '../shared/logger.js';
import { buildIndex as buildIndexWithIndexer } from './indexer.js';

// Initialize logger
const logger = getLogger();

/**
 * Processamento em lote otimizado EXCLUSIVAMENTE para Ollama
 * Conforme COMPLETE_DEVELOPMENT_GUIDE.md:
 * - Batch Size: 64 chunks para Ollama local (provider-aware batching)
 * - Progress Tracking: Real-time progress com ETA
 * - Error Recovery: Retry com exponential backoff
 * - Memory Management: Garbage collection automático
 */
async function generateEmbeddingsInOptimizedBatches(
  texts: string[],
  embedder: any
): Promise<number[][]> {
  const logger = getLogger();
  
  // Validar provider antes do processamento
  validateEmbeddingProvider(embedder);

  // Batch size otimizado para Ollama (64 chunks)
  const batchSize = 64;
  
  logger.info(
    `🎯 Using optimized batch processing: ${batchSize} chunks per batch (${embedder.name})`
  );

  const totalBatches = Math.ceil(texts.length / batchSize);
  const embeddings: number[][] = [];
  const startTime = Date.now();

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, texts.length);
    const batch = texts.slice(batchStart, batchEnd);

    // Progress tracking com ETA
    const processed = batchStart;
    const progress = ((processed / texts.length) * 100).toFixed(1);
    const elapsed = Date.now() - startTime;
    const avgTimePerChunk = elapsed / Math.max(processed, 1);
    const remaining = texts.length - processed;
    const eta = Math.round((remaining * avgTimePerChunk) / 1000);

    logger.info(
      `📊 Batch ${batchIndex + 1}/${totalBatches}: Processing ${batch.length} chunks (${progress}% complete, ETA: ${eta}s)`
    );

    // Error recovery com retry logic
    let batchEmbeddings: number[][];
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount <= maxRetries) {
      try {
        logger.info(`🔄 Processing ${batch.length} embeddings with ${embedder.name} (optimized batch)...`);
        
        // Gerar embeddings para o batch atual
        batchEmbeddings = await embedder.embed(batch);

        // Validar dimensões dos embeddings
        if (!batchEmbeddings || batchEmbeddings.length !== batch.length) {
          throw new Error(
            `Invalid batch embeddings: expected ${batch.length}, got ${batchEmbeddings?.length || 0}`
          );
        }

        // Batch processado com sucesso
        embeddings.push(...batchEmbeddings);
        logger.info(`✅ ${batchEmbeddings.length} embeddings generated successfully with ${embedder.name}`);
        logger.info(
          `✅ Batch ${batchIndex + 1}/${totalBatches} completed (${batchEmbeddings.length} embeddings)`
        );
        break;
      } catch (error) {
        retryCount++;
        if (retryCount > maxRetries) {
          logger.error(
            `❌ Batch ${batchIndex + 1} failed after ${maxRetries} retries:`,
            error
          );
          throw new Error(`Batch processing failed: ${error}`);
        }

        // Exponential backoff for retry
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
        logger.warn(
          `⚠️ Batch ${batchIndex + 1} failed (retry ${retryCount}/${maxRetries}), retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Memory management - força garbage collection a cada 10 batches
    if ((batchIndex + 1) % 10 === 0 && global.gc) {
      logger.info(
        `🧹 Running garbage collection after batch ${batchIndex + 1}`
      );
      global.gc();
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgBatchTime = (parseFloat(totalTime) / totalBatches).toFixed(1);
  logger.info(
    `🎉 Embedding generation completed: ${embeddings.length} embeddings in ${totalTime}s (avg ${avgBatchTime}s/batch)`
  );

  return embeddings;
}

function parseGitignore(baseDir: string): string[] {
  const gitignorePath = path.join(baseDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];

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
  } catch {
    return [];
  }
}

// Check if RAG database exists
export function hasRagDatabase(baseDir: string): boolean {
  const indexPath = path.join(baseDir, '.clia', 'rag', 'hnswlib');
  const docsPath = path.join(indexPath, 'docs.json');
  const indexFile = path.join(indexPath, 'index.dat');

  // Verificar se ambos arquivos existem (metadados + índice HNSWLib)
  return fs.existsSync(docsPath) && fs.existsSync(indexFile);
}

// Load project-specific context for intelligent scoring
interface ProjectContext {
  commands: string[];
  importantDirectories: string[];
  fileTypes: Record<string, number>;
  keyTerms: string[];
}

function loadProjectContext(baseDir: string): ProjectContext {
  const defaultContext: ProjectContext = {
    commands: [],
    importantDirectories: ['src', 'lib', 'app', 'components'],
    fileTypes: {
      config: 2,
      'package.json': 3,
      tsconfig: 2,
      README: 3,
      docs: 3,
    },
    keyTerms: [],
  };

  try {
    // Load project inspection data
    const inspectionPath = path.join(
      baseDir,
      '.clia',
      'project-inspection.json'
    );
    const stackPath = path.join(baseDir, '.clia', 'stack-analysis.json');

    let projectContext = { ...defaultContext };

    if (fs.existsSync(inspectionPath)) {
      const inspection = JSON.parse(fs.readFileSync(inspectionPath, 'utf-8'));

      // Extract commands from directory structure
      if (inspection.directoryStructure?.structure) {
        const commands = extractCommandsFromStructure(
          inspection.directoryStructure.structure
        );
        projectContext.commands = commands;
      }

      // Extract important directories
      if (inspection.directoryStructure?.includePaths) {
        projectContext.importantDirectories =
          inspection.directoryStructure.includePaths;
      }

      // Extract key terms from patterns and findings
      if (inspection.patterns) {
        projectContext.keyTerms.push(...Object.keys(inspection.patterns));
      }
    }

    if (fs.existsSync(stackPath)) {
      const stack = JSON.parse(fs.readFileSync(stackPath, 'utf-8'));

      // Add stack-specific terms
      if (stack.languages) {
        projectContext.keyTerms.push(...Object.keys(stack.languages));
      }

      if (stack.frameworks) {
        projectContext.keyTerms.push(...Object.keys(stack.frameworks));
      }

      if (stack.packageManagers) {
        projectContext.keyTerms.push(...Object.keys(stack.packageManagers));
      }
    }

    return projectContext;
  } catch (error) {
    logger.debug(`Could not load project context, using defaults: ${error}`);
    return defaultContext;
  }
}

function extractCommandsFromStructure(structure: any): string[] {
  const commands: string[] = [];

  function traverse(obj: any, currentPath: string = '') {
    if (typeof obj !== 'object' || obj === null) return;

    Object.keys(obj).forEach((key) => {
      const fullPath = currentPath ? `${currentPath}/${key}` : key;

      // Look for command-like directories
      if (
        key.includes('command') ||
        key.includes('cmd') ||
        key.includes('cli')
      ) {
        commands.push(key);
      }

      // Look for files that might be commands
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        traverse(obj[key], fullPath);
      } else if (typeof obj[key] === 'string' && obj[key].includes('.')) {
        // This is likely a file
        const fileName = key.replace(/\.[^/.]+$/, ''); // Remove extension
        if (fullPath.includes('command') || fullPath.includes('cmd')) {
          commands.push(fileName);
        }
      }
    });
  }

  traverse(structure);
  return [...new Set(commands)]; // Remove duplicates
}

// Load RAG optimization configuration from project-inspection.json if available
function loadRagOptimizationConfig(baseDir: string): any | null {
  const inspectionPath = path.join(baseDir, '.clia', 'project-inspection.json');
  if (!fs.existsSync(inspectionPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(inspectionPath, 'utf-8');
    const inspection = JSON.parse(content);
    return inspection.ragOptimization || null;
  } catch (error) {
    logger.warn(
      `Failed to load project inspection for RAG optimization: ${error}`
    );
    return null;
  }
}

// Auto-build RAG if it doesn't exist
export async function ensureRagDatabase(
  baseDir: string,
  paths: string[],
  exclude: string[],
  chunkSize: number,
  chunkOverlap: number,
  embedder: Embeddings,
  useIncremental: boolean = true,
  documentationConfig?: any
): Promise<string> {
  return await buildIndex(
    baseDir,
    paths,
    exclude,
    chunkSize,
    chunkOverlap,
    embedder,
    hasRagDatabase(baseDir) && useIncremental,
    documentationConfig
  );
}

export async function buildIndex(
  baseDir: string,
  paths: string[],
  exclude: string[],
  chunkSize: number,
  chunkOverlap: number,
  embedder: Embeddings,
  useIncremental: boolean = false,
  documentationConfig?: any
) {
  // VALIDAÇÃO OBRIGATÓRIA NO INÍCIO - FAIL FAST
  logger.info('🔍 Validating required dependencies...');
  validateRequiredDependencies();
  
  logger.info('🔍 Validating embedding provider...');
  validateEmbeddingProvider(embedder);
  
  logger.info('✅ All dependencies validated successfully');

  if (useIncremental) {
    const result = await buildIndexWithIndexer(
      baseDir,
      {
        paths,
        excludeGlobs: exclude,
        chunkSize,
        chunkOverlap,
        enableDocProfile: false,
        incremental: true,
      },
      embedder
    );

    logger.info(
      `✅ Smart rebuild completed: ${result.newChunks} new chunks, ${result.removedChunks} removed, ${result.skippedFiles} files skipped`
    );
    return path.join(baseDir, '.clia', 'rag', 'hnswlib');
  }

  // Original implementation for full rebuild
  // Load RAG optimization configuration from project-inspection.json if available
  const ragOptimization = loadRagOptimizationConfig(baseDir);

  let finalPaths = paths;
  let finalExcludes = exclude;
  let finalChunkSize = chunkSize;
  let finalChunkOverlap = chunkOverlap;

  if (ragOptimization) {
    logger.info(
      '🎯 Using RAG optimization configuration from project-inspection.json'
    );

    // Use optimized configuration if available
    if (ragOptimization.directoryStructure?.includePaths?.length > 0) {
      finalPaths = ragOptimization.directoryStructure.includePaths;
      logger.info(`📁 Using optimized include paths: ${finalPaths.join(', ')}`);
    }

    if (ragOptimization.directoryStructure?.excludePaths?.length > 0) {
      finalExcludes = [
        ...exclude,
        ...ragOptimization.directoryStructure.excludePaths,
      ];
      logger.info(
        `🚫 Using optimized exclude paths: ${ragOptimization.directoryStructure.excludePaths.join(', ')}`
      );
    }

    if (ragOptimization.recommendedIndexingConfig?.chunkSize) {
      finalChunkSize = ragOptimization.recommendedIndexingConfig.chunkSize;
      logger.info(`📐 Using optimized chunk size: ${finalChunkSize}`);
    }

    if (ragOptimization.recommendedIndexingConfig?.chunkOverlap) {
      finalChunkOverlap =
        ragOptimization.recommendedIndexingConfig.chunkOverlap;
      logger.info(`🔗 Using optimized chunk overlap: ${finalChunkOverlap}`);
    }

    // Add file pattern exclusions
    if (ragOptimization.filePatterns?.exclude?.length > 0) {
      finalExcludes = [
        ...finalExcludes,
        ...ragOptimization.filePatterns.exclude,
      ];
    }

    // Add language-specific exclusions
    if (ragOptimization.languageSpecificExclusions) {
      Object.values(ragOptimization.languageSpecificExclusions).forEach(
        (exclusions: any) => {
          if (Array.isArray(exclusions)) {
            finalExcludes = [...finalExcludes, ...exclusions];
          }
        }
      );
    }
  }

  // Combine config excludes with gitignore patterns
  const gitignorePatterns = parseGitignore(baseDir);

  // Use the exclude patterns passed as parameter (from RAG configuration)
  const allExcludes = [...finalExcludes, ...gitignorePatterns];

  const files: string[] = [];
  for (const p of finalPaths) {
    const found = await glob(path.join(baseDir, p, '**/*.*'), {
      ignore: allExcludes,
    });
    files.push(...found);
  }

  logger.info(`Processing ${files.length} files for RAG...`);
  if (allExcludes.length > 0) {
    logger.info(
      `Ignoring patterns: ${allExcludes.slice(0, 3).join(', ')}${allExcludes.length > 3 ? '...' : ''}`
    );
  }

  const docs: Document[] = [];
  const docDocs: Document[] = [];
  
  for (const f of files) {
    try {
      const text = fs.readFileSync(f, 'utf-8');
      const relativePath = path.relative(baseDir, f);
      const doc = new Document({
        pageContent: text,
        metadata: { source: relativePath },
      });
      
      // Check if this is a documentation file
      const isDocFile = documentationConfig?.patterns?.some((pattern: string) => {
        const normPattern = pattern.replace(/\*\*/g, '').replace(/\*/g, '');
        return relativePath.includes(normPattern) || 
               relativePath.toLowerCase().includes('readme') ||
               relativePath.toLowerCase().includes('doc') ||
               relativePath.endsWith('.md');
      });
      
      if (isDocFile) {
        docDocs.push(doc);
      } else {
        docs.push(doc);
      }
    } catch {}
  }
  
  let splitDocs: Document[] = [];
  
  // Process regular files with standard chunking
  if (docs.length > 0) {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: finalChunkSize,
      chunkOverlap: finalChunkOverlap,
    });
    const regularSplitDocs = await splitter.splitDocuments(docs);
    splitDocs.push(...regularSplitDocs);
    logger.info(`📄 Processed ${docs.length} regular files with ${finalChunkSize}/${finalChunkOverlap} chunking`);
  }
  
  // Process documentation files with documentation-specific chunking
  if (docDocs.length > 0 && documentationConfig) {
    const docSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: documentationConfig.chunkSize,
      chunkOverlap: documentationConfig.chunkOverlap,
    });
    const docSplitDocs = await docSplitter.splitDocuments(docDocs);
    splitDocs.push(...docSplitDocs);
    logger.info(`📚 Processed ${docDocs.length} documentation files with ${documentationConfig.chunkSize}/${documentationConfig.chunkOverlap} chunking`);
  } else if (docDocs.length > 0) {
    // Fallback to regular chunking if no doc config
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: finalChunkSize,
      chunkOverlap: finalChunkOverlap,
    });
    const docSplitDocs = await splitter.splitDocuments(docDocs);
    splitDocs.push(...docSplitDocs);
    logger.info(`📚 Processed ${docDocs.length} documentation files with standard chunking`);
  }

  logger.info(`🔄 Generating embeddings for ${splitDocs.length} chunks...`);

  // Extrair textos dos documentos para processamento em lote otimizado
  const texts = splitDocs.map((doc) => doc.pageContent);

  // Implementar processamento em lote otimizado conforme COMPLETE_DEVELOPMENT_GUIDE.md
  const embeddings = await generateEmbeddingsInOptimizedBatches(
    texts,
    embedder
  );

  if (embeddings.length === 0 || !embeddings[0] || embeddings[0].length === 0) {
    throw new Error('Failed to generate embeddings');
  }

  const embeddingDim = embeddings[0].length;
  logger.info(
    `✅ Embeddings generated! Dimension: ${embeddingDim}, Creating HNSWLib index...`
  );

  // Criar índice HNSWLib conforme COMPLETE_DEVELOPMENT_GUIDE.md
  const indexPath = path.join(baseDir, '.clia', 'rag', 'hnswlib');
  fs.mkdirSync(indexPath, { recursive: true });

  // Preparar arquivo de índice - limpar conflitos ANTES de inicializar HNSWLib
  const indexFile = path.join(indexPath, 'index.dat');

  // Garantir que não há conflitos de arquivo/diretório
  if (fs.existsSync(indexFile)) {
    const stat = fs.statSync(indexFile);
    if (stat.isDirectory()) {
      logger.info(`🧹 Removing conflicting directory: ${indexFile}`);
      fs.rmSync(indexFile, { recursive: true, force: true });
    } else if (stat.isFile()) {
      logger.info(`🧹 Removing existing index file: ${indexFile}`);
      fs.unlinkSync(indexFile);
    }
  }

  // Inicializar HNSWLib index após limpeza
  const index = new HierarchicalNSW('cosine', embeddingDim);
  index.initIndex(splitDocs.length * 2); // Espaço extra para futuras adições

  // Adicionar embeddings ao índice HNSWLib
  logger.info(`🏗️ Building HNSWLib index with ${embeddings.length} vectors...`);
  for (let i = 0; i < embeddings.length; i++) {
    index.addPoint(embeddings[i], i);
  }

  // Salvar índice HNSWLib
  logger.info(`💾 Saving HNSWLib index to ${indexFile}...`);
  index.writeIndexSync(indexFile);
  logger.info(`✅ HNSWLib index saved successfully`);

  // Salvar metadados dos documentos
  const ragData = {
    documents: splitDocs.map((doc, i) => ({
      id: i,
      pageContent: doc.pageContent,
      metadata: doc.metadata,
    })),
    totalDocs: splitDocs.length,
    embeddingModel: embedder.name,
    embeddingDimension: embeddingDim,
    indexType: 'hnswlib-cosine',
    createdAt: new Date().toISOString(),
    config: { 
      chunkSize: finalChunkSize, 
      chunkOverlap: finalChunkOverlap,
      optimized: !!ragOptimization,
      optimizationSource: ragOptimization ? 'project-inspection.json' : 'default',
      provider: 'ollama-only'
    }
  };

  fs.writeFileSync(
    path.join(indexPath, 'docs.json'),
    JSON.stringify(ragData, null, 2)
  );
  logger.info(
    `✅ RAG base created with ${splitDocs.length} chunks in ${indexPath}`
  );
  logger.info(`📊 Index type: HNSWLib (${embeddingDim}D cosine similarity)`);
  logger.info(`🤖 Embedding model: ${embedder.name}`);
  return indexPath;
}

// Selective retrieval by semantic similarity with HNSWLib - OLLAMA ONLY
export async function retrieveForFiles(
  query: string,
  changedFiles: string[],
  k = 6,
  embedder?: Embeddings
) {
  const baseDir = process.cwd();
  const indexPath = path.join(baseDir, '.clia', 'rag', 'hnswlib');

  // Check if RAG database exists
  if (!hasRagDatabase(baseDir)) {
    throw new Error(
      '❌ RAG database not found. Run "clia rag index" first to build the index.'
    );
  }

  // Validar dependências obrigatórias
  validateRequiredDependencies();

  // Validar embedder obrigatório
  if (!embedder) {
    throw new Error('❌ Embedder is required for RAG search. Configure Ollama embed tier.');
  }
  
  // Validar provider Ollama
  validateEmbeddingProvider(embedder);

  const docsPath = path.join(indexPath, 'docs.json');
  const indexFile = path.join(indexPath, 'index.dat');

  if (!fs.existsSync(docsPath)) {
    throw new Error('❌ RAG metadata not found. Rebuild the index.');
  }

  if (!fs.existsSync(indexFile)) {
    throw new Error('❌ HNSWLib index file not found. Rebuild the index.');
  }

  const ragData = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
  const docs = ragData.documents || ragData;

  logger.info(
    `🔍 Performing HNSWLib semantic search with ${docs.length} documents...`
  );

  // Carregar índice HNSWLib
  const index = new HierarchicalNSW('cosine', ragData.embeddingDimension);
  index.readIndexSync(indexFile);

  // Gerar embedding da query
  logger.info(`🔄 Generating query embedding with ${embedder.name}...`);
  const queryEmbeddings = await embedder.embed([query]);
  const queryEmbedding = queryEmbeddings[0];

  if (
    !queryEmbedding ||
    queryEmbedding.length !== ragData.embeddingDimension
  ) {
    throw new Error(
      `Query embedding dimension mismatch: got ${queryEmbedding?.length}, expected ${ragData.embeddingDimension}`
    );
  }

  // Buscar documentos similares usando HNSWLib
  const searchResults = index.searchKnn(queryEmbedding, k * 2);

  // Aplicar boost para arquivos relacionados aos changedFiles
  const scoredResults = searchResults.neighbors
    .map((docId: number, idx: number) => {
      const doc = docs[docId];
      if (!doc) return null;

      const similarity = 1 - searchResults.distances[idx];

      // Boost para arquivos relacionados aos changedFiles
      let fileBoost = 0;
      const src = (doc.metadata?.source || '') as string;
      const hints = new Set(changedFiles.map((f) => f.split(path.sep)[0]));

      for (const hint of hints) {
        if (src.startsWith(hint + path.sep)) fileBoost += 0.2;
        if (src.includes(hint)) fileBoost += 0.1;
      }

      const finalScore = similarity + fileBoost;

      return {
        ...doc,
        score: finalScore,
        semanticScore: similarity,
        fileBoost,
      };
    })
    .filter(Boolean);

  // Ordenar por score e retornar top-k
  const topResults = scoredResults
    .filter((d: any) => d.semanticScore > 0.3) // Threshold mínimo de similaridade
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, k)
    .map((d: any) => d.pageContent.slice(0, 2000));

  const avgSimilarity = scoredResults.length > 0 
    ? (scoredResults.reduce((sum: number, d: any) => sum + d.semanticScore, 0) / scoredResults.length * 100).toFixed(1)
    : '0.0';

  logger.info(
    `✅ HNSWLib RAG: ${topResults.length} relevant contexts found (avg similarity: ${avgSimilarity}%)`
  );
  
  return topResults;
}
