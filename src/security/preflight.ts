import { McpClient } from '../mcp/client.js';
import { loadConfig } from '../config.js';

export interface ParsedCommand {
  bin: string;
  subcommand?: string;
  args: string[];
  normalized: string;
  original: string;
}

export interface PreflightReport {
  errors: string[];
  warnings: string[];
  checks: {
    filesystem?: {
      pathsChecked: number;
      outsideWorkspace: string[];
      largeFiles: Array<{ path: string; size: number }>;
      binaryFiles: string[];
    };
    git?: {
      branch: string;
      isProtectedBranch: boolean;
      isDangerousOperation: boolean;
      affectedFiles: string[];
    };
    fetch?: {
      urlsChecked: string[];
      inaccessibleUrls: string[];
      largeDownloads: Array<{ url: string; size: number }>;
    };
  };
  recommendation?: 'allow' | 'deny' | 'review' | 'mcp_alternative';
  mcpAlternative?: {
    description: string;
    mcpCalls: Array<{ service: string; operation: string; args: any }>;
  };
}

/**
 * Sistema de pré-validação usando MCP para comandos
 */
export class PreflightValidator {
  private mcp: McpClient;
  private config: any;
  
  constructor(mcp?: McpClient, config?: any) {
    this.mcp = mcp || McpClient.fromConfig();
    this.config = config || loadConfig();
  }

  /**
   * Executa validação completa de um comando
   */
  async validate(command: ParsedCommand): Promise<PreflightReport> {
    const report: PreflightReport = {
      errors: [],
      warnings: [],
      checks: {}
    };

    // Parse básico do comando
    await this.validateFileSystem(command, report);
    await this.validateGit(command, report);
    await this.validateFetch(command, report);

    // Determinar recomendação final
    this.determineRecommendation(command, report);

    return report;
  }

  /**
   * Valida operações de filesystem
   */
  private async validateFileSystem(command: ParsedCommand, report: PreflightReport): Promise<void> {
    const pathArgs = this.extractPathArgs(command);
    if (pathArgs.length === 0) return;

    report.checks.filesystem = {
      pathsChecked: 0,
      outsideWorkspace: [],
      largeFiles: [],
      binaryFiles: []
    };

    const ignoreGlobs = [
      ...(this.config.rag?.excludeGlobs || []),
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**'
    ];

    for (const pathArg of pathArgs) {
      try {
        // Expandir globs
        const files = await this.mcp.fsList(pathArg);
        
        // Filtrar arquivos ignorados
        const filteredFiles = files.filter(file => {
          return !ignoreGlobs.some(glob => {
            const minimatch = require('minimatch');
            return minimatch(file, glob);
          });
        });

        report.checks.filesystem!.pathsChecked += filteredFiles.length;

        for (const file of filteredFiles) {
          const stat = await this.mcp.fsStat(file);
          
          // Verificar se está dentro do workspace
          if (!stat.insideWorkspace) {
            report.checks.filesystem!.outsideWorkspace.push(file);
            report.errors.push(`Arquivo fora do workspace: ${file}`);
          }

          // Verificar tamanho (5MB limite)
          if (stat.size > 5 * 1024 * 1024) {
            report.checks.filesystem!.largeFiles.push({ path: file, size: stat.size });
            report.warnings.push(`Arquivo grande detectado: ${file} (${this.formatBytes(stat.size)})`);
          }

          // Verificar se é binário
          if (stat.isBinary && this.isTextOperation(command)) {
            report.checks.filesystem!.binaryFiles.push(file);
            report.warnings.push(`Operação de texto em arquivo binário: ${file}`);
          }
        }
      } catch (error) {
        report.warnings.push(`Erro ao verificar path: ${pathArg} - ${error}`);
      }
    }
  }

  /**
   * Valida operações git
   */
  private async validateGit(command: ParsedCommand, report: PreflightReport): Promise<void> {
    if (command.bin !== 'git' && !this.affectsGitRepository(command)) return;

    try {
      const status = await this.mcp.gitStatus();
      const branch = await this.mcp.gitBranch();

      report.checks.git = {
        branch,
        isProtectedBranch: this.isProtectedBranch(branch),
        isDangerousOperation: this.isDangerousGitOperation(command),
        affectedFiles: [...status.staged, ...status.unstaged]
      };

      // Verificar branch protegida
      if (report.checks.git.isProtectedBranch && this.isWriteOperation(command)) {
        report.errors.push(`Operação de escrita em branch protegida: ${branch}`);
      }

      // Verificar operações perigosas
      if (report.checks.git.isDangerousOperation) {
        report.warnings.push(`Operação git potencialmente perigosa: ${command.normalized}`);
      }

      // Sugerir alternativa MCP se possível
      const mcpAlternative = this.suggestMcpAlternative(command, status);
      if (mcpAlternative) {
        report.mcpAlternative = mcpAlternative;
      }

    } catch (error) {
      report.warnings.push(`Erro ao verificar git: ${error}`);
    }
  }

