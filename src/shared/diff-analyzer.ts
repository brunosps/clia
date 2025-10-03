import { execSync } from 'child_process';
import { getLogger } from './logger.js';
import { execa, execa as execaCommand } from 'execa';

const logger = getLogger();
import { CommitClassification } from './commit-validator.js';

export interface FileChange {
  file: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C'; // Added, Modified, Deleted, Renamed, Copied
  insertions: number;
  deletions: number;
  hunks: DiffHunk[];
  isBinary: boolean;
  diff: string;
  oldFile?: string; // Para renames
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: '+' | '-' | ' '; // Added, Removed, Context
  content: string;
  lineNumber?: number;
}

export interface DiffAnalysis {
  files: FileChange[];
  stats: {
    totalFiles: number;
    insertions: number;
    deletions: number;
    netChange: number;
  };
  patterns: {
    hasTestChanges: boolean;
    hasConfigChanges: boolean;
    hasDocChanges: boolean;
    hasCriticalPaths: boolean;
    predominantChangeType: 'addition' | 'deletion' | 'modification';
  };
}

async function getDiff(
  filePath: string,
  status: string,
  hunks: DiffHunk[],
  staged: boolean
): Promise<string> {
  const baseArgs = staged ? ['diff', '--cached'] : ['diff'];
  let diff = '';
  try {
    if (status === 'D') {
      diff = 'File Deleted';
    } else if (status === 'M') {
      const result = await execa('git', [...baseArgs, filePath]);
      diff = result.stdout;
    } else if (hunks && hunks[0] && hunks[0].lines) {
      diff = hunks[0].lines.map((line) => line.content).join('\n');
    }
  } catch (error) {
    logger.warn(`Failed to get diff for ${filePath}`);
    diff = 'Diff unavailable';
  }
  return diff;
}

export async function analyzeDiff(
  staged: boolean = true
): Promise<DiffAnalysis> {
  const baseArgs = staged ? ['diff', '--cached'] : ['diff'];

  try {
    // Comando separado para status dos arquivos
    const { stdout: statusOutput } = await execaCommand('git', [
      ...baseArgs,
      '--name-status',
    ]);

    // Se não há arquivos staged/unstaged via diff, verificar arquivos não rastreados
    if (!statusOutput.trim() && !staged) {
      const { stdout: untrackedOutput } = await execaCommand('git', [
        'ls-files',
        '--others',
        '--exclude-standard',
      ]);
      if (untrackedOutput.trim()) {
        // Tratar arquivos não rastreados como novos
        const untrackedFiles = untrackedOutput
          .trim()
          .split('\n')
          .filter(Boolean);
        const files = await Promise.all(
          untrackedFiles.map(
            async (file): Promise<FileChange> => ({
              file,
              status: 'A',
              insertions: 0,
              deletions: 0,
              hunks: [],
              isBinary: false,
              diff: await getDiff(file, 'A', [], staged),
            })
          )
        );

        return {
          files,
          stats: {
            totalFiles: files.length,
            insertions: 0,
            deletions: 0,
            netChange: 0,
          },
          patterns: detectPatterns(files),
        };
      }
    }

    if (!statusOutput.trim()) {
      return {
        files: [],
        stats: { totalFiles: 0, insertions: 0, deletions: 0, netChange: 0 },
        patterns: {
          hasTestChanges: false,
          hasConfigChanges: false,
          hasDocChanges: false,
          hasCriticalPaths: false,
          predominantChangeType: 'modification',
        },
      };
    }

    // Comando separado para estatísticas numéricas
    const { stdout: statsOutput } = await execaCommand('git', [
      ...baseArgs,
      '--numstat',
    ]);

    const files = await parseFileChanges(statsOutput, statusOutput, staged);
    const stats = calculateStats(files);
    const patterns = detectPatterns(files);

    return { files, stats, patterns };
  } catch (error) {
    logger.error('Erro ao analisar diff:', error);
    return {
      files: [],
      stats: { totalFiles: 0, insertions: 0, deletions: 0, netChange: 0 },
      patterns: {
        hasTestChanges: false,
        hasConfigChanges: false,
        hasDocChanges: false,
        hasCriticalPaths: false,
        predominantChangeType: 'modification',
      },
    };
  }
}

/**
 * Parseia mudanças detalhadas de arquivo
 */
