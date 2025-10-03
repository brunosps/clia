import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PromptVariables {
  [key: string]: unknown;
}

export interface PromptTemplate {
  content: string;
  variables: string[];
}


import { getLogger } from './logger.js';

const logger = getLogger();

export class PromptTemplateEngine {
  private static promptsCache = new Map<string, PromptTemplate>();

  static loadPrompt(
    promptName: string,
    version: string = '1.0.0'
  ): PromptTemplate {
    const cacheKey = `${promptName}:${version}`;

    if (this.promptsCache.has(cacheKey)) {
      return this.promptsCache.get(cacheKey)!;
    }

    let promptPath: string;

    // Check if this is a pipeline prompt (command/phase format)
    if (promptName.includes('/')) {
      const [command, phase] = promptName.split('/');
      promptPath = path.join(
        __dirname,
        '..',
        '..',
        'src',
        'prompts',
        command,
        version,
        `${phase}.md`
      );
    } else {
      // Legacy format - look for system.md
      promptPath = path.join(
        __dirname,
        '..',
        '..',
        'src',
        'prompts',
        promptName,
        version,
        'system.md'
      );
    }

    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt não encontrado: ${promptPath}`);
    }

    const content = fs.readFileSync(promptPath, 'utf-8');
    const variables = this.extractVariables(content);

    const template: PromptTemplate = { content, variables };
    this.promptsCache.set(cacheKey, template);

    return template;
  }

  /**
   * Processa um template substituindo variáveis por valores fornecidos
   * Suporta tanto {$variableName} quanto {{variableName}}
   */
  static processTemplate(
    template: PromptTemplate,
    variables: PromptVariables,
    templateName?: string
  ): string {
    let processedContent = template.content;

    // Substituir variáveis no formato {$variableName} (formato original)
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined && value !== null) {
        const placeholder = `{$${key}}`;
        const stringValue = this.valueToString(value);
        processedContent = processedContent.replaceAll(placeholder, stringValue);
      }
    }

    // Substituir variáveis no formato {{variableName}} (formato Handlebars/Mustache)
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined && value !== null) {
        const placeholder = `{{${key}}}`;
        processedContent = processedContent.replaceAll(
          placeholder,
          this.valueToString(value)
        );
      }
    }

    // Suportar acesso a propriedades aninhadas como {{input.question}}
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const objValue = value as Record<string, unknown>;
        for (const [subKey, subValue] of Object.entries(objValue)) {
          if (subValue !== undefined) {
            const placeholder = `{{${key}.${subKey}}}`;
            processedContent = processedContent.replaceAll(
              placeholder,
              this.valueToString(subValue)
            );
          }
        }
      }
    }

    // Verificar se restaram variáveis não substituídas (ambos os formatos)
    const remainingVarsOld = this.extractVariables(processedContent);
    const remainingVarsNew = this.extractHandlebarsVariables(processedContent);

    if (remainingVarsOld.length > 0) {
      logger.warn(
        `Variáveis {$} não substituídas no template: ${remainingVarsOld.join(', ')}`
      );
      // Limpar variáveis não substituídas
      remainingVarsOld.forEach((varName) => {
        const placeholder = `{$${varName}}`;
        processedContent = processedContent.replaceAll(placeholder, '');
      });
    }

    if (remainingVarsNew.length > 0) {
      logger.warn(
        `Variáveis {{}} não substituídas no template: ${remainingVarsNew.join(', ')}`
      );
      // Limpar variáveis não substituídas
      remainingVarsNew.forEach((varName: string) => {
        const placeholder = `{{${varName}}}`;
        processedContent = processedContent.replaceAll(placeholder, '');
      });
    }

    return this.cleanupTemplate(processedContent);
  }

  private static valueToString(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.valueToString(item)).join(', ');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  /**
   * Carrega e processa um prompt em uma única operação
   */
  static renderPrompt(
    promptName: string,
    variables: PromptVariables,
    version: string = '1.0.0'
  ): string {
    const rawPrompt = this.loadPrompt(promptName, version);
    const template = Handlebars.compile(rawPrompt.content);    
    const output = template(variables);
    return output;
  }

  /**
   * Extrai nomes de variáveis do conteúdo do template (formato {$variableName})
   */
  private static extractVariables(content: string): string[] {
    const regex = /\{\$([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    const variables: string[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const varName = match[1];
      if (!variables.includes(varName)) {
        variables.push(varName);
      }
    }

    return variables;
  }

  /**
   * Extrai nomes de variáveis do conteúdo do template (formato {{variableName}})
   */
  private static extractHandlebarsVariables(content: string): string[] {
    const regex = /\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g;
    const variables: string[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const varName = match[1];
      if (!variables.includes(varName)) {
        variables.push(varName);
      }
    }

    return variables;
  }

  /**
   * Limpa o template removendo linhas vazias excessivas e espaços
   */
  private static cleanupTemplate(content: string): string {
    return (
      content
        // Remover múltiplas quebras de linha seguidas
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        // Remover espaços em branco no final das linhas
        .replace(/[ \t]+$/gm, '')
        // Remover quebras de linha no início e fim
        .trim()
    );
  }

  /**
   * Lista todos os prompts disponíveis
   */
  static listAvailablePrompts(): { name: string; versions: string[] }[] {
    const promptsDir = path.join(__dirname, '..', '..', 'src', 'prompts');

    if (!fs.existsSync(promptsDir)) {
      return [];
    }

    const prompts: { name: string; versions: string[] }[] = [];

    const entries = fs.readdirSync(promptsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const promptName = entry.name;
        const promptPath = path.join(promptsDir, promptName);

        try {
          const versionDirs = fs
            .readdirSync(promptPath, { withFileTypes: true })
            .filter((subEntry) => subEntry.isDirectory())
            .map((subEntry) => subEntry.name)
            .filter((version) => {
              // Verificar se existe system.md na versão
              const systemPath = path.join(promptPath, version, 'system.md');
              return fs.existsSync(systemPath);
            });

          if (versionDirs.length > 0) {
            prompts.push({
              name: promptName,
              versions: versionDirs.sort().reverse(), // Versões mais recentes primeiro
            });
          }
        } catch (error) {
          // Ignorar diretórios que não são prompts válidos
          continue;
        }
      }
    }

    return prompts;
  }

  /**
   * Valida se um prompt existe e está bem formado
   */
  static validatePrompt(
    promptName: string,
    version: string = '1.0.0'
  ): {
    exists: boolean;
    variables: string[];
    errors: string[];
  } {
    const errors: string[] = [];

    try {
      const template = this.loadPrompt(promptName, version);

      return {
        exists: true,
        variables: template.variables,
        errors,
      };
    } catch (error) {
      errors.push(`Erro ao carregar prompt: ${error}`);

      return {
        exists: false,
        variables: [],
        errors,
      };
    }
  }

  /**
   * Limpa cache de prompts (útil para desenvolvimento)
   */
  static clearCache(): void {
    this.promptsCache.clear();
  }
}

/**
 * Interface para uso mais conveniente
 */
export class PromptLoader {
  /**
   * Carrega prompt de commit unificado
   */
  static commitUnified(variables: PromptVariables): string {
    return PromptTemplateEngine.renderPrompt('commit-unified', variables);
  }

  /**
   * Carrega prompt de commit simples
   */
  static commitSimple(variables: PromptVariables): string {
    return PromptTemplateEngine.renderPrompt('commit-simple', variables);
  }

  /**
   * Carrega prompt de refactor
   */
  static refactor(variables: PromptVariables): string {
    return PromptTemplateEngine.renderPrompt('refactor', variables);
  }

  /**
   * Carrega prompt de review
   */
  static review(variables: PromptVariables, version: string = '1.1.0'): string {
    return PromptTemplateEngine.renderPrompt('review', variables, version);
  }

  /**
   * Carrega prompt customizado
   */
  static custom(
    promptName: string,
    variables: PromptVariables,
    version?: string
  ): string {
    return PromptTemplateEngine.renderPrompt(promptName, variables, version);
  }
}
