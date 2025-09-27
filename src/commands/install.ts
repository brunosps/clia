import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import readline from 'readline';
import fetch from 'node-fetch';
import { getModelsForProviderTier, type ModelInfo } from '../llm/models.js';

// ==================== INTERFACES ====================

export interface ProviderConfig {
  apiKeyEnv: string;
  endpoint: string;
  deployments?: any;
  apiVersion?: string;
  endpointEnv?: string;
  apiKey?: string;
}

export interface UserPreferences {
  providers: { [key: string]: ProviderConfig };
  apiKeys: { [key: string]: string };
  tiers: {
    basic: { provider: string; model?: string; deployment?: string };
    default: { provider: string; model?: string; deployment?: string };
    premium: { provider: string; model?: string; deployment?: string };
    embed: { provider: string; model?: string; deployment?: string };
  };
  instructionsDir: string;
  enableReports: boolean;
}

// ==================== UTILITIES ====================

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
    const costBadge = isFree ? '🆓' : opt.costLevel === 'low' ? '💰' : opt.costLevel === 'medium' ? '💰💰' : '💰💰💰';
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
    .description("Setup interativo do CLIA com múltiplos providers LLM")
    .option("--dir <path>", "Diretório de destino", process.cwd())
    .action(async (options) => {
      const targetDir = path.resolve(options.dir);
      
      console.log(`🚀 Setup CLIA em: ${targetDir}`);
      
      try {
        console.log('🔧 Iniciando configuração interativa...');
        
        // Enhanced interactive setup following COMPLETE_DEVELOPMENT_GUIDE.md
        console.log('🚀 CLIA Setup Interativo v4.0.0');
        console.log('==================================');
        console.log('Configuração inicial para uso do CLIA em seu projeto\n');
        
        // 1. Project Information
        const projectName = await prompt('💡 Nome do projeto: ');
        if (!projectName.trim()) {
          console.log('❌ Nome do projeto é obrigatório');
          process.exit(1);
        }
        console.log(`✅ Projeto: ${projectName}`);
        
        // 2. Language Selection
        console.log('\n🌍 Seleção de Idioma:');
        const languages = ['pt-BR (Português Brasil)', 'en-US (English)'];
        const langIndex = await promptSelect('Selecione seu idioma:', languages);
        const selectedLanguage = langIndex === 0 ? 'pt-BR' : 'en-US';
        console.log(`✅ Idioma: ${selectedLanguage}`);
        
        // 3. LLM Provider Selection
        console.log('\n🤖 Configuração de Provedores LLM:');
        console.log('Selecione os provedores que deseja configurar (múltipla escolha):');
        
        const providers = [
          { name: 'OpenRouter', key: 'openrouter', env: 'OPENROUTER_API_KEY', endpoint: 'https://openrouter.ai/api/v1' },
          { name: 'Anthropic', key: 'anthropic', env: 'ANTHROPIC_API_KEY', endpoint: 'https://api.anthropic.com' },
          { name: 'OpenAI', key: 'openai', env: 'OPENAI_API_KEY', endpoint: 'https://api.openai.com/v1' },
          { name: 'DeepSeek', key: 'deepseek', env: 'DEEPSEEK_API_KEY', endpoint: 'https://api.deepseek.com' },
          { name: 'Ollama (Local)', key: 'ollama', env: '', endpoint: 'http://localhost:11434' }
        ];
        
        const selectedProviders: any = {};
        const envVars: string[] = [];
        
        for (const provider of providers) {
          const useProvider = await promptYesNo(`Configurar ${provider.name}?`);
          if (useProvider) {
            selectedProviders[provider.key] = {
              endpoint: provider.endpoint,
              apiKeyEnv: provider.env || undefined
            };
            
            if (provider.env) {
              const apiKey = await prompt(`🔑 ${provider.name} API Key: `);
              if (apiKey.trim()) {
                envVars.push(`${provider.env}=${apiKey.trim()}`);
              }
            }
            console.log(`✅ ${provider.name} configurado`);
          }
        }
        
        // 4. Tier Configuration
        console.log('\n⚙️ Configuração de Tiers:');
        const availableProviders = Object.keys(selectedProviders);
        if (availableProviders.length === 0) {
          console.log('⚠️ Nenhum provedor configurado, usando Ollama como padrão');
          selectedProviders.ollama = {
            endpoint: 'http://localhost:11434'
          };
          availableProviders.push('ollama');
        }
        
        const tierConfig: any = {};
        const tiers = [
          { name: 'basic', desc: 'Validações e verificações simples (modelos mais baratos)' },
          { name: 'default', desc: 'Operações padrão e análises (modelos balanceados)' },
          { name: 'premium', desc: 'Planejamento e tarefas complexas (modelos mais avançados)' },
          { name: 'embed', desc: 'Embeddings para RAG (recomendado: Ollama local)' }
        ];
        
        for (const tier of tiers) {
          console.log(`\n🎯 Configurando tier "${tier.name}" (${tier.desc}):`);
          
          // Escolher provider para o tier
          const providerList = availableProviders.map(p => `${p} ${p === 'ollama' && tier.name === 'embed' ? '(recomendado para embeddings)' : ''}`);
          const providerIndex = await promptSelect(`Provedor para tier ${tier.name}:`, providerList);
          const selectedProvider = availableProviders[providerIndex];
          
          console.log(`🔍 Buscando modelos disponíveis para ${selectedProvider}...`);
          
          try {
            // Buscar modelos para o tier específico
            const availableModels = await getModelsForProviderTier(selectedProvider, tier.name as any);
            
            if (availableModels.length === 0) {
              console.log(`⚠️ Nenhum modelo encontrado para tier ${tier.name}, usando modelo padrão`);
              tierConfig[tier.name] = {
                provider: selectedProvider,
                model: tier.name === 'embed' ? 'nomic-embed-text:latest' : 'default-model'
              };
              continue;
            }
            
            // Garantir pelo menos 4 opções se possível, mas mostrar todos disponíveis
            const modelsToShow = availableModels.length >= 4 ? availableModels : availableModels;
            
            console.log(`💡 Encontrados ${availableModels.length} modelos para tier ${tier.name}`);
            console.log('🆓 = GRATUITO | 💰 = Baixo custo | 💰💰 = Custo médio | 💰💰💰 = Alto custo');
            
            const selectedModel = await promptSelectModel(`Escolha o modelo para tier ${tier.name}:`, modelsToShow);
            
            tierConfig[tier.name] = {
              provider: selectedProvider,
              model: selectedModel.id
            };
            
            console.log(`✅ Tier ${tier.name}: ${selectedModel.name} (${selectedProvider})`);
            
          } catch (error) {
            console.log(`⚠️ Erro ao buscar modelos para ${selectedProvider}:`, error);
            console.log('📝 Usando configuração padrão');
            
            // Fallback para configuração padrão
            const defaultModels: any = {
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
        
        // 5. RAG Configuration
        console.log('\n🧠 Configuração RAG:');
        const chunkSize = await prompt('Tamanho do chunk (padrão: 1000): ') || '1000';
        const chunkOverlap = await prompt('Overlap do chunk (padrão: 200): ') || '200';
        
        // 6. MCP Configuration
        console.log('\n🔌 Configuração MCP:');
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
        
        // 7. Security Policy
        console.log('\n🛡️ Política de Segurança:');
        const securityLevels = ['permissive', 'moderate', 'restrictive'];
        const securityIndex = await promptSelect('Nível de segurança:', securityLevels);
        const securityLevel = securityLevels[securityIndex];
        
        console.log('\n📁 Criando estrutura de diretórios...');
        
        // Create directory structure
        const cliaDir = path.join(targetDir, '.clia');
        fs.mkdirSync(cliaDir, { recursive: true });
        fs.mkdirSync(path.join(cliaDir, 'logs'), { recursive: true });
        fs.mkdirSync(path.join(cliaDir, 'rag'), { recursive: true });
        fs.mkdirSync(path.join(cliaDir, 'reports'), { recursive: true });
        
        // Create comprehensive configuration
        const config = {
          version: "4.0.0",
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
        
        console.log('💾 Salvando configuração...');
        
        // Save main configuration
        const configPath = path.join(cliaDir, 'clia.config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        // Save environment variables
        if (envVars.length > 0) {
          const envPath = path.join(cliaDir, '.env');
          fs.writeFileSync(envPath, envVars.join('\n') + '\n');
          console.log(`🔑 Variáveis de ambiente salvas em: ${envPath}`);
        }
        
        // Create .gitignore for sensitive files
        const gitignorePath = path.join(cliaDir, '.gitignore');
        fs.writeFileSync(gitignorePath, '.env\n*.log\ntemp/\n');
        
        console.log(`\n✅ Configuração criada: ${configPath}`);
        console.log('📁 Estrutura de diretórios criada');
        console.log(`🌍 Idioma: ${selectedLanguage}`);
        console.log(`🤖 Provedores: ${Object.keys(selectedProviders).join(', ')}`);
        console.log(`🛡️ Política de segurança: ${securityLevel}`);
        console.log('✅ CLIA setup completed!');
        console.log('🎉 Setup concluído com sucesso!');
        
      } catch (error) {
        console.error('❌ Erro durante setup:', error);
        process.exit(1);
      }
    });

  return cmd;
}
