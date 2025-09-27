import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { getLogger } from './logger.js';
import * as fs from 'fs';

const logger = getLogger();
import path from 'path';
import { fileURLToPath } from 'url';
import NodeCache from 'node-cache';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Gerenciador de prompts versionados
 * 
 * Sistema para carregar prompts de arquivos versionados seguindo semantic versioning.
 * Os prompts ficam organizados em src/prompts/{command}/{version}/
 * 
 * Exemplo: src/prompts/commit/1.0.0/system.md
 *          src/prompts/commit/1.0.1/system.md
 */

interface PromptVersion {
  major: number;
  minor: number;
  patch: number;
  version: string;
  path: string;
}

export class PromptManager {
  private static instance: PromptManager;
  private promptsDir: string;
  private cache: NodeCache;

  private constructor() {
    // Procurar os prompts tanto em desenvolvimento quanto em instalação global
    // Em desenvolvimento: process.cwd()/src/prompts
    // Em instalação global: pasta do módulo/src/prompts
    const devPromptsDir = path.join(process.cwd(), 'src', 'prompts');
    const modulePromptsDir = path.join(__dirname, '..', '..', 'src', 'prompts');
    
    if (fs.existsSync(devPromptsDir)) {
      this.promptsDir = devPromptsDir;
    } else if (fs.existsSync(modulePromptsDir)) {
      this.promptsDir = modulePromptsDir;
    } else {
      // Fallback: tentar encontrar a partir do módulo instalado
      const packageRoot = path.resolve(__dirname, '../..');
      const fallbackDir = path.join(packageRoot, 'src', 'prompts');
      this.promptsDir = fallbackDir;
    }
    
    // Cache com TTL de 5 minutos (300 segundos)
    this.cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
  }

  static getInstance(): PromptManager {
    if (!PromptManager.instance) {
      PromptManager.instance = new PromptManager();
    }
    return PromptManager.instance;
  }

