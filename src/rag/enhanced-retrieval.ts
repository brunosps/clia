/**
 * Enhanced RAG Retrieval System v1.0.0
 * Implements advanced techniques for more reliable and relevant context retrieval
 */

import path from 'path';
import fs from 'fs';
// @ts-ignore - CommonJS import
import pkg from 'hnswlib-node';
const { HierarchicalNSW } = pkg;
import { getLogger } from '../shared/logger.js';
import type { Embeddings } from '../embeddings/provider.js';

const logger = getLogger();

export interface EnhancedRetrievalOptions {
  query: string;
  changedFiles?: string[];
  k?: number;
  embedder?: Embeddings;
  useHybrid?: boolean;
  useQueryExpansion?: boolean;
  useReranking?: boolean;
  minSimilarity?: number;
  contextWindow?: number;
}

export interface RetrievalResult {
  content: string;
  score: number;
  source: string;
  relevanceFactors: string[];
  metadata: any;
}

export interface EnhancedRetrievalResponse {
  results: RetrievalResult[];
  totalFound: number;
  averageScore: number;
  retrievalStrategy: string;
  qualityMetrics: {
    diversityScore: number;
    coverageScore: number;
    confidenceLevel: 'low' | 'medium' | 'high';
  };
}

/**
 * Enhanced retrieval with multiple quality improvement techniques
 */
export async function enhancedRetrieveForFiles(
  baseDir: string,
  options: EnhancedRetrievalOptions
): Promise<EnhancedRetrievalResponse> {
  const {
    query,
    changedFiles = [],
    k = 6,
    embedder,
    useHybrid = true,
    useQueryExpansion = true,
    useReranking = true,
    minSimilarity = 0.3,
    contextWindow = 2000
  } = options;

  logger.info(`🧠 Enhanced RAG retrieval: "${query}"`);
  logger.info(`🔧 Settings: hybrid=${useHybrid}, expansion=${useQueryExpansion}, rerank=${useReranking}`);

  const indexPath = path.join(baseDir, '.clia', 'rag', 'hnswlib');
  const docsPath = path.join(indexPath, 'docs.json');
  const indexFile = path.join(indexPath, 'index.dat');

  if (!fs.existsSync(docsPath) || !fs.existsSync(indexFile)) {
    throw new Error('RAG database not found. Run "clia rag index" first');
  }

  const ragData = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
  const docs = ragData.documents || ragData;

  // Step 1: Query Expansion
  const expandedQueries = useQueryExpansion 
    ? expandQuery(query)
    : [query];

  logger.info(`📈 Query expansion: ${expandedQueries.length} variations`);

  // Step 2: Multi-pass Retrieval
  const allCandidates: RetrievalResult[] = [];

  for (const expandedQuery of expandedQueries) {
    // Semantic retrieval
    if (embedder && ragData.embeddingDimension) {
      const semanticResults = await performSemanticSearch(
        expandedQuery,
        docs,
        indexFile,
        ragData,
        embedder,
        k * 2,
        changedFiles,
        minSimilarity
      );
      allCandidates.push(...semanticResults);
    }

    // Hybrid: Add keyword-based results
    if (useHybrid) {
      const keywordResults = await performKeywordSearch(
        expandedQuery,
        docs,
        k,
        changedFiles,
        contextWindow
      );
      allCandidates.push(...keywordResults);
    }
  }

  // Step 3: Deduplication and Re-ranking
  const uniqueResults = deduplicateResults(allCandidates);
  
  const finalResults = useReranking
    ? await rerankResults(uniqueResults, query, k, embedder)
    : uniqueResults.slice(0, k);

  // Step 4: Quality Assessment
  const qualityMetrics = calculateQualityMetrics(finalResults, query);

  const response: EnhancedRetrievalResponse = {
    results: finalResults,
    totalFound: allCandidates.length,
    averageScore: finalResults.reduce((sum, r) => sum + r.score, 0) / finalResults.length || 0,
    retrievalStrategy: getStrategyDescription(useHybrid, useQueryExpansion, useReranking),
    qualityMetrics
  };

  logger.info(`✅ Enhanced retrieval: ${finalResults.length} results, avg score: ${response.averageScore.toFixed(3)}, confidence: ${qualityMetrics.confidenceLevel}`);

  return response;
}

