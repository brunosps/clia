import type { Config } from '../config.js';
import fetch from 'node-fetch';

export interface LLM {
  chat(prompt: string): Promise<string>;
  name: string; // provider:model
}

export async function makeLLM(cfg: Config['llm']): Promise<LLM> {
  const provider = cfg.defaultProvider || 'anthropic';
  if (provider === 'openai') {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const model = cfg.models.openai;
    return {
      name: `openai:${model}`,
      async chat(prompt: string) {
        const r = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }]
        });
        return r.choices[0].message?.content?.trim() || '';
      }
    }
  }
  if (provider === 'ollama') {
    const model = cfg.models.ollama;
    return {
      name: `ollama:${model}`,
      async chat(prompt: string) {
        const r = await fetch('http://localhost:11434/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
        });
        const text = await r.text();
        return text.trim();
      }
    }
  }
  if (provider === 'deepseek') {
    const model = cfg.models.deepseek;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY não definida');
    return {
      name: `deepseek:${model}`,
      async chat(prompt: string) {
        const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1024,
            temperature: 0.1
          })
        });
        const data = await r.json() as any;
        if (!r.ok) {
          throw new Error(`DeepSeek API error: ${data.error?.message || r.statusText}`);
        }
        return data.choices?.[0]?.message?.content?.trim() || '';
      }
    }
  }
  // default anthropic
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = cfg.models.anthropic;
  return {
    name: `anthropic:${model}`,
    async chat(prompt: string) {
      const r = await client.messages.create({
        model, max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      });
      return r.content.map((c: any) => ('text' in c ? c.text : '')).join('').trim();
    }
  }
}