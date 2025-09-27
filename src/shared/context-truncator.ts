/**
 * Context Truncator - Gerencia truncamento de contexto para evitar overflow de tokens
 */

import { getLogger } from './logger.js';

const logger = getLogger();

export interface ContextTruncationLimits {
  maxInputTokens: number;
  maxRagTokens: number;
  maxSecurityTokens: number;
  maxMcpTokens: number;
  maxStackTokens: number;
  maxPreviousResultTokens: number;
  reserveTokensForPrompt: number;
}

export interface TruncatedContext {
  input: string;
  ragContext: string;
  securityContext: string;
  mcpContext: string;
  stackContext: string;
  previousResult: string;
  metadata: {
    originalTokens: number;
    truncatedTokens: number;
    truncations: string[];
  };
}

export class ContextTruncator {
  private static readonly DEFAULT_LIMITS: ContextTruncationLimits = {
    maxInputTokens: 20000,        // ~20k tokens para input
    maxRagTokens: 15000,          // ~15k tokens para RAG
    maxSecurityTokens: 8000,      // ~8k tokens para security
    maxMcpTokens: 5000,           // ~5k tokens para MCP
    maxStackTokens: 3000,         // ~3k tokens para stack
    maxPreviousResultTokens: 10000, // ~10k tokens para resultado anterior
    reserveTokensForPrompt: 30000   // ~30k tokens reservados para prompt template
  };

  /**
   * Estima tokens baseado em contagem de caracteres (aproximação: 4 chars = 1 token)
   */
  static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Trunca texto para caber no limite de tokens
   */
  static truncateText(text: string, maxTokens: number): { text: string; wasTruncated: boolean } {
    if (!text) return { text: '', wasTruncated: false };
    
    const estimatedTokens = this.estimateTokens(text);
    
    if (estimatedTokens <= maxTokens) {
      return { text, wasTruncated: false };
    }
    
    // Truncar mantendo aproximadamente o limite de tokens
    const maxChars = maxTokens * 4;
    const truncatedText = text.substring(0, maxChars - 100) + '\n\n[... TRUNCADO PARA EVITAR OVERFLOW DE CONTEXTO ...]';
    
    return { text: truncatedText, wasTruncated: true };
  }

  /**
   * Trunca input JSON complexo de forma inteligente
   */
  static truncateInputJson(input: any, maxTokens: number): { text: string; wasTruncated: boolean } {
    if (!input) return { text: '{}', wasTruncated: false };
    
    try {
      // Primeiro, tentar JSON completo
      const fullJson = JSON.stringify(input, null, 2);
      const fullTokens = this.estimateTokens(fullJson);
      
      if (fullTokens <= maxTokens) {
        return { text: fullJson, wasTruncated: false };
      }
      
      // Se muito grande, criar versão resumida
      const truncatedInput = this.createSummarizedInput(input, maxTokens);
      return { text: JSON.stringify(truncatedInput, null, 2), wasTruncated: true };
      
    } catch (error) {
      logger.warn('Erro ao truncar input JSON:', error);
      return { text: JSON.stringify({ error: 'JSON inválido para truncamento' }, null, 2), wasTruncated: true };
    }
  }

