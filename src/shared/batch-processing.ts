/**
 * Batch Processing Manager - Estratégia inteligente para processamento em lotes
 */

import { approxTokensFromText } from './tokens.js';
import { getLogger } from './logger.js';

// Initialize logger
const logger = getLogger();

export interface FileBatch {
  id: string;
  files: Array<{
    path: string;
    content: string;
    language: string;
    priority: number;
  }>;
  totalTokens: number;
  batchType: 'small' | 'medium' | 'large';
  complexity: 'simple' | 'medium' | 'complex';
}

export interface BatchingStrategy {
  maxTokensPerBatch: number;
  maxFilesPerBatch: number;
  contextWindowSize: number;
  reserveTokensForPrompt: number;
  reserveTokensForResponse: number;
  priorityGrouping: boolean;
  languageGrouping: boolean;
  complexityGrouping: boolean;
  dynamicSizing: boolean;
}

export class BatchProcessingManager {
  private strategy: BatchingStrategy;

  constructor(strategy?: Partial<BatchingStrategy>, contextWindowSize?: number) {
    const defaultContextWindow = contextWindowSize || 32000; // Default para modelos como GPT-4
    
    this.strategy = {
      maxTokensPerBatch: Math.floor(defaultContextWindow * 0.4), // 40% para conteúdo de arquivos
      maxFilesPerBatch: 5,
      contextWindowSize: defaultContextWindow,
      reserveTokensForPrompt: Math.floor(defaultContextWindow * 0.3), // 30% para prompt
      reserveTokensForResponse: Math.floor(defaultContextWindow * 0.2), // 20% para resposta
      priorityGrouping: true,
      languageGrouping: true,
      complexityGrouping: true,
      dynamicSizing: true,
      ...strategy
    };
    
    // Recalcular maxTokensPerBatch se dynamicSizing estiver ativo
    if (this.strategy.dynamicSizing) {
      this.strategy.maxTokensPerBatch = this.strategy.contextWindowSize - 
        this.strategy.reserveTokensForPrompt - 
        this.strategy.reserveTokensForResponse;
    }
  }

  /**
   * Calcula prioridade do arquivo baseado em múltiplos fatores
   */
  private calculateFilePriority(filePath: string, content: string): number {
    let priority = 0;

    // Prioridade por tipo de arquivo
    if (filePath.includes('/commands/')) priority += 10;
    if (filePath.includes('/shared/')) priority += 8;
    if (filePath.includes('/config')) priority += 7;
    if (filePath.includes('index.')) priority += 9;
    if (filePath.includes('.test.') || filePath.includes('.spec.')) priority -= 5;

    // Prioridade por tamanho (arquivos menores primeiro)
    const lines = content.split('\n').length;
    if (lines < 50) priority += 3;
    else if (lines < 150) priority += 2;
    else if (lines < 300) priority += 1;
    else priority -= 2;

    // Prioridade por complexidade (menos complexos primeiro)
    const complexity = this.estimateComplexity(content);
    if (complexity === 'simple') priority += 3;
    else if (complexity === 'medium') priority += 1;
    else priority -= 1;

    return Math.max(0, priority);
  }

