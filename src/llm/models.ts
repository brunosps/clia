/**
 * Sistema de descoberta de modelos LLM por provider
 */
import fetch from 'node-fetch';

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  capabilities?: string[];
  contextWindow?: number;
  isEmbedding?: boolean;
  tier?: 'basic' | 'default' | 'premium' | 'embed';
  costLevel?: 'low' | 'medium' | 'high';
  costHint?: string;
}

export interface ProviderModels {
  provider: string;
  models: ModelInfo[];
  hasEmbedding: boolean;
}

/**
 * Busca modelos disponíveis para OpenAI
 */
async function getOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!response.ok) return getOpenAIFallbackModels();
    
    const data = await response.json() as any;
    const availableModels = data.data.map((model: any) => model.id);
    
    // Retorna modelos conhecidos que estão disponíveis
    return getOpenAIFallbackModels().filter(model => 
      availableModels.includes(model.id)
    );
  } catch {
    return getOpenAIFallbackModels();
  }
}

function getOpenAIFallbackModels(): ModelInfo[] {
  return [
    // Basic tier models (cheapest)
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fastest)', tier: 'basic', costLevel: 'low', costHint: '$0.15/$0.60 per 1M tokens' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Legacy)', tier: 'basic', costLevel: 'low', costHint: '$0.50/$1.50 per 1M tokens' },
    
    // Default tier models (balanced)
    { id: 'gpt-4o', name: 'GPT-4o (Balanced)', tier: 'default', costLevel: 'medium', costHint: '$2.50/$10.00 per 1M tokens' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)', tier: 'default', costLevel: 'low', costHint: '$0.15/$0.60 per 1M tokens' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo (Powerful)', tier: 'default', costLevel: 'medium', costHint: '$10.00/$30.00 per 1M tokens' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Economy)', tier: 'default', costLevel: 'low', costHint: '$0.50/$1.50 per 1M tokens' },
    
    // Premium tier models (most capable)
    { id: 'gpt-4o', name: 'GPT-4o (Latest)', tier: 'premium', costLevel: 'medium', costHint: '$2.50/$10.00 per 1M tokens' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo (Advanced)', tier: 'premium', costLevel: 'high', costHint: '$10.00/$30.00 per 1M tokens' },
    { id: 'gpt-4', name: 'GPT-4 (Classic)', tier: 'premium', costLevel: 'high', costHint: '$30.00/$60.00 per 1M tokens' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Budget)', tier: 'premium', costLevel: 'low', costHint: '$0.15/$0.60 per 1M tokens' },
    
    // Embedding models
    { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small (Recommended)', tier: 'embed', isEmbedding: true, costLevel: 'low', costHint: '$0.02 per 1M tokens' },
    { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large (Higher Quality)', tier: 'embed', isEmbedding: true, costLevel: 'medium', costHint: '$0.13 per 1M tokens' },
    { id: 'text-embedding-ada-002', name: 'Text Embedding Ada 002 (Legacy)', tier: 'embed', isEmbedding: true, costLevel: 'low', costHint: '$0.10 per 1M tokens' }
  ];
}

/**
 * Busca modelos disponíveis para Anthropic
 */
async function getAnthropicModels(): Promise<ModelInfo[]> {
  return [
    // Basic tier models
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Fastest)', tier: 'basic', costLevel: 'low', costHint: '$0.25/$1.25 per 1M tokens' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Fast)', tier: 'basic', costLevel: 'low', costHint: '$1.00/$5.00 per 1M tokens' },
    
    // Default tier models
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Recommended)', tier: 'default', costLevel: 'low', costHint: '$1.00/$5.00 per 1M tokens' },
    { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet (Balanced)', tier: 'default', costLevel: 'medium', costHint: '$3.00/$15.00 per 1M tokens' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Economy)', tier: 'default', costLevel: 'low', costHint: '$0.25/$1.25 per 1M tokens' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Advanced)', tier: 'default', costLevel: 'medium', costHint: '$3.00/$15.00 per 1M tokens' },
    
    // Premium tier models
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Latest)', tier: 'premium', costLevel: 'medium', costHint: '$3.00/$15.00 per 1M tokens' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (Most Capable)', tier: 'premium', costLevel: 'high', costHint: '$15.00/$75.00 per 1M tokens' },
    { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet (Reliable)', tier: 'premium', costLevel: 'medium', costHint: '$3.00/$15.00 per 1M tokens' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Budget)', tier: 'premium', costLevel: 'low', costHint: '$1.00/$5.00 per 1M tokens' }
  ];
}

/**
 * Busca modelos disponíveis para DeepSeek
 */
