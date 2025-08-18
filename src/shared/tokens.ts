export function approxTokensFromText(s: string): number {
  // Rough: ~4 chars per token
  return Math.ceil((s || '').length / 4);
}