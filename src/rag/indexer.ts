/**
 * Pipeline de indexação RAG seguindo especificação GPT-5
 * Inclui chunking inteligente, perfil de documentos e indexação incremental
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { v4 as uuid } from 'uuid';
import { minimatch } from 'minimatch';
import type { LLM } from '../llm/provider.js';
import type { Embeddings } from '../embeddings/provider.js';
import { smartChunk, detectLanguage } from './chunker.js';
import { getLogger } from '../shared/logger.js';
import {
  ensureRagDirectory,
  loadCorpusManifest,
  saveCorpusManifest,
  loadChunkMetadata,
  saveChunkMetadata,
  loadDocuments,
  saveDocuments,
  createContentHash,
  getChangedFiles,
  removeDeletedFiles,
  type CorpusManifest,
  type RagDocument,
  type ChunkMetadataEntry,
} from './storage.js';

// Initialize logger
const logger = getLogger();

interface DocumentProfile {
  summary: string;
  tags: string[];
  complexity: 'low' | 'medium' | 'high';
  keyComponents: string[];
  relationships: string[];
}

function createDocumentProfilePrompt(
  filePath: string,
  language: string,
  content: string
): string {
  return `Analyze this ${language} file and generate a JSON profile:

File: ${filePath}
Content preview: ${content.slice(0, 2000)}...

Generate JSON with this structure:
{
  "summary": "Brief description of file purpose",
  "tags": ["tag1", "tag2"],
  "complexity": "low|medium|high",
  "keyComponents": ["function1", "class1"],
  "relationships": ["depends on X", "used by Y"]
}`;
}

export interface IndexingOptions {
  paths: string[];
  excludeGlobs: string[];
  chunkSize: number;
  chunkOverlap: number;
  enableDocProfile: boolean;
  incremental: boolean;
}

export interface IndexingResult {
  totalFiles: number;
  processedFiles: number;
  totalChunks: number;
  newChunks: number;
  removedChunks: number;
  skippedFiles: number;
  duration: number;
}

/**
 * Merge de padrões de exclusão usando dados reais dinâmicos
 * Segue o princípio: "100% real data via MCP integration - Zero simulations"
 * Integra com project-inspection.json para exclusões descobertas dinamicamente
 */
export function mergeExcludes(config: any, scopeMap?: any): string[] {
  const excludes: string[] = [];

  // 1. deterministicIgnoreGlobs do config
  if (config.inspect?.deterministicIgnoreGlobs) {
    excludes.push(...config.inspect.deterministicIgnoreGlobs);
  }

  // 2. rag.excludeGlobs do config
  if (config.rag?.excludeGlobs) {
    excludes.push(...config.rag.excludeGlobs);
  }

  // 3. ragIgnoreGlobs do scope-map (chave principal)
  if (scopeMap?.ragIgnoreGlobs) {
    excludes.push(...scopeMap.ragIgnoreGlobs);
  }

  // 4. DADOS REAIS: Carregar exclusões do project-inspection.json
  const projectInspectionExcludes = loadProjectInspectionExcludes();
  if (projectInspectionExcludes.length > 0) {
    excludes.push(...projectInspectionExcludes);
  }

  // 5. Filtros binários padrão e diretórios do sistema
  const systemExclusions = [
    // Arquivos binários
    '**/*.png',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.gif',
    '**/*.bmp',
    '**/*.svg',
    '**/*.pdf',
    '**/*.zip',
    '**/*.tar',
    '**/*.gz',
    '**/*.rar',
    '**/*.7z',
    '**/*.mp3',
    '**/*.mp4',
    '**/*.avi',
    '**/*.mov',
    '**/*.wmv',
    '**/*.exe',
    '**/*.bin',
    '**/*.dll',
    '**/*.so',
    '**/*.dylib',
    '**/*.ico',
    '**/*.woff',
    '**/*.woff2',
    '**/*.ttf',
    '**/*.eot',
    // Diretórios do sistema CLIA
    '.clia',
    '.clia/**',
    '**/.clia/**',
  ];

  excludes.push(...systemExclusions);

  // Remove duplicatas
  return [...new Set(excludes)];
}

/**
 * Carrega exclusões reais do arquivo project-inspection.json
 * Retorna dados descobertos dinamicamente pelo sistema inspect
 */
