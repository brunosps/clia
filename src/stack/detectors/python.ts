/**
 * Detector especializado para Python
 */

import fs from 'fs';
import path from 'path';
import { LanguageDetector, LanguageDetectionResult, DependencyInfo } from './types.js';
import { PyPIRegistry } from './registries.js';

export class PythonDetector implements LanguageDetector {
  private registry = new PyPIRegistry();

  async isApplicable(workspaceRoot: string): Promise<boolean> {
    const requirementsPath = path.join(workspaceRoot, 'requirements.txt');
    const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
    const setupPath = path.join(workspaceRoot, 'setup.py');
    const hasPythonFiles = this.hasFileExtensions(workspaceRoot, ['.py']);
    
    return fs.existsSync(requirementsPath) || fs.existsSync(pyprojectPath) || 
           fs.existsSync(setupPath) || hasPythonFiles;
  }

  async detect(workspaceRoot: string): Promise<LanguageDetectionResult | null> {
    if (!await this.isApplicable(workspaceRoot)) {
      return null;
    }

    // Detectar package manager
    const packageManager = this.detectPackageManager(workspaceRoot);

    // Analisar dependências de diferentes fontes
    const allDependencies = await this.parseAllDependencies(workspaceRoot);
    const dependencies = allDependencies.filter(d => d.depType !== 'dev');
    const devDependencies = allDependencies.filter(d => d.depType === 'dev');

    // Identificar frameworks principais
    const mainFrameworks = this.identifyMainFrameworks(dependencies, devDependencies);

    // Arquivos de configuração
    const configFiles = this.findConfigFiles(workspaceRoot);
    const lockFiles = this.findLockFiles(workspaceRoot);

    // Detectar versão do Python
    const runtimeVersion = this.detectPythonVersion(workspaceRoot);

    // Gerar recomendações
    const recommendations = this.generateRecommendations(dependencies, devDependencies, workspaceRoot);
    const securityIssues = this.identifySecurityIssues(dependencies, devDependencies);

    return {
      language: 'Python',
      ecosystem: 'Python',
      packageManager,
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

  private detectPackageManager(workspaceRoot: string): string {
    if (fs.existsSync(path.join(workspaceRoot, 'poetry.lock'))) return 'poetry';
    if (fs.existsSync(path.join(workspaceRoot, 'Pipfile'))) return 'pipenv';
    if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'))) return 'pip (pyproject.toml)';
    if (fs.existsSync(path.join(workspaceRoot, 'requirements.txt'))) return 'pip';
    if (fs.existsSync(path.join(workspaceRoot, 'conda.yaml'))) return 'conda';
    return 'pip'; // default
  }

  private async parseAllDependencies(workspaceRoot: string): Promise<(DependencyInfo & { depType: 'prod' | 'dev' })[]> {
    const allDeps: (DependencyInfo & { depType: 'prod' | 'dev' })[] = [];

    // Parse requirements.txt
    const reqDeps = await this.parseRequirementsTxt(workspaceRoot);
    allDeps.push(...reqDeps.map(d => ({ ...d, depType: 'prod' as const })));

    // Parse requirements-dev.txt
    const devReqDeps = await this.parseRequirementsTxt(workspaceRoot, 'requirements-dev.txt');
    allDeps.push(...devReqDeps.map(d => ({ ...d, depType: 'dev' as const })));

    // Parse pyproject.toml
    const pyprojectDeps = await this.parsePyprojectToml(workspaceRoot);
    allDeps.push(...pyprojectDeps);

    // Parse setup.py (basic)
    const setupDeps = await this.parseSetupPy(workspaceRoot);
    allDeps.push(...setupDeps.map(d => ({ ...d, depType: 'prod' as const })));

    // Remove duplicates
    const uniqueDeps = new Map<string, DependencyInfo & { depType: 'prod' | 'dev' }>();
    for (const dep of allDeps) {
      if (!uniqueDeps.has(dep.name) || dep.depType === 'prod') {
        uniqueDeps.set(dep.name, dep);
      }
    }

    return Array.from(uniqueDeps.values());
  }

  private async parseRequirementsTxt(workspaceRoot: string, filename = 'requirements.txt'): Promise<DependencyInfo[]> {
    const filePath = path.join(workspaceRoot, filename);
    
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => 
      line.trim() && !line.startsWith('#') && !line.startsWith('-')
    );

    const dependencies: DependencyInfo[] = [];

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+)([>=<~!]+)?([0-9.]+)?/);
      if (match) {
        const [, name, , version] = match;
        
        const latestVersion = await this.registry.getLatestVersion(name);
        const packageInfo = await this.registry.getPackageInfo(name);
        
        const currentVersion = version || 'latest';
        const isOutdated = latestVersion && version ? 
          this.compareVersions(version, latestVersion) < 0 : false;

        dependencies.push({
          name,
          currentVersion,
          latestVersion: latestVersion || undefined,
          isOutdated,
          type: this.categorizePythonPackage(name),
          category: packageInfo?.category || 'General',
          description: packageInfo?.description
        });
      }
    }

    return dependencies;
  }

  private async parsePyprojectToml(workspaceRoot: string): Promise<(DependencyInfo & { depType: 'prod' | 'dev' })[]> {
    const filePath = path.join(workspaceRoot, 'pyproject.toml');
    
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      // Simple TOML parsing for dependencies - could use a TOML library for robustness
      const content = fs.readFileSync(filePath, 'utf-8');
      const dependencies: (DependencyInfo & { depType: 'prod' | 'dev' })[] = [];

      // Extract [tool.poetry.dependencies] section
      const depsMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\[|$)/);
      if (depsMatch) {
        const depsSection = depsMatch[1];
        const depLines = depsSection.split('\n').filter(line => 
          line.includes('=') && !line.includes('python')
        );

        for (const line of depLines) {
          const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
          if (match) {
            const [, name, version] = match;
            const cleanVersion = version.replace(/^[\^~>=<\s]+/, '');
            
            const latestVersion = await this.registry.getLatestVersion(name);
            const packageInfo = await this.registry.getPackageInfo(name);
            
            const isOutdated = latestVersion ? 
              this.compareVersions(cleanVersion, latestVersion) < 0 : false;

            dependencies.push({
              name,
              currentVersion: cleanVersion,
              latestVersion: latestVersion || undefined,
              isOutdated,
              type: this.categorizePythonPackage(name),
              category: packageInfo?.category || 'General',
              description: packageInfo?.description,
              depType: 'prod'
            });
          }
        }
      }

      // Extract [tool.poetry.group.dev.dependencies] section
      const devDepsMatch = content.match(/\[tool\.poetry\.group\.dev\.dependencies\]([\s\S]*?)(\[|$)/);
      if (devDepsMatch) {
        const devDepsSection = devDepsMatch[1];
        const depLines = devDepsSection.split('\n').filter(line => line.includes('='));

        for (const line of depLines) {
          const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
          if (match) {
            const [, name, version] = match;
            const cleanVersion = version.replace(/^[\^~>=<\s]+/, '');
            
            const latestVersion = await this.registry.getLatestVersion(name);
            const packageInfo = await this.registry.getPackageInfo(name);
            
            const isOutdated = latestVersion ? 
              this.compareVersions(cleanVersion, latestVersion) < 0 : false;

            dependencies.push({
              name,
              currentVersion: cleanVersion,
              latestVersion: latestVersion || undefined,
              isOutdated,
              type: this.categorizePythonPackage(name),
              category: packageInfo?.category || 'General',
              description: packageInfo?.description,
              depType: 'dev'
            });
          }
        }
      }

      return dependencies;
    } catch {
      return [];
    }
  }

  private async parseSetupPy(workspaceRoot: string): Promise<DependencyInfo[]> {
    const filePath = path.join(workspaceRoot, 'setup.py');
    
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Basic regex to extract install_requires
      const installRequiresMatch = content.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
      if (!installRequiresMatch) {
        return [];
      }

      const requiresContent = installRequiresMatch[1];
      const packageNames = requiresContent.match(/"([^"]+)"/g) || [];
      
      const dependencies: DependencyInfo[] = [];

      for (const packageName of packageNames) {
        const cleanName = packageName.replace(/"/g, '');
        const nameMatch = cleanName.match(/^([a-zA-Z0-9_-]+)/);
        
        if (nameMatch) {
          const name = nameMatch[1];
          
          const latestVersion = await this.registry.getLatestVersion(name);
          const packageInfo = await this.registry.getPackageInfo(name);

          dependencies.push({
            name,
            currentVersion: 'unknown',
            latestVersion: latestVersion || undefined,
            isOutdated: false,
            type: this.categorizePythonPackage(name),
            category: packageInfo?.category || 'General',
            description: packageInfo?.description
          });
        }
      }

      return dependencies;
    } catch {
      return [];
    }
  }

  private categorizePythonPackage(name: string): 'framework' | 'library' | 'tool' | 'runtime' {
    const frameworks = ['django', 'flask', 'fastapi', 'tornado', 'pyramid', 'sanic'];
    const tools = ['pytest', 'black', 'flake8', 'mypy', 'isort', 'bandit'];
    
    if (frameworks.some(fw => name.includes(fw))) return 'framework';
    if (tools.some(tool => name.includes(tool))) return 'tool';
    
    return 'library';
  }

  private identifyMainFrameworks(deps: DependencyInfo[], devDeps: DependencyInfo[]): DependencyInfo[] {
    const allDeps = [...deps, ...devDeps];
    
    return allDeps.filter(dep => 
      dep.type === 'framework' && 
      ['django', 'flask', 'fastapi', 'tornado'].some(fw => dep.name.includes(fw))
    );
  }

  private detectPythonVersion(workspaceRoot: string): string | undefined {
    // Check .python-version file
    const pythonVersionPath = path.join(workspaceRoot, '.python-version');
    if (fs.existsSync(pythonVersionPath)) {
      return fs.readFileSync(pythonVersionPath, 'utf-8').trim();
    }

    // Check pyproject.toml for python version requirement
    const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      const pythonMatch = content.match(/python\s*=\s*"([^"]+)"/);
      if (pythonMatch) {
        return pythonMatch[1];
      }
    }

    return undefined;
  }

  private findConfigFiles(workspaceRoot: string): string[] {
    const configPatterns = [
      'requirements.txt', 'requirements-dev.txt',
      'pyproject.toml', 'setup.py', 'setup.cfg',
      'poetry.lock', 'Pipfile', 'Pipfile.lock',
      'pytest.ini', 'tox.ini',
      '.python-version',
      'mypy.ini', '.mypy.ini',
      '.flake8', 'setup.cfg',
      'manage.py', // Django
      'app.py', 'main.py' // Common entry points
    ];

    return configPatterns.filter(pattern => 
      fs.existsSync(path.join(workspaceRoot, pattern))
    );
  }

  private findLockFiles(workspaceRoot: string): string[] {
    const lockFiles = ['poetry.lock', 'Pipfile.lock'];
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

  private generateRecommendations(deps: DependencyInfo[], devDeps: DependencyInfo[], workspaceRoot: string): string[] {
    const recommendations: string[] = [];
    
    // Verificar dependências desatualizadas
    const outdatedCount = [...deps, ...devDeps].filter(d => d.isOutdated).length;
    if (outdatedCount > 0) {
      recommendations.push(`Atualizar ${outdatedCount} dependência(s) desatualizada(s)`);
    }

    // Verificar ambiente virtual
    if (!fs.existsSync(path.join(workspaceRoot, 'venv')) && 
        !fs.existsSync(path.join(workspaceRoot, '.venv'))) {
      recommendations.push('Usar ambiente virtual (venv) para isolamento de dependências');
    }

    // Verificar testes
    const hasTests = devDeps.some(d => d.name.includes('pytest')) || 
                     deps.some(d => d.name.includes('unittest'));
    if (!hasTests) {
      recommendations.push('Adicionar framework de testes (pytest recomendado)');
    }

    // Verificar linting/formatação
    const hasLinting = [...deps, ...devDeps].some(d => 
      d.name.includes('black') || d.name.includes('flake8') || d.name.includes('pylint')
    );
    if (!hasLinting) {
      recommendations.push('Adicionar ferramentas de linting e formatação (black, flake8)');
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