import fetch from 'node-fetch';
import { pipeline } from '@xenova/transformers';
import type { Config } from '../config.js';

export interface Embeddings {
  embed(texts: string[]): Promise<number[][]>;
  name: string;
}

export async function makeEmbeddings(cfg: Config['project']['rag']): Promise<Embeddings> {
  const mode = (cfg.embeddings || 'auto') as 'auto' | 'ollama' | 'transformers';
  if (mode === 'ollama' || mode === 'auto') {
    try {
      await fetch('http://localhost:11434/api/tags');
      const model = 'nomic-embed-text';
      return {
        name: `ollama:${model}`,
        async embed(texts: string[]) {
          const out: number[][] = [];
          for (const input of texts) {
            const r = await fetch('http://localhost:11434/api/embeddings', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model, prompt: input })
            });
            const j: any = await r.json();
            out.push(j.embedding);
          }
          return out;
        }
      }
    } catch {}
  }
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return {
    name: 'transformers:all-MiniLM-L6-v2',
    async embed(texts: string[]) {
      const out: number[][] = [];
      for (const t of texts) {
        const res: any = await extractor(t, { pooling: 'mean', normalize: true });
        out.push(Array.from(res.data));
      }
      return out;
    }
  }
}