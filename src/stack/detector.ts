import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { getLogger } from '../shared/logger.js';

const logger = getLogger();
import { 
  StackInfo, 
  TechStack, 
  PackageManager, 
  Framework, 
  Tool, 
  Language,
  StackDetectorOptions,
  OutdatedDependency
} from './types.js';
import { DETECTION_PATTERNS, LANGUAGE_EXTENSIONS } from './patterns.js';

/**
 * Detector automático de stack de tecnologias
 * Analisa arquivos de configuração e dependências para identificar a stack
 */
export class StackDetector {
  private workspaceRoot: string;
  private options: StackDetectorOptions;

  constructor(workspaceRoot?: string, options: StackDetectorOptions = {}) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.options = {
      scanDepth: 3,
      includeDevDependencies: true,
      detectVersions: true,
      ...options
    };
  }

  /**
   * Detecta a stack completa do projeto
   */
  async detectStack(): Promise<StackInfo> {
    const detectedTechs = await this.analyzeProject();
    
    const result = {
      primary: this.findPrimaryStack(detectedTechs),
      secondary: this.findSecondaryStacks(detectedTechs),
      packageManagers: this.detectPackageManagers(detectedTechs),
      frameworks: this.detectFrameworks(detectedTechs),
      tools: this.detectTools(detectedTechs),
      languages: await this.detectLanguages(),
      confidence: this.calculateOverallConfidence(detectedTechs)
    };
    
    // Adicionar informações sobre dependências desatualizadas
    if (this.options.detectVersions) {
      await this.enrichWithOutdatedInfo(result);
    }
    
    return result;
  }

  /**
   * Enriquece resultado com informações sobre dependências desatualizadas
   */
  private async enrichWithOutdatedInfo(stackInfo: Omit<StackInfo, 'outdatedDependencies'>): Promise<void> {
    const outdated: OutdatedDependency[] = [];
    
    try {
      // Verificar dependências Node.js
      const packageFiles = await this.findConfigFiles(['package.json']);
      for (const file of packageFiles) {
        const npmOutdated = await this.checkNpmOutdated(file);
        outdated.push(...npmOutdated);
      }
      
      // Verificar dependências Python
      const pythonFiles = await this.findConfigFiles(['requirements.txt', 'pyproject.toml']);
      for (const file of pythonFiles) {
        const pipOutdated = await this.checkPythonOutdated(file);
        outdated.push(...pipOutdated);
      }
      
      // Verificar dependências PHP
      const composerFiles = await this.findConfigFiles(['composer.json']);
      for (const file of composerFiles) {
        const composerOutdated = await this.checkComposerOutdated(file);
        outdated.push(...composerOutdated);
      }
      
      // Verificar dependências Rust
      const cargoFiles = await this.findConfigFiles(['Cargo.toml']);
      for (const file of cargoFiles) {
        const cargoOutdated = await this.checkCargoOutdated(file);
        outdated.push(...cargoOutdated);
      }
      
      // Verificar dependências Ruby
      const gemFiles = await this.findConfigFiles(['Gemfile']);
      for (const file of gemFiles) {
        const gemOutdated = await this.checkGemOutdated(file);
        outdated.push(...gemOutdated);
      }
      
      (stackInfo as StackInfo).outdatedDependencies = outdated;
    } catch (error) {
      // Em caso de erro, não falha a detecção principal
      logger.warn(' Erro ao verificar dependências desatualizadas:', error);
      (stackInfo as StackInfo).outdatedDependencies = [];
    }
  }

  /**
   * Verifica dependências NPM desatualizadas
   */
  private async checkNpmOutdated(packageJsonPath: string): Promise<OutdatedDependency[]> {
    const outdated: OutdatedDependency[] = [];
    
    try {
      const fullPath = path.join(this.workspaceRoot, packageJsonPath);
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      // Simulação básica - em um ambiente real, usaria npm outdated ou APIs do registry
      for (const [name, version] of Object.entries(allDeps)) {
        const cleanVersion = (version as string).replace(/[\^~>=<]/, '');
        
        // Simular algumas dependências conhecidamente desatualizadas (usando deps reais do projeto)
        const outdatedPackages: Record<string, { latest: string, severity: OutdatedDependency['severity'] }> = {
          'langchain': { latest: '0.3.15', severity: 'minor' },
          'commander': { latest: '12.1.0', severity: 'minor' },
          '@types/node': { latest: '22.8.0', severity: 'major' },
          'chalk': { latest: '6.0.0', severity: 'minor' },
          'typescript': { latest: '5.7.2', severity: 'minor' }
        };
        
        if (outdatedPackages[name] && this.isVersionOutdated(cleanVersion, outdatedPackages[name].latest)) {
          outdated.push({
            name,
            currentVersion: cleanVersion,
            latestVersion: outdatedPackages[name].latest,
            severity: outdatedPackages[name].severity,
            ecosystem: 'npm'
          });
        }
      }
    } catch (error) {
      // Arquivo não encontrado ou erro de parsing
    }
    
    return outdated;
  }

  /**
   * Verifica dependências Python desatualizadas
   */
  private async checkPythonOutdated(filePath: string): Promise<OutdatedDependency[]> {
    const outdated: OutdatedDependency[] = [];
    
    try {
      const deps = await this.readDependencies(filePath);
      
      // Simulação para packages Python conhecidos
      const outdatedPackages: Record<string, { latest: string, severity: OutdatedDependency['severity'] }> = {
        'django': { latest: '4.2.7', severity: 'major' },
        'flask': { latest: '3.0.0', severity: 'major' },
        'requests': { latest: '2.31.0', severity: 'minor' },
        'numpy': { latest: '1.25.2', severity: 'minor' },
        'pandas': { latest: '2.1.3', severity: 'major' }
      };
      
      for (const depName of deps.production) {
        if (outdatedPackages[depName]) {
          outdated.push({
            name: depName,
            currentVersion: 'unknown',
            latestVersion: outdatedPackages[depName].latest,
            severity: outdatedPackages[depName].severity,
            ecosystem: 'pip'
          });
        }
      }
    } catch (error) {
      // Erro na leitura
    }
    
    return outdated;
  }

  /**
   * Verifica dependências Composer desatualizadas
   */
  private async checkComposerOutdated(filePath: string): Promise<OutdatedDependency[]> {
    return []; // Implementação simplificada por agora
  }

  /**
   * Verifica dependências Cargo desatualizadas
   */
  private async checkCargoOutdated(filePath: string): Promise<OutdatedDependency[]> {
    return []; // Implementação simplificada por agora
  }

  /**
   * Verifica dependências Gem desatualizadas
   */
  private async checkGemOutdated(filePath: string): Promise<OutdatedDependency[]> {
    return []; // Implementação simplificada por agora
  }

  /**
   * Verifica se uma versão está desatualizada
   */
  private isVersionOutdated(current: string, latest: string): boolean {
    // Implementação simplificada de comparação de versões
    const currentParts = current.split('.').map(n => parseInt(n) || 0);
    const latestParts = latest.split('.').map(n => parseInt(n) || 0);
    
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
      const currentPart = currentParts[i] || 0;
      const latestPart = latestParts[i] || 0;
      
      if (currentPart < latestPart) return true;
      if (currentPart > latestPart) return false;
    }
    
    return false;
  }

  /**
   * Analisa o projeto e retorna tecnologias detectadas
   */
  private async analyzeProject(): Promise<Map<string, TechStack>> {
    const detected = new Map<string, TechStack>();
    
    // Analisa cada padrão de detecção
    for (const [techName, pattern] of Object.entries(DETECTION_PATTERNS)) {
      const confidence = await this.calculateTechConfidence(pattern);
      
      if (confidence > 0) {
        const configFiles = await this.findConfigFiles(pattern.files || []);
        const version = this.options.detectVersions ? 
          await this.detectVersion(techName, configFiles) : undefined;
        
        detected.set(techName, {
          name: techName,
          type: this.getTechType(techName),
          version,
          configFiles,
          confidence
        });
      }
    }
    
    return detected;
  }

  /**
   * Calcula a confiança de detecção para uma tecnologia
   */
  private async calculateTechConfidence(pattern: typeof DETECTION_PATTERNS[string]): Promise<number> {
    let confidence = 0;
    let maxPossible = 0;
    
    // Verifica arquivos de configuração
    if (pattern.files) {
      const foundFiles = await this.findConfigFiles(pattern.files);
      confidence += foundFiles.length > 0 ? pattern.weight : 0;
      maxPossible += pattern.weight;
    }
    
    // Verifica dependências
    if (pattern.dependencies) {
      const packageJsons = await this.findPackageFiles();
      for (const pkgFile of packageJsons) {
        const deps = await this.readDependencies(pkgFile);
        const foundDeps = pattern.dependencies.filter(dep => 
          deps.production.includes(dep) || 
          (this.options.includeDevDependencies && deps.dev.includes(dep))
        );
        
        if (foundDeps.length > 0) {
          confidence += (foundDeps.length / pattern.dependencies.length) * (pattern.weight * 0.8);
        }
      }
      maxPossible += pattern.weight * 0.8;
    }
    
    // Verifica scripts (para package.json)
    if (pattern.scripts) {
      const packageJsons = await this.findPackageFiles();
      for (const pkgFile of packageJsons) {
        const scripts = await this.readScripts(pkgFile);
        const foundScripts = pattern.scripts.filter(script => 
          scripts.some(s => s.includes(script))
        );
        
        if (foundScripts.length > 0) {
          confidence += (foundScripts.length / pattern.scripts.length) * (pattern.weight * 0.3);
        }
      }
      maxPossible += pattern.weight * 0.3;
    }
    
    return maxPossible > 0 ? Math.min(100, (confidence / maxPossible) * 100) : 0;
  }

  /**
   * Encontra arquivos de configuração correspondentes aos padrões
   */
  private async findConfigFiles(patterns: string[]): Promise<string[]> {
    const found: string[] = [];
    
    for (const pattern of patterns) {
      try {
        const files = await glob(pattern, {
          cwd: this.workspaceRoot,
          maxDepth: this.options.scanDepth,
          ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**']
        });
        found.push(...files);
      } catch (error) {
        // Padrão não encontrado ou erro, continua
      }
    }
    
    return [...new Set(found)]; // Remove duplicatas
  }

  /**
   * Encontra arquivos de package (package.json, composer.json, etc.)
   */
  private async findPackageFiles(): Promise<string[]> {
    const packagePatterns = [
      'package.json',
      'composer.json', 
      'pyproject.toml',
      'requirements.txt',
      'pom.xml',
      'build.gradle',
      'Cargo.toml',
      'go.mod',
      'Gemfile',
      '*.csproj'
    ];
    
    return this.findConfigFiles(packagePatterns);
  }

  /**
   * Lê dependências de um arquivo de package
   */
  private async readDependencies(filePath: string): Promise<{ production: string[], dev: string[] }> {
    try {
      const fullPath = path.join(this.workspaceRoot, filePath);
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      
      // NODE.JS / NPM
      if (filePath.endsWith('package.json')) {
        const pkg = JSON.parse(content);
        return {
          production: Object.keys(pkg.dependencies || {}),
          dev: Object.keys(pkg.devDependencies || {})
        };
      }
      
      // PHP / COMPOSER
      if (filePath.endsWith('composer.json')) {
        const composer = JSON.parse(content);
        return {
          production: Object.keys(composer.require || {}),
          dev: Object.keys(composer['require-dev'] || {})
        };
      }
      
      // PYTHON / PIP
      if (filePath.endsWith('requirements.txt')) {
        const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        const deps = lines.map(line => {
          const match = line.match(/^([a-zA-Z0-9_-]+)/);
          return match ? match[1] : null;
        }).filter(Boolean) as string[];
        return { production: deps, dev: [] };
      }
      
      // PYTHON / PYPROJECT.TOML
      if (filePath.endsWith('pyproject.toml')) {
        const tomlLines = content.split('\n');
        const production: string[] = [];
        const dev: string[] = [];
        
        let inDependencies = false;
        let inDevDependencies = false;
        
        for (const line of tomlLines) {
          const trimmed = line.trim();
          if (trimmed === '[project.dependencies]' || trimmed === 'dependencies = [') {
            inDependencies = true;
            inDevDependencies = false;
            continue;
          }
          if (trimmed === '[project.optional-dependencies]' || trimmed.includes('dev') || trimmed.includes('test')) {
            inDevDependencies = true;
            inDependencies = false;
            continue;
          }
          if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inDependencies = false;
            inDevDependencies = false;
            continue;
          }
          
          const depMatch = trimmed.match(/["']([a-zA-Z0-9_-]+)/);
          if (depMatch) {
            if (inDependencies) production.push(depMatch[1]);
            if (inDevDependencies) dev.push(depMatch[1]);
          }
        }
        
        return { production, dev };
      }
      
      // JAVA / MAVEN
      if (filePath.endsWith('pom.xml')) {
        const dependencies: string[] = [];
        const devDependencies: string[] = [];
        
        // Parse básico de XML para extrair artifactId
        const artifactMatches = content.match(/<artifactId>([^<]+)<\/artifactId>/g) || [];
        for (const match of artifactMatches) {
          const artifactId = match.replace(/<\/?artifactId>/g, '');
          if (artifactId && !artifactId.includes('${')) {
            dependencies.push(artifactId);
          }
        }
        
        return { production: dependencies, dev: devDependencies };
      }
      
      // JAVA / GRADLE
      if (filePath.endsWith('build.gradle') || filePath.endsWith('gradle.build')) {
        const production: string[] = [];
        const dev: string[] = [];
        
        const depMatches = content.match(/(?:implementation|compile|api)\s+['"]([^'"]+)['"]/g) || [];
        const testMatches = content.match(/(?:testImplementation|testCompile)\s+['"]([^'"]+)['"]/g) || [];
        
        for (const match of depMatches) {
          const dep = match.replace(/(?:implementation|compile|api)\s+['"]([^'"]+)['"]/, '$1');
          const artifactId = dep.split(':').pop();
          if (artifactId) production.push(artifactId);
        }
        
        for (const match of testMatches) {
          const dep = match.replace(/(?:testImplementation|testCompile)\s+['"]([^'"]+)['"]/, '$1');
          const artifactId = dep.split(':').pop();
          if (artifactId) dev.push(artifactId);
        }
        
        return { production, dev };
      }
      
      // RUST / CARGO
      if (filePath.endsWith('Cargo.toml')) {
        const production: string[] = [];
        const dev: string[] = [];
        
        const lines = content.split('\n');
        let inDependencies = false;
        let inDevDependencies = false;
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '[dependencies]') {
            inDependencies = true;
            inDevDependencies = false;
            continue;
          }
          if (trimmed === '[dev-dependencies]') {
            inDevDependencies = true;
            inDependencies = false;
            continue;
          }
          if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inDependencies = false;
            inDevDependencies = false;
            continue;
          }
          
          const depMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=/);
          if (depMatch) {
            if (inDependencies) production.push(depMatch[1]);
            if (inDevDependencies) dev.push(depMatch[1]);
          }
        }
        
        return { production, dev };
      }
      
      // GO / GO.MOD
      if (filePath.endsWith('go.mod')) {
        const production: string[] = [];
        const lines = content.split('\n');
        
        for (const line of lines) {
          const trimmed = line.trim();
          const requireMatch = trimmed.match(/require\s+([^\s]+)/);
          if (requireMatch) {
            const moduleName = requireMatch[1].split('/').pop();
            if (moduleName) production.push(moduleName);
          }
        }
        
        return { production, dev: [] };
      }
      
      // C# / .CSPROJ
      if (filePath.endsWith('.csproj')) {
        const dependencies: string[] = [];
        const packageMatches = content.match(/<PackageReference\s+Include="([^"]+)"/g) || [];
        
        for (const match of packageMatches) {
          const packageName = match.replace(/<PackageReference\s+Include="([^"]+)"/, '$1');
          dependencies.push(packageName);
        }
        
        return { production: dependencies, dev: [] };
      }
      
      // RUBY / GEMFILE
      if (filePath.endsWith('Gemfile')) {
        const production: string[] = [];
        const dev: string[] = [];
        
        const lines = content.split('\n');
        let inGroup = '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          
          // Detectar grupos
          if (trimmed.includes('group :development') || trimmed.includes('group :test')) {
            inGroup = 'dev';
            continue;
          }
          if (trimmed.includes('group :production') || trimmed.startsWith('gem ') && !inGroup) {
            inGroup = 'production';
          }
          if (trimmed === 'end') {
            inGroup = '';
            continue;
          }
          
          // Extrair gems
          const gemMatch = trimmed.match(/gem\s+['"]([^'"]+)['"]/);
          if (gemMatch) {
            if (inGroup === 'dev' || trimmed.includes(':development') || trimmed.includes(':test')) {
              dev.push(gemMatch[1]);
            } else {
              production.push(gemMatch[1]);
            }
          }
        }
        
        return { production, dev };
      }
      
      return { production: [], dev: [] };
    } catch {
      return { production: [], dev: [] };
    }
  }

  /**
   * Lê scripts de package.json
   */
  private async readScripts(filePath: string): Promise<string[]> {
    try {
      if (!filePath.endsWith('package.json')) return [];
      
      const fullPath = path.join(this.workspaceRoot, filePath);
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      return Object.values(pkg.scripts || {}) as string[];
    } catch {
      return [];
    }
  }

  /**
   * Detecta versão de uma tecnologia
   */
  private async detectVersion(techName: string, configFiles: string[]): Promise<string | undefined> {
    for (const file of configFiles) {
      try {
        const fullPath = path.join(this.workspaceRoot, file);
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        
        // NODE.JS / NPM
        if (file.endsWith('package.json')) {
          const pkg = JSON.parse(content);
          
          // Verifica dependências
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (allDeps[techName]) {
            return allDeps[techName].replace(/[\^~]/, ''); // Remove prefixos de versão
          }
          
          // Verifica engines para node
          if (techName === 'nodejs' && pkg.engines?.node) {
            return pkg.engines.node.replace(/[\^~>=<]/, '');
          }
        }
        
        // PHP / COMPOSER
        if (file.endsWith('composer.json')) {
          const composer = JSON.parse(content);
          const allDeps = { ...composer.require, ...composer['require-dev'] };
          if (allDeps[techName]) {
            return allDeps[techName].replace(/[\^~]/, '');
          }
        }
        
        // PYTHON / Requirements
        if (file.endsWith('requirements.txt')) {
          const lines = content.split('\n');
          for (const line of lines) {
            const match = line.match(new RegExp(`^${techName}([=><~!]+)([\\d\\.]+)`));
            if (match) return match[2];
          }
        }
        
        // PYTHON / pyproject.toml
        if (file.endsWith('pyproject.toml')) {
          const versionMatch = content.match(new RegExp(`${techName}\\s*[=><~]+\\s*[\"']([\\d\\.]+)[\"']`));
          if (versionMatch) return versionMatch[1];
        }
        
        // JAVA / Maven
        if (file.endsWith('pom.xml')) {
          const versionMatch = content.match(new RegExp(`<artifactId>${techName}</artifactId>\\s*<version>([^<]+)</version>`));
          if (versionMatch) return versionMatch[1];
        }
        
        // JAVA / Gradle
        if (file.endsWith('build.gradle') || file.endsWith('gradle.build')) {
          const versionMatch = content.match(new RegExp(`${techName}[\"']\\s*:\\s*[\"']([\\d\\.]+)[\"']`));
          if (versionMatch) return versionMatch[1];
        }
        
        // RUST / Cargo
        if (file.endsWith('Cargo.toml')) {
          const versionMatch = content.match(new RegExp(`${techName}\\s*=\\s*[\"']([\\d\\.]+)[\"']`));
          if (versionMatch) return versionMatch[1];
        }
        
        // GO / go.mod
        if (file.endsWith('go.mod')) {
          const versionMatch = content.match(new RegExp(`require\\s+[^\\s]*${techName}[^\\s]*\\s+v([\\d\\.]+)`));
          if (versionMatch) return versionMatch[1];
        }
        
        // C# / .csproj
        if (file.endsWith('.csproj')) {
          const versionMatch = content.match(new RegExp(`<PackageReference\\s+Include=[\"']${techName}[\"']\\s+Version=[\"']([\\d\\.]+)[\"']`));
          if (versionMatch) return versionMatch[1];
        }
        
      } catch (error) {
        // Arquivo não encontrado ou erro de parsing, continua
      }
    }
    
    return undefined;
  }

  /**
   * Determina o tipo de tecnologia
   */
  private getTechType(techName: string): TechStack['type'] {
    const languageTypes = ['nodejs', 'python', 'php', 'java', 'dotnet', 'rust', 'golang'];
    const frameworkTypes = ['react', 'vue', 'angular', 'nextjs', 'django', 'laravel', 'spring'];
    const libraryTypes = ['express', 'flask', 'fastapi'];
    
    if (languageTypes.includes(techName)) return 'runtime';
    if (frameworkTypes.includes(techName)) return 'framework';
    if (libraryTypes.includes(techName)) return 'library';
    
    return 'language';
  }

  /**
   * Detecta linguagens baseado em extensões de arquivo
   */
  private async detectLanguages(): Promise<Language[]> {
    const languages: Language[] = [];
    const fileStats = new Map<string, number>();
    
    // Escaneia arquivos do projeto
    for (const [lang, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
      for (const ext of extensions) {
        try {
          const files = await glob(`**/*${ext}`, {
            cwd: this.workspaceRoot,
            ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
            maxDepth: this.options.scanDepth
          });
          
          if (files.length > 0) {
            fileStats.set(lang, (fileStats.get(lang) || 0) + files.length);
          }
        } catch {
          // Continua se houver erro
        }
      }
    }
    
    // Converte estatísticas em linguagens com confiança
    const totalFiles = Array.from(fileStats.values()).reduce((a, b) => a + b, 0);
    
    for (const [lang, count] of fileStats.entries()) {
      const confidence = Math.min(100, (count / totalFiles) * 100);
      
      if (confidence >= 5) { // Mínimo 5% dos arquivos
        languages.push({
          name: lang,
          confidence: Math.round(confidence)
        });
      }
    }
    
    return languages.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Identifica a stack primária (maior confiança)
   */
  private findPrimaryStack(techs: Map<string, TechStack>): TechStack {
    let primary: TechStack | null = null;
    let maxConfidence = 0;
    
    for (const tech of techs.values()) {
      if (tech.type === 'runtime' || tech.type === 'language') {
        if (tech.confidence > maxConfidence) {
          maxConfidence = tech.confidence;
          primary = tech;
        }
      }
    }
    
    return primary || {
      name: 'unknown',
      type: 'language',
      configFiles: [],
      confidence: 0
    };
  }

  /**
   * Identifica stacks secundárias
   */
  private findSecondaryStacks(techs: Map<string, TechStack>): TechStack[] {
    const primary = this.findPrimaryStack(techs);
    
    return Array.from(techs.values())
      .filter(tech => tech.name !== primary.name && tech.confidence >= 30)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Detecta package managers
   */
  private detectPackageManagers(techs: Map<string, TechStack>): PackageManager[] {
    const managers: PackageManager[] = [];
    
    if (techs.has('npm')) managers.push({ name: 'npm', lockFile: 'package-lock.json', configFile: 'package.json' });
    if (techs.has('yarn')) managers.push({ name: 'yarn', lockFile: 'yarn.lock', configFile: 'package.json' });
    if (techs.has('pnpm')) managers.push({ name: 'pnpm', lockFile: 'pnpm-lock.yaml', configFile: 'package.json' });
    if (techs.has('php')) managers.push({ name: 'composer', lockFile: 'composer.lock', configFile: 'composer.json' });
    if (techs.has('python')) managers.push({ name: 'pip', configFile: 'requirements.txt' });
    if (techs.has('maven')) managers.push({ name: 'maven', configFile: 'pom.xml' });
    if (techs.has('gradle')) managers.push({ name: 'gradle', configFile: 'build.gradle' });
    if (techs.has('rust')) managers.push({ name: 'cargo', lockFile: 'Cargo.lock', configFile: 'Cargo.toml' });
    if (techs.has('golang')) managers.push({ name: 'go-mod', lockFile: 'go.sum', configFile: 'go.mod' });
    
    return managers;
  }

  /**
   * Detecta frameworks
   */
  private detectFrameworks(techs: Map<string, TechStack>): Framework[] {
    const frameworks: Framework[] = [];
    
    for (const tech of techs.values()) {
      if (tech.type === 'framework' && tech.confidence >= 50) {
        frameworks.push({
          name: tech.name,
          type: this.getFrameworkType(tech.name),
          version: tech.version,
          ecosystem: this.getFrameworkEcosystem(tech.name)
        });
      }
    }
    
    return frameworks.sort((a, b) => (techs.get(b.name)?.confidence || 0) - (techs.get(a.name)?.confidence || 0));
  }

  /**
   * Detecta ferramentas
   */
  private detectTools(techs: Map<string, TechStack>): Tool[] {
    const tools: Tool[] = [];
    
    const toolMapping: Record<string, { type: Tool['type'], configFile?: string }> = {
      eslint: { type: 'linter', configFile: '.eslintrc.json' },
      prettier: { type: 'formatter', configFile: '.prettierrc' },
      webpack: { type: 'bundler', configFile: 'webpack.config.js' },
      vite: { type: 'bundler', configFile: 'vite.config.js' },
      jest: { type: 'test', configFile: 'jest.config.js' },
      cypress: { type: 'test', configFile: 'cypress.config.js' },
      docker: { type: 'docker', configFile: 'Dockerfile' }
    };
    
    for (const [techName, config] of Object.entries(toolMapping)) {
      if (techs.has(techName)) {
        const tech = techs.get(techName)!;
        tools.push({
          name: techName,
          type: config.type,
          configFile: config.configFile,
          confidence: tech.confidence
        });
      }
    }
    
    return tools;
  }

  private getFrameworkType(name: string): Framework['type'] {
    const webFrameworks = ['react', 'vue', 'angular', 'nextjs', 'svelte'];
    const apiFrameworks = ['express', 'nestjs', 'django', 'flask', 'fastapi', 'laravel', 'spring'];
    const testFrameworks = ['jest', 'vitest', 'cypress'];
    
    if (webFrameworks.includes(name)) return 'web';
    if (apiFrameworks.includes(name)) return 'api';
    if (testFrameworks.includes(name)) return 'test';
    
    return 'web'; // default
  }

  private getFrameworkEcosystem(name: string): string {
    const ecosystems: Record<string, string> = {
      react: 'nodejs',
      vue: 'nodejs',
      angular: 'nodejs',
      nextjs: 'nodejs',
      svelte: 'nodejs',
      express: 'nodejs',
      nestjs: 'nodejs',
      django: 'python',
      flask: 'python',
      fastapi: 'python',
      laravel: 'php',
      symfony: 'php',
      spring: 'java'
    };
    
    return ecosystems[name] || 'unknown';
  }

  /**
   * Calcula confiança geral da detecção
   */
  private calculateOverallConfidence(techs: Map<string, TechStack>): number {
    if (techs.size === 0) return 0;
    
    const confidences = Array.from(techs.values()).map(t => t.confidence);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    
    // Bonus para múltiplas tecnologias detectadas com alta confiança
    const highConfidenceTechs = confidences.filter(c => c >= 70).length;
    const bonus = Math.min(20, highConfidenceTechs * 5);
    
    return Math.min(100, Math.round(avgConfidence + bonus));
  }
}