  /**
   * Cria versão resumida do input mantendo informações essenciais
   */
  private static createSummarizedInput(input: any, maxTokens: number): any {
    const summary: any = {
      _truncated: true,
      _originalSize: JSON.stringify(input).length
    };
    
    // Preservar campos essenciais sempre
    const essentialFields = [
      'task', 'project_name', 'review_config', 'review_scope'
    ];
    
    essentialFields.forEach(field => {
      if (input[field] !== undefined) {
        summary[field] = input[field];
      }
    });
    
    // Para changed_files, incluir apenas resumos
    if (input.changed_files && Array.isArray(input.changed_files)) {
      const maxFiles = Math.min(input.changed_files.length, 10); // Máximo 10 arquivos
      summary.changed_files = input.changed_files.slice(0, maxFiles).map((file: any) => ({
        filePath: file.filePath,
        changeType: file.changeType,
        insertions: file.insertions,
        deletions: file.deletions,
        contentPreview: file.content ? file.content.substring(0, 500) + '...' : '',
        diffPreview: file.diff ? file.diff.substring(0, 300) + '...' : '',
        _originalContentSize: file.content ? file.content.length : 0,
        _originalDiffSize: file.diff ? file.diff.length : 0
      }));
      
      if (input.changed_files.length > maxFiles) {
        summary._truncatedFiles = input.changed_files.length - maxFiles;
      }
    }
    
    // Incluir outros campos até o limite
    const currentSize = this.estimateTokens(JSON.stringify(summary, null, 2));
    const remainingTokens = maxTokens - currentSize;
    
    if (remainingTokens > 1000) {
      // Adicionar filePaths se houver espaço
      if (input.filePaths && Array.isArray(input.filePaths)) {
        summary.filePaths = input.filePaths.slice(0, 20); // Máximo 20 paths
      }
    }
    
    return summary;
  }

  /**
   * Trunca contexto RAG mantendo diversidade
   */
  static truncateRagContext(ragContext: string, maxTokens: number): { text: string; wasTruncated: boolean } {
    if (!ragContext) return { text: '', wasTruncated: false };
    
    const sections = ragContext.split('### RAG Context');
    
    if (sections.length <= 2) {
      // Apenas uma seção, truncar normalmente
      return this.truncateText(ragContext, maxTokens);
    }
    
    // Múltiplas seções - manter diversidade
    const maxSections = Math.min(sections.length - 1, 6); // Máximo 6 seções (primeiro item é vazio)
    const tokensPerSection = Math.floor(maxTokens / maxSections);
    
    let result = '';
    let wasTruncated = false;
    
    for (let i = 1; i <= maxSections; i++) {
      if (sections[i]) {
        const sectionContent = '### RAG Context' + sections[i];
        const truncated = this.truncateText(sectionContent, tokensPerSection);
        result += truncated.text + '\n\n';
        if (truncated.wasTruncated) wasTruncated = true;
      }
    }
    
    if (sections.length > maxSections + 1) {
      result += `[... ${sections.length - maxSections - 1} seções RAG adicionais truncadas ...]`;
      wasTruncated = true;
    }
    
    return { text: result.trim(), wasTruncated };
  }

  /**
   * Trunca contexto de segurança mantendo os issues mais críticos
   */
  static truncateSecurityContext(securityContext: string, maxTokens: number): { text: string; wasTruncated: boolean } {
    if (!securityContext) return { text: '', wasTruncated: false };
    
    const estimatedTokens = this.estimateTokens(securityContext);
    
    if (estimatedTokens <= maxTokens) {
      return { text: securityContext, wasTruncated: false };
    }
    
    // Extrair e priorizar issues de alta severidade
    const lines = securityContext.split('\n');
    let result = '### Análise de Segurança (Truncada)\n\n';
    let currentTokens = this.estimateTokens(result);
    let wasTruncated = false;
    
    // Prioridade: HIGH > MEDIUM > LOW
    const priorities = ['HIGH SEVERITY', 'MEDIUM SEVERITY', 'LOW SEVERITY'];
    
    for (const priority of priorities) {
      const sectionStart = lines.findIndex(line => line.includes(priority));
      if (sectionStart === -1) continue;
      
      const sectionEnd = lines.findIndex((line, idx) => 
        idx > sectionStart && priorities.some(p => p !== priority && line.includes(p))
      );
      
      const sectionLines = sectionEnd === -1 
        ? lines.slice(sectionStart) 
        : lines.slice(sectionStart, sectionEnd);
      
      const sectionText = sectionLines.join('\n') + '\n';
      const sectionTokens = this.estimateTokens(sectionText);
      
      if (currentTokens + sectionTokens <= maxTokens) {
        result += sectionText;
        currentTokens += sectionTokens;
      } else {
        // Incluir pelo menos o header da seção
        const headerLine = sectionLines[0] + '\n[... detalhes truncados ...]\n\n';
        if (currentTokens + this.estimateTokens(headerLine) <= maxTokens) {
          result += headerLine;
        }
        wasTruncated = true;
        break;
      }
    }
    
    return { text: result, wasTruncated };
  }

