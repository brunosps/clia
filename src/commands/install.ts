import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import readline from 'readline';
import { getModelsForProviderTier, type ModelInfo } from '../llm/models.js';
import { getLogger } from '../shared/logger.js';

const logger = getLogger();

interface DeploymentConfig {
  [key: string]: string;
}

export interface ProviderConfig {
  apiKeyEnv: string;
  endpoint: string;
  deployments?: DeploymentConfig;
  apiVersion?: string;
  endpointEnv?: string;
  apiKey?: string;
}

interface ProviderInfo {
  name: string;
  key: string;
  env: string;
  endpoint: string;
}

interface SelectedProviders {
  [key: string]: ProviderConfig;
}

interface TierConfiguration {
  [key: string]: TierModel;
}

interface ConfigData {
  version: string;
  language: string;
  project: {
    name: string;
    type: string;
    instructionsDir: string;
    outputDir: string;
  };
  llm: {
    providers: SelectedProviders;
    tiers: TierConfiguration;
    budget: {
      perRunUSD: number;
      dailyLimitUSD: number;
    };
  };
  rag: {
    chunkSize: number;
    chunkOverlap: number;
    indexPath: string;
    embeddings: {
      provider: string;
      model: string;
    };
  };
  mcp: {
    enabled: boolean;
    servers?: {
      [key: string]: string;
    };
  };
  security: {
    policy: string;
    firewall: {
      enabled: boolean;
      strictMode: boolean;
    };
  };
  logging: {
    level: string;
    file: {
      enabled: boolean;
      path: string;
      maxFiles: number;
      maxSize: string;
    };
    rotation: {
      enabled: boolean;
      interval: string;
    };
  };
  reports: {
    enabled: boolean;
    outputDir: string;
    formats: string[];
  };
}

interface TierInfo {
  name: string;
  desc: string;
}

interface TierModel {
  provider: string;
  model?: string;
  deployment?: string;
}

export interface UserPreferences {
  providers: { [key: string]: ProviderConfig };
  apiKeys: { [key: string]: string };
  tiers: {
    basic: TierModel;
    default: TierModel;
    premium: TierModel;
    embed: TierModel;
  };
  instructionsDir: string;
  enableReports: boolean;
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/N): `);
  return ['y', 'yes', 's', 'sim'].includes(answer.toLowerCase());
}

async function promptSelect(question: string, options: string[]): Promise<number> {
  console.log(`\n${question}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  
  while (true) {
    const answer = await prompt('Escolha uma opção (número): ');
    const choice = parseInt(answer) - 1;
    
    if (choice >= 0 && choice < options.length) {
      return choice;
    }
    
    console.log('❌ Opção inválida, tente novamente.');
  }
}

async function promptSelectModel(question: string, options: ModelInfo[]): Promise<ModelInfo> {
  console.log(`\n${question}`);
  options.forEach((opt, i) => {
    const isFree = opt.costHint?.includes('FREE') || opt.costHint?.includes('Free');
    const costBadge = isFree ? '' : opt.costLevel === 'low' ? '' : opt.costLevel === 'medium' ? '' : '';
    const costInfo = opt.costHint ? ` (${opt.costHint})` : '';
    console.log(`  ${i + 1}. ${opt.name} ${costBadge}${costInfo}`);
  });
  
  while (true) {
    const answer = await prompt('Escolha (número): ');
    const choice = parseInt(answer) - 1;
    
    if (choice >= 0 && choice < options.length) {
      return options[choice];
    }
    
    console.log('❌ Opção inválida, tente novamente.');
  }
}