function loadProjectInspectionExcludes(): string[] {
  try {
    const projectInspectionPath = path.join(
      process.cwd(),
      '.clia',
      'project-inspection.json'
    );

    if (!fs.existsSync(projectInspectionPath)) {
      return [];
    }

    const inspectionData = JSON.parse(
      fs.readFileSync(projectInspectionPath, 'utf-8')
    );
    const excludes: string[] = [];

    // Exclusões de estrutura de diretório descobertas
    if (inspectionData.ragOptimization?.directoryStructure?.excludePaths) {
      excludes.push(
        ...inspectionData.ragOptimization.directoryStructure.excludePaths
      );
    }

    // Padrões de arquivo descobertos
    if (inspectionData.ragOptimization?.filePatterns?.exclude) {
      excludes.push(...inspectionData.ragOptimization.filePatterns.exclude);
    }

    // Exclusões específicas por linguagem descobertas
    if (inspectionData.ragOptimization?.languageSpecificExclusions) {
      const langExclusions =
        inspectionData.ragOptimization.languageSpecificExclusions;
      for (const lang of Object.keys(langExclusions)) {
        if (Array.isArray(langExclusions[lang])) {
          excludes.push(...langExclusions[lang]);
        }
      }
    }

    return excludes;
  } catch (error) {
    // Se não conseguir carregar, retorna array vazio (não falha o sistema)
    return [];
  }
}

// Expande um padrao em multiplas variacoes para glob
function expandOnePattern(raw: string): string[] {
  const p = toPosix(raw.trim());
  if (!p) return [];

  const hasGlob = /[*?[\]{}()!]/.test(p);
  const isDirLike = !p.includes('.') && !hasGlob; // directory heuristic
  const isFileName = p.startsWith('.') || (!hasGlob && p.includes('.')); // file heuristic

  if (hasGlob) {
    // já é glob; se começa com "*", prefixa para casar em subpastas
    return p.startsWith('*') ? [`**/${p}`, p] : [p];
  }

  if (isDirLike) {
    return [
      `**/${p}/**`,
      `${p}/**`,
      `**/${p}`,
      p, // por via das dúvidas
    ];
  }

  if (isFileName) {
    return [`**/${p}`, p];
  }

  // fallback: trate como diretório
  return [`**/${p}/**`, `${p}/**`, `**/${p}`, p];
}

/**
 * Normaliza + expande uma lista de padrões para máxima robustez
 */
function buildIgnorePatterns(excludes: string[]): string[] {
  const out: string[] = [];
  for (const raw of excludes) {
    for (const pat of expandOnePattern(raw)) out.push(pat);
  }
  // remove vazios/duplicatas
  return Array.from(new Set(out.filter(Boolean)));
}

/** Converte caminho para estilo POSIX (/, não \) */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Filtro ultra-rápido por segmentos de caminho:
 * ignora qualquer arquivo cujo caminho contenha um segmento exatamente igual
 * a um dos nomes excluídos (ex.: "node_modules", ".next", "dist"...).
 */
function shouldSkipBySegments(
  absPath: string,
  baseDir: string,
  excludedNames: Set<string>
): boolean {
  const rel = toPosix(path.relative(baseDir, absPath));
  const segments = rel.split('/').filter(Boolean);
  
  for (const seg of segments) {
    if (excludedNames.has(seg)) return true;
    if (excludedNames.has(`${seg}/*`) || excludedNames.has(`${seg}/**`)) return true;
    
    // Hardcode para .git que deve sempre ser excluído
    if (seg.includes('.git/')) return true;
  }
  return false;
}

/** Verifica se um caminho relativo bate em algum padrão minimatch (com dot: true) */
function isExcludedByPatterns(
  relPosixPath: string,
  patterns: string[]
): boolean {
  return patterns.some((pattern) =>
    minimatch(relPosixPath, pattern, { dot: true })
  );
}

