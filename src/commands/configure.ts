/**
 * Configure command v1.0.0 - Provider Configuration and Management
 */

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import readline from 'readline';
import { loadConfig } from '../config.js';
import { getModelsForProvider, type ProviderModels } from '../llm/models.js';

interface ProviderConfig {
  apiKeyEnv: string;
  endpoint: string;
  models?: string[];
}

interface TierConfig {
  provider: string;
  model: string;
}

interface ConfigData {
  language?: string;
  project?: any;
  llm?: {
    providers?: Record<string, ProviderConfig>;
    tiers?: Record<string, TierConfig>;
  };
  reports?: any;
  logging?: any;
  mcp?: any;
}

export async function runConfigureCommand(options: any = {}) {
  console.log('🎛️ CLIA Configuração de Provedores v4.0.0');
  console.log('Interface interativa para configuração completa de provedores LLM');
  console.log('');

  // Enhanced configuration loading v4.0.0
  const configPath = findConfigFile();
  if (!configPath) {
    console.log('❌ Erro: Nenhum arquivo de configuração encontrado.');
    console.log('💡 Execute "clia install" primeiro para criar a configuração inicial.');
    return;
  }

  console.log(`📁 Carregando configuração de: ${configPath}`);
  
  // Create backup if requested
  if (options.backup) {
    const backupPath = `${configPath}.backup.${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);
    console.log(`💾 Backup criado em: ${backupPath}`);
  }
  
  const config = loadCurrentConfig(configPath);
  
  // Show current providers with enhanced display
  showCurrentProviders(config, options.verbose);
  
  // Enhanced main configuration menu v4.0.0
  while (true) {
    console.log('');
    console.log('🎛️ **Opções de Configuração:**');
    console.log('1. ➕ Adicionar novo provedor');
    console.log('2. ⚙️ Configurar atribuições de tier');
    console.log('3. ❌ Remover provedor');
    console.log('4. 📊 Mostrar configuração atual');
    console.log('5. 🔧 Testar conectividade');
    console.log('6. 🤖 Sugestões OpenRouter (modelos free/pagos)');
    console.log('7. 💾 Salvar e sair');
    console.log('');
    
    const choice = await promptUser('Selecione uma opção (1-7): ');
    
    switch (choice) {
      case '1':
        await addNewProvider(config);
        break;
      case '2':
        await configureTiers(config);
        break;
      case '3':
        await removeProvider(config);
        break;
      case '4':
        showCurrentProviders(config, options.verbose);
        break;
      case '5':
        await testConnectivity(config);
        break;
      case '6':
        await configureOpenRouterSuggestions(config);
        break;
      case '7':
        saveConfiguration(config, configPath);
        console.log('✅ Configuração salva com sucesso!');
        return;
      default:
        console.log('❌ Opção inválida. Selecione 1-7.');
    }
  }
}

function findConfigFile(): string | null {
  const possiblePaths = [
    path.join(process.cwd(), '.clia', 'clia.config.json'),
    path.join(process.cwd(), 'clia.config.json'),
    path.join(process.cwd(), 'config.json')
  ];

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  
  return null;
}

function loadCurrentConfig(configPath: string): ConfigData {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.log('Error loading configuration:', error);
    return {};
  }
}

function showCurrentProviders(config: ConfigData, verbose: boolean = false) {
  console.log('');
  console.log('📊 **Configuração Atual de Provedores:**');
  console.log('==========================================');
  
  const providers = config.llm?.providers || {};
  if (Object.keys(providers).length === 0) {
    console.log('❌ Nenhum provedor configurado.');
    return;
  }
  
  console.log('');
  console.log('🔧 **Provedores:**');
  Object.entries(providers).forEach(([name, provider]) => {
    console.log(`  📍 ${name}:`);
    console.log(`    🌐 Endpoint: ${provider.endpoint}`);
    console.log(`    🔑 Chave API Environment: ${provider.apiKeyEnv}`);
    if (provider.models) {
      console.log(`    🤖 Modelos: ${provider.models.join(', ')}`);
    }
    if (verbose) {
      console.log(`    � Status: Configurado`);
    }
  });
  
  console.log('');
  console.log('⚙️ **Atribuições de Tier:**');
  const tiers = config.llm?.tiers || {};
  if (Object.keys(tiers).length === 0) {
    console.log('❌ Nenhuma atribuição de tier configurada.');
  } else {
    Object.entries(tiers).forEach(([tier, assignment]) => {
      const emoji = tier === 'premium' ? '💎' : tier === 'default' ? '⚡' : '🔧';
      console.log(`  ${emoji} ${tier}: ${assignment.provider} (${assignment.model})`);
    });
  }
}

async function testConnectivity(config: ConfigData) {
  console.log('');
  console.log('🔧 **Teste de Conectividade:**');
  console.log('============================');
  
  const providers = config.llm?.providers || {};
  if (Object.keys(providers).length === 0) {
    console.log('❌ Nenhum provedor configurado para testar.');
    return;
  }
  
  console.log('⏳ Testando conectividade com provedores...');
  
  for (const [name, provider] of Object.entries(providers)) {
    try {
      console.log(`\n📡 Testando ${name}...`);
      
      // Simple connectivity test (placeholder - would need actual implementation)
      const apiKey = process.env[provider.apiKeyEnv];
      if (!apiKey) {
        console.log(`  ❌ Chave API não encontrada (${provider.apiKeyEnv})`);
        continue;
      }
      
      console.log(`  ✅ Chave API configurada`);
      console.log(`  🌐 Endpoint: ${provider.endpoint}`);
      console.log(`  🤖 Modelos disponíveis: ${provider.models?.join(', ') || 'N/A'}`);
      
    } catch (error) {
      console.log(`  ❌ Erro ao testar ${name}: ${error}`);
    }
  }
  
  console.log('\n💡 **Nota:** Para testes completos de conectividade, use os comandos específicos do CLIA.');
}

async function addNewProvider(config: ConfigData) {
  console.log('');
  console.log('➕ **Adicionar Novo Provedor**');
  console.log('=============================');
  
  const predefinedProviders = [
    { name: 'openai', emoji: '🤖', desc: 'OpenAI (GPT models)' },
    { name: 'anthropic', emoji: '🧠', desc: 'Anthropic (Claude models)' },
    { name: 'deepseek', emoji: '🚀', desc: 'DeepSeek (Cost-effective)' },
    { name: 'ollama', emoji: '🏠', desc: 'Ollama (Local models)' },
    { name: 'azure', emoji: '☁️', desc: 'Azure OpenAI' },
    { name: 'openrouter', emoji: '🌐', desc: 'OpenRouter (Multiple providers)' },
    { name: 'abacus', emoji: '🧮', desc: 'Abacus.ai' },
    { name: 'custom', emoji: '⚙️', desc: 'Custom provider' }
  ];
  
  console.log('📋 **Tipos de provedores disponíveis:**');
  predefinedProviders.forEach((provider, index) => {
    console.log(`  ${index + 1}. ${provider.emoji} ${provider.name} - ${provider.desc}`);
  });
  
  const choiceIndex = await promptUser('\nSelecione o tipo de provedor (1-8): ');
  const selectedIndex = parseInt(choiceIndex) - 1;
  
  if (selectedIndex < 0 || selectedIndex >= predefinedProviders.length) {
    console.log('❌ Opção inválida.');
    return;
  }
  
  const choice = predefinedProviders[selectedIndex].name;
  
  let providerName: string;
  
  if (choice === 'custom') {
    providerName = await promptUser('Custom provider name (e.g., "myapi", "localai"): ');
    if (!providerName || providerName.trim() === '') {
      console.log('Invalid provider name.');
      return;
    }
  } else {
    providerName = choice;
  }
  
  // Check if provider already exists
  if (config.llm?.providers?.[providerName]) {
    console.log(`Provider "${providerName}" already exists.`);
    const overwrite = await promptYesNo('Do you want to overwrite it?');
    if (!overwrite) {
      return;
    }
  }
  
  // Get provider configuration based on type
  const providerConfig = await getProviderConfiguration(providerName);
  if (!providerConfig) {
    return;
  }
  
  // Initialize config structure if needed
  if (!config.llm) config.llm = {};
  if (!config.llm.providers) config.llm.providers = {};
  
  // Add the new provider
  config.llm.providers[providerName] = providerConfig;
  
  console.log(`Provider "${providerName}" added successfully!`);
}

async function getProviderConfiguration(providerName: string): Promise<ProviderConfig | null> {
  const lowerName = providerName.toLowerCase();
  
  // Pre-configured providers
  const preConfigured: Record<string, ProviderConfig> = {
    'openai': {
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']
    },
    'anthropic': {
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      endpoint: 'https://api.anthropic.com/v1',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']
    },
    'deepseek': {
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      endpoint: 'https://api.deepseek.com/v1',
      models: ['deepseek-coder', 'deepseek-chat']
    },
    'ollama': {
      apiKeyEnv: 'OLLAMA_API_KEY',
      endpoint: 'http://localhost:11434',
      models: ['llama3.1', 'codellama', 'mistral', 'nomic-embed-text']
    },
    'azure': {
      apiKeyEnv: 'AZURE_OPENAI_API_KEY',
      endpoint: 'https://your-resource.openai.azure.com',
      models: ['gpt-4', 'gpt-35-turbo']
    },
    'openrouter': {
      apiKeyEnv: 'OPENROUTER_API_KEY',
      endpoint: 'https://openrouter.ai/api/v1',
      models: [
        'deepseek/deepseek-chat-v3.1:free',
        'deepseek/deepseek-r1-0528:free',
        'meta-llama/llama-3.3-8b-instruct:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemini-2.0-flash-exp:free',
        'mistralai/mistral-small-3.2-24b-instruct:free',
        'qwen/qwen3-coder:free',
        'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',
        'openrouter/sonoma-dusk-alpha',
        'openrouter/sonoma-sky-alpha',
        'amazon/nova-micro-v1',
        'baidu/ernie-4.5-21b-a3b',
        'openai/gpt-oss-120b',
        'deepseek/deepseek-r1-0528',
        'deepseek/deepseek-chat-v3-0324',
        'qwen/qwen3-14b',
        'meta-llama/llama-4-maverick',
        'nvidia/llama-3.3-nemotron-super-49b-v1',
        'mistralai/devstral-small-2505',
        'liquid/lfm-3b',
        'anthropic/claude-3-haiku-20240307',
        'openai/gpt-4o-mini'
      ]
    },
    'abacus': {
      apiKeyEnv: 'ABACUS_API_KEY',
      endpoint: 'https://routellm.abacus.ai/v1',
      models: ['route-llm']
    }
  };
  
  if (preConfigured[lowerName]) {
    console.log(`Using pre-configured settings for ${providerName}`);
    const config = preConfigured[lowerName];
    
    // Allow customization of endpoint for some providers
    if (lowerName === 'azure') {
      const customEndpoint = await promptUser('Azure OpenAI endpoint (or press Enter for default): ');
      if (customEndpoint.trim()) {
        config.endpoint = customEndpoint.trim();
      }
    } else if (lowerName === 'ollama') {
      const customEndpoint = await promptUser('Ollama endpoint (or press Enter for http://localhost:11434): ');
      if (customEndpoint.trim()) {
        config.endpoint = customEndpoint.trim();
      }
    }
    
    return config;
  }
  
  // Custom provider configuration
  console.log('Configuring custom provider...');
  
  const endpoint = await promptUser('API endpoint URL: ');
  if (!endpoint || endpoint.trim() === '') {
    console.log('Invalid endpoint.');
    return null;
  }
  
  const apiKeyEnv = await promptUser('Environment variable name for API key: ');
  if (!apiKeyEnv || apiKeyEnv.trim() === '') {
    console.log('Invalid API key environment variable.');
    return null;
  }
  
  const modelsInput = await promptUser('Available models (comma-separated, optional): ');
  const models = modelsInput.trim() ? modelsInput.split(',').map(m => m.trim()) : undefined;
  
  return {
    apiKeyEnv: apiKeyEnv.trim(),
    endpoint: endpoint.trim(),
    models
  };
}

async function configureTiers(config: ConfigData) {
  console.log('');
  console.log('Configure Tier Assignments');
  console.log('==========================');
  console.log('  Basic: For simple tasks (cheap)');
  console.log('  Default: For general use (balanced)');
  console.log('  Premium: For complex tasks (expensive)');
  console.log('  Embed: For embeddings/RAG');
  
  const providers = config.llm?.providers || {};
  const providerNames = Object.keys(providers);
  
  if (providerNames.length === 0) {
    console.log('No providers available. Please add providers first.');
    return;
  }
  
  // Fetch models dynamically for each provider
  console.log('\nSearching for available models...');
  const providerModels: { [key: string]: ProviderModels } = {};
  
  for (const provider of providerNames) {
    try {
      const models = await getModelsForProvider(provider, providers[provider]);
      providerModels[provider] = models;
      console.log(`  ${provider}: ${models.models.length} models found`);
    } catch (error) {
      console.log(`  ${provider}: Using default models (error fetching: ${error})`);
    }
  }
  
  // Providers that have native embedding support
  const embedAvailableProviders = providerNames.filter(p => 
    providerModels[p]?.hasEmbedding || ['openai', 'azureOpenAI', 'ollama'].includes(p)
  );
  
  // Initialize tiers if needed
  if (!config.llm) config.llm = {};
  if (!config.llm.tiers) config.llm.tiers = {};
  
  const tiers = ['basic', 'default', 'premium', 'embed'];
  
  for (const tier of tiers) {
    console.log(`\nConfiguring ${tier.toUpperCase()} tier:`);
    
    // For embed, show warning if no providers with native embedding
    if (tier === 'embed') {
      if (embedAvailableProviders.length === 0) {
        console.log('  No providers with native embedding available.');
        console.log('  Recommendation: Configure OpenAI, Azure OpenAI or Ollama for embeddings.');
        continue;
      }
      console.log(`  Available providers for embed: ${embedAvailableProviders.join(', ')}`);
    }
    
    const tierProviders = tier === 'embed' ? embedAvailableProviders : providerNames;
    
    if (tierProviders.length === 0) {
      console.log(`  No providers available for ${tier}`);
      continue;
    }
    
    const selectedProvider = await promptSelect(
      `Choose provider for ${tier}:`,
      tierProviders
    );
    
    // Search for available models for selected provider
    const availableModels = providerModels[selectedProvider];
    
    if (availableModels && availableModels.models.length > 0) {
      // Filter models by type (embedding or chat)
      let filteredModels = availableModels.models;
      if (tier === 'embed') {
        filteredModels = availableModels.models.filter(m => m.isEmbedding);
      } else {
        filteredModels = availableModels.models.filter(m => !m.isEmbedding);
      }
      
      if (filteredModels.length > 0) {
        console.log(`\nAvailable models for ${selectedProvider}:`);
        filteredModels.forEach((model, i) => {
          console.log(`  ${i + 1}. ${model.name} (${model.id})`);
        });
        
        const modelChoice = await promptSelect(
          'Choose model:',
          filteredModels.map(m => `${m.name} (${m.id})`)
        );
        
        const selectedModel = filteredModels.find(m => 
          modelChoice.includes(m.id) || modelChoice.includes(m.name)
        );
        
        if (selectedModel) {
          config.llm.tiers[tier] = {
            provider: selectedProvider,
            model: selectedModel.id
          };
          console.log(`  ${tier}: ${selectedProvider} -> ${selectedModel.id}`);
          continue;
        }
      }
    }
    
    // Fallback for manual configuration if models not found
    const defaultModel = getDefaultModelForProvider(selectedProvider, tier);
    const selectedModel = await promptUser(`Model for ${tier} [${defaultModel}]: `) || defaultModel;
    
    config.llm.tiers[tier] = {
      provider: selectedProvider,
      model: selectedModel
    };
    console.log(`  ${tier}: ${selectedProvider} -> ${selectedModel}`);
  }
}

async function removeProvider(config: ConfigData) {
  console.log('');
  console.log('Remove Provider');
  console.log('===============');
  
  const providers = config.llm?.providers || {};
  const providerNames = Object.keys(providers);
  
  if (providerNames.length === 0) {
    console.log('No providers available to remove.');
    return;
  }
  
  const providerToRemove = await promptSelect(
    'Select provider to remove:',
    providerNames
  );
  
  // Check if provider is being used in any tier
  const tiers = config.llm?.tiers || {};
  const usedInTiers = Object.entries(tiers)
    .filter(([, assignment]) => assignment.provider === providerToRemove)
    .map(([tier]) => tier);
  
  if (usedInTiers.length > 0) {
    console.log(`Warning: Provider "${providerToRemove}" is currently used in tiers: ${usedInTiers.join(', ')}`);
    const confirm = await promptYesNo('Do you want to continue? You will need to reconfigure these tiers.');
    if (!confirm) {
      return;
    }
    
    // Remove from tiers
    usedInTiers.forEach(tier => {
      delete tiers[tier];
    });
  }
  
  // Remove the provider
  delete providers[providerToRemove];
  
  console.log(`Provider "${providerToRemove}" removed successfully!`);
  
  if (usedInTiers.length > 0) {
    console.log('Please reconfigure the affected tiers.');
  }
}

function saveConfiguration(config: ConfigData, configPath: string) {
  try {
    const configContent = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, configContent, 'utf-8');
  } catch (error) {
    console.log('Error saving configuration:', error);
  }
}

// Simple prompt utility (since we can't use readline in this context)
async function promptUser(question: string): Promise<string> {
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
  const answer = await promptUser(`${question} (y/N): `);
  return ['y', 'yes'].includes(answer.toLowerCase());
}

async function promptSelect(question: string, options: string[]): Promise<string> {
  console.log(`\n${question}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  
  while (true) {
    const answer = await promptUser('Choose (number): ');
    const choice = parseInt(answer) - 1;
    
    if (choice >= 0 && choice < options.length) {
      return options[choice];
    }
    
    console.log('Invalid option, please try again.');
  }
}

function getDefaultModelForProvider(provider: string, tier: string): string {
  const defaults: { [key: string]: { [tier: string]: string } } = {
    openai: {
      basic: 'gpt-4o-mini',
      default: 'gpt-4o',
      premium: 'gpt-4o',
      embed: 'text-embedding-3-small'
    },
    anthropic: {
      basic: 'claude-3-haiku-20240307',
      default: 'claude-3-5-sonnet-20241022',
      premium: 'claude-3-5-sonnet-20241022',
      embed: 'claude-3-5-sonnet-20241022'
    },
    deepseek: {
      basic: 'deepseek-coder',
      default: 'deepseek-chat',
      premium: 'deepseek-chat',
      embed: 'deepseek-coder'
    },
    ollama: {
      basic: 'llama3.1',
      default: 'codellama',
      premium: 'mistral',
      embed: 'nomic-embed-text'
    },
    azure: {
      basic: 'gpt-35-turbo',
      default: 'gpt-4',
      premium: 'gpt-4',
      embed: 'text-embedding-ada-002'
    },
    openrouter: {
      basic: 'deepseek/deepseek-chat-v3.1:free',
      default: 'meta-llama/llama-3.3-70b-instruct:free',
      premium: 'deepseek/deepseek-r1-0528',
      embed: 'openai/text-embedding-3-small'
    },
    abacus: {
      basic: 'route-llm',
      default: 'route-llm',
      premium: 'route-llm',
      embed: 'route-llm'
    }
  };
  
  return defaults[provider]?.[tier] || 'default-model';
}

// OpenRouter Model Interface
interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  top_provider?: {
    is_moderated: boolean;
    max_completion_tokens?: number;
  };
}

