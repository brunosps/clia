import * as fs from 'fs';
import * as path from 'path';
import { LanguageDetector, LanguageDetectionResult, DependencyInfo } from './types.js';
import { CratesRegistry } from './registries.js';

export class RustDetector implements LanguageDetector {
  private registry: CratesRegistry;

  constructor() {
    this.registry = new CratesRegistry();
  }

  async isApplicable(workspaceRoot: string): Promise<boolean> {
    const cargoTomlPath = path.join(workspaceRoot, 'Cargo.toml');
    return fs.existsSync(cargoTomlPath);
  }

  async detect(workspaceRoot: string): Promise<LanguageDetectionResult | null> {
    const cargoTomlPath = path.join(workspaceRoot, 'Cargo.toml');
    
    if (!fs.existsSync(cargoTomlPath)) {
      return null;
    }

    const rustVersion = await this.detectRustVersion(workspaceRoot);
    const framework = await this.detectFramework(workspaceRoot);
    const allDependencies = await this.analyzeDependencies(workspaceRoot);
    
    const prodDependencies = allDependencies.filter(dep => 'depType' in dep && dep.depType === 'prod');
    const devDependencies = allDependencies.filter(dep => 'depType' in dep && dep.depType === 'dev');
    const frameworks = prodDependencies.filter(dep => dep.type === 'framework');

    return {
      language: 'Rust',
      ecosystem: 'Crates.io',
      packageManager: 'Cargo',
      mainFrameworks: frameworks,
      dependencies: prodDependencies,
      devDependencies: devDependencies,
      runtimeVersion: rustVersion,
      configFiles: this.getConfigFiles(workspaceRoot),
      lockFiles: this.getLockFiles(workspaceRoot),
      confidence: this.calculateConfidence(workspaceRoot),
      recommendations: this.generateRecommendations(allDependencies, framework),
      securityIssues: []
    };
  }

  private async detectRustVersion(workspaceRoot: string): Promise<string | undefined> {
    // Check rust-toolchain.toml
    const rustToolchainPath = path.join(workspaceRoot, 'rust-toolchain.toml');
    if (fs.existsSync(rustToolchainPath)) {
      try {
        const content = fs.readFileSync(rustToolchainPath, 'utf-8');
        const channelMatch = content.match(/channel\s*=\s*"([^"]+)"/);
        if (channelMatch) {
          return channelMatch[1];
        }
      } catch {
        // Continue to next method
      }
    }

    // Check rust-toolchain file
    const rustToolchainLegacyPath = path.join(workspaceRoot, 'rust-toolchain');
    if (fs.existsSync(rustToolchainLegacyPath)) {
      try {
        const version = fs.readFileSync(rustToolchainLegacyPath, 'utf-8').trim();
        return version;
      } catch {
        // Continue
      }
    }

