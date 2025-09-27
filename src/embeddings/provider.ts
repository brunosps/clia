import fetch from 'node-fetch';
import { pipeline } from '@xenova/transformers';
import type { Config } from '../config.js';
import { makeLLM } from '../llm/provider.js';
import { getLogger } from '../shared/logger.js';

// Initialize logger
const logger = getLogger();

export interface Embeddings {
  embed(texts: string[]): Promise<number[][]>;
  name: string;
}

export async function makeEmbeddings(
  cfg: Config['project']['rag'],
  fullConfig: Config
): Promise<Embeddings> {
  const mode = (cfg.embeddings || 'auto') as 'auto' | 'llm' | 'transformers';

  // PRIMEIRO: Usar tier embed configurada conforme COMPLETE_DEVELOPMENT_GUIDE.md
  if (fullConfig.llm?.tiers?.embed) {
    try {
      const embedTier = fullConfig.llm.tiers.embed;
      const provider = embedTier.provider;

      logger.info(
        `🎯 Using configured embed tier: ${provider} (${embedTier.model || 'default model'})`
      );

      // Para OpenAI e Azure OpenAI - usar embedding API nativa
      if (provider === 'openai' && process.env.OPENAI_API_KEY) {
        const OpenAI = (await import('openai')).default;
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
        const model = embedTier.model || 'text-embedding-3-small';

        return {
          name: `openai:${model}`,
          async embed(texts: string[]) {
            logger.info(
              `🔄 Generating ${texts.length} embeddings in batch with ${model}...`
            );
            const response = await client.embeddings.create({
              model,
              input: texts,
            });
            logger.info(
              `✅ ${response.data.length} embeddings generated successfully`
            );
            return response.data.map((d) => d.embedding);
          },
        };
      }

      if (
        provider === 'azureOpenAI' &&
        process.env.AZURE_OPENAI_API_KEY &&
        process.env.AZURE_OPENAI_ENDPOINT
      ) {
        const OpenAI = (await import('openai')).default;
        const azureConfig = fullConfig.llm.providers.azureOpenAI;

        const client = new OpenAI({
          apiKey: process.env.AZURE_OPENAI_API_KEY,
          baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments`,
          defaultQuery: {
            'api-version': azureConfig?.apiVersion || '2024-02-15-preview',
          },
          defaultHeaders: {
            'api-key': process.env.AZURE_OPENAI_API_KEY,
          },
        });

        const deployment =
          embedTier.deployment ||
          azureConfig?.deployments?.embed ||
          'text-embedding-3-small';

        return {
          name: `azureOpenAI:${deployment}`,
          async embed(texts: string[]) {
            logger.info(
              `🔄 Generating ${texts.length} embeddings in batch with ${deployment}...`
            );
            const response = await client.embeddings.create({
              model: deployment,
              input: texts,
            });
            logger.info(
              `✅ ${response.data.length} embeddings generated successfully`
            );
            return response.data.map((d) => d.embedding);
          },
        };
      }

      // Para Ollama - usar endpoint de embeddings nativo
      if (provider === 'ollama') {
        const ollamaConfig = fullConfig.llm.providers.ollama;
        const endpoint =
          ollamaConfig?.endpoint ||
          process.env.OLLAMA_ENDPOINT ||
          'http://localhost:11434';
        const model = embedTier.model || 'nomic-embed-text:latest';

        try {
          // Test if the model is available
          const testResponse = await fetch(`${endpoint}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: 'test' }),
          });
          
          if (testResponse.ok) {
            return {
              name: `ollama:${model}`,
              async embed(texts: string[]) {
                logger.info(
                  `🔄 Processing ${texts.length} embeddings with ${model} (optimized batch)...`
                );

                // Otimização para lotes: usar Promise.all com limite de concorrência
                const concurrencyLimit = 3; // Max 3 requests simultâneos para Ollama
                const results: number[][] = [];

                for (let i = 0; i < texts.length; i += concurrencyLimit) {
                  const batch = texts.slice(i, i + concurrencyLimit);
                  const batchPromises = batch.map(async (input) => {
                    const r = await fetch(`${endpoint}/api/embeddings`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ model, prompt: input }),
                    });
                    const j: any = await r.json();
                    return j.embedding;
                  });

                  const batchResults = await Promise.all(batchPromises);
                  results.push(...batchResults);
                }

                logger.info(
                  `✅ ${results.length} embeddings generated successfully with ${model}`
                );
                return results;
              },
            };
          }
        } catch (error) {
          // Embedding model not available in Ollama, continue to next option
        }
      }
    } catch (error) {
      logger.warn(
        '⚠️ Error using configured embed tier, trying fallbacks:',
        error
      );
    }
  }

  // Try to use basic or default LLM for embeddings if available
  if (mode === 'llm' || mode === 'auto') {
    try {
      // Tenta usar LLM básica primeiro, depois padrão como fallback
      const llm = await makeLLM(fullConfig, 'basic');

      // Verifica se é uma LLM Ollama (que pode ter embeddings nativas)
      if (llm.name.includes('ollama')) {
        // Extrai URL do Ollama da configuração
        let ollamaUrl = 'http://localhost:11434'; // fallback padrão

        try {
          const adaptedCfg = await import('../shared/config-adapter.js').then(
            (m) => m.adaptConfig
          );
          const llmCfg = adaptedCfg({ llm: fullConfig.llm }).llm;
          const ollamaConfig = llmCfg.models.ollama;

          if (ollamaConfig) {
            if (Array.isArray(ollamaConfig)) {
              // Server array - use the first available
              for (const server of ollamaConfig) {
                if (server.url) {
                  ollamaUrl = server.url.replace(/\/$/, '');
                  break;
                }
              }
            } else {
              // Configuração única
              if (ollamaConfig.url) {
                ollamaUrl = ollamaConfig.url.replace(/\/$/, '');
              }
            }
          }
        } catch {
          // Se falhar ao ler config, usa localhost padrão
        }

        // Test if Ollama has embedding model available
        try {
          await fetch(`${ollamaUrl}/api/tags`);
          const model = 'nomic-embed-text';

          // Test if the embedding model is available
          const testResponse = await fetch(`${ollamaUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: 'test' }),
          });

          if (testResponse.ok) {
            return {
              name: `ollama:${model}`,
              async embed(texts: string[]) {
                logger.info(
                  `Generating ${texts.length} embeddings in batch with ${model}...`
                );

                // Processa em lote usando Promise.all para paralelização
                const batchSize = 10; // Limita a 10 requests simultâneos
                const batches = [];

                for (let i = 0; i < texts.length; i += batchSize) {
                  const batch = texts.slice(i, i + batchSize);
                  const batchPromises = batch.map(async (input) => {
                    const r = await fetch(`${ollamaUrl}/api/embeddings`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ model, prompt: input }),
                    });
                    const j: any = await r.json();
                    return j.embedding;
                  });
                  batches.push(Promise.all(batchPromises));
                }

                const results = await Promise.all(batches);
                const out = results.flat();
                logger.info(`${out.length} embeddings generated successfully`);
                return out;
              },
            };
          }
        } catch {
          // Embedding model not available in Ollama, continue to next option
        }
      }

      // Fallback: usar LLM para gerar embeddings básicos via prompt
      return {
        name: `llm-embeddings:${llm.name}`,
        async embed(texts: string[]) {
          logger.info(
            `Generating ${texts.length} embeddings in batch with LLM...`
          );

          // Processa em lote usando Promise.all para paralelização
          const batchSize = 5; // Menor lote para LLMs para evitar sobrecarga
          const batches = [];

          for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchPromises = batch.map(async (text) => {
              try {
                // Prompt simples para gerar representação numérica do texto
                const prompt = `Analyze this text and provide a numerical representation as a comma-separated list of 384 numbers between -1 and 1 that represent the semantic meaning: "${text.slice(0, 500)}"`;
                const response = await llm.chat(prompt, 0.1);

                // Extrai números da resposta
                const numbers = response.match(/-?\d+\.?\d*/g);
                if (numbers && numbers.length >= 100) {
                  // Converte para array de números e normaliza para 384 dimensões
                  const embedding = numbers
                    .slice(0, 384)
                    .map((n) => parseFloat(n));
                  // Garante que temos exatamente 384 dimensões
                  while (embedding.length < 384) {
                    embedding.push(Math.random() * 0.1 - 0.05); // Valores pequenos aleatórios
                  }
                  return embedding.slice(0, 384);
                } else {
                  // Fallback: embedding aleatório baseado no hash do texto
                  const hash = text
                    .split('')
                    .reduce((a, b) => a + b.charCodeAt(0), 0);
                  return Array.from(
                    { length: 384 },
                    (_, i) => Math.sin(hash * (i + 1) * 0.01) * 0.5
                  );
                }
              } catch {
                // Fallback: embedding aleatório determinístico
                const hash = text
                  .split('')
                  .reduce((a, b) => a + b.charCodeAt(0), 0);
                return Array.from(
                  { length: 384 },
                  (_, i) => Math.sin(hash * (i + 1) * 0.01) * 0.5
                );
              }
            });
            batches.push(Promise.all(batchPromises));
          }

          const results = await Promise.all(batches);
          const out = results.flat();
          logger.info(`${out.length} embeddings generated successfully`);
          return out;
        },
      };
    } catch {
      // LLM not available, continue to transformers
    }
  }

  // Fallback final: usar transformers locais
  const extractor = await pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2'
  );
  return {
    name: 'transformers:all-MiniLM-L6-v2',
    async embed(texts: string[]) {
      logger.info(
        `🔄 Processing ${texts.length} embeddings with Transformers (optimized batch)...`
      );

      // Transformers otimizado: processamento em lote eficiente
      const batchSize = 32; // Maior lote para transformers locais - mais eficiente
      const out: number[][] = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(texts.length / batchSize);

        logger.info(
          `🔄 Processing Transformers batch ${batchNum}/${totalBatches} (${batch.length} texts)...`
        );

        // Processa lote inteiro de uma vez - muito mais eficiente que individual
        const res: any = await extractor(batch, {
          pooling: 'mean',
          normalize: true,
        });

        // Extrai embeddings do resultado do lote
        if (Array.isArray(res) && res.length === batch.length) {
          // Resultado já é array de arrays
          for (const embedding of res) {
            out.push(Array.from(embedding.data || embedding));
          }
        } else if (res.data) {
          // Resultado único com múltiplas dimensões
          const embeddings = Array.from(res.data) as number[];
          const embeddingSize = embeddings.length / batch.length;
          for (let j = 0; j < batch.length; j++) {
            const start = j * embeddingSize;
            const end = start + embeddingSize;
            out.push(embeddings.slice(start, end));
          }
        }

        // Progress feedback
        logger.info(
          `✅ Batch ${batchNum}/${totalBatches} completed (${batch.length} embeddings)`
        );
      }

      logger.info(
        `🎉 All ${out.length} embeddings generated successfully with Transformers`
      );
      return out;
    },
  };
}