/** Lê rapidamente um trecho para detectar se é binário (presença de \0) */
function isTextFileSync(absPath: string): boolean {
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      const buf = Buffer.alloc(1024);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      const slice = buf.subarray(0, bytes).toString('utf8');
      return !slice.includes('\0');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Descobre arquivos de texto respeitando paths e exclusões (robusto p/ .next, node_modules, etc.)
 *
 * @param baseDir Diretório base (ex.: process.cwd())
 * @param paths Caminhos a pesquisar (ex.: [".","src","README.md"])
 * @param excludes Padrões/nomes a excluir (ex.: ["public","node_modules",".next","build","dist",".env","*.log"])
 */
export async function discoverFiles(
  baseDir: string,
  paths: string[],
  excludes: string[]
): Promise<string[]> {
  const baseAbs = path.resolve(baseDir);

  // 1) Conjuntos derivados para filtros rápidos
  const excludedNames = new Set(
    excludes.map((e) => toPosix(e.trim())).filter(Boolean)
  );

  for (const e of [...excludedNames]) {
    if (/[*?[\]{}()!]/.test(e)) continue; // tem glob -> ignora
    const bn = e.split('/').filter(Boolean).pop();
    if (bn && bn !== e) excludedNames.add(bn);
  }

  // 2) Padrões de ignore para glob/minimatch
  const ignorePatterns = buildIgnorePatterns(excludes);

  // Log dos padrões aplicados para debugging
  logger.info(`Applying ${ignorePatterns.length} expanded ignore patterns`);
  if (logger.getLevel() === 'debug') {
    logger.debug(
      'Ignore patterns:',
      ignorePatterns.slice(0, 10).join(', ') +
        (ignorePatterns.length > 10 ? '...' : '')
    );
  }

  const collected: string[] = [];

  for (const searchPath of paths) {
    const absCandidate = path.resolve(baseAbs, searchPath);

    if (shouldSkipBySegments(absCandidate, baseAbs, excludedNames)) {
      continue;
    }

    try {
      const st = await fs.promises.stat(absCandidate).catch(() => null);

      if (st && st.isFile()) {
        const rel = toPosix(path.relative(baseAbs, absCandidate));
        if (
          !shouldSkipBySegments(absCandidate, baseAbs, excludedNames) &&
          !isExcludedByPatterns(rel, ignorePatterns)
        ) {
          collected.push(absCandidate);
        }
        continue;
      }

      // Diretório ou inexistente: usa glob a partir de baseDir
      const relInput = toPosix(path.relative(baseAbs, absCandidate));
      const safeRel = relInput && relInput !== '.' ? relInput : '';
      const patternPosix = safeRel ? `${safeRel}/**/*.*` : `**/*.*`;

      const files = await glob(patternPosix, {
        cwd: baseAbs,
        ignore: ignorePatterns,
        absolute: true,
        nodir: true,
        dot: true,
        follow: false,
      });

      for (const abs of files) {
        // Short-circuit por segmentos (barato)
        if (shouldSkipBySegments(abs, baseAbs, excludedNames)) continue;

        const rel = toPosix(path.relative(baseAbs, abs));
        if (isExcludedByPatterns(rel, ignorePatterns)) continue;

        collected.push(abs);
      }
    } catch (err) {
      logger.warn(`discoverFiles: erro ao varrer "${searchPath}":`, err);
    }
  }

  // Mantém só arquivos de texto (antes das duplicatas p/ evitar IO desnecessário)
  const textFiles = collected.filter((abs) => isTextFileSync(abs));

  // Remove duplicatas
  return Array.from(new Set(textFiles));
}

/**
 * Gera perfil do documento usando LLM basic
 */
export async function generateDocumentProfile(
  filePath: string,
  content: string,
  llm: LLM
): Promise<DocumentProfile | null> {
  try {
    const relPath = path.relative(process.cwd(), filePath);
    const lang = detectLanguage(filePath);
    const prompt = createDocumentProfilePrompt(relPath, lang, content);

    const response = await llm.chat(prompt);

    // Parse da resposta JSON
    const match = response.match(/\{[^}]+\}/s);
    if (match) {
      const profile: DocumentProfile = JSON.parse(match[0]);

      // Validação básica
      if (profile.tags && Array.isArray(profile.tags) && profile.summary) {
        return profile;
      }
    }
  } catch (error) {
    logger.warn(`Error generating profile for ${filePath}:`, error);
  }

  return null;
}

/**
 * Processa um arquivo individual
 */
export async function processFile(
  filePath: string,
  baseDir: string,
  options: IndexingOptions,
  llm?: LLM
): Promise<RagDocument[]> {
  const relPath = path.relative(baseDir, filePath);
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const hash = createContentHash(content);
  const lang = detectLanguage(filePath);

  // Gerar perfil do documento se habilitado
  let profile: DocumentProfile | null = null;
  if (options.enableDocProfile && llm) {
    profile = await generateDocumentProfile(filePath, content, llm);
  }

  // Chunking inteligente
  const chunks = smartChunk(
    content,
    filePath,
    options.chunkSize,
    options.chunkOverlap
  );

  // Criar documentos
  const documents: RagDocument[] = [];

  for (const chunk of chunks) {
    const doc: RagDocument = {
      id: uuid(),
      pageContent: chunk.content,
      metadata: {
        path: filePath,
        relPath,
        mtime: stat.mtime.toISOString(),
        lang,
        lines: chunk.lines,
        hash,
        tags: profile?.tags,
        summary: profile?.summary,
      },
    };

    documents.push(doc);
  }

  return documents;
}

/**
 * Pipeline principal de indexação
 */
