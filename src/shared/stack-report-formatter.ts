/**
 * Formatador de relatórios de stack para humanos
 */

import { StackInfo } from '../stack/types.js';

export interface StackAnalysisReport {
  summary: any;
  details: any;
  recommendations?: any;
  security?: any;
}

export function formatStackReportForHumans(
  stackInfo: StackInfo, 
  analysisReport?: StackAnalysisReport
): string {
  let markdown = '';
  
  // Header
  markdown += `# 🏗️ Análise de Stack Tecnológica\n\n`;
  markdown += `**Data:** ${new Date().toLocaleString('pt-BR')}\n\n`;
  
  // Stack Principal
  markdown += `##  Stack Principal\n\n`;
  markdown += `**Tecnologia:** ${stackInfo.primary.name}\n`;
  markdown += `**Confiança:** ${stackInfo.primary.confidence.toFixed(1)}%\n\n`;
  
  // Linguagens
  if (stackInfo.languages?.length > 0) {
    markdown += `## 💻 Linguagens de Programação\n\n`;
    stackInfo.languages.forEach((lang: any) => {
      markdown += `- **${lang.name}**: ${lang.confidence.toFixed(1)}% de confiança\n`;
    });
    markdown += '\n';
  }
  
  // Frameworks e Bibliotecas
  if (stackInfo.frameworks?.length > 0) {
    markdown += `## 🛠️ Frameworks e Bibliotecas\n\n`;
    stackInfo.frameworks.forEach((fw: any) => {
      const version = fw.version ? ` v${fw.version}` : '';
      markdown += `- **${fw.name}${version}**: ${fw.confidence.toFixed(1)}% de confiança\n`;
    });
    markdown += '\n';
  }
  
  // Ferramentas
  if (stackInfo.tools?.length > 0) {
    markdown += `## ⚙️ Ferramentas e Utilitários\n\n`;
    stackInfo.tools.forEach((tool: any) => {
      markdown += `- **${tool.name}**: ${tool.confidence.toFixed(1)}% de confiança\n`;
    });
    markdown += '\n';
  }
  
  // Dependências Desatualizadas
  if (stackInfo.outdatedDependencies && stackInfo.outdatedDependencies.length > 0) {
    markdown += `##  Dependências Desatualizadas\n\n`;
    markdown += `| Pacote | Versão Atual | Versão Mais Recente | Severidade | Ecossistema |\n`;
    markdown += `|--------|-------------|-------------------|-----------|-------------|\n`;
    
    stackInfo.outdatedDependencies.forEach((dep: any) => {
      const severityIcon = dep.severity === 'critical' ? '🔴 Crítica' : 
                          dep.severity === 'major' ? '🟡 Média' : 
                          dep.severity === 'minor' ? '🟢 Baixa' : dep.severity;
      markdown += `| ${dep.name} | ${dep.currentVersion} | ${dep.latestVersion} | ${severityIcon} | ${dep.ecosystem} |\n`;
    });
    markdown += '\n';
  }
  
  // Análise com IA (se disponível)
  if (analysisReport) {
    markdown += formatAIAnalysisSection(analysisReport);
  }
  
  // Rodapé
  markdown += `---\n\n`;
  markdown += `*Relatório gerado pelo CLIA v2.0.0 em ${new Date().toLocaleString('pt-BR')}*\n`;
  
  return markdown;
}

function formatAIAnalysisSection(analysisReport: StackAnalysisReport): string {
  let section = '';
  
  section += `##  Análise com Inteligência Artificial\n\n`;
  
  // Detectar tecnologias
  if (analysisReport.details?.['detect-technologies']) {
    const techData = analysisReport.details['detect-technologies'];
    section += `###  Detecção de Tecnologias\n\n`;
    
    if (techData.primaryStack?.language) {
      section += `**Linguagem Principal:** ${techData.primaryStack.language.primary}\n`;
      if (techData.primaryStack.language.secondary?.length > 0) {
        section += `**Linguagens Secundárias:** ${techData.primaryStack.language.secondary.join(', ')}\n`;
      }
    }
    
    if (techData.primaryStack?.runtime) {
      section += `**Runtime:** ${techData.primaryStack.runtime.name}\n`;
      section += `**Versão:** ${techData.primaryStack.runtime.version}\n`;
    }
    
    section += '\n';
  }
  
  // Análise de arquitetura
  if (analysisReport.details?.['analyze-architecture']) {
    const archData = analysisReport.details['analyze-architecture'];
    section += `### 🏗️ Análise de Arquitetura\n\n`;
    
    if (archData.architecture?.style) {
      section += `**Estilo Arquitetural:** ${archData.architecture.style}\n`;
    }
    
    if (archData.architecture?.patterns?.length > 0) {
      section += `**Padrões Detectados:**\n`;
      archData.architecture.patterns.forEach((pattern: any) => {
        section += `- **${pattern.name}**: ${pattern.description} (Qualidade: ${pattern.quality})\n`;
      });
    }
    
    section += '\n';
  }
  
  // Recomendações
  if (analysisReport.details?.['recommend-optimizations']) {
    const recData = analysisReport.details['recommend-optimizations'];
    section += `###  Recomendações de Otimização\n\n`;
    
    if (recData.recommendations?.immediate?.length > 0) {
      section += `#### 🔥 Ações Imediatas\n\n`;
      recData.recommendations.immediate.forEach((rec: any, index: number) => {
        section += `${index + 1}. **${rec.action || rec.category}**: ${rec.reason || rec.description}\n`;
        if (rec.packages?.length > 0) {
          section += `   - Pacotes: ${rec.packages.join(', ')}\n`;
        }
        section += `   - Esforço: ${rec.effort}, Impacto: ${rec.impact}\n\n`;
      });
    }
    
    if (recData.recommendations?.shortTerm?.length > 0) {
      section += `#### 📅 Curto Prazo\n\n`;
      recData.recommendations.shortTerm.forEach((rec: any, index: number) => {
        section += `${index + 1}. **${rec.action || rec.category}**: ${rec.reason || rec.description}\n`;
        section += `   - Esforço: ${rec.effort}, Impacto: ${rec.impact}\n\n`;
      });
    }
    
    if (recData.stackHealth) {
      section += `####  Saúde do Stack\n\n`;
      section += `- **Atual:** ${recData.stackHealth.current}/100\n`;
      section += `- **Potencial:** ${recData.stackHealth.potential}/100\n`;
      section += `- **Melhoria Possível:** +${recData.stackHealth.improvement} pontos\n\n`;
    }
  }
  
  return section;
}

export function formatStackReportForMachines(
  stackInfo: StackInfo, 
  analysisReport?: StackAnalysisReport
): any {
  return {
    metadata: {
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      generator: 'CLIA Stack Analyzer'
    },
    stack: stackInfo,
    analysis: analysisReport || null,
    summary: {
      primary_technology: stackInfo.primary.name,
      confidence: stackInfo.primary.confidence,
      languages_count: stackInfo.languages?.length || 0,
      frameworks_count: stackInfo.frameworks?.length || 0,
      tools_count: stackInfo.tools?.length || 0,
      outdated_dependencies_count: stackInfo.outdatedDependencies?.length || 0
    }
  };
}