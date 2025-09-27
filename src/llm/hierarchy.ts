import { makeLLM } from './provider.js';
import { loadConfig } from '../config.js';

/**
 * Sistema de hierarquia de LLMs para diferentes tipos de tarefas
 * 
 * - Premium: Tarefas estratégicas, planejamento, avaliação de qualidade
 * - Default: Tarefas operacionais, geração de código, análises
 * - Basic: Tarefas triviais, formatação, limpeza
 */

export type LLMTier = 'premium' | 'default' | 'basic';

export interface LLMProviderConfig {
  model: string;
  timeout: number;
  temperature: number;
}

export interface LLMProvidersConfig {
  premium: LLMProviderConfig;
  default: LLMProviderConfig;
  basic: LLMProviderConfig;
}

export class LLMHierarchy {
  private static instance: LLMHierarchy;
  private config: any;
  private providersConfig: LLMProvidersConfig;

  private constructor() {
    this.config = loadConfig();
    this.providersConfig = this.initializeProviders();
  }

  static getInstance(): LLMHierarchy {
    if (!LLMHierarchy.instance) {
      LLMHierarchy.instance = new LLMHierarchy();
    }
    return LLMHierarchy.instance;
  }

  private initializeProviders(): LLMProvidersConfig {
    // Usar configuração explícita dos providers
    const providersConfig = this.config.llm?.providers;
    
    if (!providersConfig) {
      throw new Error('Configuração llm.providers não encontrada');
    }

    return {
      premium: providersConfig.premium || {
        model: 'openai:gpt-4o',
        timeout: 30000,
        temperature: 0.1
      },
      default: providersConfig.default || {
        model: 'deepseek:deepseek-coder',
        timeout: 30000,
        temperature: 0.1
      },
      basic: providersConfig.basic || {
        model: 'ollama:qwen2.5-coder:7b',
        timeout: 30000,
        temperature: 0.1
      }
    };
  }

  /**
   * Verifica se existe API key para um provider
   */
  private hasApiKey(provider: string): boolean {
    switch (provider) {
      case 'openai':
        return !!process.env.OPENAI_API_KEY || !!this.config.llm?.openai?.apiKey;
      case 'anthropic':
        return !!process.env.ANTHROPIC_API_KEY || !!this.config.llm?.anthropic?.apiKey;
      case 'deepseek':
        return !!process.env.DEEPSEEK_API_KEY || !!this.config.llm?.deepseek?.apiKey;
      case 'ollama':
        return true; // Ollama is always available locally
      default:
        return false;
    }
  }

  /**
   * Seleciona o melhor modelo para um tier, com fallback baseado em API keys
   */
  private selectModelForTier(tier: LLMTier): LLMProviderConfig {
    const targetConfig = this.providersConfig[tier];
    const [provider] = targetConfig.model.split(':');
    
    // Se tem API key para o provider configurado, usar ele
    if (this.hasApiKey(provider)) {
      return targetConfig;
    }
    
    // Fallback hierarchy: deepseek -> ollama (para qualquer tier)
    if (this.hasApiKey('deepseek')) {
      return {
        model: 'deepseek:deepseek-coder',
        timeout: 30000,
        temperature: targetConfig.temperature
      };
    }
    
    // Last fallback: ollama (always available)
    return {
      model: 'ollama:qwen2.5-coder:7b',
      timeout: 30000,
      temperature: targetConfig.temperature
    };
  }

  /**
   * Cria LLM para um tier específico
   */
  async createLLMForTier(tier: LLMTier, contextInfo?: string): Promise<any> {
    const providerConfig = this.selectModelForTier(tier);
    const [provider, model] = providerConfig.model.split(':');
    
    // O makeLLM já usa adaptConfig internamente para compatibilidade
    const llm = await makeLLM(this.config, provider);
    
    // Aplicar configurações específicas do tier
    const temperatures = {
      premium: this.providersConfig.premium.temperature,
      default: this.providersConfig.default.temperature,
      basic: this.providersConfig.basic.temperature
    };
    
    // Wrapper para aplicar temperatura do tier
    return {
      ...llm,
      chat: async (prompt: string, temperatureOverride?: number) => {
        const temperature = temperatureOverride ?? temperatures[tier];
        return llm.chat(prompt, temperature);
      },
      tier,
      provider,
      model: providerConfig.model
    };
  }

  /**
   * Cria LLM Premium para tarefas estratégicas
   * - Planejamento de mudanças
   * - Avaliação de qualidade
   * - Análise arquitetural
   */
  async createPremiumLLM(contextInfo?: string): Promise<any> {
    return this.createLLMForTier('premium', contextInfo);
  }

  /**
   * Cria LLM Default para tarefas operacionais
   * - Geração de código
   * - Refatoração
   * - Análise de bugs
   */
  async createDefaultLLM(contextInfo?: string): Promise<any> {
    return this.createLLMForTier('default', contextInfo);
  }

  /**
   * Cria LLM Basic para tarefas triviais
   * - Commit messages
   * - Formatação
   * - Traduções simples
   */
  async createBasicLLM(contextInfo?: string): Promise<any> {
    return this.createLLMForTier('basic', contextInfo);
  }

  /**
   * Seleção inteligente baseada no tipo de tarefa
   */
  async createSmartLLM(taskType: 'strategic' | 'operational' | 'trivial' | 'analysis' | 'planning' | 'implementation' | 'validation', contextInfo?: string): Promise<any> {
    const tierMapping = {
      strategic: 'premium',
      analysis: 'premium', 
      planning: 'premium',
      operational: 'default',
      implementation: 'default',
      validation: 'default',
      trivial: 'basic'
    } as const;
    
    const tier = tierMapping[taskType];
    return this.createLLMForTier(tier, contextInfo);
  }




}

// Funções de conveniência para usar sem instanciar a classe
export async function createPremiumLLM(contextInfo?: string, ragContext?: string) {
  const hierarchy = LLMHierarchy.getInstance();
  return hierarchy.createPremiumLLM(contextInfo);
}

export async function createDefaultLLM(contextInfo?: string, ragContext?: string) {
  const hierarchy = LLMHierarchy.getInstance();
  return hierarchy.createDefaultLLM(contextInfo);
}

export async function createBasicLLM(contextInfo?: string, ragContext?: string) {
  const hierarchy = LLMHierarchy.getInstance();
  return hierarchy.createBasicLLM(contextInfo);
}

export async function createSmartLLM(taskType: 'strategic' | 'operational' | 'trivial' | 'analysis' | 'planning' | 'implementation' | 'validation', contextInfo?: string, ragContext?: string) {
  const hierarchy = LLMHierarchy.getInstance();
  return hierarchy.createSmartLLM(taskType, contextInfo);
}