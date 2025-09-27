/**
 * Utilitários para aplicação e validação de patches
 */

import fs from 'fs';
import path from 'path';
import { execa } from 'execa';
import { McpClient } from '../mcp/client.js';
import { getLogger } from './logger.js';

const logger = getLogger();

export interface PatchValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    filesAffected: number;
    linesAdded: number;
    linesRemoved: number;
  };
}

/**
 * Valida se o patch está bem formado e dentro dos limites
 */
export function validatePatch(patch: string, maxLinesPerFile: number = 300): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = { filesAffected: 0, linesAdded: 0, linesRemoved: 0 };

  if (!patch.trim()) {
    errors.push('Patch vazio');
    return { isValid: false, errors, warnings, stats };
  }

  // Verificar cabeçalhos básicos
  if (!patch.includes('--- a/') || !patch.includes('+++ b/')) {
    errors.push('Cabeçalhos de patch ausentes (--- a/ e +++ b/)');
  }

  // Analisar cada arquivo no patch
  const fileBlocks = patch.split(/^--- a\//gm).filter(Boolean);
  
  for (const block of fileBlocks) {
    const lines = block.split('\n');
    const filePath = lines[0]?.split('\t')[0] || lines[0];
    
    if (!filePath) {
      warnings.push('Caminho de arquivo não identificado em um bloco');
      continue;
    }

    // Verificar se não está tentando alterar arquivos fora do workspace
    if (filePath.includes('../') || path.isAbsolute(filePath)) {
      errors.push(`Tentativa de alterar arquivo fora do workspace: ${filePath}`);
    }

    // Contar alterações
    let linesChanged = 0;
    let addedLines = 0;
    let removedLines = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        addedLines++;
        linesChanged++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removedLines++;
        linesChanged++;
      }
    }

    stats.filesAffected++;
    stats.linesAdded += addedLines;
    stats.linesRemoved += removedLines;

    // Verificar limite de linhas por arquivo
    if (linesChanged > maxLinesPerFile) {
      errors.push(`Arquivo ${filePath} excede limite de ${maxLinesPerFile} linhas (${linesChanged} alterações)`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats
  };
}

/**
 * Aplica patch usando MCP Git se disponível, caso contrário usa git apply diretamente
 */
export async function applyPatch(patch: string, workingDir: string = process.cwd()): Promise<void> {
  const logger = getLogger();
  
  try {
    // Normalizar formato do patch (remover cabeçalhos git se presentes)
    let normalizedPatch = patch.trim();
    
    // Remover cabeçalhos "diff --git" se presentes
    normalizedPatch = normalizedPatch.replace(/^diff --git a\/.+ b\/.+\n/gm, '');
    
    // Garantir que temos cabeçalhos corretos --- a/ e +++ b/
    if (!normalizedPatch.includes('--- a/') || !normalizedPatch.includes('+++ b/')) {
      throw new Error('Formato de patch inválido: cabeçalhos --- a/ e +++ b/ ausentes');
    }

    // Validar patch antes de aplicar
    const validation = validatePatch(normalizedPatch);
    if (!validation.isValid) {
      throw new Error(`Patch inválido: ${validation.errors.join(', ')}`);
    }

    // Tentar usar MCP Git primeiro
    try {
      const mcpClient = McpClient.fromConfig();
      
      // Verificar se o patch pode ser aplicado usando MCP
      const patchCheck = await mcpClient.gitCheckPatch(normalizedPatch);
      
      if (patchCheck.canApply) {
        // Aplicar usando MCP Git
        await mcpClient.gitApplyPatch(normalizedPatch, { 
          index: true, 
          whitespace: 'fix' 
        });
        
        logger.info(` Patch aplicado via MCP: ${validation.stats.filesAffected} arquivo(s), +${validation.stats.linesAdded}/-${validation.stats.linesRemoved} linhas`);
        return;
      } else {
        logger.warn('MCP Git indicou que patch não pode ser aplicado', { errors: patchCheck.errors });
        // Continuar com fallback
      }
    } catch (mcpError) {
      logger.warn('Erro ao usar MCP Git, usando fallback', { error: String(mcpError) });
      // Continuar com fallback
    }

    // Fallback: usar git apply diretamente
    const { stdout, stderr } = await execa('git', ['apply', '--index', '--whitespace=fix'], {
      input: normalizedPatch,
      cwd: workingDir
    });

    if (stderr && !stderr.includes('warning')) {
      logger.warn('Avisos do git apply', { warnings: stderr });
    }

    logger.info(` Patch aplicado via git CLI: ${validation.stats.filesAffected} arquivo(s), +${validation.stats.linesAdded}/-${validation.stats.linesRemoved} linhas`);

  } catch (error: any) {
    // Salvar patch para debug
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const failedPatchPath = path.join(workingDir, '.clia', 'patches', `failed-${timestamp}.diff`);
    
    try {
      await savePatch(patch, failedPatchPath);
      logger.error('Erro ao aplicar patch, salvo para debug', { path: failedPatchPath });
    } catch (saveError) {
      logger.error('Erro ao aplicar patch e não foi possível salvar para debug');
    }

    throw new Error(`Falha ao aplicar patch: ${error.message}`);
  }
}