    // Check Cargo.toml for rust-version
    const cargoTomlPath = path.join(workspaceRoot, 'Cargo.toml');
    if (fs.existsSync(cargoTomlPath)) {
      try {
        const content = fs.readFileSync(cargoTomlPath, 'utf-8');
        const rustVersionMatch = content.match(/rust-version\s*=\s*"([^"]+)"/);
        if (rustVersionMatch) {
          return rustVersionMatch[1];
        }
      } catch {
        // Continue
      }
    }

    return undefined;
  }

  private async detectFramework(workspaceRoot: string): Promise<string | undefined> {
    const cargoTomlPath = path.join(workspaceRoot, 'Cargo.toml');
    if (!fs.existsSync(cargoTomlPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(cargoTomlPath, 'utf-8');

      // Check for web frameworks
      if (content.includes('actix-web')) {
        return 'Actix Web';
      }
      if (content.includes('axum')) {
        return 'Axum';
      }
      if (content.includes('rocket')) {
        return 'Rocket';
      }
      if (content.includes('warp')) {
        return 'Warp';
      }
      if (content.includes('tide')) {
        return 'Tide';
      }

      // Check for GUI frameworks
      if (content.includes('tauri')) {
        return 'Tauri';
      }
      if (content.includes('egui')) {
        return 'egui';
      }
      if (content.includes('iced')) {
        return 'Iced';
      }

      // Check for game frameworks
      if (content.includes('bevy')) {
        return 'Bevy';
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  private async analyzeDependencies(workspaceRoot: string): Promise<DependencyInfo[]> {
    const dependencies: DependencyInfo[] = [];

    // Parse Cargo.toml
    const cargoTomlDeps = await this.parseCargoToml(workspaceRoot);
    dependencies.push(...cargoTomlDeps);

    // Parse Cargo.lock for exact versions
    const cargoLockDeps = await this.parseCargoLock(workspaceRoot);
    
    // Merge information from Cargo.lock
    for (const lockDep of cargoLockDeps) {
      const existingDep = dependencies.find(d => d.name === lockDep.name);
      if (existingDep) {
        existingDep.currentVersion = lockDep.currentVersion;
      } else {
        dependencies.push(lockDep);
      }
    }

    return dependencies;
  }

  private async parseCargoToml(workspaceRoot: string): Promise<(DependencyInfo & { depType: 'prod' | 'dev' })[]> {
    const cargoTomlPath = path.join(workspaceRoot, 'Cargo.toml');
    
    if (!fs.existsSync(cargoTomlPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(cargoTomlPath, 'utf-8');
      const dependencies: (DependencyInfo & { depType: 'prod' | 'dev' })[] = [];
      
      // Parse [dependencies] section
      const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
      if (depsMatch) {
        const depsSection = depsMatch[1];
        const depLines = depsSection.split('\n').filter(line => 
          line.includes('=') && !line.trim().startsWith('#')
        );

        for (const line of depLines) {
          const simpleMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
          const objectMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*{[^}]*version\s*=\s*"([^"]+)"/);
          
          let name: string | undefined;
          let version: string | undefined;

          if (simpleMatch) {
            [, name, version] = simpleMatch;
          } else if (objectMatch) {
            [, name, version] = objectMatch;
          }

          if (name && version) {
            const cleanVersion = version.replace(/^[~>=<\s]+/, '');
            
            const latestVersion = await this.registry.getLatestVersion(name);
            const packageInfo = await this.registry.getPackageInfo(name);
            
            const isOutdated = latestVersion ? 
              this.compareVersions(cleanVersion, latestVersion) < 0 : false;

            dependencies.push({
              name,
              currentVersion: cleanVersion,
              latestVersion: latestVersion || undefined,
              isOutdated,
              type: this.categorizeRustCrate(name),
              category: packageInfo?.category || 'General',
              description: packageInfo?.description,
              depType: 'prod'
            });
          }
        }
      }

      // Parse [dev-dependencies] section
      const devDepsMatch = content.match(/\[dev-dependencies\]([\s\S]*?)(?:\[|$)/);
      if (devDepsMatch) {
        const devDepsSection = devDepsMatch[1];
        const depLines = devDepsSection.split('\n').filter(line => 
          line.includes('=') && !line.trim().startsWith('#')
        );

        for (const line of depLines) {
          const simpleMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
          const objectMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*{[^}]*version\s*=\s*"([^"]+)"/);
          
          let name: string | undefined;
          let version: string | undefined;

          if (simpleMatch) {
            [, name, version] = simpleMatch;
          } else if (objectMatch) {
            [, name, version] = objectMatch;
          }

          if (name && version) {
            const cleanVersion = version.replace(/^[~>=<\s]+/, '');
            
            const latestVersion = await this.registry.getLatestVersion(name);
            const packageInfo = await this.registry.getPackageInfo(name);
            
            const isOutdated = latestVersion ? 
              this.compareVersions(cleanVersion, latestVersion) < 0 : false;

            dependencies.push({
              name,
              currentVersion: cleanVersion,
              latestVersion: latestVersion || undefined,
              isOutdated,
              type: this.categorizeRustCrate(name),
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

  private async parseCargoLock(workspaceRoot: string): Promise<DependencyInfo[]> {
    const cargoLockPath = path.join(workspaceRoot, 'Cargo.lock');
    
    if (!fs.existsSync(cargoLockPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(cargoLockPath, 'utf-8');
      const dependencies: DependencyInfo[] = [];
      
      // Parse [[package]] sections
      const packageMatches = content.match(/\[\[package\]\]([\s\S]*?)(?=\[\[package\]\]|$)/g);
      if (packageMatches) {
        for (const packageBlock of packageMatches) {
          const nameMatch = packageBlock.match(/name\s*=\s*"([^"]+)"/);
          const versionMatch = packageBlock.match(/version\s*=\s*"([^"]+)"/);
          
          if (nameMatch && versionMatch) {
            const [, name] = nameMatch;
            const [, version] = versionMatch;
            
            const latestVersion = await this.registry.getLatestVersion(name);
            const packageInfo = await this.registry.getPackageInfo(name);
            
            const isOutdated = latestVersion ? 
              this.compareVersions(version, latestVersion) < 0 : false;

            dependencies.push({
              name,
              currentVersion: version,
              latestVersion: latestVersion || undefined,
              isOutdated,
              type: this.categorizeRustCrate(name),
              category: packageInfo?.category || 'General',
              description: packageInfo?.description
            });
          }
        }
      }

      return dependencies;
    } catch {
      return [];
    }
  }

  private categorizeRustCrate(crateName: string): 'framework' | 'library' | 'tool' | 'runtime' {
    const frameworks = ['actix-web', 'axum', 'rocket', 'warp', 'tide', 'tauri', 'egui', 'iced', 'bevy'];
    const runtimeCrates = ['tokio', 'async-std', 'futures', 'hyper', 'reqwest', 'sqlx'];
    const tools = ['cargo', 'rustc', 'clippy', 'rustfmt', 'serde_derive', 'proc-macro2'];

    if (frameworks.some(fw => crateName.includes(fw))) {
      return 'framework';
    }
    
    if (runtimeCrates.some(runtime => crateName.includes(runtime))) {
      return 'runtime';
    }
    
    if (tools.some(tool => crateName.includes(tool))) {
      return 'tool';
    }
    
    return 'library';
  }

  private generateRecommendations(dependencies: DependencyInfo[], framework?: string): string[] {
    const recommendations: string[] = [];

    // Check for outdated dependencies
    const outdatedCount = dependencies.filter(dep => dep.isOutdated).length;
    if (outdatedCount > 0) {
      recommendations.push(`Considere atualizar ${outdatedCount} dependências desatualizadas`);
    }

    // Framework-specific recommendations
    if (framework?.includes('Actix') || framework?.includes('Axum') || framework?.includes('Rocket')) {
      if (!dependencies.some(dep => dep.name.includes('tokio'))) {
        recommendations.push('Considere usar tokio para programação assíncrona');
      }
    }

    // General Rust recommendations
    if (!dependencies.some(dep => dep.name === 'serde')) {
      recommendations.push('Considere adicionar serde para serialização/deserialização');
    }

    // Security and performance recommendations
    if (!dependencies.some(dep => dep.name === 'thiserror' || dep.name === 'anyhow')) {
      recommendations.push('Considere usar thiserror ou anyhow para tratamento de erros');
    }

    return recommendations;
  }

  private getConfigFiles(workspaceRoot: string): string[] {
    const configFiles: string[] = [];
    const possibleConfigs = [
      'Cargo.toml',
      'rust-toolchain.toml',
      'rust-toolchain',
      '.cargo/config.toml',
      'rustfmt.toml',
      '.rustfmt.toml',
      'clippy.toml'
    ];

    for (const config of possibleConfigs) {
      if (fs.existsSync(path.join(workspaceRoot, config))) {
        configFiles.push(config);
      }
    }

    return configFiles;
  }

  private getLockFiles(workspaceRoot: string): string[] {
    const lockFiles: string[] = [];
    const possibleLocks = ['Cargo.lock'];

    for (const lock of possibleLocks) {
      if (fs.existsSync(path.join(workspaceRoot, lock))) {
        lockFiles.push(lock);
      }
    }

    return lockFiles;
  }

  private calculateConfidence(workspaceRoot: string): number {
    let confidence = 0;

    // Cargo.toml exists
    if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
      confidence += 50;
    }

    // Cargo.lock exists
    if (fs.existsSync(path.join(workspaceRoot, 'Cargo.lock'))) {
      confidence += 25;
    }

    // src/main.rs or src/lib.rs exists
    if (fs.existsSync(path.join(workspaceRoot, 'src/main.rs')) || 
        fs.existsSync(path.join(workspaceRoot, 'src/lib.rs'))) {
      confidence += 20;
    }

    // Rust toolchain specified
    if (fs.existsSync(path.join(workspaceRoot, 'rust-toolchain.toml')) ||
        fs.existsSync(path.join(workspaceRoot, 'rust-toolchain'))) {
      confidence += 5;
    }

    return Math.min(confidence, 100);
  }

  private compareVersions(current: string, latest: string): number {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);
    
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
      const currentPart = currentParts[i] || 0;
      const latestPart = latestParts[i] || 0;
      
      if (currentPart < latestPart) return -1;
      if (currentPart > latestPart) return 1;
    }
    
    return 0;
  }
}