export async function buildIndex(
  baseDir: string,
  options: IndexingOptions,
  embedder: Embeddings,
  llms?: { basic: LLM; default: LLM; premium: LLM },
  config?: any
): Promise<IndexingResult> {
  const startTime = Date.now();
  const ragDir = ensureRagDirectory(baseDir);

  logger.info('Starting RAG indexing pipeline...');

  // Carregar scope-map se disponível
  let scopeMap: any = null;
  const scopeMapPath = path.join(baseDir, '.clia', 'scope-map.json');
  if (fs.existsSync(scopeMapPath)) {
    try {
      scopeMap = JSON.parse(fs.readFileSync(scopeMapPath, 'utf-8'));
      logger.info(
        `Loaded scope-map.json with ${scopeMap.ragIgnoreGlobs?.length || 0} ignore patterns`
      );
    } catch (error) {
      logger.warn('Error loading scope-map.json:', error);
    }
  }

  // Merge de excludes
  const excludes = mergeExcludes(config || {}, scopeMap);
  logger.info(`Applying ${excludes.length} exclusion patterns`);

  // Descoberta de arquivos
  const allFiles = await discoverFiles(baseDir, options.paths, excludes);
  logger.info(`Discovered ${allFiles.length} files for processing`);

  if (allFiles.length === 0) {
    logger.warn('No files found to index');
    return {
      totalFiles: 0,
      processedFiles: 0,
      totalChunks: 0,
      newChunks: 0,
      removedChunks: 0,
      skippedFiles: 0,
      duration: Date.now() - startTime,
    };
  }

  // Verificar arquivos que mudaram (incremental)
  let filesToProcess = allFiles;
  let skippedFiles = 0;

  if (options.incremental) {
    const { changed, removed } = getChangedFiles(baseDir, ragDir, allFiles);

    if (removed.length > 0) {
      logger.info(`Removing ${removed.length} deleted files...`);
      removeDeletedFiles(ragDir, removed);
    }

    filesToProcess = changed;
    skippedFiles = allFiles.length - changed.length;

    if (skippedFiles > 0) {
      logger.info(`Skipping ${skippedFiles} unmodified files`);
    }
  }

  // Processar arquivos
  const allDocuments: RagDocument[] = [];
  let processedFiles = 0;

  for (const filePath of filesToProcess) {
    try {
      let llmForProfile: LLM | undefined;

      // Usar LLM para perfil de documento se habilitado
      if (options.enableDocProfile && llms) {
        llmForProfile = llms.basic;
      }

      const docs = await processFile(filePath, baseDir, options, llmForProfile);
      allDocuments.push(...docs);
      processedFiles++;

      if (processedFiles % 10 === 0) {
        logger.info(
          `Processed ${processedFiles}/${filesToProcess.length} files...`
        );
      }
    } catch (error) {
      logger.warn(`Error processing ${filePath}:`, error);
    }
  }

  // Se modo incremental, combinar com documentos existentes
  if (options.incremental) {
    const existingDocs = loadDocuments(ragDir);
    const existingFromUnchanged = existingDocs.filter(
      (doc) => !filesToProcess.includes(doc.metadata.path)
    );

    allDocuments.push(...existingFromUnchanged);
    logger.info(
      `Incremental mode: ${existingFromUnchanged.length} existing chunks preserved`
    );
  }

  // Salvar documentos
  saveDocuments(ragDir, allDocuments);

  // Salvar metadata dos chunks
  const metadata = new Map<string, ChunkMetadataEntry>();
  for (const doc of allDocuments) {
    metadata.set(doc.id, {
      id: doc.id,
      path: doc.metadata.path,
      relPath: doc.metadata.relPath,
      mtime: doc.metadata.mtime,
      lang: doc.metadata.lang,
      lines: doc.metadata.lines,
      hash: doc.metadata.hash,
      tags: doc.metadata.tags,
      summary: doc.metadata.summary,
    });
  }
  saveChunkMetadata(ragDir, metadata);

  // Salvar manifest
  const manifest: CorpusManifest = {
    embedder: embedder.name,
    chunkSize: options.chunkSize,
    chunkOverlap: options.chunkOverlap,
    docCount: allDocuments.length,
    updatedAt: new Date().toISOString(),
    excludes,
    paths: options.paths,
    enableDocProfile: options.enableDocProfile,
  };
  saveCorpusManifest(ragDir, manifest);

  const duration = Date.now() - startTime;
  const newChunks =
    filesToProcess.length > 0
      ? allDocuments.filter((doc) => filesToProcess.includes(doc.metadata.path))
          .length
      : 0;

  logger.info(`Indexing completed in ${(duration / 1000).toFixed(1)}s`);
  logger.info(
    `Total: ${allDocuments.length} chunks, ${processedFiles} files processed`
  );
  logger.info(`Embedder: ${embedder.name}`);

  if (options.enableDocProfile) {
    const profiledFiles = allDocuments.filter(
      (doc) => doc.metadata.tags
    ).length;
    logger.info(`Profiles generated: ${profiledFiles} files`);
  }

  return {
    totalFiles: allFiles.length,
    processedFiles,
    totalChunks: allDocuments.length,
    newChunks,
    removedChunks: 0, // TODO: implementar contagem precisa
    skippedFiles,
    duration,
  };
}