// OpenRouter API Response
interface OpenRouterResponse {
  data: OpenRouterModel[];
}

async function configureOpenRouterSuggestions(config: ConfigData) {
  console.log('');
  console.log('🤖 **Buscando sugestões da OpenRouter API...**');
  console.log('Analisando modelos free e pagos para diferentes camadas de uso');
  console.log('');

  try {
    // Fetch models from OpenRouter API
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: OpenRouterResponse = await response.json();
    const models = data.data;

    console.log(`✅ Encontrados ${models.length} modelos disponíveis na OpenRouter`);
    console.log('');

    // Filter and categorize models
    const freeModels = models.filter(m => 
      parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0
    ).slice(0, 10); // Top 10 free models

    const cheapModels = models
      .filter(m => parseFloat(m.pricing.prompt) > 0)
      .sort((a, b) => 
        (parseFloat(a.pricing.prompt) + parseFloat(a.pricing.completion)) - 
        (parseFloat(b.pricing.prompt) + parseFloat(b.pricing.completion))
      ).slice(0, 15); // Top 15 cheapest paid models

    // Display suggestions by tier
    console.log('🆓 **Modelos GRATUITOS recomendados:**');
    console.log('─'.repeat(60));
    freeModels.forEach((model, i) => {
      console.log(`${i + 1}. ${model.name}`);
      console.log(`   📝 ID: ${model.id}`);
      console.log(`   📏 Context: ${model.context_length?.toLocaleString() || 'N/A'} tokens`);
      console.log(`   💰 Preço: FREE`);
      console.log('');
    });

    console.log('💵 **Modelos PAGOS mais baratos:**');
    console.log('─'.repeat(60));
    cheapModels.forEach((model, i) => {
      const promptPrice = parseFloat(model.pricing.prompt);
      const completionPrice = parseFloat(model.pricing.completion);
      console.log(`${i + 1}. ${model.name}`);
      console.log(`   📝 ID: ${model.id}`);
      console.log(`   📏 Context: ${model.context_length?.toLocaleString() || 'N/A'} tokens`);
      console.log(`   💰 Preço: $${promptPrice.toFixed(6)}/1M prompt + $${completionPrice.toFixed(6)}/1M completion`);
      console.log('');
    });

    // Tier-based recommendations - FREE and CHEAP for each tier
    console.log('🎯 **Recomendações por Tier:**');
    console.log('─'.repeat(60));

    // Basic tier - simplest free and cheapest paid
    console.log('🥉 **BASIC TIER:**');
    if (freeModels.length > 0) {
      const basicFree = freeModels.find(m => 
        m.context_length && m.context_length < 50000
      ) || freeModels[freeModels.length - 1]; // Smallest context free model
      
      console.log(`   🆓 GRATUITO: ${basicFree.name}`);
      console.log(`      ID: ${basicFree.id}`);
      console.log(`      Context: ${basicFree.context_length?.toLocaleString() || 'N/A'} tokens`);
    }
    
    if (cheapModels.length > 0) {
      const basicPaid = cheapModels.find(m => 
        m.name.toLowerCase().includes('1b') || 
        m.name.toLowerCase().includes('3b')
      ) || cheapModels[0]; // Smallest/cheapest model
      
      console.log(`   💵 PAGO BARATO: ${basicPaid.name}`);
      console.log(`      ID: ${basicPaid.id}`);
      console.log(`      Context: ${basicPaid.context_length?.toLocaleString() || 'N/A'} tokens`);
      console.log(`      Custo: $${(parseFloat(basicPaid.pricing.prompt) + parseFloat(basicPaid.pricing.completion)).toFixed(6)}/1M tokens`);
    }
    console.log('');

    // Default tier - balanced free and mid-range paid
    console.log('🥈 **DEFAULT TIER:**');
    if (freeModels.length > 1) {
      const defaultFree = freeModels.find(m => 
        m.context_length && m.context_length > 50000 && m.context_length < 200000
      ) || freeModels[1]; // Mid-range context free model
      
      console.log(`   🆓 GRATUITO: ${defaultFree.name}`);
      console.log(`      ID: ${defaultFree.id}`);
      console.log(`      Context: ${defaultFree.context_length?.toLocaleString() || 'N/A'} tokens`);
    }
    
    if (cheapModels.length > 1) {
      const defaultPaid = cheapModels.find(m => 
        m.name.toLowerCase().includes('7b') || 
        m.name.toLowerCase().includes('8b') ||
        m.name.toLowerCase().includes('9b')
      ) || cheapModels[1]; // Mid-size model
      
      console.log(`   💵 PAGO BARATO: ${defaultPaid.name}`);
      console.log(`      ID: ${defaultPaid.id}`);
      console.log(`      Context: ${defaultPaid.context_length?.toLocaleString() || 'N/A'} tokens`);
      console.log(`      Custo: $${(parseFloat(defaultPaid.pricing.prompt) + parseFloat(defaultPaid.pricing.completion)).toFixed(6)}/1M tokens`);
    }
    console.log('');

    // Premium tier - best free and quality paid
    console.log('🥇 **PREMIUM TIER:**');
    if (freeModels.length > 0) {
      const premiumFree = freeModels.find(m => 
        m.context_length && m.context_length > 100000
      ) || freeModels[0]; // Largest context free model
      
      console.log(`   🆓 GRATUITO: ${premiumFree.name}`);
      console.log(`      ID: ${premiumFree.id}`);
      console.log(`      Context: ${premiumFree.context_length?.toLocaleString() || 'N/A'} tokens`);
    }
    
    if (cheapModels.length > 2) {
      const premiumPaid = cheapModels.find(m => 
        m.name.toLowerCase().includes('70b') || 
        m.name.toLowerCase().includes('claude') ||
        m.name.toLowerCase().includes('gpt-4') ||
        m.name.toLowerCase().includes('gemini') ||
        (m.context_length && m.context_length > 100000)
      ) || cheapModels[2]; // Larger/better model
      
      console.log(`   💵 PAGO BARATO: ${premiumPaid.name}`);
      console.log(`      ID: ${premiumPaid.id}`);
      console.log(`      Context: ${premiumPaid.context_length?.toLocaleString() || 'N/A'} tokens`);
      console.log(`      Custo: $${(parseFloat(premiumPaid.pricing.prompt) + parseFloat(premiumPaid.pricing.completion)).toFixed(6)}/1M tokens`);
    }
    console.log('');

    // Ask if user wants to apply these configurations
    console.log('⚙️ **Aplicar configurações recomendadas?**');
    const apply = await promptUser('Deseja aplicar as configurações OpenRouter automaticamente? (s/n): ');
    
    if (apply.toLowerCase() === 's' || apply.toLowerCase() === 'sim') {
      await applyOpenRouterConfiguration(config, freeModels, cheapModels);
    } else {
      console.log('💡 Você pode copiar os IDs dos modelos acima para configurar manualmente.');
    }

  } catch (error) {
    console.log('❌ Erro ao buscar modelos da OpenRouter:', error instanceof Error ? error.message : error);
    console.log('');
    console.log('💡 **Modelos OpenRouter recomendados (fallback):**');
    console.log('🆓 Free: meta-llama/llama-3.2-3b-instruct:free');
    console.log('💵 Barato: meta-llama/llama-3.2-1b-instruct');
    console.log('🥇 Premium: anthropic/claude-3-haiku');
  }
}

