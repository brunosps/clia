import type { Config } from '../config.js';
import fetch from 'node-fetch';
import { approxTokensFromText } from '../shared/tokens.js';
import { createLogger, setLogger, getLogger } from '../shared/logger.js';

/**
 * Calcula tokens aproximados e determina se precisa de middle-out
 */
function shouldUseMiddleOut(prompt: string, maxTokens: number = 2000000): boolean {
  const estimatedTokens = approxTokensFromText(prompt);
  return estimatedTokens > maxTokens * 0.8; // 80% do limite para mais segurança
}

/**
 * Aplica middle-out transform genérico mantendo seções críticas
 */
function applyMiddleOutTransform(prompt: string, targetTokens: number = 1600000): string {
  const logger = getLogger();
  const originalTokens = approxTokensFromText(prompt);
  
  if (originalTokens <= targetTokens) {
    return prompt;
  }
  
  // Estratégia genérica: manter início e fim
  const lines = prompt.split('\n');
  const keepStart = Math.floor(lines.length * 0.4);
  const keepEnd = Math.floor(lines.length * 0.3);
  
  const startSection = lines.slice(0, keepStart).join('\n');
  const endSection = lines.slice(-keepEnd).join('\n');
  const middleSection = '\n\n<!-- [MIDDLE CONTENT COMPRESSED FOR CONTEXT LIMITS] -->\n\n';
  
  const result = startSection + middleSection + endSection;
  const finalTokens = approxTokensFromText(result);
  logger.info(`🗜️ Generic middle-out: ${originalTokens} → ${finalTokens} tokens (${((1 - finalTokens/originalTokens) * 100).toFixed(1)}% reduction)`);
  
  return result;
}

export interface LLM {
  chat(prompt: string, temperature?: number): Promise<string>;
  name: string; // provider:model
}

interface ModelSelection {
  provider: string;
  deployment?: string; // Para Azure OpenAI
  tier: string; // basic, default, premium
}

type ComplexityLevel = 'simple' | 'medium' | 'complex';

/**
 * Analisa a complexidade do prompt baseado em múltiplos fatores
 */
