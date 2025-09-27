/**
 * Detector especializado para JavaScript/TypeScript
 */

import fs from 'fs';
import path from 'path';
import { LanguageDetector, LanguageDetectionResult, DependencyInfo } from './types.js';
import { NPMRegistry } from './registries.js';

export class JavaScriptTypeScriptDetector implements LanguageDetector {
  private registry = new NPMRegistry();

  async isApplicable(workspaceRoot: string): Promise<boolean> {
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    return fs.existsSync(packageJsonPath);
  }

  async detect(workspaceRoot: string): Promise<LanguageDetectionResult | null> {
    if (!await this.isApplicable(workspaceRoot)) {
      return null;
    }

    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Detectar linguagem primária
    const isTypeScript = this.detectTypeScript(workspaceRoot, packageJson);
    const language = isTypeScript ? 'TypeScript' : 'JavaScript';

    // Detectar package manager
    const packageManager = this.detectPackageManager(workspaceRoot);

    // Analisar dependências
    const dependencies = await this.analyzeDependencies(packageJson.dependencies || {}, 'dependency');
    const devDependencies = await this.analyzeDependencies(packageJson.devDependencies || {}, 'dev-dependency');

    // Identificar frameworks principais
    const mainFrameworks = this.identifyMainFrameworks(dependencies, devDependencies);

    // Arquivos de configuração
    const configFiles = this.findConfigFiles(workspaceRoot);
    const lockFiles = this.findLockFiles(workspaceRoot);

    // Detectar versão do Node.js (se especificada)
    const runtimeVersion = packageJson.engines?.node;

    // Gerar recomendações
    const recommendations = this.generateRecommendations(dependencies, devDependencies, packageJson);
    const securityIssues = this.identifySecurityIssues(dependencies, devDependencies);

    return {
      language,
      ecosystem: 'Node.js',
      packageManager,
      mainFrameworks,
      dependencies,
      devDependencies,
      runtimeVersion,
      configFiles,
      lockFiles,
      confidence: 95,
      recommendations,
      securityIssues
    };
  }

  private detectTypeScript(workspaceRoot: string, packageJson: any): boolean {
    // Verifica se tem TypeScript como dependência
    const hasTypescriptDep = packageJson.dependencies?.typescript || packageJson.devDependencies?.typescript;
    
    // Verifica se tem tsconfig.json
    const hasTsConfig = fs.existsSync(path.join(workspaceRoot, 'tsconfig.json'));
    
    // Verifica se tem arquivos .ts
    const hasTypeScriptFiles = this.hasFileExtensions(workspaceRoot, ['.ts', '.tsx']);

    return !!(hasTypescriptDep || hasTsConfig || hasTypeScriptFiles);
  }

  private detectPackageManager(workspaceRoot: string): string {
    if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(workspaceRoot, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(workspaceRoot, 'package-lock.json'))) return 'npm';
    return 'npm'; // default
  }

  private async analyzeDependencies(deps: Record<string, string>, type: string): Promise<DependencyInfo[]> {
    const results: DependencyInfo[] = [];

    for (const [name, version] of Object.entries(deps)) {
      const cleanVersion = version.replace(/^[\^~>=<]/, '');
      const latestVersion = await this.registry.getLatestVersion(name);
      const packageInfo = await this.registry.getPackageInfo(name);

      const isOutdated = latestVersion ? this.compareVersions(cleanVersion, latestVersion) < 0 : false;

      results.push({
        name,
        currentVersion: cleanVersion,
        latestVersion: latestVersion || undefined,
        isOutdated,
        type: this.categorizeJSPackage(name),
        category: packageInfo?.category || 'General',
        description: packageInfo?.description
      });
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  private categorizeJSPackage(name: string): 'framework' | 'library' | 'tool' | 'runtime' {
    const frameworks = ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'gatsby', 'express', 'nestjs', 'fastify'];
    const tools = ['webpack', 'vite', 'rollup', 'babel', 'eslint', 'prettier', 'jest', 'vitest', 'cypress'];
    
    if (frameworks.some(fw => name.includes(fw))) return 'framework';
    if (tools.some(tool => name.includes(tool))) return 'tool';
    if (name === 'node' || name === 'typescript') return 'runtime';
    
    return 'library';
  }

  private identifyMainFrameworks(deps: DependencyInfo[], devDeps: DependencyInfo[]): DependencyInfo[] {
    const allDeps = [...deps, ...devDeps];
    
    return allDeps.filter(dep => 
      dep.type === 'framework' && 
      ['react', 'vue', 'angular', 'svelte', 'next', 'express', 'nestjs'].some(fw => dep.name.includes(fw))
    );
  }

  private findConfigFiles(workspaceRoot: string): string[] {
    const configPatterns = [
      'tsconfig.json', 'jsconfig.json',
      '.eslintrc.js', '.eslintrc.json', '.eslintrc.yaml',
      '.prettierrc', '.prettierrc.json',
      'webpack.config.js', 'vite.config.js', 'rollup.config.js',
      'jest.config.js', 'vitest.config.js',
      'cypress.config.js', 'playwright.config.js',
      'next.config.js', 'nuxt.config.js'
    ];

    return configPatterns.filter(pattern => 
      fs.existsSync(path.join(workspaceRoot, pattern))
    );
  }

  private findLockFiles(workspaceRoot: string): string[] {
    const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    return lockFiles.filter(file => fs.existsSync(path.join(workspaceRoot, file)));
  }

  private hasFileExtensions(workspaceRoot: string, extensions: string[]): boolean {
    try {
      const files = fs.readdirSync(workspaceRoot, { recursive: true });
      return files.some((file: any) => 
        typeof file === 'string' && 
        extensions.some(ext => file.endsWith(ext))
      );
    } catch {
      return false;
    }
  }

  private compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;
      
      if (v1Part < v2Part) return -1;
      if (v1Part > v2Part) return 1;
    }
    
    return 0;
  }

  private generateRecommendations(deps: DependencyInfo[], devDeps: DependencyInfo[], packageJson: any): string[] {
    const recommendations: string[] = [];
    
    // Verificar dependências desatualizadas
    const outdatedCount = [...deps, ...devDeps].filter(d => d.isOutdated).length;
    if (outdatedCount > 0) {
      recommendations.push(`Atualizar ${outdatedCount} dependência(s) desatualizada(s)`);
    }

    // Verificar se tem scripts básicos
    const scripts = packageJson.scripts || {};
    if (!scripts.test) {
      recommendations.push('Adicionar script de teste');
    }
    if (!scripts.build) {
      recommendations.push('Adicionar script de build');
    }

    // Verificar TypeScript
    const hasTypeScript = deps.some(d => d.name === 'typescript') || devDeps.some(d => d.name === 'typescript');
    if (!hasTypeScript && deps.length > 10) {
      recommendations.push('Considerar migração para TypeScript para projetos grandes');
    }

    return recommendations;
  }

  private identifySecurityIssues(deps: DependencyInfo[], devDeps: DependencyInfo[]): string[] {
    const issues: string[] = [];
    
    // Verificar dependências muito desatualizadas (mais de 2 anos)
    const veryOldDeps = [...deps, ...devDeps].filter(d => {
      if (!d.latestVersion || !d.isOutdated) return false;
      
      const currentMajor = parseInt(d.currentVersion.split('.')[0]);
      const latestMajor = parseInt(d.latestVersion.split('.')[0]);
      
      return latestMajor - currentMajor >= 2;
    });

    if (veryOldDeps.length > 0) {
      issues.push(`${veryOldDeps.length} dependência(s) com versões muito desatualizadas`);
    }

    return issues;
  }
}