async function parseFileChanges(
  statsOutput: string,
  statusOutput: string,
  staged: boolean
): Promise<FileChange[]> {
  const statsLines = statsOutput
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const statusLines = statusOutput
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  const files: FileChange[] = [];

  // Criar mapeamento de estatísticas por arquivo
  const statsMap = new Map<
    string,
    { insertions: number; deletions: number; isBinary: boolean }
  >();

  for (const statsLine of statsLines) {
    // Parse stats (ex: "10 5 src/file.ts")
    const statsMatch = statsLine.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
    if (statsMatch) {
      const [, insertionsStr, deletionsStr, filePath] = statsMatch;
      const insertions =
        insertionsStr === '-' ? 0 : parseInt(insertionsStr, 10);
      const deletions = deletionsStr === '-' ? 0 : parseInt(deletionsStr, 10);
      const isBinary = insertionsStr === '-' && deletionsStr === '-';
      statsMap.set(filePath, { insertions, deletions, isBinary });
    }
  }

  // Processar cada arquivo com status
  for (const statusLine of statusLines) {
    // Parse status (ex: "M src/file.ts" ou "R100 old.ts new.ts")
    const statusMatch = statusLine.match(/^([AMDR])(\d*)\s+(.+)$/);
    if (!statusMatch) continue;

    const [, status, , filePath] = statusMatch;

    // Handle renames para extrair novo nome do arquivo
    let file = filePath;
    let oldFile: string | undefined;
    if (status === 'R' && filePath.includes('\t')) {
      const [old, newFile] = filePath.split('\t');
      oldFile = old;
      file = newFile;
    }

    // Buscar estatísticas (pode não existir para alguns arquivos)
    const stats = statsMap.get(filePath) || {
      insertions: 0,
      deletions: 0,
      isBinary: false,
    };

    // Obter hunks detalhados
    const hunks = await getFileHunks(file, staged);
    const diff = await getDiff(file, status, hunks, staged);

    files.push({
      file,
      status: status as FileChange['status'],
      insertions: stats.insertions,
      deletions: stats.deletions,
      hunks,
      isBinary: stats.isBinary,
      oldFile,
      diff,
    });
  }

  return files;
}

/**
 * Obtém hunks detalhados para um arquivo
 */
async function getFileHunks(
  filePath: string,
  staged: boolean
): Promise<DiffHunk[]> {
  const args = staged
    ? ['diff', '--cached', '-U3', '--', filePath]
    : ['diff', '-U3', '--', filePath];

  try {
    const { stdout } = await execaCommand('git', args);
    return parseDiffHunks(stdout);
  } catch {
    return [];
  }
}

/**
 * Parseia hunks de diff detalhado
 */