  /**
   * Carrega o prompt mais recente para um comando específico
   * @param commandName Nome do comando (ex: 'commit', 'refactor')
   * @param fileName Nome do arquivo dentro da pasta de versão (padrão: 'system.md')
   * @returns Conteúdo do prompt
   */
  async loadPrompt(commandName: string, fileName: string = 'system.md'): Promise<string> {
    const cacheKey = `${commandName}:${fileName}`;
    
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    const latestVersion = this.getLatestVersion(commandName);
    if (!latestVersion) {
      throw new Error(`Nenhuma versão encontrada para o comando '${commandName}'`);
    }

    const promptPath = path.join(latestVersion.path, fileName);
    
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Arquivo de prompt não encontrado: ${promptPath}`);
    }

    const content = fs.readFileSync(promptPath, 'utf-8');
    this.cache.set(cacheKey, content);
    
    return content;
  }

  /**
   * Carrega um prompt de uma versão específica
   * @param commandName Nome do comando
   * @param version Versão específica (ex: '1.0.0')
   * @param fileName Nome do arquivo (padrão: 'system.md')
   * @returns Conteúdo do prompt
   */
  async loadPromptVersion(commandName: string, version: string, fileName: string = 'system.md'): Promise<string> {
    const cacheKey = `${commandName}:${version}:${fileName}`;
    
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    const promptPath = path.join(this.promptsDir, commandName, version, fileName);
    
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Arquivo de prompt não encontrado: ${promptPath}`);
    }

    const content = fs.readFileSync(promptPath, 'utf-8');
    this.cache.set(cacheKey, content);
    
    return content;
  }

  /**
   * Lista todas as versões disponíveis para um comando
   * @param commandName Nome do comando
   * @returns Array de versões ordenadas da mais recente para a mais antiga
   */
  getAvailableVersions(commandName: string): PromptVersion[] {
    const commandDir = path.join(this.promptsDir, commandName);
    
    if (!fs.existsSync(commandDir)) {
      return [];
    }

    const versions: PromptVersion[] = [];
    const entries = fs.readdirSync(commandDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && this.isValidVersion(entry.name)) {
        const versionParts = entry.name.split('.').map(Number);
        versions.push({
          major: versionParts[0],
          minor: versionParts[1],
          patch: versionParts[2],
          version: entry.name,
          path: path.join(commandDir, entry.name)
        });
      }
    }

    // Ordenar por versão (mais recente primeiro)
    return versions.sort((a, b) => {
      if (a.major !== b.major) return b.major - a.major;
      if (a.minor !== b.minor) return b.minor - a.minor;
      return b.patch - a.patch;
    });
  }

  /**
   * Obtém a versão mais recente para um comando
   * @param commandName Nome do comando
   * @returns Versão mais recente ou null se não encontrada
   */
  getLatestVersion(commandName: string): PromptVersion | null {
    const versions = this.getAvailableVersions(commandName);
    return versions.length > 0 ? versions[0] : null;
  }

  /**
   * Valida se uma string é uma versão semântica válida
   * @param version String da versão
   * @returns true se válida
   */
  private isValidVersion(version: string): boolean {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    return semverRegex.test(version);
  }

  /**
   * Limpa o cache de prompts
   */
  clearCache(): void {
    this.cache.flushAll();
  }

  /**
   * Obtém estatísticas do cache
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Define TTL customizado para um comando específico
   */
  setCacheTTL(ttl: number): void {
    this.cache.options.stdTTL = ttl;
  }

  /**
   * Cria uma nova versão de prompt baseada na versão anterior
   * @param commandName Nome do comando
   * @param newVersion Nova versão (ex: '1.0.1')
   * @param baseVersion Versão base para copiar (opcional, usa a mais recente)
   */
  async createNewVersion(commandName: string, newVersion: string, baseVersion?: string): Promise<void> {
    if (!this.isValidVersion(newVersion)) {
      throw new Error(`Versão inválida: ${newVersion}. Use formato semântico (ex: 1.0.1)`);
    }

    const newVersionDir = path.join(this.promptsDir, commandName, newVersion);
    
    if (fs.existsSync(newVersionDir)) {
      throw new Error(`Versão ${newVersion} já existe para o comando ${commandName}`);
    }

    // Determinar versão base
    let sourceVersion: PromptVersion | null;
    if (baseVersion) {
      const versions = this.getAvailableVersions(commandName);
      sourceVersion = versions.find(v => v.version === baseVersion) || null;
    } else {
      sourceVersion = this.getLatestVersion(commandName);
    }

    if (!sourceVersion) {
      throw new Error(`Versão base não encontrada para ${commandName}`);
    }

    // Criar diretório da nova versão
    fs.mkdirSync(newVersionDir, { recursive: true });

    // Copiar arquivos da versão base
    const sourceFiles = fs.readdirSync(sourceVersion.path);
    for (const file of sourceFiles) {
      const sourcePath = path.join(sourceVersion.path, file);
      const destPath = path.join(newVersionDir, file);
      fs.copyFileSync(sourcePath, destPath);
    }

    logger.info(` Nova versão ${newVersion} criada para ${commandName} baseada em ${sourceVersion.version}`);
  }
}

/**
 * Função de conveniência para carregar prompts
 * @param commandName Nome do comando
 * @param fileName Nome do arquivo (padrão: 'system.md')
 * @returns Conteúdo do prompt
 */
export async function loadPrompt(commandName: string, fileName: string = 'system.md'): Promise<string> {
  const manager = PromptManager.getInstance();
  return manager.loadPrompt(commandName, fileName);
}

/**
 * Função de conveniência para carregar prompt de versão específica
 * @param commandName Nome do comando
 * @param version Versão específica
 * @param fileName Nome do arquivo (padrão: 'system.md')
 * @returns Conteúdo do prompt
 */
export async function loadPromptVersion(commandName: string, version: string, fileName: string = 'system.md'): Promise<string> {
  const manager = PromptManager.getInstance();
  return manager.loadPromptVersion(commandName, version, fileName);
}