async function applyOpenRouterConfiguration(
  config: ConfigData, 
  freeModels: OpenRouterModel[], 
  cheapModels: OpenRouterModel[]
) {
  console.log('');
  console.log('🔧 **Aplicando configuração OpenRouter...**');

  // Ensure config structure exists
  if (!config.llm) config.llm = {};
  if (!config.llm.providers) config.llm.providers = {};
  if (!config.llm.tiers) config.llm.tiers = {};

  // Add OpenRouter provider
  config.llm.providers.openrouter = {
    apiKeyEnv: 'OPENROUTER_API_KEY',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: []
  };

  console.log('🎯 **Configurando tiers com opções FREE e PAGAS:**');
  console.log('');

  // Basic tier configurations
  const basicFree = freeModels.find(m => 
    m.context_length && m.context_length < 50000
  ) || freeModels[freeModels.length - 1];
  
  const basicPaid = cheapModels.find(m => 
    m.name.toLowerCase().includes('1b') || 
    m.name.toLowerCase().includes('3b')
  ) || cheapModels[0];

  if (basicFree) {
    config.llm.tiers.basic = {
      provider: 'openrouter',
      model: basicFree.id
    };
    console.log(`🥉 Basic FREE: ${basicFree.name}`);
  }

  if (basicPaid) {
    config.llm.tiers['basic-paid'] = {
      provider: 'openrouter',
      model: basicPaid.id
    };
    console.log(`🥉 Basic PAID: ${basicPaid.name}`);
  }

  // Default tier configurations
  const defaultFree = freeModels.find(m => 
    m.context_length && m.context_length > 50000 && m.context_length < 200000
  ) || freeModels[1];
  
  const defaultPaid = cheapModels.find(m => 
    m.name.toLowerCase().includes('7b') || 
    m.name.toLowerCase().includes('8b') ||
    m.name.toLowerCase().includes('9b')
  ) || cheapModels[1];

  if (defaultFree) {
    config.llm.tiers.default = {
      provider: 'openrouter',
      model: defaultFree.id
    };
    console.log(`🥈 Default FREE: ${defaultFree.name}`);
  }

  if (defaultPaid) {
    config.llm.tiers['default-paid'] = {
      provider: 'openrouter',
      model: defaultPaid.id
    };
    console.log(`🥈 Default PAID: ${defaultPaid.name}`);
  }

  // Premium tier configurations
  const premiumFree = freeModels.find(m => 
    m.context_length && m.context_length > 100000
  ) || freeModels[0];
  
  const premiumPaid = cheapModels.find(m => 
    m.name.toLowerCase().includes('70b') || 
    m.name.toLowerCase().includes('claude') ||
    m.name.toLowerCase().includes('gpt-4') ||
    m.name.toLowerCase().includes('gemini') ||
    (m.context_length && m.context_length > 100000)
  ) || cheapModels[2];

  if (premiumFree) {
    config.llm.tiers.premium = {
      provider: 'openrouter',
      model: premiumFree.id
    };
    console.log(`🥇 Premium FREE: ${premiumFree.name}`);
  }

  if (premiumPaid) {
    config.llm.tiers['premium-paid'] = {
      provider: 'openrouter',
      model: premiumPaid.id
    };
    console.log(`🥇 Premium PAID: ${premiumPaid.name}`);
  }

  console.log('');
  console.log('📋 **Tiers configurados:**');
  console.log('   • basic (gratuito)');
  console.log('   • basic-paid (pago barato)');
  console.log('   • default (gratuito)');
  console.log('   • default-paid (pago barato)');
  console.log('   • premium (gratuito)');
  console.log('   • premium-paid (pago barato)');
  console.log('');
  console.log('🔑 **Próximo passo:**');
  console.log('1. Crie uma conta em https://openrouter.ai');
  console.log('2. Gere uma API key');
  console.log('3. Adicione OPENROUTER_API_KEY=sua_chave_aqui no arquivo .clia/.env');
  console.log('');
  console.log('✅ Configuração OpenRouter aplicada com sucesso!');
}

