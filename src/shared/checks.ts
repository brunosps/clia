/**
 * Sistema de execução de checks (lint, test, build)
 */

import { execa } from 'execa';
import { getLogger } from './logger.js';
import type { Config } from '../config.js';

export interface CheckResult {
  command: string;
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

export interface ChecksResult {
  passed: CheckResult[];
  failed: CheckResult[];
  skipped: string[];
  totalDuration: number;
}

/**
 * Executa lista de checks do plano
 */
export async function runChecks(
  config: Config,
  checks: string[],
  workingDir: string = process.cwd()
): Promise<ChecksResult> {
  const result: ChecksResult = {
    passed: [],
    failed: [],
    skipped: [],
    totalDuration: 0
  };

  const startTime = Date.now();

  for (const check of checks) {
    const checkResult = await runSingleCheck(config, check, workingDir);
    
    if (checkResult.success) {
      result.passed.push(checkResult);
    } else {
      result.failed.push(checkResult);
    }

    result.totalDuration += checkResult.duration;
  }

  result.totalDuration = Date.now() - startTime;
  return result;
}

/**
 * Executa um check individual
 */
async function runSingleCheck(
  config: Config,
  check: string,
  workingDir: string
): Promise<CheckResult> {
  const logger = getLogger();
  const startTime = Date.now();
  
  // Resolver comando real baseado no check
  const command = resolveCheckCommand(check);
  
  // Verificar se comando está na allow list
  if (!isCommandAllowed(config, command)) {
    if (config.security?.requireApprovalForUnknown) {
      logger.warn(`  Command '${command}' is not in the allowed list.`);
      logger.warn('   Do you want to execute anyway? (y/N)');
      
      // In production, use readline, here we assume 'N' for security
      return {
        command,
        success: false,
        output: '',
        error: 'Command not authorized by user',
        duration: Date.now() - startTime
      };
    }
  }

  // Verificar se comando está na deny list
  if (isCommandDenied(config, command)) {
    return {
      command,
      success: false,
      output: '',
      error: 'Command blocked by security configuration',
      duration: Date.now() - startTime
    };
  }

  try {
    logger.info(` Executing: ${command}`);
    
    const { stdout, stderr } = await execa('bash', ['-c', command], {
      cwd: workingDir,
      timeout: 300000, // 5 minutos
      reject: false
    });

    const success = !stderr || !stderr.includes('error') && !stderr.includes('Error');
    
    return {
      command,
      success,
      output: stdout || '',
      error: stderr || undefined,
      duration: Date.now() - startTime
    };

  } catch (error: any) {
    return {
      command,
      success: false,
      output: '',
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Resolve alias de check para comando real
 */
function resolveCheckCommand(check: string): string {
  const aliases: Record<string, string> = {
    'lint': 'npm run lint',
    'test': 'npm test',
    'build': 'npm run build',
    'typecheck': 'npx tsc --noEmit',
    'test:unit': 'npm run test:unit',
    'test:e2e': 'npm run test:e2e'
  };

  // Se é um alias conhecido, resolver
  if (aliases[check]) {
    return aliases[check];
  }

  // Se começa com 'npm' ou 'pnpm' ou 'yarn', usar direto
  if (check.startsWith('npm ') || check.startsWith('pnpm ') || check.startsWith('yarn ')) {
    return check;
  }

  // Se contém ':', assumir que é npm script
  if (check.includes(':')) {
    return `npm run ${check}`;
  }

  // Caso contrário, usar como comando direto
  return check;
}

/**
 * Verifica se comando está na allow list
 */
function isCommandAllowed(config: Config, command: string): boolean {
  const allowCommands = config.security?.allowCommands || [];
  
  if (allowCommands.length === 0) {
    return true; // Se não há lista, permitir tudo
  }

  return allowCommands.some(allowed => {
    // Permitir correspondência exata ou prefix
    return command === allowed || command.startsWith(allowed);
  });
}

/**
 * Verifica se comando está na deny list
 */
function isCommandDenied(config: Config, command: string): boolean {
  const denyCommands = config.security?.denyCommands || [];
  
  return denyCommands.some(denied => {
    // Bloquear correspondência exata ou prefix
    return command === denied || command.startsWith(denied);
  });
}

/**
 * Formata resultado dos checks para exibição
 */
export function formatChecksResult(result: ChecksResult): string {
  let output = `\n Checks executados (${result.totalDuration}ms):\n`;
  
  if (result.passed.length > 0) {
    output += ` Passou: ${result.passed.length}\n`;
    for (const check of result.passed) {
      output += `   • ${check.command} (${check.duration}ms)\n`;
    }
  }

  if (result.failed.length > 0) {
    output += `Failed: ${result.failed.length}\n`;
    for (const check of result.failed) {
      output += `   • ${check.command}: ${check.error}\n`;
      if (check.output) {
        // Mostrar apenas primeiras linhas do output
        const lines = check.output.split('\n').slice(0, 3);
        output += `     ${lines.join('\n     ')}\n`;
      }
    }
  }

  if (result.skipped.length > 0) {
    output += `⏭️  Ignorado: ${result.skipped.length}\n`;
    for (const skipped of result.skipped) {
      output += `   • ${skipped}\n`;
    }
  }

  return output;
}

/**
 * Verifica se checks falharam criticamente
 */
export function hasFailedCriticalChecks(result: ChecksResult): boolean {
  const criticalChecks = ['lint', 'typecheck', 'test:unit'];
  
  return result.failed.some(failed => 
    criticalChecks.some(critical => 
      failed.command.includes(critical)
    )
  );
}