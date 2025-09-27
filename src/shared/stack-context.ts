/**
 * Stack Context Helper - Utilitário para integração do stack detector
 */


import { McpClient } from '../mcp/client.js';
import { StackInfo } from '../stack/types.js';

export interface StackContext {
  stackInfo: StackInfo | null;
  available: boolean;
  summary: {
    primary: string;
    languages: string[];
    frameworks: string[];
    tools: string[];
    outdatedCount: number;
  } | null;
}

/**
 * Obtém contexto completo do stack via MCP
 */
export async function getStackContext(logger?: any): Promise<StackContext> {
  try {
    logger?.info('Collecting stack context...');

    const mcpClient = McpClient.fromConfig();
    const stackInfo = await mcpClient.detectStack();

    if (!stackInfo) {
      logger?.warn(' Stack context unavailable: no stack info returned');
      return { stackInfo: null, available: false, summary: null };
    }

    const summary = {
      primary: stackInfo.primary?.name || 'unknown',
      languages: stackInfo.languages?.map((l: any) => l.name) || [],
      frameworks: stackInfo.frameworks?.map((f: any) => f.name) || [],
      tools: stackInfo.tools?.map((t: any) => t.name) || [],
      outdatedCount: stackInfo.outdatedDependencies?.length || 0,
    };

    logger?.info(
      `Stack context: ${summary.primary} | ${summary.languages.length} languages | ${summary.outdatedCount} outdated`
    );

    return {
      stackInfo,
      available: true,
      summary,
    };
  } catch (error) {
    logger?.warn(' Stack context unavailable:', error);
    return { stackInfo: null, available: false, summary: null };
  }
}

/**
 * Cria contexto resumido para pipelines
 */
export function createPipelineStackContext(stackContext: StackContext): any {
  if (!stackContext.available || !stackContext.stackInfo) {
    return { stack_available: false };
  }

  return {
    stack_available: true,
    stack_info: {
      primary_technology: stackContext.summary?.primary,
      languages: stackContext.summary?.languages,
      frameworks: stackContext.summary?.frameworks,
      tools: stackContext.summary?.tools,
      outdated_dependencies:
        stackContext.stackInfo.outdatedDependencies?.map((dep) => ({
          name: dep.name,
          current: dep.currentVersion,
          latest: dep.latestVersion,
          severity: dep.severity,
        })) || [],
      confidence: stackContext.stackInfo.confidence || 0,
    },
  };
}

/**
 * Detecta tecnologias afetadas por arquivos modificados
 */
export function detectAffectedTechnologies(
  changedFiles: string[],
  stackContext: StackContext
): string[] {
  if (!stackContext.available || !stackContext.stackInfo) {
    return [];
  }

  const affected = new Set<string>();

  // Mapeamento de extensões para tecnologias
  const extensionMap = new Map([
    ['.ts', 'TypeScript'],
    ['.js', 'JavaScript'],
    ['.py', 'Python'],
    ['.php', 'PHP'],
    ['.cs', 'C#'],
    ['.rs', 'Rust'],
    ['.rb', 'Ruby'],
    ['.go', 'Go'],
    ['.java', 'Java'],
    ['.json', 'Configuration'],
  ]);

  changedFiles.forEach((file) => {
    const ext = file.substring(file.lastIndexOf('.'));
    const tech = extensionMap.get(ext);
    if (tech && stackContext.summary?.languages.includes(tech)) {
      affected.add(tech);
    }

    // Arquivos especiais
    if (file.includes('package.json')) affected.add('Node.js');
    if (file.includes('requirements.txt') || file.includes('pyproject.toml'))
      affected.add('Python');
    if (file.includes('composer.json')) affected.add('PHP');
    if (file.includes('Cargo.toml')) affected.add('Rust');
    if (file.includes('Gemfile')) affected.add('Ruby');
  });

  return Array.from(affected);
}
