/**
 * Sistema de chunking inteligente para RAG
 * Suporte a Markdown (por headings) e código (por blocos)
 */

import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

export interface ChunkMetadata {
  path: string;
  relPath: string;
  mtime: Date;
  lang: string;
  lines?: string;
  hash: string;
  tags?: string[];
  summary?: string;
}

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: ChunkMetadata;
}

/**
 * Detecta linguagem do arquivo baseado na extensão
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  
  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'js': 'javascript',
    'tsx': 'typescript',
    'jsx': 'javascript',
    'py': 'python',
    'md': 'markdown',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'php': 'php',
    'rb': 'ruby',
    'sh': 'bash',
    'sql': 'sql',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'vue': 'vue',
    'svelte': 'svelte'
  };
  
  return langMap[ext] || 'text';
}

/**
 * Chunking inteligente para Markdown - separa por headings
 */
export function chunkMarkdown(content: string, chunkSize: number, chunkOverlap: number): Array<{content: string, lines?: string}> {
  const lines = content.split('\n');
  const chunks: Array<{content: string, lines?: string}> = [];
  
  let currentChunk = '';
  let currentStartLine = 1;
  let currentEndLine = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentEndLine = i + 1;
    
    // Se encontrou um heading e já tem conteúdo, finalize o chunk
    if (line.match(/^#+\s/) && currentChunk.trim()) {
      if (currentChunk.length >= chunkSize * 0.3) { // Evita chunks muito pequenos
        chunks.push({
          content: currentChunk.trim(),
          lines: `${currentStartLine}-${currentEndLine - 1}`
        });
        
        // Overlap: mantenha as últimas linhas para contexto
        const overlapLines = Math.min(Math.floor(chunkOverlap / 50), 3);
        const overlap = lines.slice(Math.max(0, i - overlapLines), i).join('\n');
        currentChunk = overlap + '\n' + line;
        currentStartLine = Math.max(1, currentEndLine - overlapLines);
      } else {
        currentChunk += '\n' + line;
      }
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
      
      // Se o chunk ficou muito grande, force uma quebra
      if (currentChunk.length > chunkSize * 1.5) {
        chunks.push({
          content: currentChunk.trim(),
          lines: `${currentStartLine}-${currentEndLine}`
        });
        currentChunk = '';
        currentStartLine = currentEndLine + 1;
      }
    }
  }
  
  // Adiciona o último chunk se não estiver vazio
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      lines: `${currentStartLine}-${currentEndLine}`
    });
  }
  
  return chunks;
}

/**
 * Chunking inteligente para código - tenta separar por funções/classes
 */
export function chunkCode(content: string, lang: string, chunkSize: number, chunkOverlap: number): Array<{content: string, lines?: string}> {
  const lines = content.split('\n');
  
  // Patterns para diferentes linguagens
  const patterns: Record<string, RegExp[]> = {
    'typescript': [/^(export\s+)?(async\s+)?function\s+/, /^(export\s+)?(abstract\s+)?class\s+/, /^(export\s+)?interface\s+/, /^(export\s+)?type\s+/],
    'javascript': [/^(export\s+)?(async\s+)?function\s+/, /^(export\s+)?class\s+/],
    'python': [/^def\s+/, /^class\s+/, /^async\s+def\s+/],
    'java': [/^(public|private|protected)?\s*(static\s+)?[a-zA-Z_]\w*\s+\w+\s*\(/, /^(public|private|protected)?\s*(abstract\s+)?class\s+/],
    'go': [/^func\s+/, /^type\s+\w+\s+(struct|interface)/],
    'rust': [/^(pub\s+)?fn\s+/, /^(pub\s+)?struct\s+/, /^(pub\s+)?enum\s+/, /^(pub\s+)?trait\s+/]
  };
  
  const langPatterns = patterns[lang] || [];
  
  if (langPatterns.length === 0) {
    // Fallback para splitter padrão
    return chunkBySize(content, chunkSize, chunkOverlap);
  }
  
  const chunks: Array<{content: string, lines?: string}> = [];
  let currentChunk = '';
  let currentStartLine = 1;
  let currentEndLine = 1;
  let indentLevel = 0;
  let blockStartLine = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentEndLine = i + 1;
    
    // Detecta início de função/classe
    const isBlockStart = langPatterns.some(pattern => line.trim().match(pattern));
    
    if (isBlockStart) {
      // Se já temos um chunk, finalize-o
      if (currentChunk.trim() && currentChunk.length >= chunkSize * 0.3) {
        chunks.push({
          content: currentChunk.trim(),
          lines: `${currentStartLine}-${currentEndLine - 1}`
        });
        currentChunk = '';
        currentStartLine = currentEndLine;
      }
      
      blockStartLine = currentEndLine;
      indentLevel = line.length - line.trimStart().length;
    }
    
    currentChunk += (currentChunk ? '\n' : '') + line;
    
    // Se o chunk ficou muito grande, force uma quebra
    if (currentChunk.length > chunkSize * 1.5) {
      chunks.push({
        content: currentChunk.trim(),
        lines: `${currentStartLine}-${currentEndLine}`
      });
      currentChunk = '';
      currentStartLine = currentEndLine + 1;
    }
  }
  
  // Adiciona o último chunk
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      lines: `${currentStartLine}-${currentEndLine}`
    });
  }
  
  return chunks;
}

/**
 * Chunking simples por tamanho (fallback)
 */
export function chunkBySize(content: string, chunkSize: number, chunkOverlap: number): Array<{content: string, lines?: string}> {
  const lines = content.split('\n');
  const chunks: Array<{content: string, lines?: string}> = [];
  
  let currentChunk = '';
  let startLine = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (currentChunk.length + line.length > chunkSize && currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        lines: `${startLine}-${i}`
      });
      
      // Overlap
      const overlapLines = Math.min(Math.floor(chunkOverlap / 50), 3);
      const overlapContent = lines.slice(Math.max(0, i - overlapLines), i).join('\n');
      currentChunk = overlapContent + '\n' + line;
      startLine = Math.max(1, i - overlapLines + 1);
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      lines: `${startLine}-${lines.length}`
    });
  }
  
  return chunks;
}

/**
 * Função principal de chunking - roteamento inteligente
 */
export function smartChunk(content: string, filePath: string, chunkSize: number, chunkOverlap: number): Array<{content: string, lines?: string}> {
  const lang = detectLanguage(filePath);
  
  if (lang === 'markdown') {
    return chunkMarkdown(content, chunkSize, chunkOverlap);
  }
  
  if (['typescript', 'javascript', 'python', 'java', 'go', 'rust'].includes(lang)) {
    return chunkCode(content, lang, chunkSize, chunkOverlap);
  }
  
  return chunkBySize(content, chunkSize, chunkOverlap);
}