  /**
   * Valida operações de fetch/download
   */
  private async validateFetch(command: ParsedCommand, report: PreflightReport): Promise<void> {
    const urls = this.extractUrls(command);
    if (urls.length === 0) return;

    report.checks.fetch = {
      urlsChecked: urls,
      inaccessibleUrls: [],
      largeDownloads: []
    };

    for (const url of urls) {
      try {
        const response = await this.mcp.fetchHead(url);
        
        if (!response.ok) {
          report.checks.fetch.inaccessibleUrls.push(url);
          report.warnings.push(`URL inacessível: ${url} (status: ${response.status})`);
        }

        // Verificar tamanho do download (25MB limite)
        if (response.contentLength && response.contentLength > 25 * 1024 * 1024) {
          report.checks.fetch.largeDownloads.push({ 
            url, 
            size: response.contentLength 
          });
          report.warnings.push(`Download grande detectado: ${url} (${this.formatBytes(response.contentLength)})`);
        }

        // Verificar domínios permitidos (se configurado)
        if (this.config.security?.allowedDomains) {
          const domain = new URL(url).hostname;
          if (!this.config.security.allowedDomains.includes(domain)) {
            report.errors.push(`Domínio não permitido: ${domain}`);
          }
        }

      } catch (error) {
        report.warnings.push(`Erro ao verificar URL: ${url} - ${error}`);
      }
    }
  }

  /**
   * Determina recomendação final baseada nas validações
   */
  private determineRecommendation(command: ParsedCommand, report: PreflightReport): void {
    // Se tem erros, negar
    if (report.errors.length > 0) {
      report.recommendation = 'deny';
      return;
    }

    // Se tem alternativa MCP, sugerir
    if (report.mcpAlternative) {
      report.recommendation = 'mcp_alternative';
      return;
    }

    // Se tem warnings, pedir revisão
    if (report.warnings.length > 0) {
      report.recommendation = 'review';
      return;
    }

    // Caso contrário, permitir
    report.recommendation = 'allow';
  }

  /**
   * Sugere alternativa MCP para comandos git comuns
   */
  private suggestMcpAlternative(command: ParsedCommand, gitStatus: any): PreflightReport['mcpAlternative'] | undefined {
    if (command.bin !== 'git') return undefined;

    const subcommand = command.args[0];

    switch (subcommand) {
      case 'status':
        return {
          description: 'Obter status do git via MCP (mais rápido e seguro)',
          mcpCalls: [
            { service: 'git', operation: 'status', args: {} }
          ]
        };

      case 'diff':
        if (command.args.includes('--name-only')) {
          return {
            description: 'Listar arquivos modificados via MCP',
            mcpCalls: [
              { service: 'git', operation: 'diffNames', args: {} }
            ]
          };
        }
        break;

      case 'branch':
        if (command.args.includes('--show-current')) {
          return {
            description: 'Obter branch atual via MCP',
            mcpCalls: [
              { service: 'git', operation: 'branch', args: {} }
            ]
          };
        }
        break;

      case 'ls-files':
        return {
          description: 'Listar arquivos do repositório via MCP filesystem',
          mcpCalls: [
            { service: 'filesystem', operation: 'list', args: { glob: '**/*' } }
          ]
        };
    }

    return undefined;
  }

  // ==================== UTILITÁRIOS ====================

  private extractPathArgs(command: ParsedCommand): string[] {
    const paths: string[] = [];
    
    for (const arg of command.args) {
      // Detectar argumentos que parecem paths
      if (arg.includes('/') || arg.includes('\\') || arg.includes('*') || arg.includes('.')) {
        // Não é flag (começa com -)
        if (!arg.startsWith('-')) {
          paths.push(arg);
        }
      }
    }

    return paths;
  }

  private extractUrls(command: ParsedCommand): string[] {
    const urls: string[] = [];
    
    for (const arg of command.args) {
      if (arg.startsWith('http://') || arg.startsWith('https://')) {
        urls.push(arg);
      }
    }

    return urls;
  }

  private isProtectedBranch(branch: string): boolean {
    const protectedBranches = this.config.git?.protectedBranches || ['main', 'master', 'production'];
    return protectedBranches.includes(branch);
  }

  private isDangerousGitOperation(command: ParsedCommand): boolean {
    const dangerous = ['push', 'force-push', 'reset --hard', 'clean -fd', 'rm --cached'];
    return dangerous.some(op => command.normalized.includes(op));
  }

  private affectsGitRepository(command: ParsedCommand): boolean {
    // Comandos que podem afetar o repositório git
    const gitAffecting = ['npm', 'yarn', 'pnpm', 'rm', 'mv', 'cp'];
    return gitAffecting.includes(command.bin);
  }

  private isWriteOperation(command: ParsedCommand): boolean {
    const writeOps = ['push', 'commit', 'merge', 'rebase', 'tag'];
    return writeOps.some(op => command.normalized.includes(op));
  }

  private isTextOperation(command: ParsedCommand): boolean {
    const textOps = ['cat', 'less', 'more', 'head', 'tail', 'grep', 'sed', 'awk'];
    return textOps.includes(command.bin);
  }

  private formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + sizes[i];
  }
}

/**
 * Função utilitária para parse básico de comandos
 */
export function parseCommand(command: string): ParsedCommand {
  const parts = command.trim().split(/\s+/);
  const bin = parts[0];
  const args = parts.slice(1);
  
  return {
    bin,
    subcommand: args[0],
    args,
    normalized: command.toLowerCase().trim(),
    original: command
  };
}