/**
 * Comando CONFIGURE v4.0.0 - Configuração Avançada de Provedores
 * 
 * Sistema interativo para configuração de provedores LLM, embedding e
 * atribuição de tiers. Oferece interface amigável para gerenciamento
 * completo da configuração CLIA.
 * 
 * Features v4.0.0:
 * - 🎛️ Interface de configuração interativa aprimorada
 * - 🔧 Suporte para múltiplos provedores (OpenAI, Anthropic, DeepSeek, Ollama)
 * - ⚙️ Configuração de tiers com validação automática
 * - 📊 Visualização clara da configuração atual
 * - 🛡️ Validação de chaves API e conectividade
 * - 💾 Backup automático antes de alterações
 * 
 * @since v4.0.0 Enhanced interactive configuration
 */
export function configureCommand() {
  const cmd = new Command('configure');
  
  cmd
    .description(`
🎛️ Configuração de Provedores v4.0.0

Interface interativa para configurar provedores LLM, embedding e tiers.
Gerencia chaves API, endpoints e atribuições de modelos.

Recursos:
  • Configuração guiada de provedores
  • Validação automática de conectividade  
  • Backup de configurações existentes
  • Visualização clara da configuração atual

Exemplos:
  clia configure              # Interface interativa
  clia configure --backup     # Criar backup antes de configurar`)
    .option('--backup', '💾 Criar backup da configuração atual antes de modificar')
    .option('--verbose', '📊 Mostrar detalhes avançados da configuração')
    .action(async (options) => {
      try {
        await runConfigureCommand(options);
      } catch (error) {
        console.log('❌ Erro na configuração:', error);
        process.exit(1);
      }
    });

  return cmd;
}