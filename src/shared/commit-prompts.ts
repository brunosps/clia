import { DiffAnalysis } from './diff-analyzer.js';
import { CommitClassification, CommitGroup } from './commit-validator.js';

export interface PromptContext {
  projectName: string;
  analysis: DiffAnalysis;
  ragContext?: string;
  taskId?: string;
  amend?: boolean;
  previousMessage?: string;
}

/**
 * Sistema de prompts estruturados para análise de commits
 */
export class CommitPrompts {
  
  /**
   * Prompt para classificação estratégica (tier premium)
   */
  static strategicAnalysis(context: PromptContext): string {
    const { analysis, projectName, ragContext, taskId } = context;
    
    const diffSummary = this.buildDiffSummary(analysis);
    const contextSection = ragContext ? `\n## Contexto do Projeto\n${ragContext}` : '';
    const taskSection = taskId ? `\n## ID da Tarefa: ${taskId}` : '';
    
    return `# Análise Estratégica de Commit - ${projectName}

You are a senior architect analyzing code changes for strategic classification.

## Mudanças Detectadas
${diffSummary}
${contextSection}
${taskSection}

## Tarefas de Análise

### 1. Classificação Técnica
Determine:
- **Tipo**: feat|fix|refactor|docs|test|chore|build|ci|perf|style
- **Escopo(s)**: baseado nos caminhos modificados (max 2 escopos principais)
- **Breaking Change**: true/false (mudanças incompatíveis com versão anterior)
- **Nível de Risco**: low|medium|high

### 2. Análise de Impacto
Para cada arquivo modificado, identifique:
- Propósito da mudança
- Componentes/funcionalidades afetados
- Dependências impactadas

### 3. Resumo Executivo
Gere bullets conciso para cada arquivo:
- 1-2 bullets por arquivo descrevendo a mudança
- Foque no "o quê" e "por quê", não no "como"
- Use linguagem técnica precisa

## Formato de Resposta (JSON)

\`\`\`json
{
  "type": "feat|fix|refactor|docs|test|chore|build|ci|perf|style",
  "scopes": ["escopo1", "escopo2"],
  "summaryByFile": [
    {
      "file": "caminho/arquivo.ts",
      "bullets": [
        "bullet descritivo da mudança",
        "impacto ou razão da mudança"
      ]
    }
  ],
  "breaking": false,
  "notes": [
    "observação estratégica sobre arquitetura",
    "consideração de impacto ou dependência"
  ],
  "riskLevel": "low|medium|high"
}
\`\`\`

Mantenha foco na estratégia e impacto arquitetural. Seja preciso e técnico.`;
  }

  /**
   * Prompt para geração de mensagem (tier default)
   */
  static messageGeneration(classification: CommitClassification, context: PromptContext): string {
    const { projectName, taskId, amend, previousMessage } = context;
    
    const amendSection = amend && previousMessage ? 
      `\n## Mensagem Anterior (para referência)\n${previousMessage}\n` : '';
    
    const breakingSection = classification.breaking ? 
      '\n **IMPORTANTE**: Esta é uma BREAKING CHANGE - inclua explicação no corpo.' : '';
    
    const taskSection = taskId ? `\n## ID da Tarefa: ${taskId}` : '';
    
    return `# Geração de Mensagem de Commit - ${projectName}

Gere uma mensagem de commit clara e informativa seguindo Conventional Commits.

## Classificação Recebida
- **Tipo**: ${classification.type}
- **Escopo(s)**: ${classification.scopes.join(', ') || 'nenhum'}
- **Breaking Change**: ${classification.breaking}
- **Risco**: ${classification.riskLevel}

## Resumo das Mudanças
${classification.summaryByFile.map(({ file, bullets }) => 
  `**${file}**:\n${bullets.map(b => `- ${b}`).join('\n')}`
).join('\n\n')}

${breakingSection}
${taskSection}
${amendSection}

## Diretrizes

### Formato Conventional Commits
\`tipo(escopo): descrição concisa\`

### Tipo Específico: ${classification.type}
${this.getTypeGuidelines(classification.type)}

### Estrutura da Mensagem
1. **Subject Line** (≤72 chars):
   - Comece com minúscula após os ":"
   - Seja específico e direto
   - Sem ponto final
   - Use verbo no imperativo (adiciona, corrige, implementa)

2. **Body** (opcional, linhas ≤100 chars):
   - Linha vazia após subject
   - Explique o "porquê" e "o quê"
   - Use bullets (-) para múltiplos pontos
   - Para breaking changes, explique a migração

3. **Footer** (se aplicável):
   - BREAKING CHANGE: detalhes da quebra
   - Referências de issues/PRs

### Escolha de Escopo
${this.getScopeGuidelines(classification.scopes)}

## Resposta Esperada

Forneça apenas a mensagem de commit final, sem explicações adicionais.
${amend ? 'Mantenha consistência com o commit anterior se aplicável.' : ''}

Exemplo de formato:
\`\`\`
feat(api): adiciona endpoint para busca de usuários

- implementa GET /users/search com filtros por nome e email
- adiciona validação de parâmetros de query
- inclui testes unitários e de integração
\`\`\``;
  }

