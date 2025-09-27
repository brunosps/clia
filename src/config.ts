/**
 * Sistema de configuração central do CLIA v0.2.1
 * 
 * Carrega configurações de múltiplas fontes:
 * - clia.config.json (prioridade)
 * - config.json (fallback)  
 * - config.sample.json (default)
 * - Variáveis de ambiente (.clia/.env)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { adaptConfig } from './shared/config-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  language?: 'pt-BR' | 'en-US';
  translateReports?: boolean;
  project: {
    name?: string;
    instructionsDir: string;
    useRag?: boolean;
    rag: {
      includes: string[];
      excludes: string[];
      chunkSize: number;
      chunkOverlap: number;
      paths?: string[];
      embeddings?: 'auto' | 'llm' | 'transformers';
    };
  };
  llm: {
    providers: {
      openai?: { apiKeyEnv: string; endpoint: string; };
      anthropic?: { apiKeyEnv: string; endpoint: string; };
      deepseek?: { apiKeyEnv: string; endpoint: string; };
      azureOpenAI?: {
        apiKeyEnv: string;
        endpointEnv: string;
        apiVersion: string;
        deployments: {
          basic: string;
          default: string;
          premium: string;
          embed: string;
        };
      };
      openrouter?: { apiKeyEnv: string; endpoint: string; };
      ollama?: { endpoint?: string; apiKeyEnv?: string; };
    };
    tiers: {
      basic: { provider: string; deployment?: string; model?: string; };
      default: { provider: string; deployment?: string; model?: string; };
      premium: { provider: string; deployment?: string; model?: string; };
      embed: { provider: string; deployment?: string; model?: string; };
    };
    debug?: any;
    promptRefinement?: any;
  };
  logging?: {
    level: 'error' | 'warn' | 'info' | 'debug';
    enableConsole?: boolean;
    file?: {
      enabled: boolean;
      path: string;
      maxFiles: number;
      maxSize: string;
    };
    rotation?: {
      enabled: boolean;
      interval: string;
    };
  };
  reports?: {
    enabled: boolean;
    outputDir: string;
    formats: string[];
    autoSave: boolean;
    keepHistory: number;
  };
  mcp: {
    enabled: boolean;
    servers: Record<string, string>;
  };
  review?: {
    severityThreshold: string;
    ci: { defaultOutput: string; };
  };
  security?: {
    requireApprovalForUnknown?: boolean;
    allowCommands?: any[];
    denyCommands?: any[];
  };
}

// Cache da configuração para evitar múltiplas leituras
let configCache: Config | null = null;

export function loadConfig(cwd = process.cwd()): Config {
  if (configCache) {
    return configCache;
  }

  const candidates = [
    path.join(cwd, '.clia', 'clia.config.json'),
    path.join(cwd, 'clia.config.json'),
    path.join(cwd, 'config.json'),
  ];
  
  let config: any;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      config = JSON.parse(fs.readFileSync(p, 'utf-8'));
      break;
    }
  }
  if (!config) {
    // fallback to sample defaults - procurar em dev e instalação global
    const devConfigPath = path.join(process.cwd(), 'config.sample.json');
    const moduleConfigPath = path.join(__dirname, '..', 'config.sample.json');
    
    let sampleConfigPath: string;
    if (fs.existsSync(devConfigPath)) {
      sampleConfigPath = devConfigPath;
    } else if (fs.existsSync(moduleConfigPath)) {
      sampleConfigPath = moduleConfigPath;
    } else {
      // Fallback: tentar encontrar a partir do módulo instalado
      const packageRoot = path.resolve(__dirname, '../..');
      sampleConfigPath = path.join(packageRoot, 'config.sample.json');
    }
    
    config = JSON.parse(fs.readFileSync(sampleConfigPath, 'utf-8'));
  }

  // Load .env from .clia directory - try current project first, then CLIA installation directory
  let envPath = path.join(cwd, '.clia', '.env');
  let envExists = fs.existsSync(envPath);
  
  // If not found in current project, try to find CLIA installation directory
  if (!envExists) {
    // Try to find the module directory from __dirname
    const moduleRoot = path.resolve(__dirname, '..');  // From dist/ to root
    const cliaEnvPath = path.join(moduleRoot, '.clia', '.env');
    
    if (fs.existsSync(cliaEnvPath)) {
      envPath = cliaEnvPath;
      envExists = true;
    } else {
      // Fallback: try common development path
      const devEnvPath = '/home/bruno/code/ia/clia/.clia/.env';
      if (fs.existsSync(devEnvPath)) {
        envPath = devEnvPath;
        envExists = true;
      }
    }
  }
  
  console.log('🔍 Loading ENV from:', envPath, '- exists:', envExists);
  
  if (envExists) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    console.log('🔍 ENV file content preview:', envContent.slice(0, 50) + '...');
    let loadedCount = 0;
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        const trimmedKey = key.trim();
        const trimmedValue = value.trim().replace(/^["']|["']$/g, '');
        console.log('🔍 Setting env var:', trimmedKey, 'value length:', trimmedValue.length);
        process.env[trimmedKey] = trimmedValue;
        loadedCount++;
        
        if (trimmedKey === 'OPENROUTER_API_KEY') {
          console.log('✅ OPENROUTER_API_KEY loaded successfully');
          console.log('🔍 API key preview:', trimmedValue.slice(0, 10) + '...');
        }
      }
    });
    console.log('✅ Loaded', loadedCount, 'environment variables');
  }

  // Inject environment variables into config
  if (process.env.TRELLO_KEY && process.env.TRELLO_TOKEN && process.env.TRELLO_BOARD_ID) {
    config.trello.enabled = true;
    config.trello.key = process.env.TRELLO_KEY;
    config.trello.token = process.env.TRELLO_TOKEN;
    config.trello.boardId = process.env.TRELLO_BOARD_ID;
  }

  // Aplicar adaptador de compatibilidade
  config = adaptConfig(config);

  // Cache the config
  configCache = config as Config;

  return configCache;
}

/**
 * Obtém o nome do projeto da configuração
 */
export function getProjectName(cwd = process.cwd()): string {
  try {
    return path.basename(cwd);
  } catch {
    return path.basename(cwd);
  }
}
