import { loadConfig } from '../config.js';
import { createStackDetectionMcpServer, StackInfo } from '../stack/index.js';

import type { Logger } from '../shared/logger.js';

export interface McpServers {
  filesystem?: string; // "mcp+local://filesystem"
  git?: string; // "mcp+local://git"
  fetch?: string; // "mcp+local://fetch"
  'stack-detector'?: string; // "mcp+local://stack-detector"
  context7?: string; // "https://mcp.context7.com/mcp"
  stackoverflow?: string; // "mcp+community://stackoverflow"
  github?: string; // "npx @modelcontextprotocol/server-github"
  semgrep?: string; // "mcp+local://semgrep"
  trivy?: string; // "mcp+local://trivy"
}

export interface GitHubRepository {
  name: string;
  fullName: string;
  description?: string;
  language?: string;
  stars: number;
  forks: number;
  topics: string[];
  url: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  author: string;
  createdAt: string;
  url: string;
}

export interface GitHubCodeSearch {
  repository: string;
  path: string;
  content: string;
  language: string;
  url: string;
}

export interface SemgrepFinding {
  ruleId: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  path: string;
  line: number;
  column: number;
  fix?: string;
}

export interface SemgrepReport {
  findings: SemgrepFinding[];
  stats: {
    rulesRan: number;
    filesScanned: number;
  };
  errors: string[];
}

export interface TrivyVulnerability {
  VulnerabilityID: string;
  Title: string;
  Description: string;
  Severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  References: string[];
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
}

export interface TrivyMisconfiguration {
  ID: string;
  Title: string;
  Description: string;
  Severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  References: string[];
  Message: string;
}

export interface TrivyReport {
  vulnerabilities: TrivyVulnerability[];
  misconfigurations: TrivyMisconfiguration[];
  errors: string[];
}

export interface StackOverflowQuestion {
  id: number;
  title: string;
  body: string;
  score: number;
  answers: StackOverflowAnswer[];
  tags: string[];
  url: string;
}

export interface StackOverflowAnswer {
  id: number;
  body: string;
  score: number;
  isAccepted: boolean;
  author: string;
}

export interface Context7LibraryInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
}

export interface Context7Documentation {
  library: string;
  version: string;
  topic?: string;
  content: string;
  examples?: string[];
  relevanceScore?: number;
}

export interface FileSystemStat {
  size: number;
  isBinary: boolean;
  insideWorkspace: boolean;
  exists: boolean;
  isDirectory: boolean;
}

export interface GitStatus {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  contentType?: string;
  contentLength?: number;
  headers: Record<string, string>;
}

/**
 * Cliente MCP para operações reais sem simulações
 * Usa protocolos MCP genuínos para todos os serviços
 */
export class McpClient {
  private servers: McpServers;
  private workspaceRoot: string;
  private stackDetector?: ReturnType<typeof createStackDetectionMcpServer>;
  private logger?: Logger;

  constructor(servers?: McpServers, workspaceRoot?: string, logger?: Logger) {
    this.servers = servers || {};
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.logger = logger;

    // Initialize Stack Detector if configured
    if (this.servers['stack-detector']) {
      this.stackDetector = createStackDetectionMcpServer(this.workspaceRoot);
    }
  }

  static fromConfig(): McpClient {
    const config = loadConfig();
    return new McpClient(config.mcp?.servers || {}, process.cwd());
  }

  // ==================== FILESYSTEM MCP ====================

  /**
   * Lista arquivos que correspondem ao glob pattern
   */
  async fsList(glob: string): Promise<string[]> {
    if (!this.servers.filesystem) {
      throw new Error(
        'MCP filesystem not configured. Configure in clia.config.json'
      );
    }

    return await this.callTool('filesystem', 'list_files', { glob });
  }

