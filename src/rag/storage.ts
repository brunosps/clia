/**
 * Sistema de storage e persistência para RAG
 * Usando HNSWLib com JSON metadata para simplicidade
 */

import { readdirSync, statSync } from 'fs';
import { getLogger } from '../shared/logger.js';
import * as fs from 'fs';

const logger = getLogger();
import path from 'path';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';

export interface RagDocument {
  id: string;
  pageContent: string;
  metadata: {
    path: string;
    relPath: string;
    mtime: string;
    lang: string;
    lines?: string;
    hash: string;
    tags?: string[];
    summary?: string;
  };
}

export interface CorpusManifest {
  embedder: string;
  chunkSize: number;
  chunkOverlap: number;
  docCount: number;
  updatedAt: string;
  excludes: string[];
  paths: string[];
  enableDocProfile?: boolean;
}

export interface ChunkMetadataEntry {
  id: string;
  path: string;
  relPath: string;
  mtime: string;
  lang: string;
  lines?: string;
  hash: string;
  tags?: string[];
  summary?: string;
}

/**
 * Cria hash do conteúdo para detecção de mudanças
 */
export function createContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Garante que o diretório RAG existe
 */
export function ensureRagDirectory(baseDir: string): string {
  const ragDir = path.join(baseDir, '.clia', 'rag');
  const hnswDir = path.join(ragDir, 'hnswlib');
  
  fs.mkdirSync(ragDir, { recursive: true });
  fs.mkdirSync(hnswDir, { recursive: true });
  
  return ragDir;
}

/**
 * Carrega o manifest do corpus
 */
export function loadCorpusManifest(ragDir: string): CorpusManifest | null {
  const manifestPath = path.join(ragDir, 'corpus-manifest.json');
  
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Salva o manifest do corpus
 */
export function saveCorpusManifest(ragDir: string, manifest: CorpusManifest): void {
  const manifestPath = path.join(ragDir, 'corpus-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Carrega metadata dos chunks (JSONL)
 */
export function loadChunkMetadata(ragDir: string): Map<string, ChunkMetadataEntry> {
  const metadataPath = path.join(ragDir, 'chunk-metadata.jsonl');
  const metadata = new Map<string, ChunkMetadataEntry>();
  
  if (!fs.existsSync(metadataPath)) {
    return metadata;
  }
  
  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const entry: ChunkMetadataEntry = JSON.parse(line);
      metadata.set(entry.id, entry);
    }
  } catch (error) {
    logger.warn('  Erro ao carregar chunk metadata:', error);
  }
  
  return metadata;
}

/**
 * Salva metadata dos chunks (JSONL)
 */
export function saveChunkMetadata(ragDir: string, metadata: Map<string, ChunkMetadataEntry>): void {
  const metadataPath = path.join(ragDir, 'chunk-metadata.jsonl');
  
  const lines = Array.from(metadata.values()).map(entry => JSON.stringify(entry));
  fs.writeFileSync(metadataPath, lines.join('\n') + '\n');
}

/**
 * Carrega documentos do storage simples (compatibilidade)
 */
export function loadDocuments(ragDir: string): RagDocument[] {
  const docsPath = path.join(ragDir, 'hnswlib', 'docs.json');
  
  if (!fs.existsSync(docsPath)) {
    return [];
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
    
    // Compatibilidade com formato antigo
    if (Array.isArray(data)) {
      return data;
    }
    
    return data.documents || [];
  } catch {
    return [];
  }
}

/**
 * Salva documentos (formato simples para compatibilidade)
 */
export function saveDocuments(ragDir: string, documents: RagDocument[]): void {
  const docsPath = path.join(ragDir, 'hnswlib', 'docs.json');
  
  const data = {
    documents,
    totalDocs: documents.length,
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync(docsPath, JSON.stringify(data, null, 2));
}

/**
 * Salva última resposta para debug
 */
export function saveLastAnswer(ragDir: string, query: string, answer: string, references: Array<{source: string, lines?: string}>): void {
  const answerPath = path.join(ragDir, 'last-answer.md');
  
  const content = `# Última Consulta RAG

**Query:** ${query}
**Timestamp:** ${new Date().toISOString()}

## Resposta

${answer}

## Referências

${references.map(ref => `- \`${ref.source}\`${ref.lines ? `:${ref.lines}` : ''}`).join('\n')}
`;
  
  fs.writeFileSync(answerPath, content);
}

/**
 * Verifica se arquivo mudou comparando hash
 */
export function hasFileChanged(filePath: string, oldHash: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const newHash = createContentHash(content);
    return newHash !== oldHash;
  } catch {
    return true; // Se não conseguiu ler, assume que mudou
  }
}

/**
 * Lista arquivos que mudaram desde última indexação
 */
export function getChangedFiles(baseDir: string, ragDir: string, filePaths: string[]): {changed: string[], removed: string[]} {
  const metadata = loadChunkMetadata(ragDir);
  const existingFiles = new Set<string>();
  
  // Mapeia arquivos existentes no índice
  for (const entry of metadata.values()) {
    existingFiles.add(entry.path);
  }
  
  const changed: string[] = [];
  const currentFiles = new Set(filePaths);
  
  // Verifica arquivos que mudaram
  for (const filePath of filePaths) {
    const relPath = path.relative(baseDir, filePath);
    let hasChanged = true;
    
    // Procura entrada existente para este arquivo
    for (const entry of metadata.values()) {
      if (entry.relPath === relPath) {
        hasChanged = hasFileChanged(filePath, entry.hash);
        break;
      }
    }
    
    if (hasChanged) {
      changed.push(filePath);
    }
  }
  
  // Verifica arquivos removidos
  const removed = Array.from(existingFiles).filter(filePath => 
    !currentFiles.has(filePath)
  );
  
  return { changed, removed };
}

/**
 * Remove entradas de arquivos deletados
 */
export function removeDeletedFiles(ragDir: string, removedFiles: string[]): void {
  if (removedFiles.length === 0) return;
  
  const metadata = loadChunkMetadata(ragDir);
  const documents = loadDocuments(ragDir);
  
  // Remove metadata
  const idsToRemove = new Set<string>();
  for (const [id, entry] of metadata.entries()) {
    if (removedFiles.includes(entry.path)) {
      metadata.delete(id);
      idsToRemove.add(id);
    }
  }
  
  // Remove documentos
  const filteredDocs = documents.filter(doc => !idsToRemove.has(doc.id));
  
  // Salva mudanças
  saveChunkMetadata(ragDir, metadata);
  saveDocuments(ragDir, filteredDocs);
  
  logger.info(`  Removidos ${idsToRemove.size} chunks de ${removedFiles.length} arquivos deletados`);
}