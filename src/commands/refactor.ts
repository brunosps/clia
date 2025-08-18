import fs from 'fs';
import path from 'path';
import { execa } from 'execa';
import { makeLLM } from '../llm/provider.js';
import { loadConfig } from '../config.js';
import { estimateCostUSD, shouldUpgradeModel } from '../shared/budget.js';

/**
 * Applies unified diff using `git apply`. Fallback: saves patch.
 */
async function applyPatch(cwd: string, patch: string) {
  try {
    await execa('git', ['apply', '--index', '--whitespace=fix', '-'], { cwd, input: patch });
    return true;
  } catch {
    return false;
  }
}

export async function refactor(file: string, instruction: string) {
  const cwd = process.cwd();
  const cfg = loadConfig(cwd);
  const filePath = path.join(cwd, file);
  if (!fs.existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${file}`);
  const content = fs.readFileSync(filePath, 'utf-8');

  const prompt = [
    'Refatore o arquivo abaixo conforme a instrução.',
    'Produza **APENAS** um patch unified diff aplicável com `git apply`.',
    'Inclua cabeçalhos `--- a/<path>` e `+++ b/<path>` com o mesmo caminho relativo.',
    '', `Instrução: ${instruction}`, '', `Arquivo: ${file}`,
    '----- BEGIN FILE -----', content, '----- END FILE -----'
  ].join('\n');

  // Budget-driven model choice
  let llmCfg = { ...cfg.llm };
  const provider = llmCfg.defaultProvider as keyof typeof llmCfg.models;
  const providerKey = `${llmCfg.defaultProvider}:${llmCfg.models[provider]}`;
  const estCost = estimateCostUSD(llmCfg, providerKey, content, 500);
  if (shouldUpgradeModel(llmCfg.budget.perRunUSD, estCost)) {
    // try cheaper: ollama (free) > deepseek > others
    if (llmCfg.defaultProvider !== 'ollama') {
      if (llmCfg.defaultProvider !== 'deepseek') {
        llmCfg.defaultProvider = 'deepseek';
      } else {
        llmCfg.defaultProvider = 'ollama';
      }
    }
  }

  const llm = await makeLLM(llmCfg);
  const patch = await llm.chat(prompt);
  const ok = await applyPatch(cwd, patch);
  if (!ok) {
    const outDir = path.join(cwd, '.clia'); fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'patch.diff'), patch, 'utf-8');
    throw new Error('Falha ao aplicar patch. Verifique .clia/patch.diff');
  }
  return 'Patch aplicado e index atualizado.';
}