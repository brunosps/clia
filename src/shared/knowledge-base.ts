import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getLogger } from './logger.js';

const logger = getLogger();

interface SourceAnalysis {
  hash: string;
  content: string;
  updatedAt: string;
}

interface KnowledgeBaseData {
  sources: Record<string, SourceAnalysis>;
}

export class KnowledgeBase {
  private baseDir: string;
  private knowledgeBasePath: string;
  private data: KnowledgeBaseData;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.knowledgeBasePath = path.join(baseDir, '.clia', 'knowledge-base.json');
    this.data = this.loadKnowledgeBase();
  }

  /**
   * Carrega a base de conhecimento do arquivo JSON
   */
  private loadKnowledgeBase(): KnowledgeBaseData {
    try {
      if (fs.existsSync(this.knowledgeBasePath)) {
        const rawData = fs.readFileSync(this.knowledgeBasePath, 'utf-8');
        return JSON.parse(rawData);
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to load knowledge base: ${error}`);
    }

    return { sources: {} };
  }

  /**
   * Salva a base de conhecimento no arquivo JSON
   */
  private saveKnowledgeBase(): void {
    try {
      const cliaDir = path.dirname(this.knowledgeBasePath);
      if (!fs.existsSync(cliaDir)) {
        fs.mkdirSync(cliaDir, { recursive: true });
      }

      fs.writeFileSync(
        this.knowledgeBasePath,
        JSON.stringify(this.data, null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.error(`❌ Failed to save knowledge base: ${error}`);
    }
  }

  /**
   * Calcula o hash MD5 do conteúdo de um arquivo
   */
  private calculateFileHash(filePath: string): string {
    try {
      const absolutePath = path.resolve(this.baseDir, filePath);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${absolutePath}`);
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');
      return crypto.createHash('md5').update(content).digest('hex');
    } catch (error) {
      logger.warn(`⚠️ Failed to calculate hash for ${filePath}: ${error}`);
      return '';
    }
  }

  /**
   * Verifica se um arquivo precisa ser analisado/atualizado
   */
  private needsUpdate(filePath: string): boolean {
    const currentHash = this.calculateFileHash(filePath);
    const existingAnalysis = this.data.sources[filePath];

    if (!existingAnalysis) {
      logger.debug(`📄 New file detected: ${filePath}`);
      return true;
    }

    if (existingAnalysis.hash !== currentHash) {
      logger.debug(`🔄 File modified: ${filePath}`);
      return true;
    }

    logger.debug(`✅ File up-to-date: ${filePath}`);
    return false;
  }

  /**
   * Obtém a análise de um arquivo da base de conhecimento
   * Se o arquivo foi modificado ou não existe, realiza nova análise
   */
  async getSourceAnalysis(
    filePath: string, 
    analysisFunction?: (question: string, options: any) => Promise<{ answer: string }>
  ): Promise<string> {
    const normalizedPath = filePath.startsWith(this.baseDir)
      ? path.relative(this.baseDir, filePath)
      : filePath;

    if (!this.needsUpdate(normalizedPath)) {
      logger.debug(`🧠 Using cached analysis for: ${normalizedPath}`);
      return this.data.sources[normalizedPath].content;
    }

    // Se não há função de análise, retorna análise existente ou erro
    if (!analysisFunction) {
      if (this.data.sources[normalizedPath]) {
        logger.warn(`⚠️ No analysis function provided, using stale analysis for: ${normalizedPath}`);
        return this.data.sources[normalizedPath].content;
      } else {
        logger.error(`❌ No analysis function provided and no cached analysis for: ${normalizedPath}`);
        return `Error: No analysis available for ${normalizedPath}`;
      }
    }

    logger.info(`🔍 Analyzing source file: ${normalizedPath}`);

    try {
      const baseQuestion = `What does the source file '${normalizedPath}' do?`;
      const question = `${baseQuestion} Please provide a comprehensive analysis including:
        - Main purpose and core functionality
        - Key classes, functions, interfaces, and their relationships
        - Dependencies, imports, and external libraries used
        - Role within the project architecture and module interactions
        - Design patterns, coding conventions, and architectural decisions
        - Performance considerations and optimization opportunities
        - Potential refactoring suggestions or code improvements
        - Security considerations if applicable
        - Testing coverage and testability aspects`;

      const result = await analysisFunction(question, { projectOnly: true });
      const currentHash = this.calculateFileHash(normalizedPath);

      this.data.sources[normalizedPath] = {
        hash: currentHash,
        content: result.answer,
        updatedAt: new Date().toISOString(),
      };

      this.saveKnowledgeBase();

      logger.debug(`✅ Analysis updated for: ${normalizedPath}`);
      return result.answer;
    } catch (error) {
      logger.error(`❌ Failed to analyze ${normalizedPath}: ${error}`);

      // Retorna análise existente se houver erro na nova análise
      if (this.data.sources[normalizedPath]) {
        logger.warn(`⚠️ Using stale analysis for: ${normalizedPath}`);
        return this.data.sources[normalizedPath].content;
      }

      return `Error analyzing file ${normalizedPath}: ${error}`;
    }
  }

  /**
   * Atualiza múltiplos arquivos baseado na inspeção do projeto
   * Utiliza o mesmo padrão do RAG index para descobrir arquivos
   */
  async updateFromProjectInspection(
    analysisFunction?: (question: string, options: any) => Promise<{ answer: string }>
  ): Promise<{ updated: number; total: number; errors: string[] }> {
    const projectInspectionPath = path.join(
      this.baseDir,
      '.clia',
      'project-inspection.json'
    );

    let filesToAnalyze: string[] = [];
    const errors: string[] = [];

    try {
      if (fs.existsSync(projectInspectionPath)) {
        const inspection = JSON.parse(
          fs.readFileSync(projectInspectionPath, 'utf-8')
        );

        // Usar caminhos otimizados da inspeção se disponível
        if (inspection.directoryStructure?.includePaths?.length > 0) {
          const includePaths = inspection.directoryStructure.includePaths;
          const excludePaths =
            inspection.directoryStructure?.excludePaths || [];

          logger.info(`📁 Using optimized paths: ${includePaths.join(', ')}`);

          // Encontrar arquivos usando os padrões da inspeção
          filesToAnalyze = this.findSourceFiles(includePaths, excludePaths);
        } else {
          // Fallback para padrões padrão
          filesToAnalyze = this.findSourceFiles(
            ['src/', 'lib/', 'app/'],
            ['node_modules/', '.next/', 'dist/']
          );
        }
      } else {
        logger.warn('⚠️ Project inspection not found, using default patterns');
        filesToAnalyze = this.findSourceFiles(
          ['src/', 'lib/', 'app/'],
          ['node_modules/', '.next/', 'dist/']
        );
      }
    } catch (error) {
      errors.push(`Failed to load project inspection: ${error}`);
      logger.error(`❌ ${errors[errors.length - 1]}`);
      return { updated: 0, total: 0, errors };
    }

    logger.info(`🔍 Found ${filesToAnalyze.length} source files to process`);

    // Filtrar apenas arquivos que precisam de atualização
    const filesToUpdate = filesToAnalyze.filter((file) =>
      this.needsUpdate(file)
    );

    logger.info(`📝 ${filesToUpdate.length} files need analysis/update`);

    let updated = 0;

    // Processar arquivos em lotes para evitar sobrecarga
    const batchSize = 5;
    for (let i = 0; i < filesToUpdate.length; i += batchSize) {
      const batch = filesToUpdate.slice(i, i + batchSize);

      logger.info(
        `📊 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filesToUpdate.length / batchSize)}: ${batch.length} files`
      );

      const batchPromises = batch.map(async (filePath) => {
        try {
          await this.getSourceAnalysis(filePath, analysisFunction);
          updated++;
          return true;
        } catch (error) {
          const errorMsg = `Failed to analyze ${filePath}: ${error}`;
          errors.push(errorMsg);
          logger.error(`❌ ${errorMsg}`);
          return false;
        }
      });

      await Promise.allSettled(batchPromises);

      // Pequena pausa entre lotes para evitar saturar o LLM
      if (i + batchSize < filesToUpdate.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    logger.info(
      `✅ Knowledge base update complete: ${updated}/${filesToUpdate.length} files processed successfully`
    );

    return {
      updated,
      total: filesToAnalyze.length,
      errors,
    };
  }

  /**
   * Encontra arquivos de código-fonte no projeto
   */
  private findSourceFiles(
    includePaths: string[],
    excludePaths: string[]
  ): string[] {
    const files: string[] = [];

    const sourceExtensions = [
      '.ts',
      '.js',
      '.tsx',
      '.jsx',
      '.vue',
      '.svelte',
      '.py',
      '.java',
      '.cs',
      '.go',
      '.rs',
      '.php',
      '.rb',
      '.c',
      '.cpp',
      '.h',
      '.hpp',
    ];

    const walkDir = (dirPath: string, relativePath: string = ''): void => {
      try {
        const fullPath = path.join(this.baseDir, dirPath);
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
          return;
        }

        const entries = fs.readdirSync(fullPath);

        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry);
          const relativeEntryPath = path.join(relativePath, entry);
          const fullEntryPath = path.join(this.baseDir, entryPath);

          // Verificar se deve excluir
          if (
            excludePaths.some(
              (exclude) =>
                entryPath.includes(exclude) ||
                relativeEntryPath.includes(exclude)
            )
          ) {
            continue;
          }

          const stat = fs.statSync(fullEntryPath);

          if (stat.isDirectory()) {
            walkDir(entryPath, relativeEntryPath);
          } else if (stat.isFile()) {
            const ext = path.extname(entry);
            if (sourceExtensions.includes(ext)) {
              files.push(entryPath);
            }
          }
        }
      } catch (error) {
        logger.warn(`⚠️ Error walking directory ${dirPath}: ${error}`);
      }
    };

    for (const includePath of includePaths) {
      walkDir(includePath);
    }

    return files;
  }

  /**
   * Limpa entradas obsoletas da base de conhecimento
   */
  cleanupObsoleteEntries(): number {
    let removed = 0;

    for (const filePath of Object.keys(this.data.sources)) {
      const fullPath = path.join(this.baseDir, filePath);
      if (!fs.existsSync(fullPath)) {
        delete this.data.sources[filePath];
        removed++;
        logger.debug(`🗑️ Removed obsolete entry: ${filePath}`);
      }
    }

    if (removed > 0) {
      this.saveKnowledgeBase();
      logger.info(`🧹 Cleaned up ${removed} obsolete entries`);
    }

    return removed;
  }

  /**
   * Obtém estatísticas da base de conhecimento
   */
  getStats(): {
    totalEntries: number;
    lastUpdate: string | null;
    sizeOnDisk: number;
  } {
    const totalEntries = Object.keys(this.data.sources).length;

    let lastUpdate: string | null = null;
    for (const analysis of Object.values(this.data.sources)) {
      if (!lastUpdate || analysis.updatedAt > lastUpdate) {
        lastUpdate = analysis.updatedAt;
      }
    }

    let sizeOnDisk = 0;
    try {
      if (fs.existsSync(this.knowledgeBasePath)) {
        sizeOnDisk = fs.statSync(this.knowledgeBasePath).size;
      }
    } catch (error) {
      // Ignora erro de tamanho
    }

    return {
      totalEntries,
      lastUpdate,
      sizeOnDisk,
    };
  }
}

/**
 * Instância global da base de conhecimento
 */
let globalKnowledgeBase: KnowledgeBase | null = null;

/**
 * Obtém a instância global da base de conhecimento
 */
export function getKnowledgeBase(
  baseDir: string = process.cwd()
): KnowledgeBase {
  if (!globalKnowledgeBase || globalKnowledgeBase['baseDir'] !== baseDir) {
    globalKnowledgeBase = new KnowledgeBase(baseDir);
  }
  return globalKnowledgeBase;
}

/**
 * Função conveniente para obter análise de arquivo com cache
 */
export async function getSourceAnalysis(
  filePath: string,
  analysisFunction?: (question: string, options: any) => Promise<{ answer: string }>,
  baseDir: string = process.cwd()
): Promise<string> {
  const knowledgeBase = getKnowledgeBase(baseDir);
  return await knowledgeBase.getSourceAnalysis(filePath, analysisFunction);
}
