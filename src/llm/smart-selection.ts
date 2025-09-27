import type { Config } from '../config.js';
import { makeLLM } from './provider.js';
import { retrieveForFiles } from '../rag/index.js';
import { makeEmbeddings } from '../embeddings/provider.js';
import { getLogger } from '../shared/logger.js';

// Initialize logger
const logger = getLogger();

/**
 * Cria um LLM com smart selection automática baseada no prompt e contexto RAG
 */
export async function makeLLMWithSmartSelection(
  cfg: Config, 
  prompt: string, 
  options?: {
    preferredProvider?: string;
    ragPaths?: string[];
    ragQuery?: string;
    useRag?: boolean;
  }
) {
  let ragContext = '';
  
  // Se RAG estiver habilitado e tiver caminhos, buscar contexto relevante
  if (options?.useRag && options?.ragPaths?.length) {
    try {
      // Tentar usar embeddings para busca semântica
      try {
        const embedder = await makeEmbeddings(cfg.project.rag, cfg);
        const ragSnippets = await retrieveForFiles(
          options.ragQuery || 'implementation context', 
          options.ragPaths,
          6,
          embedder
        );
        ragContext = ragSnippets.join('\n\n');
        
        if (ragContext) {
          logger.info(`RAG context found: ${ragSnippets.length} snippets`);
        }
      } catch (embedError) {
        // Fallback para busca sem embeddings
        logger.warn('Failed to load embeddings, using file search:', embedError);
        const ragSnippets = await retrieveForFiles(
          options.ragQuery || 'implementation context', 
          options.ragPaths
        );
        ragContext = ragSnippets.join('\n\n');
        
        if (ragContext) {
          logger.info(`RAG context found: ${ragSnippets.length} snippets`);
        }
      }
    } catch (error) {
      logger.warn('Failed to search RAG context:', error instanceof Error ? error.message : error);
    }
  }
  
  return await makeLLM(cfg, options?.preferredProvider, prompt, ragContext);
}

/**
 * Wrapper para comandos que precisam de smart selection + RAG automático
 */
export async function createSmartLLM(
  cfg: Config, 
  prompt: string,
  options?: {
    preferredProvider?: string;
    ragQuery?: string;
    changedFiles?: string[];
  }
) {
  const useRag = cfg.project?.useRag || false;
  const ragPaths = options?.changedFiles?.length 
    ? options.changedFiles 
    : [cfg.project?.rag?.paths?.[0] || 'src'];
  
  return await makeLLMWithSmartSelection(cfg, prompt, {
    preferredProvider: options?.preferredProvider,
    ragPaths,
    ragQuery: options?.ragQuery,
    useRag
  });
}