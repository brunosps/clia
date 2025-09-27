import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { execa } from 'execa';
import { getLogger } from '../shared/logger.js';

// Initialize logger
const logger = getLogger();

export async function mcpFilesystemRead(p: string): Promise<string> {
  const confirm = await askConfirm(`MCP filesystem: ler ${p}? [y/N] `);
  if (!confirm) throw new Error('Negado pelo usuário');
  return fs.readFileSync(path.resolve(p), 'utf-8');
}

/**
 * Versão automática que não pergunta - para uso em scripts
 */
export async function mcpFilesystemReadAuto(p: string): Promise<string> {
  try {
    return fs.readFileSync(path.resolve(p), 'utf-8');
  } catch (error) {
    throw new Error(`Erro ao ler ${p}: ${error}`);
  }
}

export async function mcpGitShow(
  ref: string,
  filePath: string
): Promise<string> {
  const confirm = await askConfirm(`MCP git: show ${ref}:${filePath}? [y/N] `);
  if (!confirm) throw new Error('Negado pelo usuário');
  const { stdout } = await execa('git', ['show', `${ref}:${filePath}`]);
  return stdout;
}

export async function mcpFetch(url: string): Promise<string> {
  const confirm = await askConfirm(`MCP fetch: GET ${url}? [y/N] `);
  if (!confirm) throw new Error('Negado pelo usuário');
  const r = await fetch(url);
  return await r.text();
}

export async function mcpSemgrepScan(
  scanPath: string,
  config?: string
): Promise<any> {
  const rulesetName = config || 'auto';

  logger.info(
    `Executing Semgrep directly: ${scanPath} with ruleset ${rulesetName}`
  );

  // Para security-scan automatizado, não pedir confirmação
  // const confirm = await askConfirm(`MCP Semgrep: scan ${scanPath} com ${rulesetName}? [y/N] `);
  // if (!confirm) throw new Error('Negado pelo usuário');

  try {
    logger.info('Starting semgrep execution...');
    // Executar semgrep diretamente
    const { stdout } = await execa('semgrep', [
      '--config',
      rulesetName,
      '--json',
      '--quiet',
      scanPath,
    ]);

    logger.info('Semgrep executed, processing result...');
    const report = JSON.parse(stdout);

    // Normalizar formato para o esperado pelo CLIA
    return {
      findings:
        report.results?.map((r: any) => ({
          ruleId: r.check_id,
          message:
            r.extra?.message ||
            r.extra?.metadata?.message ||
            'Security issue found',
          severity: r.extra?.severity || 'warning',
          path: r.path,
          line: r.start?.line || 0,
          column: r.start?.col || 0,
          fix: r.extra?.fix,
        })) || [],
      errors: report.errors?.map((e: any) => e.message || e.toString()) || [],
      stats: {
        rulesRan:
          Math.round(
            (report.time?.prefiltering?.rules_selected_ratio || 0) * 1000
          ) || 0,
        filesScanned: report.paths?.scanned?.length || 0,
      },
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'Semgrep não encontrado. Instale com: pip install semgrep'
      );
    }
    throw new Error(`Erro no Semgrep scan: ${error.message}`);
  }
}

export async function mcpTrivyScan(
  scanPath: string,
  scanType?: string
): Promise<any> {
  const confirm = await askConfirm(
    `MCP Trivy: scan ${scanPath} (${scanType || 'fs'})? [y/N] `
  );
  if (!confirm) throw new Error('Negado pelo usuário');

  try {
    // Tentar executar trivy diretamente
    const { stdout } = await execa('trivy', [
      scanType || 'fs',
      '--format',
      'json',
      '--quiet',
      scanPath,
    ]);

    const report = JSON.parse(stdout);

    // Normalizar formato para o esperado pelo CLIA
    return {
      vulnerabilities:
        report.Results?.flatMap(
          (r: any) =>
            r.Vulnerabilities?.map((v: any) => ({
              id: v.VulnerabilityID,
              severity: v.Severity?.toLowerCase(),
              title: v.Title,
              description: v.Description,
              package: v.PkgName,
              version: v.InstalledVersion,
              fixedVersion: v.FixedVersion,
              references: v.References || [],
            })) || []
        ) || [],
      misconfigurations:
        report.Results?.flatMap(
          (r: any) =>
            r.Misconfigurations?.map((m: any) => ({
              id: m.ID,
              title: m.Title,
              description: m.Description,
              severity: m.Severity?.toLowerCase(),
              status: m.Status,
              location: {
                file: r.Target,
                line: m.CauseMetadata?.StartLine || 0,
              },
            })) || []
        ) || [],
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'Trivy não encontrado. Instale com: https://aquasecurity.github.io/trivy/latest/getting-started/installation/'
      );
    }
    throw new Error(`Erro no Trivy scan: ${error.message}`);
  }
}

async function askConfirm(q: string): Promise<boolean> {
  process.stdout.write(q);
  return await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (d) => {
      const v = (d + '').trim().toLowerCase();
      resolve(v === 'y' || v === 'yes' || v === 's' || v === 'sim');
    });
  });
}