/**
 * Salva patch em arquivo para dry-run ou backup
 */
export async function savePatch(patch: string, filePath?: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultPath = path.join(process.cwd(), '.clia', 'patches', `refactor-${timestamp}.diff`);
  const targetPath = filePath || defaultPath;

  // Garantir que o diretório existe
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Escrever patch
  fs.writeFileSync(targetPath, patch, 'utf-8');
  
  return targetPath;
}

/**
 * Extrai patch corrigido de uma resposta de revisão
 */
export function extractCorrectedPatch(reviewResponse: string): string | null {
  // Procurar por STATUS: FIX ou STATUS: CORRIGIDO seguido de patch
  if (!reviewResponse.includes('STATUS: FIX') && !reviewResponse.includes('STATUS: CORRIGIDO')) {
    return null;
  }

  // Encontrar início do patch corrigido
  const lines = reviewResponse.split('\n');
  let patchStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('STATUS: FIX') || lines[i].includes('STATUS: CORRIGIDO')) {
      // Procurar próxima linha que começa com --- a/ ou <<<BEGIN_PATCH
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith('--- a/') || lines[j].includes('<<<BEGIN_PATCH')) {
          patchStartIndex = lines[j].includes('<<<BEGIN_PATCH') ? j + 1 : j;
          break;
        }
      }
      break;
    }
  }

  if (patchStartIndex === -1) {
    return null;
  }

  // Extrair patch do início até o final (ou até >>>END_PATCH se existir)
  let patchLines = lines.slice(patchStartIndex);
  
  // Se encontrou >>>END_PATCH, cortar ali
  const endIndex = patchLines.findIndex(line => line.includes('>>>END_PATCH'));
  if (endIndex !== -1) {
    patchLines = patchLines.slice(0, endIndex);
  }

  return patchLines.join('\n');
}

/**
 * Verifica se arquivo tem permissão para ser alterado
 */
export function isFileAllowedForRefactor(filePath: string, blockedPaths: string[] = []): boolean {
  const defaultBlocked = [
    '**/prod/**',
    'infra/prod/*',
    'secrets/*',
    '**/*.key',
    '**/*.pem',
    '**/.env*',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**'
  ];

  const allBlocked = [...defaultBlocked, ...blockedPaths];
  
  return !allBlocked.some(pattern => {
    // Conversão simples de glob para regex
    const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
    return regex.test(filePath);
  });
}

/**
 * Cria backup de segurança antes de aplicar patches
 */
export async function createRefactorBackup(files: string[], backupDir: string): Promise<void> {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    files: [],
    git_hash: ''
  };

  try {
    // Obter hash atual do git
    const { stdout: gitHash } = await execa('git', ['rev-parse', 'HEAD']);
    manifest.git_hash = gitHash.trim();
  } catch (error) {
    logger.warn('  Não foi possível obter hash do git');
  }

  // Copiar cada arquivo para backup
  for (const file of files) {
    if (fs.existsSync(file)) {
      const relativePath = path.relative(process.cwd(), file);
      const backupPath = path.join(backupDir, relativePath);
      const backupFileDir = path.dirname(backupPath);

      if (!fs.existsSync(backupFileDir)) {
        fs.mkdirSync(backupFileDir, { recursive: true });
      }

      fs.copyFileSync(file, backupPath);
      (manifest.files as any).push({
        original: relativePath,
        backup: path.relative(backupDir, backupPath),
        size: fs.statSync(file).size
      });
    }
  }

  // Salvar manifest
  fs.writeFileSync(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  logger.info(` Backup criado: ${manifest.files.length} arquivo(s) em ${backupDir}`);
}