/**
 * Expande a query com termos relacionados e sinônimos
 */
function expandQuery(query: string): string[] {
  const queries = [query];
  const words = query.toLowerCase().split(/\s+/);
  
  // Sinônimos técnicos comuns
  const synonyms: Record<string, string[]> = {
    'function': ['method', 'procedure', 'routine'],
    'class': ['component', 'module', 'object'],
    'error': ['exception', 'bug', 'issue', 'problem'],
    'config': ['configuration', 'settings', 'options'],
    'auth': ['authentication', 'authorization', 'login'],
    'test': ['testing', 'spec', 'unit test'],
    'api': ['endpoint', 'service', 'interface'],
    'db': ['database', 'data store', 'persistence'],
    'ui': ['interface', 'frontend', 'view'],
    'server': ['backend', 'service', 'api']
  };

  // Adicionar variações com sinônimos
  for (const word of words) {
    if (synonyms[word]) {
      for (const synonym of synonyms[word]) {
        const expandedQuery = query.replace(new RegExp(word, 'gi'), synonym);
        if (expandedQuery !== query) {
          queries.push(expandedQuery);
        }
      }
    }
  }

  // Adicionar variações técnicas
  if (query.includes('how to')) {
    queries.push(query.replace('how to', 'implement'));
    queries.push(query.replace('how to', 'create'));
  }

  return queries.slice(0, 3); // Limitar para evitar explosão
}

/**
 * Busca semântica usando HNSWLib
 */
async function performSemanticSearch(
  query: string,
  docs: any[],
  indexFile: string,
  ragData: any,
  embedder: Embeddings,
  k: number,
  changedFiles: string[],
  minSimilarity: number
): Promise<RetrievalResult[]> {
  try {
    const index = new HierarchicalNSW('cosine', ragData.embeddingDimension);
    index.readIndexSync(indexFile);
    
    const queryEmbeddings = await embedder.embed([query]);
    const queryEmbedding = queryEmbeddings[0];
    
    if (!queryEmbedding || queryEmbedding.length !== ragData.embeddingDimension) {
      logger.warn(`Query embedding dimension mismatch: ${queryEmbedding?.length} vs ${ragData.embeddingDimension}`);
      return [];
    }
    
    const searchResults = index.searchKnn(queryEmbedding, k);
    
    const results: RetrievalResult[] = [];
    
    for (let i = 0; i < searchResults.neighbors.length; i++) {
      const docId = searchResults.neighbors[i];
      const doc = docs[docId];
      if (!doc) continue;
      
      const similarity = 1 - searchResults.distances[i];
      if (similarity < minSimilarity) continue;
      
      // Calculate boosts and relevance factors
      const { score, relevanceFactors } = calculateSemanticScore(
        doc, 
        similarity, 
        query, 
        changedFiles
      );
      
      results.push({
        content: doc.pageContent.slice(0, 2000),
        score,
        source: doc.metadata?.source || 'unknown',
        relevanceFactors,
        metadata: doc.metadata
      });
    }
    
    return results;
  } catch (error) {
    logger.warn(`Semantic search failed: ${error}`);
    return [];
  }
}

/**
 * Busca baseada em palavras-chave com TF-IDF simplificado
 */
