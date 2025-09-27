/**
 * Pré-validação de patches para bloquear placeholders e contextos inventados
 * Baseado na sugestão do ChatGPT 5 para resolver problemas com git apply
 */

import crypto from 'crypto';

const BANNED_CONTEXT_PATTERNS = [
  /^\s*\/\/\s*\.\.\.\s*$/m,
  /^\s*\/\*\s*\.\.\.\s*\*\/\s*$/m,
  /^\s*#\s*\.\.\.\s*$/m,
  /(^|\s)(PLACEHOLDER|TODO|FIXME|Novo sistema)/m,
  /…/m,
  /^\s*\/\/\s*código\s*omitido/mi,
  /^\s*\/\/\s*\.\.\.\s*código/mi,
  /^\s*\/\/\s*Modificação/mi,
  /^\s*\/\/\s*Novo\s*sistema/mi,
  /^\s*\/\*\s*código\s*omitido/mi,
  /^\s*#\s*código\s*omitido/mi
];

export function sha256(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8');
  return crypto.createHash('sha256').update(b).digest('hex');
}

/**
 * Verifica se TODAS as linhas de contexto (prefixo " ") existem no original
 */
export function verifyUnifiedDiffAgainstOriginal(
  patch: string, 
  original: string
): { ok: boolean; reason: string } {
  
  // 1) Bloqueia cercas e cabeçalhos indevidos
  if (patch.includes('```') || patch.startsWith('diff --git') || patch.includes('\r\n```')) {
    return { ok: false, reason: 'Patch contém cercas de código ou cabeçalhos proibidos.' };
  }

  // 2) Bloqueia placeholders/comentários inventados
  for (const pat of BANNED_CONTEXT_PATTERNS) {
    if (pat.test(patch)) {
      const match = patch.match(pat);
      return { 
        ok: false, 
        reason: `Patch contém placeholders/comentários inventados no contexto: "${match?.[0] || 'padrão detectado'}"` 
      };
    }
  }

  // 3) Parse simples por hunks e checagem de contexto
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  if (!lines[0]?.startsWith('--- ')) {
    return { ok: false, reason: 'Cabeçalho --- ausente.' };
  }
  if (!lines[1]?.startsWith('+++ ')) {
    return { ok: false, reason: 'Cabeçalho +++ ausente.' };
  }

  let inHunk = false;
  const originalLines = original.replace(/\r\n/g, '\n').split('\n');
  const contextIssues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];

    if (L.startsWith('@@ ')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (L.startsWith(' ')) {
      const ctx = L.slice(1); // linha de contexto literal
      
      // Procurar ctx no original (aceita múltiplas ocorrências; só precisa existir)
      const found = originalLines.some((ol) => ol === ctx);
      if (!found) {
        contextIssues.push(`Linha de contexto não encontrada: ${JSON.stringify(ctx)}`);
      }
    } else if (L.startsWith('+') || L.startsWith('-')) {
      // ok, mudanças válidas
    } else if (L.startsWith('--- ') || L.startsWith('+++ ')) {
      // próximo arquivo
      inHunk = false;
    } else if (L.trim() === '') {
      // linha vazia entre hunks, ok
    } else {
      // Qualquer outro prefixo é inválido
      return { ok: false, reason: `Linha inválida no patch: ${L.slice(0, 40)}...` };
    }
  }

  if (contextIssues.length > 0) {
    return { 
      ok: false, 
      reason: `Contexto inválido encontrado:\n${contextIssues.slice(0, 3).join('\n')}${contextIssues.length > 3 ? `\n... e mais ${contextIssues.length - 3} problemas` : ''}` 
    };
  }

  return { ok: true, reason: '' };
}

/**
 * Valida múltiplos patches de uma vez
 */
export function validatePatchBatch(
  patches: Array<{ file: string; patch: string }>,
  fileContents: Map<string, string>
): { validPatches: Array<{ file: string; patch: string }>; invalidPatches: Array<{ file: string; patch: string; reason: string }> } {
  
  const validPatches: Array<{ file: string; patch: string }> = [];
  const invalidPatches: Array<{ file: string; patch: string; reason: string }> = [];

  for (const patchInfo of patches) {
    const originalContent = fileContents.get(patchInfo.file);
    
    if (!originalContent) {
      invalidPatches.push({
        ...patchInfo,
        reason: `Conteúdo original não encontrado para arquivo: ${patchInfo.file}`
      });
      continue;
    }

    const validation = verifyUnifiedDiffAgainstOriginal(patchInfo.patch, originalContent);
    
    if (validation.ok) {
      validPatches.push(patchInfo);
    } else {
      invalidPatches.push({
        ...patchInfo,
        reason: validation.reason
      });
    }
  }

  return { validPatches, invalidPatches };
}

/**
 * Detecta se uma linha parece ser um placeholder inventado
 */
export function detectPlaceholderLine(line: string): boolean {
  const trimmed = line.trim();
  
  // Padrões comuns de placeholders
  const placeholderPatterns = [
    /^\s*\/\/\s*\.\.\./,
    /^\s*\/\*\s*\.\.\./,
    /^\s*#\s*\.\.\./,
    /código\s+omitido/i,
    /novo\s+sistema/i,
    /modificação/i,
    /placeholder/i,
    /todo:/i,
    /fixme:/i
  ];

  return placeholderPatterns.some(pattern => pattern.test(trimmed));
}