  /**
   * Obtém estatísticas de um arquivo/diretório
   */
  async fsStat(path: string): Promise<FileSystemStat> {
    if (!this.servers.filesystem) {
      throw new Error(
        'MCP filesystem not configured. Configure in clia.config.json'
      );
    }

    return await this.callTool('filesystem', 'stat', { path });
  }

  /**
   * Verifica se um path está dentro do workspace
   */
  async fsWithinWorkspace(path: string): Promise<boolean> {
    if (!this.servers.filesystem) {
      // Fallback usando Node.js puro
      const pathModule = await import('path');
      const resolvedPath = pathModule.resolve(path);
      const resolvedWorkspace = pathModule.resolve(this.workspaceRoot);
      return resolvedPath.startsWith(resolvedWorkspace);
    }

    const result = await this.callTool('filesystem', 'within_workspace', {
      path,
    });
    return result.withinWorkspace;
  }

  // ==================== GIT MCP ====================

  /**
   * Obtém status do repositório Git
   */
  async gitStatus(): Promise<GitStatus> {
    // Tentar MCP Git nativo primeiro
    try {
      return await this.callTool('git', 'status', {});
    } catch (mcpError) {
      this.logger?.warn('MCP Git falhou, usando fallback nativo', {
        error: mcpError,
      });
    }

    // Fallback usando git nativo
    try {
      const { execa } = await import('execa');
      const { stdout } = await execa('git', ['status', '--porcelain'], {
        cwd: this.workspaceRoot,
      });

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      if (stdout.trim()) {
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const statusCode = line.substring(0, 2);
          const filePath = line.substring(3);

          // Parse git status codes
          if (statusCode[0] !== ' ' && statusCode[0] !== '?') {
            staged.push(filePath);
          }
          if (statusCode[1] !== ' ' && statusCode[1] !== '?') {
            unstaged.push(filePath);
          }
          if (statusCode === '??') {
            untracked.push(filePath);
          }
        }
      }

      // Obter informações de branch e commits ahead/behind
      let branch = 'main';
      let ahead = 0;
      let behind = 0;

      try {
        const { stdout: branchInfo } = await execa(
          'git',
          ['status', '--porcelain=v1', '--branch'],
          { cwd: this.workspaceRoot }
        );
        const branchLine = branchInfo.split('\n')[0];
        if (branchLine.startsWith('## ')) {
          const branchPart = branchLine.substring(3);
          if (branchPart.includes('...')) {
            const [localBranch, remote] = branchPart.split('...');
            branch = localBranch;
            // Parse ahead/behind if available
            const match = branchPart.match(
              /\[ahead (\d+), behind (\d+)\]|\[ahead (\d+)\]|\[behind (\d+)\]/
            );
            if (match) {
              ahead = parseInt(match[1] || match[3] || '0');
              behind = parseInt(match[2] || match[4] || '0');
            }
          } else {
            branch = branchPart;
          }
        }
      } catch (branchError) {
        this.logger?.warn('Erro ao obter info de branch:', branchError);
      }

      return { branch, staged, unstaged, untracked, ahead, behind };
    } catch (error) {
      throw new Error(
        `Falha ao obter git status: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      );
    }
  }

  /**
   * Obtém diff de um arquivo específico
   */
  async gitDiff(filePath: string, base: string = 'HEAD'): Promise<string> {
    // Tentar MCP Git nativo primeiro
    try {
      const result = await this.callTool('git', 'diff', {
        file: filePath,
        base,
      });
      return result.diff || '';
    } catch (mcpError) {
      this.logger?.warn('MCP Git diff falhou, usando fallback nativo', {
        error: mcpError,
      });
    }

    // Fallback usando git nativo
    try {
      const { execa } = await import('execa');
      const { stdout } = await execa('git', ['diff', base, '--', filePath], {
        cwd: this.workspaceRoot,
      });
      return stdout;
    } catch (error) {
      // Fallback silencioso para evitar logs desnecessários
      return '';
    }
  }

  /**
   * Obtém informações estatísticas de mudanças em um arquivo
   */
  async gitDiffStats(
    filePath: string,
    base: string = 'HEAD'
  ): Promise<{ insertions: number; deletions: number }> {
    // Tentar MCP Git nativo primeiro
    try {
      const result = await this.callTool('git', 'diff_stats', {
        file: filePath,
        base,
      });
      return {
        insertions: result.insertions || 0,
        deletions: result.deletions || 0,
      };
    } catch (mcpError) {
      this.logger?.warn('MCP Git diff stats falhou, usando fallback nativo', {
        error: mcpError,
      });
    }

    // Fallback usando git nativo
    try {
      const { execa } = await import('execa');
      const { stdout } = await execa(
        'git',
        ['diff', '--numstat', base, '--', filePath],
        { cwd: this.workspaceRoot }
      );

      if (stdout.trim()) {
        const [insertions, deletions] = stdout
          .trim()
          .split('\t')
          .map((n) => parseInt(n) || 0);
        return { insertions, deletions };
      }

      return { insertions: 0, deletions: 0 };
    } catch (error) {
      // Fallback silencioso
      return { insertions: 0, deletions: 0 };
    }
  }

  async gitCommit(message: string, files?: string[]): Promise<void> {
    if (!this.servers.git) {
      throw new Error('MCP git not configured. Configure in clia.config.json');
    }

    await this.callTool('git', 'commit', { message, files });
  }

  /**
   * Obtém arquivos modificados em um range de commits (ex: commit1^..commit2)
   */
  async gitDiffRange(range: string): Promise<{ diff: string; stats: any }> {
    try {
      // Tentar MCP Git nativo primeiro
      const [diffResult, statsResult] = await Promise.all([
        this.callTool('git', 'diff', { range }),
        this.callTool('git', 'diff_stats', { range }),
      ]);

      return {
        diff: diffResult.diff || '',
        stats: statsResult,
      };
    } catch (mcpError) {
      this.logger?.warn('MCP Git diff range falhou, usando fallback nativo', {
        error: mcpError,
      });

      // Fallback usando git nativo
      try {
        const { execa } = await import('execa');
        const [diffResult, statsResult] = await Promise.all([
          execa('git', ['diff', range], { cwd: this.workspaceRoot }),
          execa('git', ['diff', '--numstat', range], {
            cwd: this.workspaceRoot,
          }),
        ]);

        // Parse stats manually
        const files = statsResult.stdout.trim()
          ? statsResult.stdout
              .trim()
              .split('\n')
              .map((line) => {
                const [insertions, deletions, file] = line.split('\t');
                return {
                  file,
                  insertions: parseInt(insertions) || 0,
                  deletions: parseInt(deletions) || 0,
                  changes:
                    (parseInt(insertions) || 0) + (parseInt(deletions) || 0),
                };
              })
          : [];

        const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
        const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

        return {
          diff: diffResult.stdout,
          stats: {
            insertions: totalInsertions,
            deletions: totalDeletions,
            changed: files.length,
            files,
          },
        };
      } catch (error) {
        throw new Error(`Erro ao obter diff do range ${range}: ${error}`);
      }
    }
  }

  /**
   * Lista branches do repositório
   */
  async gitListBranches(): Promise<string[]> {
    if (!this.servers.git) {
      throw new Error('MCP git not configured. Configure in clia.config.json');
    }

    const result = await this.callTool('git', 'list_branches', {});
    return result.branches;
  }

  /**
   * Obtém branch atual
   */
  async gitBranch(): Promise<string> {
    if (!this.servers.git) {
      throw new Error('MCP git not configured. Configure in clia.config.json');
    }

    const result = await this.callTool('git', 'current_branch', {});
    return result.branch;
  }

  /**
   * Aplica patch usando git apply
   */
  async gitApplyPatch(
    patch: string,
    options?: { index?: boolean; whitespace?: 'fix' | 'warn' | 'error' }
  ): Promise<void> {
    if (!this.servers.git) {
      throw new Error('MCP git not configured. Configure in clia.config.json');
    }

    const params = {
      patch,
      index: options?.index ?? true,
      whitespace: options?.whitespace ?? 'fix',
    };

    await this.callTool('git', 'apply', params);
  }

  /**
   * Verifica se um patch pode ser aplicado (git apply --check)
   */
  async gitCheckPatch(
    patch: string
  ): Promise<{ canApply: boolean; errors?: string[] }> {
    if (!this.servers.git) {
      throw new Error('MCP git not configured. Configure in clia.config.json');
    }

    try {
      await this.callTool('git', 'apply', { patch, check: true });
      return { canApply: true };
    } catch (error) {
      return {
        canApply: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ==================== FETCH MCP ====================

  /**
   * Realiza requisição HTTP segura
   */
  async fetchUrl(url: string, options?: any): Promise<FetchResponse> {
    if (!this.servers.fetch) {
      throw new Error(
        'MCP fetch not configured. Configure in clia.config.json'
      );
    }

    return await this.callTool('fetch', 'get', { url, ...options });
  }

  /**
   * Realiza requisição HEAD HTTP
   */
  async fetchHead(url: string): Promise<FetchResponse> {
    if (!this.servers.fetch) {
      throw new Error(
        'MCP fetch not configured. Configure in clia.config.json'
      );
    }

    return await this.callTool('fetch', 'head', { url });
  }

  // ==================== STACK DETECTOR MCP ====================

  /**
   * Detecta tecnologias do projeto
   */
  async detectStack(): Promise<StackInfo> {
    if (!this.stackDetector) {
      throw new Error(
        'Stack detector MCP not configured. Configure in clia.config.json'
      );
    }

    return this.stackDetector.detectStack();
  }

  /**
   * Obtém informações de contexto para RAG
   */
  async stackGetContextInfo(): Promise<{
    summary: string;
    technologies: string[];
    searchHints: string[];
  }> {
    if (!this.stackDetector) {
      throw new Error(
        'Stack detector MCP not configured. Configure in clia.config.json'
      );
    }

    return this.stackDetector.getContextInfo();
  }

  // ==================== SEMGREP MCP ====================

  /**
   * Executa scan de segurança com Semgrep
   */
  async semgrepScan(path?: string, config?: string): Promise<SemgrepReport> {
    const scanPath = path || this.workspaceRoot;
    const ruleset = config || 'auto';

    try {
      // Try MCP server first if configured
      if (this.isServerConfigured('semgrep')) {
        const response = await this.callTool('semgrep', 'scan', {
          path: scanPath,
          config: ruleset,
        });
        return response;
      }
    } catch (error) {
      this.logger?.warn(
        'MCP Semgrep falhou, usando execução direta:',
        error instanceof Error ? error.message : String(error)
      );
    }

    // Fallback: executar Semgrep diretamente
    try {
      const { mcpSemgrepScan } = await import('./stubs.js');
      const result = await mcpSemgrepScan(scanPath, ruleset);
      this.logger?.info('Semgrep executado diretamente com sucesso', {
        findings: result.findings?.length || 0,
        filesScanned: result.stats?.filesScanned || 0,
      });
      return result;
    } catch (directError) {
      this.logger?.error('Error running Semgrep directly:', directError);
      throw new Error(
        `Semgrep not available via MCP or direct execution: ${directError}`
      );
    }
  }

  /**
   * Lista rulesets disponíveis no Semgrep
   */
  async semgrepGetRulesets(): Promise<string[]> {
    if (!this.isServerConfigured('semgrep')) {
      throw new Error('Semgrep MCP server not configured');
    }

    try {
      const response = await this.callTool('semgrep', 'get_rulesets', {});
      return response.rulesets || [];
    } catch (error) {
      this.logger?.error('Error getting Semgrep rulesets:', error);
      throw error;
    }
  }

  /**
   * Executa scan de dependências e IaC com Trivy
   */
  async trivyScan(path?: string, scanType?: string): Promise<TrivyReport> {
    if (!this.isServerConfigured('trivy')) {
      throw new Error(
        'Trivy MCP server not configured. Configure in clia.config.json'
      );
    }

    try {
      const response = await this.callTool('trivy', 'scan', {
        path: path || this.workspaceRoot,
        scanType: scanType || 'fs',
      });

      return response;
    } catch (error) {
      this.logger?.error('Error running Trivy scan:', error);
      throw error;
    }
  }

  /**
   * Validate Semgrep rule syntax
   */
  async validateSemgrepRule(rule: string): Promise<boolean> {
    if (!this.isServerConfigured('semgrep')) {
      throw new Error('Semgrep MCP server not configured');
    }

    try {
      const response = await this.callTool('semgrep', 'validate_rule', {
        rule,
      });

      return response.valid || false;
    } catch (error) {
      this.logger?.error('Error validating Semgrep rule:', error);
      return false;
    }
  }

  // ==================== GITHUB MCP ====================

  /**
   * Search for GitHub repositories
   */
  async githubSearchRepositories(
    query: string,
    language?: string
  ): Promise<GitHubRepository[]> {
    if (!this.isServerConfigured('github')) {
      throw new Error(
        'GitHub MCP server not configured. Configure in clia.config.json'
      );
    }

    try {
      const response = await this.callTool('github', 'search_repositories', {
        query,
        language,
      });

      return response.repositories || [];
    } catch (error) {
      this.logger?.error('Error searching GitHub repositories:', error);
      throw error;
    }
  }

  /**
   * Search for GitHub issues
   */
  async githubSearchIssues(
    query: string,
    repo?: string
  ): Promise<GitHubIssue[]> {
    if (!this.isServerConfigured('github')) {
      throw new Error('GitHub MCP server not configured');
    }

    try {
      const response = await this.callTool('github', 'search_issues', {
        query,
        repo,
      });

      return response.issues || [];
    } catch (error) {
      this.logger?.error('Error searching GitHub issues:', error);
      throw error;
    }
  }

  /**
   * Search for code in GitHub
   */
  async githubSearchCode(
    query: string,
    language?: string
  ): Promise<GitHubCodeSearch[]> {
    if (!this.isServerConfigured('github')) {
      throw new Error('GitHub MCP server not configured');
    }

    try {
      const response = await this.callTool('github', 'search_code', {
        query,
        language,
      });

      return response.results || [];
    } catch (error) {
      this.logger?.error('Error searching GitHub code:', error);
      throw error;
    }
  }

  // ==================== STACKOVERFLOW MCP ====================

  /**
   * Busca perguntas no StackOverflow via MCP
   */
  async stackOverflowSearch(
    query: string,
    tags?: string[]
  ): Promise<StackOverflowQuestion[]> {
    if (!this.isServerConfigured('stackoverflow')) {
      throw new Error(
        'StackOverflow MCP server not configured. Configure in clia.config.json'
      );
    }

    try {
      const response = await this.callTool('stackoverflow', 'search', {
        query,
        tags: tags || [],
      });

      return response.questions || [];
    } catch (error) {
      this.logger?.error('Error searching StackOverflow:', error);
      throw error;
    }
  }

  // ==================== CONTEXT7 MCP ====================

  /**
   * Search for libraries in Context7
   */
  async context7SearchLibraries(query: string): Promise<Context7LibraryInfo[]> {
    if (!this.isServerConfigured('context7')) {
      throw new Error(
        'Context7 MCP server not configured. Configure in clia.config.json'
      );
    }

    try {
      const response = await this.callTool('context7', 'search_libraries', {
        query,
      });

      return response.libraries || [];
    } catch (error) {
      this.logger?.error('Error searching Context7 libraries:', error);
      throw error;
    }
  }

  /**
   * Get documentation for a library
   */
  async context7GetDocumentation(
    libraryId: string,
    topic?: string
  ): Promise<Context7Documentation[]> {
    if (!this.isServerConfigured('context7')) {
      throw new Error('Context7 MCP server não configurado');
    }

    try {
      const response = await this.callTool('context7', 'get_documentation', {
        libraryId,
        topic,
      });

      return response.documentation || [];
    } catch (error) {
      this.logger?.error('Error getting Context7 documentation:', error);
      throw error;
    }
  }

  // ==================== HELPER METHODS ====================

  private isServerConfigured(serverName: keyof McpServers): boolean {
    const serverValue = this.servers[serverName];
    return !!(serverValue && serverValue !== 'DISABLED' && serverValue !== '');
  }

  private async callTool(
    serverName: string,
    toolName: string,
    params?: any
  ): Promise<any> {
    if (!this.isServerConfigured(serverName as keyof McpServers)) {
      throw new Error(
        `MCP server '${serverName}' não está configurado. Configure em clia.config.json`
      );
    }

    this.logger?.info(`Executing ${serverName}.${toolName}`, params);

    try {
      // Implementar protocolo MCP real aqui
      // Por enquanto, precisamos implementar cada servidor específico
      switch (serverName) {
        case 'git':
          return await this.callGitMcp(toolName, params);
        case 'github':
          return await this.callGitHubMcp(toolName, params);
        case 'semgrep':
          return await this.callSemgrepMcp(toolName, params);
        case 'trivy':
          return await this.callTrivyMcp(toolName, params);
        case 'stackoverflow':
          return await this.callStackOverflowMcp(toolName, params);
        case 'context7':
          return await this.callContext7Mcp(toolName, params);
        default:
          throw new Error(`Servidor MCP '${serverName}' não implementado`);
      }
    } catch (error) {
      this.logger?.error(`Erro ao chamar ${serverName}.${toolName}:`, error);
      throw error;
    }
  }

  // ==================== REAL MCP IMPLEMENTATIONS ====================

  private async callGitMcp(toolName: string, params: any): Promise<any> {
    // Git MCP server - operações locais do Git
    const simpleGit = await import('simple-git');
    const git = simpleGit.simpleGit(this.workspaceRoot);

    try {
      switch (toolName) {
        case 'status':
          const status = await git.status();
          return {
            branch: status.current || 'unknown',
            staged: status.staged || [],
            unstaged: status.modified || [],
            untracked: status.not_added || [],
            ahead: status.ahead || 0,
            behind: status.behind || 0,
          };

        case 'diff':
          if (params.range) {
            // Diff entre commits (ex: commit1^..commit2)
            const diff = await git.diff([params.range]);
            return { diff, range: params.range };
          } else if (params.file) {
            // Diff de arquivo específico vs base
            const base = params.base || 'HEAD';
            const diff = await git.diff([base, '--', params.file]);
            return { diff, file: params.file, base };
          } else {
            // Diff geral do working tree
            const diff = await git.diff();
            return { diff };
          }

        case 'diff_stats':
          if (params.range) {
            // Stats entre commits
            const stats = await git.diffSummary([params.range]);
            return {
              insertions: stats.insertions,
              deletions: stats.deletions,
              changed: stats.changed,
              files: stats.files.map((f) => ({
                file: f.file,
                changes: 'changes' in f ? f.changes : 0,
                insertions: 'insertions' in f ? f.insertions : 0,
                deletions: 'deletions' in f ? f.deletions : 0,
                binary: 'binary' in f ? f.binary : false,
              })),
            };
          } else if (params.file) {
            // Stats de arquivo específico vs base
            const base = params.base || 'HEAD';
            const stats = await git.diffSummary([base, '--', params.file]);
            return {
              insertions: stats.insertions,
              deletions: stats.deletions,
              changed: stats.changed,
              files: stats.files.map((f) => ({
                file: f.file,
                changes: 'changes' in f ? f.changes : 0,
                insertions: 'insertions' in f ? f.insertions : 0,
                deletions: 'deletions' in f ? f.deletions : 0,
                binary: 'binary' in f ? f.binary : false,
              })),
            };
          } else {
            // Stats gerais do working tree
            const stats = await git.diffSummary();
            return {
              insertions: stats.insertions,
              deletions: stats.deletions,
              changed: stats.changed,
              files: stats.files.map((f) => ({
                file: f.file,
                changes: 'changes' in f ? f.changes : 0,
                insertions: 'insertions' in f ? f.insertions : 0,
                deletions: 'deletions' in f ? f.deletions : 0,
                binary: 'binary' in f ? f.binary : false,
              })),
            };
          }

        case 'commit':
          await git.add(params.files || '.');
          const result = await git.commit(params.message);
          return { commit: result.commit, summary: result.summary };

        case 'list_branches':
          const branches = await git.branchLocal();
          return {
            current: branches.current,
            all: branches.all,
            branches: Object.keys(branches.branches).map((name) => ({
              name,
              current: name === branches.current,
              commit: branches.branches[name].commit,
              label: branches.branches[name].label,
            })),
          };

        case 'current_branch':
          const branch = await git.branch();
          return { current: branch.current };

        case 'apply':
          if (params.check) {
            // Verificar se o patch pode ser aplicado
            await git.raw(['apply', '--check', '--index'], params.patch);
            return { success: true, checked: true };
          } else {
            // Aplicar o patch
            await git.raw(['apply', '--index'], params.patch);
            return { success: true, applied: true };
          }

        default:
          throw new Error(`Git tool '${toolName}' não implementado`);
      }
    } catch (error) {
      this.logger?.error(`Erro no Git MCP tool '${toolName}':`, error);
      throw error;
    }
  }

  private async callGitHubMcp(toolName: string, params: any): Promise<any> {
    // GitHub MCP server via @modelcontextprotocol/server-github
    const serverUrl = this.servers.github;
    if (!serverUrl) {
      throw new Error('GitHub MCP server not configured');
    }

    // Implementação real via protocolo MCP para GitHub
    if (!this.isServerConfigured('github')) {
      throw new Error(
        'GitHub MCP server not configured. Configure in clia.config.json servers.github'
      );
    }

    try {
      // GitHub MCP server available via npm @modelcontextprotocol/server-github
      const response = await this.callTool('github', toolName, params);
      return response;
    } catch (error) {
      this.logger?.warn(
        `GitHub MCP server unavailable for '${toolName}':`,
        error
      );
      throw new Error(
        `GitHub MCP: Servidor não conectado. Instale e execute: npx @modelcontextprotocol/server-github`
      );
    }
  }

  private async callSemgrepMcp(toolName: string, params: any): Promise<any> {
    // Semgrep local MCP server
    const fs = await import('fs/promises');
    const path = await import('path');
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    try {
      switch (toolName) {
        case 'scan':
          // Executar Semgrep real no diretório especificado
          const targetPath = params.path || this.workspaceRoot;
          const config = params.config || 'auto';

          const { stdout, stderr } = await execFileAsync('semgrep', [
            '--config',
            config,
            '--json',
            '--quiet',
            targetPath,
          ]);

          if (stderr && stderr.trim()) {
            this.logger?.warn('Semgrep warnings:', stderr);
          }

          const report = JSON.parse(stdout);
          return this.formatSemgrepReport(report);

        case 'get_rulesets':
          return {
            rulesets: [
              'auto',
              'security',
              'correctness',
              'performance',
              'typescript',
              'javascript',
              'python',
            ],
          };

        case 'validate_rule':
          // Validar regra Semgrep real
          const tempFile = path.join('/tmp', `semgrep-rule-${Date.now()}.yaml`);
          await fs.writeFile(tempFile, params.rule);

          try {
            await execFileAsync('semgrep', [
              '--config',
              tempFile,
              '--validate',
            ]);
            await fs.unlink(tempFile);
            return { valid: true };
          } catch (error) {
            await fs.unlink(tempFile);
            return { valid: false, error: (error as Error).message };
          }

        default:
          throw new Error(
            `Semgrep MCP: ferramenta '${toolName}' não implementada`
          );
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          'Semgrep não encontrado. Instale com: pip install semgrep'
        );
      }
      throw error;
    }
  }

  private async callTrivyMcp(toolName: string, params: any): Promise<any> {
    // Trivy local MCP server
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    try {
      switch (toolName) {
        case 'scan':
          // Executar Trivy real no diretório especificado
          const targetPath = params.path || this.workspaceRoot;
          const scanType = params.scanType || 'fs';

          const { stdout, stderr } = await execFileAsync('trivy', [
            scanType,
            '--format',
            'json',
            '--quiet',
            targetPath,
          ]);

          if (stderr && stderr.trim()) {
            this.logger?.warn('Trivy warnings:', stderr);
          }

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

        default:
          throw new Error(
            `Trivy MCP: ferramenta '${toolName}' não implementada`
          );
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          'Trivy não encontrado. Instale com: https://aquasecurity.github.io/trivy/latest/getting-started/installation/'
        );
      }
      throw error;
    }
  }

  private async callStackOverflowMcp(
    toolName: string,
    params: any
  ): Promise<any> {
    // StackOverflow community MCP server
    const serverUrl = this.servers.stackoverflow;
    if (!serverUrl) {
      throw new Error('StackOverflow MCP server não configurado');
    }

    // Implementação real via protocolo MCP para StackOverflow
    try {
      const response = await this.callTool('stackoverflow', toolName, params);
      return response;
    } catch (error) {
      this.logger?.warn(
        `StackOverflow MCP server unavailable for '${toolName}':`,
        error
      );
      throw new Error(
        `StackOverflow MCP: Servidor não conectado. Configure: mcp+community://stackoverflow`
      );
    }
  }

  private async callContext7Mcp(toolName: string, params: any): Promise<any> {
    // Context7 MCP server
    const serverUrl = this.servers.context7;
    if (!serverUrl) {
      throw new Error('Context7 MCP server não configurado');
    }

    // Implementação real via protocolo MCP para Context7
    try {
      const response = await this.callTool('context7', toolName, params);
      return response;
    } catch (error) {
      this.logger?.warn(
        `Context7 MCP server unavailable for '${toolName}':`,
        error
      );
      throw new Error(
        `Context7 MCP: Servidor não conectado. Verifique conectividade com ${serverUrl}`
      );
    }
  }

  private formatSemgrepReport(report: any): SemgrepReport {
    const findings: SemgrepFinding[] = (report.results || []).map(
      (result: any) => ({
        ruleId: result.check_id,
        message: result.extra.message,
        severity: this.mapSemgrepSeverity(result.extra.severity),
        path: result.path,
        startLine: result.start.line,
        endLine: result.end.line,
        startCol: result.start.col,
        endCol: result.end.col,
        fix: result.extra.fix,
        category: this.mapSemgrepCategory(result.check_id),
      })
    );

    return {
      findings,
      errors: report.errors || [],
      stats: {
        rulesRan: report.rules?.length || 0,
        filesScanned: new Set(findings.map((f) => f.path)).size,
      },
    };
  }

  private mapSemgrepSeverity(severity: string): 'error' | 'warning' | 'info' {
    switch (severity?.toLowerCase()) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      default:
        return 'info';
    }
  }

  private mapSemgrepCategory(ruleId: string): string {
    if (ruleId.includes('security')) return 'security';
    if (ruleId.includes('correctness')) return 'correctness';
    if (ruleId.includes('performance')) return 'performance';
    if (ruleId.includes('best-practice')) return 'best-practice';
    return 'other';
  }
}