function performKeywordSearch(
  query: string,
  docs: any[],
  k: number,
  changedFiles: string[],
  contextWindow: number
): RetrievalResult[] {
  const queryWords = query.toLowerCase().split(/\s+/);
  const results: RetrievalResult[] = [];
  
  for (const doc of docs) {
    const content = doc.pageContent.toLowerCase();
    let score = 0;
    const relevanceFactors: string[] = [];
    
    // TF-IDF simplificado
    for (const word of queryWords) {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      const matches = content.match(regex);
      if (matches) {
        const tf = matches.length / content.split(/\s+/).length;
        score += tf * Math.log(docs.length / (docs.filter(d => 
          d.pageContent.toLowerCase().includes(word)).length || 1));
        relevanceFactors.push(`keyword:${word}(${matches.length})`);
      }
    }
    
    // Boost para frase completa
    if (content.includes(query.toLowerCase())) {
      score += 0.5;
      relevanceFactors.push('exact-phrase');
    }
    
    // File boost
    const src = doc.metadata?.source || '';
    const fileBoost = calculateFileBoost(src, changedFiles);
    score += fileBoost;
    if (fileBoost > 0) {
      relevanceFactors.push(`file-priority(+${fileBoost.toFixed(2)})`);
    }
    
    if (score > 0) {
      results.push({
        content: doc.pageContent.slice(0, contextWindow),
        score,
        source: src,
        relevanceFactors,
        metadata: doc.metadata
      });
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Remove resultados duplicados baseado em conteúdo similar
 */
function deduplicateResults(results: RetrievalResult[]): RetrievalResult[] {
  const unique: RetrievalResult[] = [];
  const seenContent = new Set<string>();
  
  for (const result of results) {
    // Usar hash simples do conteúdo para detectar duplicatas
    const contentHash = result.content.slice(0, 200);
    if (!seenContent.has(contentHash)) {
      seenContent.add(contentHash);
      unique.push(result);
    } else {
      // Se encontrar duplicata, manter a de maior score
      const existingIndex = unique.findIndex(u => 
        u.content.slice(0, 200) === contentHash
      );
      if (existingIndex !== -1 && result.score > unique[existingIndex].score) {
        unique[existingIndex] = result;
      }
    }
  }
  
  return unique.sort((a, b) => b.score - a.score);
}

/**
 * Re-ranking usando query-document similarity aprimorada
 */
async function rerankResults(
  results: RetrievalResult[],
  originalQuery: string,
  k: number,
  embedder?: Embeddings
): Promise<RetrievalResult[]> {
  if (!embedder || results.length === 0) {
    return results.slice(0, k);
  }
  
  try {
    // Re-rank baseado em múltiplos fatores
    const rerankedResults = results.map(result => {
      let newScore = result.score;
      
      // Boost para diversidade de sources
      const sourceBonus = calculateSourceDiversityBonus(result, results);
      newScore += sourceBonus;
      
      // Boost para metadados relevantes
      const metadataBonus = calculateMetadataRelevance(result, originalQuery);
      newScore += metadataBonus;
      
      // Penalidade para conteúdo muito curto ou muito longo
      const lengthPenalty = calculateLengthPenalty(result.content);
      newScore -= lengthPenalty;
      
      if (sourceBonus > 0 || metadataBonus > 0 || lengthPenalty > 0) {
        result.relevanceFactors.push(`rerank(+${(sourceBonus + metadataBonus - lengthPenalty).toFixed(3)})`);
      }
      
      return { ...result, score: newScore };
    });
    
    return rerankedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
      
  } catch (error) {
    logger.warn(`Re-ranking failed: ${error}`);
    return results.slice(0, k);
  }
}

/**
 * Calcula score semântico com fatores de relevância
 */
function calculateSemanticScore(
  doc: any,
  similarity: number,
  query: string,
  changedFiles: string[]
): { score: number; relevanceFactors: string[] } {
  let score = similarity;
  const relevanceFactors: string[] = [`semantic(${similarity.toFixed(3)})`];
  
  // File boost
  const src = doc.metadata?.source || '';
  const fileBoost = calculateFileBoost(src, changedFiles);
  score += fileBoost;
  if (fileBoost > 0) {
    relevanceFactors.push(`file-boost(+${fileBoost.toFixed(2)})`);
  }
  
  // Boost para arquivos de configuração/documentação
  if (src.includes('config') || src.includes('README') || src.includes('.md')) {
    score += 0.1;
    relevanceFactors.push('config-docs(+0.1)');
  }
  
  // Boost para código fonte vs outros tipos
  if (src.match(/\.(ts|js|py|java|go|rs|cpp|c|php)$/)) {
    score += 0.05;
    relevanceFactors.push('source-code(+0.05)');
  }
  
  return { score, relevanceFactors };
}

/**
 * Calcula boost baseado em arquivos relacionados
 */
function calculateFileBoost(src: string, changedFiles: string[]): number {
  let boost = 0;
  const hints = new Set(changedFiles.map(f => f.split(path.sep)[0]));
  
  for (const hint of hints) {
    if (src.startsWith(hint + path.sep)) boost += 0.2;
    if (src.includes(hint)) boost += 0.1;
  }
  
  return boost;
}

/**
 * Calcula bonus de diversidade de sources
 */
function calculateSourceDiversityBonus(result: RetrievalResult, allResults: RetrievalResult[]): number {
  const sourceDir = path.dirname(result.source);
  const sameSourceCount = allResults.filter(r => 
    path.dirname(r.source) === sourceDir
  ).length;
  
  // Penalizar se muitos resultados da mesma pasta
  return sameSourceCount > 2 ? -0.05 : 0.02;
}

/**
 * Calcula relevância dos metadados
 */
function calculateMetadataRelevance(result: RetrievalResult, query: string): number {
  let bonus = 0;
  const metadata = result.metadata || {};
  
  // Boost para arquivos com metadata rica
  if (metadata.tags && metadata.tags.length > 0) bonus += 0.02;
  if (metadata.summary) bonus += 0.03;
  if (metadata.lang && ['typescript', 'javascript', 'python'].includes(metadata.lang)) bonus += 0.01;
  
  return bonus;
}

/**
 * Calcula penalidade baseada no comprimento do conteúdo
 */
function calculateLengthPenalty(content: string): number {
  const length = content.length;
  
  // Penalizar conteúdo muito curto (< 100 chars) ou muito longo (> 3000 chars)
  if (length < 100) return 0.05;
  if (length > 3000) return 0.02;
  
  return 0;
}

/**
 * Calcula métricas de qualidade dos resultados
 */
function calculateQualityMetrics(
  results: RetrievalResult[],
  query: string
): { diversityScore: number; coverageScore: number; confidenceLevel: 'low' | 'medium' | 'high' } {
  if (results.length === 0) {
    return { diversityScore: 0, coverageScore: 0, confidenceLevel: 'low' };
  }
  
  // Diversidade: quantos diretórios diferentes
  const uniqueDirectories = new Set(results.map(r => path.dirname(r.source))).size;
  const diversityScore = uniqueDirectories / results.length;
  
  // Cobertura: média dos scores
  const averageScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const coverageScore = Math.min(averageScore, 1.0);
  
  // Nível de confiança baseado em score e quantidade
  let confidenceLevel: 'low' | 'medium' | 'high' = 'low';
  if (averageScore > 0.7 && results.length >= 3) confidenceLevel = 'high';
  else if (averageScore > 0.5 && results.length >= 2) confidenceLevel = 'medium';
  
  return { diversityScore, coverageScore, confidenceLevel };
}

/**
 * Descreve a estratégia de retrieval usada
 */
function getStrategyDescription(
  useHybrid: boolean,
  useQueryExpansion: boolean,
  useReranking: boolean
): string {
  const strategies = [];
  if (useQueryExpansion) strategies.push('query-expansion');
  strategies.push('semantic-search');
  if (useHybrid) strategies.push('keyword-search');
  if (useReranking) strategies.push('advanced-reranking');
  
  return strategies.join(' + ');
}