export function installCommand() {
  const cmd = new Command("install");
  
  cmd
    .description("Interactive CLIA setup with multiple LLM providers v1.0.0")
    .option("--dir <path>", "Diretório de destino", process.cwd())
    .action(async (options: { dir: string }) => {
      const targetDir = path.resolve(options.dir);
      
      console.log(`Setup CLIA em: ${targetDir}`);
      
      try {
        logger.info('Iniciando configuração interativa...');
        
        console.log('CLIA Setup Interativo v1.0.0');
        console.log('==================================');
        console.log('Configuração inicial para uso do CLIA em seu projeto\n');
        
        const projectName = await prompt('Nome do projeto: ');
        if (!projectName.trim()) {
          throw new Error('Nome do projeto é obrigatório');
        }
        console.log(`Projeto: ${projectName}`);
        
        console.log('\nSeleção de Idioma:');
        const languages = ['pt-BR (Português Brasil)', 'en-US (English)'];
        const langIndex = await promptSelect('Selecione seu idioma:', languages);
        const selectedLanguage = langIndex === 0 ? 'pt-BR' : 'en-US';
        console.log(`Idioma: ${selectedLanguage}`);
        
        console.log('\n Configuração de Provedores LLM:');
        console.log('Selecione os provedores que deseja configurar (múltipla escolha):');
        
        const providers = [
          { name: 'OpenRouter', key: 'openrouter', env: 'OPENROUTER_API_KEY', endpoint: 'https://openrouter.ai/api/v1' },
          { name: 'Anthropic', key: 'anthropic', env: 'ANTHROPIC_API_KEY', endpoint: 'https://api.anthropic.com' },
          { name: 'OpenAI', key: 'openai', env: 'OPENAI_API_KEY', endpoint: 'https://api.openai.com/v1' },
          { name: 'DeepSeek', key: 'deepseek', env: 'DEEPSEEK_API_KEY', endpoint: 'https://api.deepseek.com' },
          { name: 'Ollama (Local)', key: 'ollama', env: '', endpoint: 'http://localhost:11434' }
        ];
        
        const selectedProviders: SelectedProviders = {};
        const envVars: string[] = [];
        
        for (const provider of providers) {
          const useProvider = await promptYesNo(`Configurar ${provider.name}?`);
          if (useProvider) {
            selectedProviders[provider.key] = {
              endpoint: provider.endpoint,
              apiKeyEnv: provider.env || 'OLLAMA_API_KEY'
            };
            
            if (provider.env) {
              const apiKey = await prompt(`${provider.name} API Key: `);
              if (apiKey.trim()) {
                envVars.push(`${provider.env}=${apiKey.trim()}`);
              }
            }
            console.log(`${provider.name} configurado`);
          }
        }
        
        console.log('\nConfiguração de Tiers:');
        const availableProviders = Object.keys(selectedProviders);
        if (availableProviders.length === 0) {
          logger.warn('Nenhum provedor configurado, usando Ollama como padrão');
          selectedProviders.ollama = {
            endpoint: 'http://localhost:11434',
            apiKeyEnv: 'OLLAMA_API_KEY'
          };
          availableProviders.push('ollama');
        }
        
        const tierConfig: TierConfiguration = {};
        const tiers = [
          { name: 'basic', desc: 'Validações e verificações simples (modelos mais baratos)' },
          { name: 'default', desc: 'Operações padrão e análises (modelos balanceados)' },
          { name: 'premium', desc: 'Planejamento e tarefas complexas (modelos mais avançados)' },
          { name: 'embed', desc: 'Embeddings para RAG (recomendado: Ollama local)' }
        ];
        
        for (const tier of tiers) {
          console.log(`\n Configurando tier "${tier.name}" (${tier.desc}):`);
          
          const providerList = availableProviders.map(p => `${p} ${p === 'ollama' && tier.name === 'embed' ? '(recomendado para embeddings)' : ''}`);
          const providerIndex = await promptSelect(`Provedor para tier ${tier.name}:`, providerList);
          const selectedProvider = availableProviders[providerIndex];
          
          console.log(` Buscando modelos disponíveis para ${selectedProvider}...`);
          
          try {
            const availableModels = await getModelsForProviderTier(selectedProvider, tier.name as 'basic' | 'default' | 'premium' | 'embed');
            
            if (availableModels.length === 0) {
              logger.warn(`Nenhum modelo encontrado para tier ${tier.name}, usando modelo padrão`);
              tierConfig[tier.name] = {
                provider: selectedProvider,
                model: tier.name === 'embed' ? 'nomic-embed-text:latest' : 'default-model'
              };
              continue;
            }
            
            logger.info(`Encontrados ${availableModels.length} modelos para tier ${tier.name}`);
            console.log('= GRATUITO | = Baixo custo | = Custo médio | = Alto custo');
            
            const selectedModel = await promptSelectModel(`Escolha o modelo para tier ${tier.name}:`, availableModels);
            
            tierConfig[tier.name] = {
              provider: selectedProvider,
              model: selectedModel.id
            };
            
            console.log(`Tier ${tier.name}: ${selectedModel.name} (${selectedProvider})`);
            
          } catch (error) {
            logger.warn(`Erro ao buscar modelos para ${selectedProvider}, usando configuração padrão`);
            
            const defaultModels: Record<string, string> = {
              basic: tier.name === 'embed' ? 'nomic-embed-text:latest' : 'llama3.2:3b',
              default: tier.name === 'embed' ? 'nomic-embed-text:latest' : 'llama3.2:8b',
              premium: tier.name === 'embed' ? 'nomic-embed-text:latest' : 'llama3.1:70b',
              embed: 'nomic-embed-text:latest'
            };
            
            tierConfig[tier.name] = {
              provider: selectedProvider,
              model: defaultModels[tier.name]
            };
          }
        }
        
        console.log('\nConfiguração RAG:');
        const chunkSize = await prompt('Tamanho do chunk (padrão: 1000): ') || '1000';
        const chunkOverlap = await prompt('Overlap do chunk (padrão: 200): ') || '200';
        
        console.log('\nConfiguração MCP:');
        const enableMcp = await promptYesNo('Habilitar servidores MCP?');
        const mcpConfig = enableMcp ? {
          enabled: true,
          servers: {
            filesystem: 'mcp+local://filesystem',
            git: 'mcp+local://git',
            semgrep: 'mcp+local://semgrep',
            trivy: 'mcp+local://trivy',
            'stack-detector': 'mcp+local://stack-detector'
          }
        } : { enabled: false };
        
        console.log('\nPolítica de Segurança:');
        const securityLevels = ['permissive', 'moderate', 'restrictive'];
        const securityIndex = await promptSelect('Nível de segurança:', securityLevels);
        const securityLevel = securityLevels[securityIndex];
        
        console.log('\nCriando estrutura de diretórios...');
        
        const cliaDir = path.join(targetDir, '.clia');
        fs.mkdirSync(cliaDir, { recursive: true });
        fs.mkdirSync(path.join(cliaDir, 'logs'), { recursive: true });
        fs.mkdirSync(path.join(cliaDir, 'rag'), { recursive: true });
        fs.mkdirSync(path.join(cliaDir, 'reports'), { recursive: true });
        
        const config = {
          version: "1.0.0",
          language: selectedLanguage,
          project: {
            name: projectName,
            type: "mixed",
            instructionsDir: ".clia/instructions",
            outputDir: "."
          },
          llm: {
            providers: selectedProviders,
            tiers: tierConfig,
            budget: {
              perRunUSD: 1.0,
              dailyLimitUSD: 10.0
            }
          },
          rag: {
            chunkSize: parseInt(chunkSize),
            chunkOverlap: parseInt(chunkOverlap),
            indexPath: ".clia/rag",
            embeddings: {
              provider: tierConfig.embed.provider,
              model: tierConfig.embed.model
            }
          },
          mcp: mcpConfig,
          security: {
            policy: securityLevel,
            firewall: {
              enabled: true,
              strictMode: securityLevel === 'restrictive'
            }
          },
          logging: {
            level: "info",
            file: {
              enabled: true,
              path: ".clia/logs",
              maxFiles: 10,
              maxSize: "10MB"
            },
            rotation: {
              enabled: true,
              interval: "daily"
            }
          },
          reports: {
            enabled: true,
            outputDir: ".clia/reports",
            formats: ["markdown", "json"]
          }
        };
        
        console.log('Salvando configuração...');
        
        const configPath = path.join(cliaDir, 'clia.config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        if (envVars.length > 0) {
          const envPath = path.join(cliaDir, '.env');
          fs.writeFileSync(envPath, envVars.join('\n') + '\n');
          console.log(`Variáveis de ambiente salvas em: ${envPath}`);
        }
        
        const gitignorePath = path.join(cliaDir, '.gitignore');
        fs.writeFileSync(gitignorePath, '.env\n*.log\ntemp/\n');
        
        console.log(`\nConfiguração criada: ${configPath}`);
        console.log('Estrutura de diretórios criada');
        console.log(`Idioma: ${selectedLanguage}`);
        console.log(`Provedores: ${Object.keys(selectedProviders).join(', ')}`);
        console.log(`Política de segurança: ${securityLevel}`);
        console.log('Setup concluído com sucesso!');
        
      } catch (error) {
        logger.error('❌ Erro durante setup:', error);
        console.log('Erro durante setup:', error);
        throw error;
      }
    });

  return cmd;
}
