import { DiffAnalysis } from './diff-analyzer.js';
import { CommitClassification } from './commit-validator.js';
import { PromptLoader, PromptVariables } from './prompt-template-engine.js';

export interface OptimizedPromptContext {
  projectName: string;
  analysis: DiffAnalysis;
  ragContext?: string;
  taskId?: string;
  amend?: boolean;
  previousMessage?: string;
  scopeMapping?: any;
}

/**
 * Sistema de prompt unificado e otimizado para análise de commits
 * Utiliza template engine para carregar prompts versionados com substituição de variáveis
 */
export class OptimizedCommitPrompts {
  
  /**
   * Prompt unificado que realiza análise, classificação, geração e validação em uma única chamada
   */
  static unifiedCommitAnalysis(context: OptimizedPromptContext): string {
    const variables = this.buildUnifiedVariables(context);
    return PromptLoader.commitUnified(variables);
  }

  /**
   * Prompt simplificado para casos básicos (quando não precisa de análise premium)
   */
  static simplifiedCommitGeneration(context: OptimizedPromptContext): string {
    const variables = this.buildSimpleVariables(context);
    return PromptLoader.commitSimple(variables);
  }

  /**
   * Constrói variáveis para prompt unificado
   */
  private static buildUnifiedVariables(context: OptimizedPromptContext): PromptVariables {
    const { analysis, projectName, ragContext, taskId, amend, previousMessage, scopeMapping } = context;
    
    return {
      projectName,
      diffSummary: this.buildDiffSummary(analysis),
      contextSection: ragContext || 'Nenhum contexto RAG disponível.',
      taskSection: taskId ? `**ID da Tarefa**: ${taskId}` : '',
      amendSection: amend && previousMessage ? `**Mensagem Anterior (para referência)**: ${previousMessage}` : '',
      scopeSection: scopeMapping ? 
        `**Mapeamento de Escopos Disponível**:\n${JSON.stringify(scopeMapping.scopes, null, 2)}` : '',
      scopeGuidelines: this.getScopeGuidelines(scopeMapping),
      amendGuideline: amend ? 'Mantenha consistência com commit anterior se aplicável' : 'Primeira análise do commit',
      taskGuideline: taskId ? `Referencie tarefa ${taskId} se relevante` : 'Nenhuma tarefa específica referenciada'
    };
  }

  /**
   * Constrói variáveis para prompt simples
   */
  private static buildSimpleVariables(context: OptimizedPromptContext): PromptVariables {
    const { analysis, projectName, taskId } = context;
    
    return {
      projectName,
      diffSummary: this.buildDiffSummary(analysis),
      taskInfo: taskId ? ` (relacionado à tarefa ${taskId})` : ''
    };
  }

  /**
   * Constrói resumo das mudanças do diff de forma otimizada
   */
  private static buildDiffSummary(analysis: DiffAnalysis): string {
    const { files, stats, patterns } = analysis;
    
    if (files.length === 0) {
      return 'Nenhuma mudança detectada.';
    }
    
    const summary = [
      `**Estatísticas**: ${stats.totalFiles} arquivos, +${stats.insertions}/-${stats.deletions} linhas`,
      `**Padrões**: ${this.describePatterns(patterns)}`,
      '',
      '**Arquivos Modificados**:'
    ];
    
    // Limitar a 10 arquivos mais relevantes para evitar prompt muito longo
    const relevantFiles = files.slice(0, 10);
    
    relevantFiles.forEach(file => {
      const statusDesc = {
        'A': 'novo',
        'M': 'modificado', 
        'D': 'removido',
        'R': 'renomeado',
        'C': 'copiado'
      }[file.status];
      
      summary.push(`- \`${file.file}\` (${statusDesc}, +${file.insertions}/-${file.deletions})`);
    });
    
    if (files.length > 10) {
      summary.push(`... e mais ${files.length - 10} arquivo(s)`);
    }
    
    return summary.join('\n');
  }

  /**
   * Descreve padrões detectados de forma concisa
   */
  private static describePatterns(patterns: any): string {
    const descriptions = [];
    
    if (patterns.hasTestChanges) descriptions.push('testes');
    if (patterns.hasConfigChanges) descriptions.push('configuração');
    if (patterns.hasDocChanges) descriptions.push('documentação');
    if (patterns.hasCriticalPaths) descriptions.push('caminhos críticos');
    
    descriptions.push(`predominante: ${patterns.predominantChangeType}`);
    
    return descriptions.join(', ');
  }

  /**
   * Diretrizes para escolha de escopo baseado no mapeamento disponível
   */
  private static getScopeGuidelines(scopeMapping?: any): string {
    if (!scopeMapping?.scopes) {
      return 'Use diretório principal como escopo ou omita se mudanças são muito amplas.';
    }
    
    const availableScopes = Object.keys(scopeMapping.scopes);
    return `Escopos disponíveis no projeto: ${availableScopes.join(', ')}. Use o mais específico que se aplique às mudanças.`;
  }

  /**
   * Determina se deve usar análise unificada ou simplificada baseado na complexidade
   */
  static shouldUseUnifiedAnalysis(analysis: DiffAnalysis): boolean {
    // Usar análise unificada para casos complexos
    return (
      analysis.files.length > 3 ||
      analysis.stats.totalFiles > 5 ||
      analysis.patterns.hasCriticalPaths ||
      analysis.files.some(f => f.status === 'A' || f.status === 'D') // Arquivos novos ou removidos
    );
  }
}