function parseDiffHunks(diffOutput: string): DiffHunk[] {
  const lines = diffOutput.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    // Linha de header do hunk (ex: "@@ -10,7 +10,8 @@ function name")
    const hunkMatch = line.match(
      /^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@(.*)$/
    );
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      const [, oldStart, oldLines, newStart, newLines, header] = hunkMatch;
      currentHunk = {
        oldStart: parseInt(oldStart, 10),
        oldLines: oldLines ? parseInt(oldLines, 10) : 1,
        newStart: parseInt(newStart, 10),
        newLines: newLines ? parseInt(newLines, 10) : 1,
        header: header.trim(),
        lines: [],
      };
      continue;
    }

    // Linhas de contexto/adição/remoção
    if (
      currentHunk &&
      (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))
    ) {
      const type = line[0] as DiffLine['type'];
      const content = line.slice(1);

      currentHunk.lines.push({
        type,
        content,
        lineNumber:
          type === '+'
            ? currentHunk.newStart +
              currentHunk.lines.filter((l) => l.type === '+' || l.type === ' ')
                .length
            : type === '-'
              ? currentHunk.oldStart +
                currentHunk.lines.filter(
                  (l) => l.type === '-' || l.type === ' '
                ).length
              : undefined,
      });
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Calcula estatísticas agregadas
 */
function calculateStats(files: FileChange[]) {
  const totalFiles = files.length;
  const insertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const netChange = insertions - deletions;

  return { totalFiles, insertions, deletions, netChange };
}

/**
 * Detecta padrões nas mudanças
 */
function detectPatterns(files: FileChange[]) {
  const hasTestChanges = files.some(
    (f) =>
      f.file.includes('test') ||
      f.file.includes('spec') ||
      f.file.includes('__tests__') ||
      f.file.endsWith('.test.ts') ||
      f.file.endsWith('.spec.ts')
  );

  const hasConfigChanges = files.some(
    (f) =>
      f.file.includes('config') ||
      f.file === 'package.json' ||
      f.file === 'tsconfig.json' ||
      f.file.startsWith('.env') ||
      f.file.includes('dockerfile') ||
      f.file.includes('docker-compose')
  );

  const hasDocChanges = files.some(
    (f) =>
      f.file.endsWith('.md') ||
      f.file.includes('docs/') ||
      f.file === 'README.md'
  );

  const criticalPatterns = [
    /auth/i,
    /security/i,
    /payment/i,
    /billing/i,
    /migration/i,
    /schema/i,
    /database/i,
    /api/i,
    /server/i,
    /middleware/i,
  ];

  const hasCriticalPaths = files.some((f) =>
    criticalPatterns.some((pattern) => pattern.test(f.file))
  );

  // Determinar tipo predominante de mudança
  const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const newFiles = files.filter((f) => f.status === 'A').length;

  let predominantChangeType: 'addition' | 'deletion' | 'modification';
  if (newFiles > files.length * 0.5 || totalInsertions > totalDeletions * 2) {
    predominantChangeType = 'addition';
  } else if (totalDeletions > totalInsertions * 2) {
    predominantChangeType = 'deletion';
  } else {
    predominantChangeType = 'modification';
  }

  return {
    hasTestChanges,
    hasConfigChanges,
    hasDocChanges,
    hasCriticalPaths,
    predominantChangeType,
  };
}

/**
 * Gera resumo de mudanças por arquivo para classificação
 */
export function generateFileSummaries(
  analysis: DiffAnalysis
): Array<{ file: string; bullets: string[] }> {
  return analysis.files.map((fileChange) => {
    const bullets: string[] = [];

    // Status do arquivo
    switch (fileChange.status) {
      case 'A':
        bullets.push('arquivo criado');
        break;
      case 'D':
        bullets.push('arquivo removido');
        break;
      case 'R':
        bullets.push(`arquivo renomeado de ${fileChange.oldFile}`);
        break;
      case 'M':
        bullets.push('arquivo modificado');
        break;
    }

    // Estatísticas
    if (fileChange.insertions > 0) {
      bullets.push(`+${fileChange.insertions} linhas adicionadas`);
    }
    if (fileChange.deletions > 0) {
      bullets.push(`-${fileChange.deletions} linhas removidas`);
    }

    // Análise dos hunks para contexto
    const functionChanges = extractFunctionChanges(fileChange.hunks || []);
    functionChanges.forEach((change) => bullets.push(change));

    return {
      file: fileChange.file,
      bullets,
    };
  });
}

/**
 * Extrai mudanças em funções/métodos dos hunks
 */
function extractFunctionChanges(hunks: DiffHunk[]): string[] {
  const changes: string[] = [];

  // Verificar se hunks está definido
  if (!hunks || !Array.isArray(hunks)) {
    return changes;
  }

  hunks.forEach((hunk) => {
    // Procurar por definições de função/método no header ou nas linhas
    const functionPatterns = [
      /function\s+(\w+)/,
      /const\s+(\w+)\s*=.*=>/,
      /(\w+)\s*\([^)]*\)\s*{/, // método
      /class\s+(\w+)/,
      /interface\s+(\w+)/,
      /type\s+(\w+)/,
      /export\s+.*function\s+(\w+)/,
      /export\s+.*const\s+(\w+)/,
    ];

    const addedLines = hunk.lines.filter((line) => line.type === '+');
    const removedLines = hunk.lines.filter((line) => line.type === '-');

    // Verificar se função foi adicionada
    addedLines.forEach((line) => {
      functionPatterns.forEach((pattern) => {
        const match = line.content.match(pattern);
        if (match) {
          changes.push(`função/método ${match[1]} adicionado`);
        }
      });
    });

    // Verificar se função foi removida
    removedLines.forEach((line) => {
      functionPatterns.forEach((pattern) => {
        const match = line.content.match(pattern);
        if (match) {
          changes.push(`função/método ${match[1]} removido`);
        }
      });
    });

    // Usar header do hunk se disponível
    if (hunk.header) {
      functionPatterns.forEach((pattern) => {
        const match = hunk.header.match(pattern);
        if (match) {
          changes.push(`modificações em ${match[1]}`);
        }
      });
    }
  });

  return [...new Set(changes)]; // Remove duplicatas
}