  /**
   * Estima complexidade do arquivo
   */
  private estimateComplexity(content: string): 'simple' | 'medium' | 'complex' {
    const lines = content.split('\n').length;
    const functions = (content.match(/function\s+\w+|const\s+\w+\s*=\s*\(/g) || []).length;
    const classes = (content.match(/class\s+\w+/g) || []).length;
    const imports = (content.match(/import\s+/g) || []).length;

    const complexityScore = (lines / 10) + (functions * 2) + (classes * 5) + imports;

    if (complexityScore < 20) return 'simple';
    if (complexityScore < 50) return 'medium';
    return 'complex';
  }

  /**
   * Detecta linguagem/tecnologia do arquivo
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts': return 'typescript';
      case 'js': return 'javascript';
      case 'jsx': return 'react';
      case 'tsx': return 'react-typescript';
      case 'py': return 'python';
      case 'java': return 'java';
      case 'cpp': case 'c': case 'h': return 'cpp';
      case 'cs': return 'csharp';
      case 'php': return 'php';
      case 'rb': return 'ruby';
      case 'go': return 'golang';
      case 'rs': return 'rust';
      case 'json': return 'json';
      case 'yaml': case 'yml': return 'yaml';
      case 'md': return 'markdown';
      default: return 'text';
    }
  }

  /**
   * Cria lotes inteligentes com balanceamento dinâmico
   */
  createBatches(files: Array<{ path: string; content: string; size?: number; lines?: number }>, maxBatchSize?: number): FileBatch[] {
    const startTime = Date.now();
    logger.info(`Starting batch creation for ${files.length} files...`);
    
    // Usar maxBatchSize se fornecido
    if (maxBatchSize) {
      this.strategy.maxFilesPerBatch = maxBatchSize;
    }

    // Preparar arquivos com metadados expandidos
    const enrichedFiles = files.map(file => {
      const tokens = approxTokensFromText(file.content);
      const lines = file.lines || file.content.split('\n').length;
      const size = file.size || file.content.length;
      
      return {
        ...file,
        language: this.detectLanguage(file.path),
        priority: this.calculateFilePriority(file.path, file.content),
        complexity: this.estimateComplexity(file.content),
        tokens,
        lines,
        size,
        tokensPerLine: lines > 0 ? tokens / lines : 0
      };
    });

    // Estatísticas para otimização dinâmica
    const totalTokens = enrichedFiles.reduce((sum, f) => sum + f.tokens, 0);
    const avgTokensPerFile = totalTokens / enrichedFiles.length;
    const maxTokensInFile = Math.max(...enrichedFiles.map(f => f.tokens));
    
    logger.info(`Statistics: ${totalTokens} total tokens, ${avgTokensPerFile.toFixed(0)} average/file, ${maxTokensInFile} max/file`);
    
    // Ajustar estratégia dinamicamente
    if (this.strategy.dynamicSizing) {
      this.adjustStrategyDynamically(enrichedFiles, avgTokensPerFile, maxTokensInFile);
    }

    // Ordenar por prioridade e otimizar para balanceamento
    enrichedFiles.sort((a, b) => {
      // Prioridade primária
      if (Math.abs(a.priority - b.priority) > 2) {
        return b.priority - a.priority;
      }
      // Balancear por tamanho como critério secundário
      return a.tokens - b.tokens;
    });

    const batches: FileBatch[] = [];
    const processedFiles = new Set<number>();
    let batchIndex = 0;

    while (processedFiles.size < enrichedFiles.length) {
      const batch = this.createOptimalBatch(enrichedFiles, processedFiles, ++batchIndex);
      if (batch.files.length > 0) {
        batches.push(batch);
      } else {
        // Evitar loop infinito - forçar adição do próximo arquivo
        const remainingFiles = enrichedFiles.filter((_, i) => !processedFiles.has(i));
        if (remainingFiles.length > 0) {
          const nextFile = remainingFiles[0];
          const index = enrichedFiles.indexOf(nextFile);
          processedFiles.add(index);
          
          batches.push(this.createBatchFromFiles([nextFile], nextFile.tokens, `batch-${++batchIndex}-forced`));
        }
      }
    }

    const creationTime = Date.now() - startTime;
    logger.info(`${batches.length} batches created in ${creationTime}ms`);
    
    // Log de distribuição de lotes
    batches.forEach((batch, i) => {
      logger.info(`  Batch ${i + 1}: ${batch.files.length} files, ${batch.totalTokens} tokens (${batch.batchType})`);
    });

    return batches;
  }

  /**
   * Ajusta estratégia dinamicamente baseada nas características dos arquivos
   */
  private adjustStrategyDynamically(files: any[], avgTokensPerFile: number, maxTokensInFile: number): void {
    const totalFiles = files.length;
    
    // Ajustar maxTokensPerBatch baseado no tamanho médio dos arquivos
    if (avgTokensPerFile > 2000) {
      // Arquivos grandes - lotes menores
      this.strategy.maxTokensPerBatch = Math.min(this.strategy.maxTokensPerBatch, 6000);
      this.strategy.maxFilesPerBatch = Math.min(this.strategy.maxFilesPerBatch, 3);
    } else if (avgTokensPerFile < 500) {
      // Arquivos pequenos - lotes maiores
      this.strategy.maxTokensPerBatch = Math.min(this.strategy.maxTokensPerBatch, 12000);
      this.strategy.maxFilesPerBatch = Math.min(this.strategy.maxFilesPerBatch, 8);
    }
    
    // Ajustar baseado no arquivo maior
    if (maxTokensInFile > this.strategy.maxTokensPerBatch) {
      logger.warn(`Large file detected (${maxTokensInFile} tokens), adjusting batch to accommodate`);
      this.strategy.maxTokensPerBatch = Math.min(maxTokensInFile + 1000, this.strategy.contextWindowSize * 0.5);
    }
    
    // Desabilitar agrupamentos para projetos muito pequenos
    if (totalFiles <= 5) {
      this.strategy.languageGrouping = false;
      this.strategy.complexityGrouping = false;
      this.strategy.priorityGrouping = false;
    }
    
    logger.info(`Strategy adjusted: ${this.strategy.maxTokensPerBatch} tokens/batch, ${this.strategy.maxFilesPerBatch} files/batch`);
  }

  /**
   * Cria lote ótimo usando algoritmo greedy melhorado
   */
  private createOptimalBatch(files: any[], processedFiles: Set<number>, batchIndex: number): FileBatch {
    const batchFiles: any[] = [];
    let batchTokens = 0;
    
    // Encontrar melhor combinação de arquivos para o lote
    for (let i = 0; i < files.length; i++) {
      if (processedFiles.has(i)) continue;
      
      const file = files[i];
      const wouldExceedTokens = batchTokens + file.tokens > this.strategy.maxTokensPerBatch;
      const wouldExceedFiles = batchFiles.length >= this.strategy.maxFilesPerBatch;
      
      if (wouldExceedTokens || wouldExceedFiles) {
        continue;
      }
      
      // Verificar compatibilidade
      if (!this.isCompatibleWithBatch(file, batchFiles)) {
        continue;
      }
      
      // Adicionar arquivo ao lote
      batchFiles.push(file);
      batchTokens += file.tokens;
      processedFiles.add(i);
    }
    
    if (batchFiles.length === 0) {
      // Tentar forçar pelo menos um arquivo se possível
      const availableFiles = files.filter((_, i) => !processedFiles.has(i));
      if (availableFiles.length > 0) {
        const smallestFile = availableFiles.reduce((min, file) => 
          file.tokens < min.tokens ? file : min
        );
        const index = files.indexOf(smallestFile);
        batchFiles.push(smallestFile);
        batchTokens = smallestFile.tokens;
        processedFiles.add(index);
      }
    }
    
    return this.createBatchFromFiles(batchFiles, batchTokens, `batch-${batchIndex}`);
  }
  private isCompatibleWithBatch(file: any, currentBatch: any[]): boolean {
    if (currentBatch.length === 0) return true;

    const firstFile = currentBatch[0];

    // Agrupamento por linguagem
    if (this.strategy.languageGrouping) {
      const sameLanguageGroup = this.getLanguageGroup(file.language) === 
        this.getLanguageGroup(firstFile.language);
      if (!sameLanguageGroup) return false;
    }

    // Agrupamento por complexidade
    if (this.strategy.complexityGrouping) {
      const complexityDiff = Math.abs(
        this.getComplexityScore(file.complexity) - 
        this.getComplexityScore(firstFile.complexity)
      );
      if (complexityDiff > 1) return false;
    }

    // Agrupamento por prioridade
    if (this.strategy.priorityGrouping) {
      const priorityDiff = Math.abs(file.priority - firstFile.priority);
      if (priorityDiff > 5) return false;
    }

    return true;
  }

  /**
   * Agrupa linguagens similares
   */
  private getLanguageGroup(language: string): string {
    const groups: { [key: string]: string } = {
      'typescript': 'js-family',
      'javascript': 'js-family',
      'react': 'js-family',
      'react-typescript': 'js-family',
      'python': 'python-family',
      'java': 'jvm-family',
      'cpp': 'c-family',
      'c': 'c-family',
      'csharp': 'dotnet-family',
      'php': 'web-family',
      'ruby': 'ruby-family',
      'golang': 'go-family',
      'rust': 'rust-family',
      'json': 'data-family',
      'yaml': 'data-family',
      'markdown': 'docs-family'
    };

    return groups[language] || 'other';
  }

  /**
   * Converte complexidade para score numérico
   */
  private getComplexityScore(complexity: string): number {
    switch (complexity) {
      case 'simple': return 1;
      case 'medium': return 2;
      case 'complex': return 3;
      default: return 2;
    }
  }

  /**
   * Cria objeto FileBatch a partir dos arquivos
   */
  private createBatchFromFiles(files: any[], totalTokens: number, id: string): FileBatch {
    const batchType = this.determineBatchType(files.length, totalTokens);
    const complexity = this.determineBatchComplexity(files);

    return {
      id,
      files: files.map(f => ({
        path: f.path,
        content: f.content,
        language: f.language,
        priority: f.priority
      })),
      totalTokens,
      batchType,
      complexity
    };
  }

  /**
   * Determina tipo do lote baseado em tamanho
   */
  private determineBatchType(fileCount: number, tokens: number): 'small' | 'medium' | 'large' {
    if (fileCount <= 2 && tokens <= 3000) return 'small';
    if (fileCount <= 4 && tokens <= 6000) return 'medium';
    return 'large';
  }

  /**
   * Determina complexidade do lote
   */
  private determineBatchComplexity(files: any[]): 'simple' | 'medium' | 'complex' {
    const complexities = files.map(f => this.getComplexityScore(f.complexity));
    const avgComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;

    if (avgComplexity <= 1.5) return 'simple';
    if (avgComplexity <= 2.5) return 'medium';
    return 'complex';
  }

  /**
   * Obtém estratégia atual de batching
   */
  getStrategy(): string {
    const priorities = [];
    if (this.strategy.priorityGrouping) priorities.push('priority');
    if (this.strategy.languageGrouping) priorities.push('language');
    if (this.strategy.complexityGrouping) priorities.push('complexity');
    
    return `intelligent-grouping-${priorities.join('-')}`;
  }

  /**
   * Obtém estratégia otimizada baseada no contexto
   */
  static getOptimizedStrategy(
    totalFiles: number, 
    avgFileSize: number, 
    availableModels: string[],
    contextWindowSize: number = 32000
  ): BatchingStrategy {
    const baseReservePrompt = Math.floor(contextWindowSize * 0.3);
    const baseReserveResponse = Math.floor(contextWindowSize * 0.2);
    
    // Estratégia baseada no número de arquivos
    if (totalFiles <= 10) {
      return {
        maxTokensPerBatch: Math.floor(contextWindowSize * 0.5),
        maxFilesPerBatch: 3,
        contextWindowSize,
        reserveTokensForPrompt: baseReservePrompt,
        reserveTokensForResponse: baseReserveResponse,
        priorityGrouping: false,
        languageGrouping: true,
        complexityGrouping: false,
        dynamicSizing: true
      };
    }

    if (totalFiles <= 50) {
      return {
        maxTokensPerBatch: Math.floor(contextWindowSize * 0.4),
        maxFilesPerBatch: 4,
        contextWindowSize,
        reserveTokensForPrompt: baseReservePrompt,
        reserveTokensForResponse: baseReserveResponse,
        priorityGrouping: true,
        languageGrouping: true,
        complexityGrouping: true,
        dynamicSizing: true
      };
    }

    // Para projetos grandes
    return {
      maxTokensPerBatch: Math.floor(contextWindowSize * 0.35),
      maxFilesPerBatch: 5,
      contextWindowSize,
      reserveTokensForPrompt: baseReservePrompt,
      reserveTokensForResponse: baseReserveResponse,
      priorityGrouping: true,
      languageGrouping: true,
      complexityGrouping: true,
      dynamicSizing: true
    };
  }
}