  /**
   * Trunca contexto completo respeitando limites por categoria
   */
  static truncateFullContext(
    input: any,
    ragContext: string,
    securityContext: string,
    mcpContext: string,
    stackContext: string,
    previousResult: string,
    limits: Partial<ContextTruncationLimits> = {}
  ): TruncatedContext {
    const finalLimits = { ...this.DEFAULT_LIMITS, ...limits };
    const truncations: string[] = [];
    
    // Calcular tokens originais
    const originalTokens = 
      this.estimateTokens(JSON.stringify(input, null, 2)) +
      this.estimateTokens(ragContext) +
      this.estimateTokens(securityContext) +
      this.estimateTokens(mcpContext) +
      this.estimateTokens(stackContext) +
      this.estimateTokens(previousResult);
    
    // Truncar cada contexto
    const truncatedInput = this.truncateInputJson(input, finalLimits.maxInputTokens);
    if (truncatedInput.wasTruncated) truncations.push('input');
    
    const truncatedRag = this.truncateRagContext(ragContext, finalLimits.maxRagTokens);
    if (truncatedRag.wasTruncated) truncations.push('ragContext');
    
    const truncatedSecurity = this.truncateSecurityContext(securityContext, finalLimits.maxSecurityTokens);
    if (truncatedSecurity.wasTruncated) truncations.push('securityContext');
    
    const truncatedMcp = this.truncateText(mcpContext, finalLimits.maxMcpTokens);
    if (truncatedMcp.wasTruncated) truncations.push('mcpContext');
    
    const truncatedStack = this.truncateText(stackContext, finalLimits.maxStackTokens);
    if (truncatedStack.wasTruncated) truncations.push('stackContext');
    
    const truncatedPrevious = this.truncateText(previousResult, finalLimits.maxPreviousResultTokens);
    if (truncatedPrevious.wasTruncated) truncations.push('previousResult');
    
    // Calcular tokens finais
    const truncatedTokens = 
      this.estimateTokens(truncatedInput.text) +
      this.estimateTokens(truncatedRag.text) +
      this.estimateTokens(truncatedSecurity.text) +
      this.estimateTokens(truncatedMcp.text) +
      this.estimateTokens(truncatedStack.text) +
      this.estimateTokens(truncatedPrevious.text);
    
    return {
      input: truncatedInput.text,
      ragContext: truncatedRag.text,
      securityContext: truncatedSecurity.text,
      mcpContext: truncatedMcp.text,
      stackContext: truncatedStack.text,
      previousResult: truncatedPrevious.text,
      metadata: {
        originalTokens,
        truncatedTokens,
        truncations
      }
    };
  }

  /**
   * Verifica se o contexto está dentro do limite de tokens do modelo
   */
  static isWithinModelLimit(totalTokens: number, modelLimit: number = 128000): boolean {
    return totalTokens <= modelLimit;
  }

  /**
   * Sugere limites de truncamento baseado no modelo
   */
  static getLimitsForModel(modelLimit: number = 128000): ContextTruncationLimits {
    const usableTokens = Math.floor(modelLimit * 0.7); // Usar 70% do limite para contexto
    
    return {
      maxInputTokens: Math.floor(usableTokens * 0.25),     // 25% para input
      maxRagTokens: Math.floor(usableTokens * 0.30),       // 30% para RAG
      maxSecurityTokens: Math.floor(usableTokens * 0.15),  // 15% para security
      maxMcpTokens: Math.floor(usableTokens * 0.10),       // 10% para MCP
      maxStackTokens: Math.floor(usableTokens * 0.05),     // 5% para stack
      maxPreviousResultTokens: Math.floor(usableTokens * 0.15), // 15% para result anterior
      reserveTokensForPrompt: Math.floor(modelLimit * 0.3) // 30% reservado para prompt
    };
  }
}