  /**
   * Prompt para validação de mensagem (tier basic)
   */
  static messageValidation(message: string, classification: CommitClassification, context: PromptContext): string {
    const { projectName } = context;
    
    return `# Validação de Mensagem de Commit - ${projectName}

Valide a seguinte mensagem de commit contra a classificação fornecida.

## Mensagem para Validação
\`\`\`
${message}
\`\`\`

## Classificação Original
- **Tipo**: ${classification.type}
- **Escopo(s)**: ${classification.scopes.join(', ') || 'nenhum'}
- **Breaking Change**: ${classification.breaking}
- **Arquivos**: ${classification.summaryByFile.map(s => s.file).join(', ')}

## Critérios de Validação

### 1. Formato Conventional Commits
- [ ] Formato: \`tipo(escopo): descrição\`
- [ ] Tipo correto: ${classification.type}
- [ ] Escopo apropriado (se aplicável)
- [ ] Subject ≤72 caracteres
- [ ] Sem ponto final no subject

### 2. Qualidade do Conteúdo
- [ ] Descrição clara e específica
- [ ] Verbo no imperativo
- [ ] Minúscula após ":"
- [ ] Body explicativo (se necessário)
- [ ] Linhas do body ≤100 chars

### 3. Alinhamento com Mudanças
- [ ] Tipo reflete as mudanças (${classification.type})
- [ ] Escopo condiz com arquivos modificados
- [ ] Breaking change marcado (se aplicável: ${classification.breaking})

### 4. Segurança
- [ ] Não contém credenciais/senhas
- [ ] Não vaza informações sensíveis

## Formato de Resposta (JSON)

\`\`\`json
{
  "isValid": true|false,
  "score": 0.85,
  "issues": [
    "problema específico encontrado",
    "outro problema se houver"
  ],
  "suggestions": [
    "sugestão de melhoria",
    "outra sugestão se aplicável"
  ],
  "correctedMessage": "versão corrigida se necessário"
}
\`\`\`

Se a mensagem estiver correta, retorne \`isValid: true\` e score alto.
Se houver problemas, forneça \`correctedMessage\` com a versão melhorada.`;
  }

  /**
   * Prompt para análise de splitting de commits
   */
  static commitSplitting(groups: CommitGroup[], context: PromptContext): string {
    const { projectName } = context;
    
    const groupsSummary = groups.map((group, idx) => 
      `**Grupo ${idx + 1} (${group.scope})**:
${group.files.map(f => `- ${f}`).join('\n')}
Mudanças: ${group.summaryByFile.map(s => s.bullets.join(', ')).join('; ')}`
    ).join('\n\n');
    
    return `# Análise de Split de Commits - ${projectName}

Analise se as mudanças devem ser divididas em múltiplos commits.

## Grupos Identificados
${groupsSummary}

## Critérios para Split

### Deve Dividir Se:
- Grupos afetam domínios completamente diferentes
- Mistura features com fixes críticos
- Inclui mudanças de configuração/build com lógica de negócio
- Contém refactoring + feature nova
- Breaking changes misturadas com outras mudanças

### Manter Junto Se:
- Mudanças são interdependentes
- Feature requer múltiplos arquivos para funcionar
- Refactoring é necessário para implementar feature
- Total < 5 arquivos e mesmo domínio
- Mudanças são parte de uma única tarefa coesa

## Formato de Resposta (JSON)

\`\`\`json
{
  "shouldSplit": true|false,
  "reasoning": "explicação da decisão",
  "suggestedCommits": [
    {
      "description": "descrição do commit 1",
      "files": ["arquivo1.ts", "arquivo2.ts"],
      "type": "feat|fix|refactor|etc"
    }
  ]
}
\`\`\`

Se \`shouldSplit: false\`, deixe \`suggestedCommits\` vazio.
Priorize clareza histórica e facilidade de review.`;
  }

  /**
   * Constrói resumo das mudanças do diff
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
    
    files.forEach(file => {
      const statusDesc = {
        'A': 'novo',
        'M': 'modificado', 
        'D': 'removido',
        'R': 'renomeado',
        'C': 'copiado'
      }[file.status];
      
      summary.push(`- \`${file.file}\` (${statusDesc}, +${file.insertions}/-${file.deletions})`);
    });
    
    return summary.join('\n');
  }

  /**
   * Descreve padrões detectados
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
   * Diretrizes específicas por tipo
   */
  private static getTypeGuidelines(type: string): string {
    const guidelines: Record<string, string> = {
      feat: 'Nova funcionalidade para usuário. Use verbo que indica adição (adiciona, implementa, cria).',
      fix: 'Correção de bug. Use verbo que indica correção (corrige, resolve, ajusta).',
      refactor: 'Mudança de código sem alterar funcionalidade. Use verbo que indica melhoria (refatora, reorganiza, otimiza).',
      docs: 'Mudanças apenas em documentação. Use verbo que indica documentação (atualiza, adiciona, corrige).',
      test: 'Adição ou correção de testes. Use verbo que indica teste (adiciona, corrige, melhora).',
      chore: 'Mudanças de build, deps, config. Use verbo que indica manutenção (atualiza, configura, ajusta).',
      perf: 'Melhoria de performance. Use verbo que indica otimização (otimiza, melhora, acelera).',
      style: 'Mudanças de formatação/estilo. Use verbo que indica formatação (formata, ajusta, padroniza).',
      build: 'Mudanças no sistema de build. Use verbo que indica build (configura, atualiza, ajusta).',
      ci: 'Mudanças em CI/CD. Use verbo que indica pipeline (configura, ajusta, corrige).'
    };
    
    return guidelines[type] || 'Siga convenções padrão do tipo.';
  }

  /**
   * Diretrizes para escolha de escopo
   */
  private static getScopeGuidelines(scopes: string[]): string {
    if (scopes.length === 0) {
      return 'Nenhum escopo identificado. Considere se um escopo geral seria útil.';
    }
    
    if (scopes.length === 1) {
      return `Use escopo: \`${scopes[0]}\``;
    }
    
    return `Escopos sugeridos: ${scopes.join(', ')}. Escolha o mais representativo ou combine se relacionados.`;
  }
}