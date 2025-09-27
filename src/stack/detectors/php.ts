/**
 * Detector especializado para PHP
 */

import fs from 'fs';
import path from 'path';
import { LanguageDetector, LanguageDetectionResult, DependencyInfo } from './types.js';
import { PackagistRegistry } from './registries.js';

export class PHPDetector implements LanguageDetector {
  private registry = new PackagistRegistry();

  async isApplicable(workspaceRoot: string): Promise<boolean> {
    const composerJsonPath = path.join(workspaceRoot, 'composer.json');
    const hasPhpFiles = this.hasFileExtensions(workspaceRoot, ['.php']);
    
    return fs.existsSync(composerJsonPath) || hasPhpFiles;
  }

  async detect(workspaceRoot: string): Promise<LanguageDetectionResult | null> {
    if (!await this.isApplicable(workspaceRoot)) {
      return null;
    }

    const composerJsonPath = path.join(workspaceRoot, 'composer.json');
    let composerJson: any = {};
    
    if (fs.existsSync(composerJsonPath)) {
      composerJson = JSON.parse(fs.readFileSync(composerJsonPath, 'utf-8'));
    }

    // Analisar dependências
    const dependencies = await this.analyzeDependencies(composerJson.require || {}, 'dependency');
    const devDependencies = await this.analyzeDependencies(composerJson['require-dev'] || {}, 'dev-dependency');

    // Identificar frameworks principais
    const mainFrameworks = this.identifyMainFrameworks(dependencies, devDependencies);

    // Arquivos de configuração
    const configFiles = this.findConfigFiles(workspaceRoot);
    const lockFiles = this.findLockFiles(workspaceRoot);

    // Detectar versão do PHP
    const runtimeVersion = this.detectPhpVersion(composerJson);

    // Gerar recomendações
    const recommendations = this.generateRecommendations(dependencies, devDependencies, composerJson);
    const securityIssues = this.identifySecurityIssues(dependencies, devDependencies);

    return {
      language: 'PHP',
      ecosystem: 'PHP',
      packageManager: 'composer',
      mainFrameworks,
      dependencies,
      devDependencies,
      runtimeVersion,
      configFiles,
      lockFiles,
      confidence: 90,
      recommendations,
      securityIssues
    };
  }

  private async analyzeDependencies(deps: Record<string, string>, type: string): Promise<DependencyInfo[]> {
    const results: DependencyInfo[] = [];

    for (const [name, version] of Object.entries(deps)) {
      // Pular PHP runtime
      if (name === 'php') continue;
      
      const cleanVersion = this.cleanPhpVersion(version);
      const latestVersion = await this.registry.getLatestVersion(name);
      const packageInfo = await this.registry.getPackageInfo(name);

      const isOutdated = latestVersion ? this.compareVersions(cleanVersion, latestVersion) < 0 : false;

      results.push({
        name,
        currentVersion: cleanVersion,
        latestVersion: latestVersion || undefined,
        isOutdated,
        type: this.categorizePHPPackage(name),
        category: packageInfo?.category || 'General',
        description: packageInfo?.description
      });
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  private cleanPhpVersion(version: string): string {
    // Remove constraint operators and extract version
    return version.replace(/^[\^~>=<\s]+/, '').split('|')[0].trim();
  }

  private categorizePHPPackage(name: string): 'framework' | 'library' | 'tool' | 'runtime' {
    const frameworks = ['laravel/framework', 'symfony/symfony', 'codeigniter', 'cakephp', 'zendframework'];
    const tools = ['phpunit/phpunit', 'squizlabs/php_codesniffer', 'phpstan/phpstan', 'psalm/psalm'];
    
    if (frameworks.some(fw => name.includes(fw.split('/')[0]))) return 'framework';
    if (tools.some(tool => name.includes(tool.split('/')[0]))) return 'tool';
    
    return 'library';
  }

  private identifyMainFrameworks(deps: DependencyInfo[], devDeps: DependencyInfo[]): DependencyInfo[] {
    const allDeps = [...deps, ...devDeps];
    
    return allDeps.filter(dep => 
      dep.type === 'framework' && 
      ['laravel', 'symfony', 'codeigniter', 'cakephp'].some(fw => dep.name.includes(fw))
    );
  }

  private detectPhpVersion(composerJson: any): string | undefined {
    return composerJson.require?.php?.replace(/^[\^~>=<\s]+/, '');
  }

  private findConfigFiles(workspaceRoot: string): string[] {
    const configPatterns = [
      'composer.json',
      'phpunit.xml', 'phpunit.xml.dist',
      'phpstan.neon', 'phpstan.neon.dist',
      'psalm.xml',
      '.php-cs-fixer.php',
      'artisan', // Laravel
      'app/config/app.php', // Laravel
      'config/app.php', // Laravel
      'app/AppKernel.php', // Symfony
      'public/index.php'
    ];

    return configPatterns.filter(pattern => 
      fs.existsSync(path.join(workspaceRoot, pattern))
    );
  }

  private findLockFiles(workspaceRoot: string): string[] {
    const lockFiles = ['composer.lock'];
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

  private generateRecommendations(deps: DependencyInfo[], devDeps: DependencyInfo[], composerJson: any): string[] {
    const recommendations: string[] = [];
    
    // Verificar dependências desatualizadas
    const outdatedCount = [...deps, ...devDeps].filter(d => d.isOutdated).length;
    if (outdatedCount > 0) {
      recommendations.push(`Atualizar ${outdatedCount} dependência(s) desatualizada(s)`);
    }

    // Verificar se tem autoload configurado
    if (!composerJson.autoload) {
      recommendations.push('Configurar autoload no composer.json');
    }

    // Verificar se tem testes
    const hasPhpUnit = deps.some(d => d.name.includes('phpunit')) || devDeps.some(d => d.name.includes('phpunit'));
    if (!hasPhpUnit) {
      recommendations.push('Adicionar PHPUnit para testes');
    }

    // Verificar análise estática
    const hasStaticAnalysis = [...deps, ...devDeps].some(d => 
      d.name.includes('phpstan') || d.name.includes('psalm')
    );
    if (!hasStaticAnalysis) {
      recommendations.push('Adicionar ferramenta de análise estática (PHPStan ou Psalm)');
    }

    return recommendations;
  }

  private identifySecurityIssues(deps: DependencyInfo[], devDeps: DependencyInfo[]): string[] {
    const issues: string[] = [];
    
    // Verificar dependências muito desatualizadas
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