function analyzePromptComplexity(
  prompt: string,
  ragContext?: string
): ComplexityLevel {
  const totalText = prompt + (ragContext || '');
  const tokens = approxTokensFromText(totalText);

  // Fatores de complexidade
  const factors = {
    length: tokens,
    codePatterns: (
      prompt.match(/```|\bclass\b|\bfunction\b|\bimport\b|\bexport\b/g) || []
    ).length,
    technicalTerms: (
      prompt.match(
        /\b(refactor|implement|debug|optimize|architecture|design pattern|algorithm)\b/gi
      ) || []
    ).length,
    multipleFiles: (
      prompt.match(/arquivo|file|\.(ts|js|py|java|cpp)\b/gi) || []
    ).length,
    questionComplexity: (
      prompt.match(/\b(como|why|explain|analyze|compare|evaluate)\b/gi) || []
    ).length,
    hasRagContext: ragContext ? ragContext.length > 500 : false,
  };

  // Scoring baseado nos fatores
  let complexityScore = 0;

  // Peso do tamanho do texto
  if (tokens > 5000) complexityScore += 3;
  else if (tokens > 2000) complexityScore += 2;
  else if (tokens > 500) complexityScore += 1;

  // Peso de padrões de código
  complexityScore += Math.min(factors.codePatterns * 0.5, 2);

  // Peso de termos técnicos
  complexityScore += Math.min(factors.technicalTerms * 0.3, 1.5);

  // Peso de múltiplos arquivos
  complexityScore += Math.min(factors.multipleFiles * 0.4, 1.5);

  // Peso de questões complexas
  complexityScore += Math.min(factors.questionComplexity * 0.3, 1);

  // Peso de contexto RAG
  if (factors.hasRagContext) complexityScore += 1;

  // Log da análise para debug
  try {
    const logger = getLogger();
    logger.debug(
      ` Smart Selection - Análise de complexidade: score=${complexityScore.toFixed(1)}, tokens=${tokens}`
    );
  } catch {
    // Logger não inicializado, ignorar
  }

  // Determina o nível baseado no score
  if (complexityScore >= 4) return 'complex';
  if (complexityScore >= 2) return 'medium';
  return 'simple';
}

/**
 * Seleciona o melhor modelo baseado na complexidade do prompt
 * Usa as configurações minimalistas do clia.config.json
 */
function selectModelByComplexity(
  cfg: Config,
  prompt: string,
  ragContext?: string
): ModelSelection {
  const complexity = analyzePromptComplexity(prompt, ragContext);

  try {
    const logger = getLogger();
    logger.info(` Complexidade detectada: ${complexity}`);
  } catch {
    // Logger não inicializado, ignorar
  }

  // Mapeia complexidade para tier
  const tierByComplexity = {
    simple: 'basic',
    medium: 'default',
    complex: 'premium',
  };

  const tier = tierByComplexity[complexity] || 'default';
  const tierConfig = cfg.llm.tiers[tier as keyof typeof cfg.llm.tiers];

  if (tierConfig && hasApiKey(tierConfig.provider)) {
    try {
      const logger = getLogger();
      logger.info(
        ` Modelo selecionado: ${tierConfig.provider}:${tierConfig.deployment || tierConfig.model || 'default'} (${tier})`
      );
    } catch {
      // Logger não inicializado, ignorar
    }

    return {
      provider: tierConfig.provider,
      deployment: tierConfig.deployment,
      tier,
    };
  }

  // Fallback para outros provedores disponíveis
  return selectBestAvailableModel(cfg);
}

/**
 * Selects the best available model based on configured APIs
 */
function selectBestAvailableModel(cfg: Config): ModelSelection {
  const providers = Object.keys(cfg.llm.providers);

  for (const provider of providers) {
    if (hasApiKey(provider)) {
      return {
        provider,
        tier: 'default',
      };
    }
  }

  throw new Error('No LLM provider available. Configure at least one API key.');
}

/**
 * Checks if an API key is available for the provider
 */
function hasApiKey(provider: string): boolean {
  switch (provider) {
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY;
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY;
    case 'azureOpenAI':
      return !!(
        process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT
      );
    case 'openrouter':
      return !!process.env.OPENROUTER_API_KEY;
    case 'abacus':
      return !!process.env.ABACUS_API_KEY;
    case 'ollama':
      // Ollama pode funcionar sem API key (local) ou com endpoint configurado
      return true;
    default:
      return false;
  }
}

/**
 * Cria LLM para tier específica conforme COMPLETE_DEVELOPMENT_GUIDE.md
 */
export async function makeLLMForTier(
  cfg: Config,
  tier: 'basic' | 'default' | 'premium' | 'embed'
): Promise<LLM> {
  // Buscar configuração da tier específica
  const tierConfig = cfg.llm?.tiers?.[tier];
  if (!tierConfig) {
    throw new Error(`Tier '${tier}' não configurada em llm.tiers`);
  }

  const provider = tierConfig.provider;
  if (!hasApiKey(provider)) {
    throw new Error(
      `API key não encontrada para provider '${provider}' na tier '${tier}'`
    );
  }

  return await createLLMForProvider(provider, tierConfig, cfg);
}

export async function makeLLM(
  cfg: Config,
  preferredProvider?: string,
  prompt?: string,
  ragContext?: string
): Promise<LLM> {
  // Inicializar logger se ainda não foi feito
  try {
    const logger = getLogger();
  } catch {
    setLogger(createLogger(cfg));
  }

  let selection: ModelSelection;

  if (prompt) {
    // Smart selection baseado na complexidade
    selection = selectModelByComplexity(cfg, prompt, ragContext);
  } else {
    // Fallback para seleção manual ou automática
    if (preferredProvider && hasApiKey(preferredProvider)) {
      selection = { provider: preferredProvider, tier: 'default' };
    } else {
      selection = selectBestAvailableModel(cfg);
    }
  }

  const { provider, deployment, tier } = selection;

  // Log do modelo selecionado
  try {
    const logger = getLogger();
    logger.info(
      `Using model: ${provider}${deployment ? `:${deployment}` : ''} (${tier})`
    );
  } catch {
    // Logger não inicializado, ignorar
  }

  return await createLLMForProvider(
    provider,
    {
      ...selection,
      model: cfg.llm.tiers[tier as keyof typeof cfg.llm.tiers]?.model,
    },
    cfg
  );
}

/**
 * Cria instância LLM para provider específico
 */
async function createLLMForProvider(
  provider: string,
  tierConfig: any,
  cfg: Config
): Promise<LLM> {
  if (provider === 'openai') {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const model = tierConfig?.model || 'gpt-4o-mini';

    return {
      name: `openai:${model}`,
      async chat(prompt: string, temperature = 0.1) {
        const r = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
        });
        return r.choices[0].message?.content?.trim() || '';
      },
    };
  }

  if (provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const model = tierConfig?.model || 'claude-3-haiku-20240307';

    return {
      name: `anthropic:${model}`,
      async chat(prompt: string, temperature = 0.1) {
        const r = await client.messages.create({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
          // @ts-ignore - Anthropic supports temperature
          temperature,
        });
        return r.content
          .map((c: any) => ('text' in c ? c.text : ''))
          .join('')
          .trim();
      },
    };
  }

  if (provider === 'deepseek') {
    // DeepSeek usa API compatível com OpenAI
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      baseURL: 'https://api.deepseek.com/v1',
    });

    const model = tierConfig?.model || 'deepseek-chat';

    return {
      name: `deepseek:${model}`,
      async chat(prompt: string, temperature = 0.1) {
        const r = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
        });
        return r.choices[0].message?.content?.trim() || '';
      },
    };
  }

  if (provider === 'azureOpenAI') {
    const { OpenAI } = await import('openai');
    const azureConfig = cfg.llm.providers.azureOpenAI;

    if (
      !azureConfig ||
      !process.env.AZURE_OPENAI_ENDPOINT ||
      !process.env.AZURE_OPENAI_API_KEY
    ) {
      throw new Error('Azure OpenAI não configurado corretamente');
    }

    const client = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments`,
      defaultQuery: { 'api-version': azureConfig.apiVersion },
      defaultHeaders: {
        'api-key': process.env.AZURE_OPENAI_API_KEY,
      },
    });

    // Usa deployment configurado ou fallback baseado no tier
    const deploymentName =
      tierConfig?.deployment || azureConfig.deployments?.default;

    return {
      name: `azureOpenAI:${deploymentName}`,
      async chat(prompt: string, temperature = 0.1) {
        const r = await client.chat.completions.create({
          model: deploymentName, // No Azure, o model é o deployment name
          messages: [{ role: 'user', content: prompt }],
          temperature,
        });
        return r.choices[0].message?.content?.trim() || '';
      },
    };
  }

  if (provider === 'openrouter') {
    // OpenRouter usa API compatível com OpenAI
    const logger = getLogger();
    const apiKey = process.env.OPENROUTER_API_KEY;
    logger.debug('🔑 OpenRouter API key length:', apiKey ? apiKey.length : 'undefined');
    logger.debug('🔑 OpenRouter API key prefix:', apiKey ? apiKey.substring(0, 10) + '...' : 'undefined');
    
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey: apiKey!,
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: 480000, // 8 minutes timeout para requests complexos
      defaultHeaders: {
        'HTTP-Referer': 'https://clia.ai', // Opcional: identificação da aplicação
        'X-Title': 'CLIA AI Developer Tool', // Opcional: título da aplicação
      },
    });

    // Seleciona modelo baseado no tierConfig
    const model = tierConfig?.model || 'openai/gpt-4o-mini';

    return {
      name: `openrouter:${model}`,
      async chat(prompt: string, temperature = 0.1) {
        // Heurística: prompts curtos tendem a não se beneficiar de stream
        const expectShort = prompt.length < 1200; // ajuste fino p/ seu caso
        const wantStream = !expectShort;

        // Métricas de debug
        const startedAt = Date.now();
        let firstChunkAt: number | null = null;
        let lastChunkAt: number = startedAt;
        let chunkCount = 0;
        let fullResponse = '';

        // Timeouts configuráveis
        const TOTAL_TIMEOUT_MS = 180000; // 3 min hard cap
        const FIRST_CHUNK_MS = 5000; // 5s até 1º chunk (se streaming)
        const CHUNK_GAP_MS = 15000; // 15s sem chunk => aborta

        // Função auxiliar p/ logs padronizados (usando logger do CLIA)
        const logEnd = (label: string) => {
          const endedAt = Date.now();
          const elapsed = endedAt - startedAt;
          try {
            const logger = getLogger();
            logger.debug(`[OpenRouter:${model}] ${label} | elapsed=${elapsed}ms chunks=${chunkCount} firstChunk=${firstChunkAt ? (firstChunkAt - startedAt) : -1}ms lastGap=${endedAt - lastChunkAt}ms size=${fullResponse.length}`);
          } catch {
            // Logger não disponível, usar console
            console.warn(`[OpenRouter:${model}] ${label} | elapsed=${elapsed}ms chunks=${chunkCount} firstChunk=${firstChunkAt ? (firstChunkAt - startedAt) : -1}ms lastGap=${endedAt - lastChunkAt}ms size=${fullResponse.length}`);
          }
        };

        // --- Caminho NON-STREAM para casos simples/curtos ---
        if (!wantStream) {
          try {
            const logger = getLogger();
            logger.debug('🔍 About to make OpenRouter NON-STREAM request');
            logger.debug('🔍 API key available:', !!process.env.OPENROUTER_API_KEY);
            logger.debug('🔍 API key length:', process.env.OPENROUTER_API_KEY?.length || 0);
            
            // Aplicar middle-out se necessário
            let processedPrompt = prompt;
            if (shouldUseMiddleOut(prompt)) {
              processedPrompt = applyMiddleOutTransform(prompt);
              logger.warn('📉 Using middle-out transform due to context length');
            }
            
            const r = await client.chat.completions.create({
              model,
              messages: [{ role: 'user', content: processedPrompt }],
              temperature,
              max_tokens: 8000,
              stream: false,
            });
            const out = r.choices[0].message?.content?.trim() ?? '';
            return out;
          } catch (e) {
            logEnd('non-stream error');
            throw e;
          }
        }

        // --- Caminho STREAM com aborts reais ---
        const controller = new AbortController();
        const totalTimer = setTimeout(() => controller.abort('total-timeout'), TOTAL_TIMEOUT_MS);

        // Relógio do "primeiro chunk"
        let firstChunkTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          controller.abort('first-chunk-timeout');
        }, FIRST_CHUNK_MS);

        // Relógio de inatividade entre chunks (reiniciado a cada chunk)
        let gapTimer: ReturnType<typeof setTimeout> | null = null;
        const resetGapTimer = () => {
          if (gapTimer) clearTimeout(gapTimer);
          gapTimer = setTimeout(() => controller.abort('chunk-gap-timeout'), CHUNK_GAP_MS);
        };

        try {
          const logger = getLogger();
          logger.debug('🔍 About to make OpenRouter request');
          logger.debug('🔍 API key available:', !!process.env.OPENROUTER_API_KEY);
          logger.debug('🔍 API key length:', process.env.OPENROUTER_API_KEY?.length || 0);
          logger.debug('🔍 Model:', model);
          
          // Aplicar middle-out se necessário
          let processedPrompt = prompt;
          if (shouldUseMiddleOut(prompt)) {
            processedPrompt = applyMiddleOutTransform(prompt);
            logger.warn('📉 Using middle-out transform due to context length');
          }
          
          const stream = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: processedPrompt }],
            temperature,
            max_tokens: 8000,
            stream: true,
          }, {
            signal: controller.signal, // ✅ AbortController signal no options
          });

          // Processa o stream
          for await (const chunk of stream) {
            const content = chunk.choices?.[0]?.delta?.content || '';
            const finish = chunk.choices?.[0]?.finish_reason;

            if (!firstChunkAt && content) {
              firstChunkAt = Date.now();
              if (firstChunkTimer) { clearTimeout(firstChunkTimer); firstChunkTimer = null; }
              resetGapTimer();
            }

            if (content) {
              fullResponse += content;
              chunkCount++;
              lastChunkAt = Date.now();
              resetGapTimer();
            }

            if (finish === 'stop' || finish === 'length') {
              break; // servidor sinalizou término
            }
          }

          // Limpa timers
          if (firstChunkTimer) clearTimeout(firstChunkTimer);
          if (gapTimer) clearTimeout(gapTimer);
          clearTimeout(totalTimer);

          // Se não houve chunk algum, faça fallback a non-streaming
          if (chunkCount === 0) {
            logEnd('no-chunk-fallback');
            const r = await client.chat.completions.create({
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature,
              max_tokens: 8000,
              stream: false,
            });
            return r.choices[0].message?.content?.trim() ?? '';
          }

          logEnd('stream-ok');
          return fullResponse.trim();

        } catch (err: any) {
          // Se foi timeout/abort, faça fallback p/ non-streaming
          const reason = (err?.name === 'AbortError') ? String(err?.message || 'aborted') : 'stream-error';
          try {
            const logger = getLogger();
            logger.warn(`OpenRouter streaming aborted: ${reason}, fallback to non-streaming`);
          } catch {
            console.warn(`OpenRouter streaming aborted: ${reason}, fallback to non-streaming`);
          }
          
          try {
            const r = await client.chat.completions.create({
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature,
              max_tokens: 8000,
              stream: false,
            });
            logEnd('fallback-non-stream-ok');
            return r.choices[0].message?.content?.trim() ?? '';
          } catch (fallbackErr) {
            logEnd('fallback-non-stream-error');
            throw fallbackErr;
          }
        } finally {
          // Limpeza defensiva
          if (firstChunkTimer) clearTimeout(firstChunkTimer);
          if (gapTimer) clearTimeout(gapTimer);
          clearTimeout(totalTimer);
        }
      },
    };
  }

  if (provider === 'abacus') {
    // Abacus.AI usa API compatível com OpenAI
    const openai = await import('openai');
    const client = new openai.OpenAI({
      apiKey: process.env.ABACUS_API_KEY!,
      baseURL: 'https://api.abacus.ai/api/v1',
    });

    // Usar modelo configurado ou fallback para Abacus.AI
    const model = tierConfig?.model || 'gpt-4'; // Default model for Abacus.AI

    return {
      async chat(prompt: string, temperature = 0.7): Promise<string> {
        const response = await client.chat.completions.create({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
        });
        return response.choices[0].message.content || '';
      },
      name: `abacus:${model}`,
    };
  }

  if (provider === 'ollama') {
    // Ollama pode ser local ou remoto
    const ollamaConfig = cfg.llm.providers.ollama;
    const endpoint =
      ollamaConfig?.endpoint ||
      process.env.OLLAMA_ENDPOINT ||
      'http://localhost:11434';

    // Usar modelo configurado ou fallback
    const model = tierConfig?.model || 'llama3.2';

    return {
      name: `ollama:${model}`,
      async chat(prompt: string, temperature = 0.1) {
        const response = await fetch(`${endpoint}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            options: {
              temperature,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Ollama error: ${response.status} ${response.statusText}`
          );
        }

        const data = (await response.json()) as any;
        return data.response?.trim() || '';
      },
    };
  }

  throw new Error(`Provedor LLM não suportado: ${provider}`);
}
