import type { Config } from '../config.js';
import { approxTokensFromText } from './tokens.js';

export function estimateCostUSD(cfg: Config['llm'], providerName: string, inputText: string, expectedOutputTokens = 400): number {
  const pricing = cfg.pricingUSDper1kTokens || {};
  const p = pricing[providerName as keyof typeof pricing];
  if (!p) return 0;
  const inTok = approxTokensFromText(inputText);
  const outTok = expectedOutputTokens;
  return (inTok/1000) * p.input + (outTok/1000) * p.output;
}

export function shouldUpgradeModel(perRunBudget: number, currentCost: number): boolean {
  return currentCost > perRunBudget;
}