async function getDeepSeekModels(): Promise<ModelInfo[]> {
  return [
    // Basic tier models
    { id: 'deepseek-chat', name: 'DeepSeek Chat (Standard)', tier: 'basic', costLevel: 'low', costHint: '$0.14/$0.28 per 1M tokens' },
    
    // Default tier models  
    { id: 'deepseek-chat', name: 'DeepSeek Chat (Recommended)', tier: 'default', costLevel: 'low', costHint: '$0.14/$0.28 per 1M tokens' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder (Code Focus)', tier: 'default', costLevel: 'low', costHint: '$0.14/$0.28 per 1M tokens' },
    
    // Premium tier models
    { id: 'deepseek-chat', name: 'DeepSeek Chat (Advanced)', tier: 'premium', costLevel: 'low', costHint: '$0.14/$0.28 per 1M tokens' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder (Professional)', tier: 'premium', costLevel: 'low', costHint: '$0.14/$0.28 per 1M tokens' }
  ];
}

/**
 * Busca modelos disponíveis para OpenRouter
 */
async function getOpenRouterModels(apiKey?: string): Promise<ModelInfo[]> {
  try {
    if (!apiKey) throw new Error('No API key');
    
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!response.ok) throw new Error('API request failed');
    
    const data = await response.json() as any;
    const availableModels = data.data.map((model: any) => model.id);
    
    // Retorna modelos conhecidos que estão disponíveis
    return getOpenRouterFallbackModels().filter(model => 
      availableModels.includes(model.id)
    );
  } catch {
    return getOpenRouterFallbackModels();
  }
}

function getOpenRouterFallbackModels(): ModelInfo[] {
  return [
    // Basic tier models (FREE models only)
    { id: 'microsoft/phi-3-mini-128k-instruct:free', name: 'Phi-3 Mini (FREE)', tier: 'basic', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'meta-llama/llama-3-8b-instruct:free', name: 'Llama 3 8B (FREE)', tier: 'basic', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'microsoft/phi-3-medium-128k-instruct:free', name: 'Phi-3 Medium (FREE)', tier: 'basic', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'google/gemma-7b-it:free', name: 'Gemma 7B Instruct (FREE)', tier: 'basic', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'deepseek/deepseek-chat:free', name: 'DeepSeek Chat (FREE)', tier: 'basic', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    
    // Default tier models (FREE models prioritized)
    { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (FREE Recommended)', tier: 'default', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'microsoft/phi-3-medium-128k-instruct:free', name: 'Phi-3 Medium (FREE Advanced)', tier: 'default', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B (FREE Balanced)', tier: 'default', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (FREE)', tier: 'default', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'deepseek/deepseek-chat:free', name: 'DeepSeek Chat (FREE Advanced)', tier: 'default', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    
    // Premium tier models (FREE models only - most capable free options)
    { id: 'meta-llama/llama-3.1-70b-instruct:free', name: 'Llama 3.1 70B (FREE Premium)', tier: 'premium', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (FREE Latest)', tier: 'premium', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'microsoft/phi-3-medium-128k-instruct:free', name: 'Phi-3 Medium (FREE Advanced)', tier: 'premium', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'google/gemma-2-27b-it:free', name: 'Gemma 2 27B (FREE Large)', tier: 'premium', costLevel: 'low', costHint: 'FREE via OpenRouter' },
    { id: 'deepseek/deepseek-chat:free', name: 'DeepSeek Chat (FREE Reliable)', tier: 'premium', costLevel: 'low', costHint: 'FREE via OpenRouter' }
  ];
}

/**
 * Busca modelos disponíveis para Ollama
 */
async function getOllamaModels(endpoint = 'http://localhost:11434'): Promise<ModelInfo[]> {
  try {
    const response = await fetch(`${endpoint}/api/tags`);
    if (!response.ok) throw new Error('Ollama not available');
    
    const data = await response.json() as any;
    const availableModels = data.models.map((model: any) => model.name);
    
    // Retorna modelos conhecidos que estão disponíveis localmente
    return getOllamaFallbackModels().filter(model => 
      availableModels.some((available: string) => available.includes(model.id.split(':')[0]))
    );
  } catch {
    return getOllamaFallbackModels();
  }
}

function getOllamaFallbackModels(): ModelInfo[] {
  return [
    // Basic tier models (smaller, faster)
    { id: 'llama3.2:3b', name: 'Llama 3.2 3B (Fastest)', tier: 'basic', costLevel: 'low', costHint: 'Free (local)' },
    { id: 'phi3:mini', name: 'Phi-3 Mini (Efficient)', tier: 'basic', costLevel: 'low', costHint: 'Free (local)' },
    { id: 'gemma2:2b', name: 'Gemma 2 2B (Lightweight)', tier: 'basic', costLevel: 'low', costHint: 'Free (local)' },
    { id: 'mistral:7b', name: 'Mistral 7B (Compact)', tier: 'basic', costLevel: 'low', costHint: 'Free (local)' },
    
    // Default tier models (balanced)
    { id: 'llama3.2:8b', name: 'Llama 3.2 8B (Recommended)', tier: 'default', costLevel: 'low', costHint: 'Free (local)' },
    { id: 'gemma2:9b', name: 'Gemma 2 9B (Balanced)', tier: 'default', costLevel: 'low', costHint: 'Free (local)' },
    { id: 'mistral:7b', name: 'Mistral 7B (Standard)', tier: 'default', costLevel: 'low', costHint: 'Free (local)' },
    { id: 'codellama:7b', name: 'Code Llama 7B (Code Focus)', tier: 'default', costLevel: 'low', costHint: 'Free (local)' },
    
    // Premium tier models (larger, more capable)
    { id: 'llama3.1:70b', name: 'Llama 3.1 70B (Most Capable)', tier: 'premium', costLevel: 'low', costHint: 'Free (local, needs ~40GB RAM)' },
    { id: 'codellama:34b', name: 'Code Llama 34B (Advanced Code)', tier: 'premium', costLevel: 'low', costHint: 'Free (local, needs ~20GB RAM)' },
    { id: 'llama3.2:8b', name: 'Llama 3.2 8B (Budget Premium)', tier: 'premium', costLevel: 'low', costHint: 'Free (local)' },
    { id: 'qwen2:72b', name: 'Qwen 2 72B (Multilingual)', tier: 'premium', costLevel: 'low', costHint: 'Free (local, needs ~40GB RAM)' },
    
    // Embedding models
    { id: 'nomic-embed-text:latest', name: 'Nomic Embed Text (Recommended)', tier: 'embed', isEmbedding: true, costLevel: 'low', costHint: 'Free (local)' },
    { id: 'mxbai-embed-large:latest', name: 'MxBAI Embed Large (High Quality)', tier: 'embed', isEmbedding: true, costLevel: 'low', costHint: 'Free (local)' },
    { id: 'all-minilm:latest', name: 'All-MiniLM (Lightweight)', tier: 'embed', isEmbedding: true, costLevel: 'low', costHint: 'Free (local)' }
  ];
}

/**
 * Busca modelos para Azure OpenAI (usar mesmos do OpenAI mas como deployments)
 */
async function getAzureOpenAIModels(): Promise<ModelInfo[]> {
  return [
    { id: 'gpt-4o', name: 'GPT-4o', capabilities: ['chat'] },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capabilities: ['chat'] },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', capabilities: ['chat'] },
    { id: 'gpt-35-turbo', name: 'GPT-3.5 Turbo', capabilities: ['chat'] },
    { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', isEmbedding: true },
    { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', isEmbedding: true },
    { id: 'text-embedding-ada-002', name: 'Text Embedding Ada 002', isEmbedding: true }
  ];
}

/**
 * Busca modelos disponíveis para um provider específico
 */
export async function getModelsForProvider(provider: string, config?: any): Promise<ProviderModels> {
  let models: ModelInfo[] = [];
  
  switch (provider) {
    case 'openai':
      models = await getOpenAIModels(process.env.OPENAI_API_KEY || '');
      break;
    case 'anthropic':
      models = await getAnthropicModels();
      break;
    case 'deepseek':
      models = await getDeepSeekModels();
      break;
    case 'azureOpenAI':
      models = await getAzureOpenAIModels();
      break;
    case 'openrouter':
      models = await getOpenRouterModels(process.env.OPENROUTER_API_KEY);
      break;
    case 'ollama':
      const endpoint = config?.endpoint || process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
      models = await getOllamaModels(endpoint);
      break;
    default:
      models = [];
  }
  
  return {
    provider,
    models,
    hasEmbedding: models.some(m => m.isEmbedding)
  };
}

/**
 * Busca modelos para todos os providers configurados
 */
export async function getAllProviderModels(providers: string[], configs?: Record<string, any>): Promise<ProviderModels[]> {
  const results = await Promise.allSettled(
    providers.map(provider => getModelsForProvider(provider, configs?.[provider]))
  );
  
  return results
    .filter((result): result is PromiseFulfilledResult<ProviderModels> => result.status === 'fulfilled')
    .map(result => result.value);
}

/**
 * Filtra modelos de um provider por tier específico
 */
export function getModelsForTier(models: ModelInfo[], tier: 'basic' | 'default' | 'premium' | 'embed'): ModelInfo[] {
  const filteredModels = models.filter(model => {
    if (tier === 'embed') {
      return model.isEmbedding === true;
    }
    return model.tier === tier;
  });

  // Ordena por custo (mais barato primeiro)
  return filteredModels.sort((a, b) => {
    const costOrder = { 'low': 1, 'medium': 2, 'high': 3 };
    return (costOrder[a.costLevel || 'medium'] || 2) - (costOrder[b.costLevel || 'medium'] || 2);
  });
}

/**
 * Busca modelos para um tier específico de um provider
 */
export async function getModelsForProviderTier(provider: string, tier: 'basic' | 'default' | 'premium' | 'embed', config?: any): Promise<ModelInfo[]> {
  const providerModels = await getModelsForProvider(provider, config);
  return getModelsForTier(providerModels.models, tier);
}