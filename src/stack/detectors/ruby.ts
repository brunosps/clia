import * as fs from 'fs';
import * as path from 'path';
import { LanguageDetector, LanguageDetectionResult, DependencyInfo } from './types.js';
import { RubyGemsRegistry } from './registries.js';

export class RubyDetector implements LanguageDetector {
  private registry: RubyGemsRegistry;

  constructor() {
    this.registry = new RubyGemsRegistry();
  }

  async isApplicable(workspaceRoot: string): Promise<boolean> {
    const gemfilePath = path.join(workspaceRoot, 'Gemfile');
    try {
      const files = fs.readdirSync(workspaceRoot);
      const gemspecFiles = files.filter(f => f.endsWith('.gemspec'));
      return fs.existsSync(gemfilePath) || gemspecFiles.length > 0;
    } catch {
      return fs.existsSync(gemfilePath);
    }
  }

  async detect(workspaceRoot: string): Promise<LanguageDetectionResult | null> {
    const gemfilePath = path.join(workspaceRoot, 'Gemfile');
    try {
      const files = fs.readdirSync(workspaceRoot);
      const gemspecFiles = files.filter(f => f.endsWith('.gemspec'));
      
      if (!fs.existsSync(gemfilePath) && gemspecFiles.length === 0) {
        return null;
      }
    } catch {
      if (!fs.existsSync(gemfilePath)) {
        return null;
      }
    }

    const rubyVersion = await this.detectRubyVersion(workspaceRoot);
    const framework = await this.detectFramework(workspaceRoot);
    const allDependencies = await this.analyzeDependencies(workspaceRoot);
    
    const prodDependencies = allDependencies.filter(dep => 'depType' in dep && dep.depType === 'prod');
    const devDependencies = allDependencies.filter(dep => 'depType' in dep && dep.depType === 'dev');
    const frameworks = prodDependencies.filter(dep => dep.type === 'framework');

    return {
      language: 'Ruby',
      ecosystem: 'RubyGems',
      packageManager: 'Bundler',
      mainFrameworks: frameworks,
      dependencies: prodDependencies,
      devDependencies: devDependencies,
      runtimeVersion: rubyVersion,
      configFiles: this.getConfigFiles(workspaceRoot),
      lockFiles: this.getLockFiles(workspaceRoot),
      confidence: this.calculateConfidence(workspaceRoot),
      recommendations: this.generateRecommendations(allDependencies, framework),
      securityIssues: []
    };
  }

  private async detectRubyVersion(workspaceRoot: string): Promise<string | undefined> {
    // Check .ruby-version file
    const rubyVersionPath = path.join(workspaceRoot, '.ruby-version');
    if (fs.existsSync(rubyVersionPath)) {
      const version = fs.readFileSync(rubyVersionPath, 'utf-8').trim();
      return version;
    }

    // Check Gemfile for ruby version
    const gemfilePath = path.join(workspaceRoot, 'Gemfile');
    if (fs.existsSync(gemfilePath)) {
      const content = fs.readFileSync(gemfilePath, 'utf-8');
      const rubyMatch = content.match(/ruby ['"]([^'"]+)['"]/);
      if (rubyMatch) {
        return rubyMatch[1];
      }
    }

    return undefined;
  }

  private async detectFramework(workspaceRoot: string): Promise<string | undefined> {
    const gemfilePath = path.join(workspaceRoot, 'Gemfile');
    if (!fs.existsSync(gemfilePath)) {
      return undefined;
    }

    const content = fs.readFileSync(gemfilePath, 'utf-8');

    // Check for Rails
    if (content.includes('rails') || content.includes('gem "rails"') || content.includes("gem 'rails'")) {
      return 'Ruby on Rails';
    }

    // Check for Sinatra
    if (content.includes('sinatra') || content.includes('gem "sinatra"') || content.includes("gem 'sinatra'")) {
      return 'Sinatra';
    }

    // Check for Hanami
    if (content.includes('hanami') || content.includes('gem "hanami"') || content.includes("gem 'hanami'")) {
      return 'Hanami';
    }

    // Check for Jekyll
    if (content.includes('jekyll') || content.includes('gem "jekyll"') || content.includes("gem 'jekyll'")) {
      return 'Jekyll';
    }

    return undefined;
  }

  private async analyzeDependencies(workspaceRoot: string): Promise<DependencyInfo[]> {
    const dependencies: DependencyInfo[] = [];

    // Parse Gemfile
    const gemfileDeps = await this.parseGemfile(workspaceRoot);
    dependencies.push(...gemfileDeps);

    // Parse Gemfile.lock for exact versions
    const gemfileLockDeps = await this.parseGemfileLock(workspaceRoot);
    
    // Merge information from Gemfile.lock
    for (const lockDep of gemfileLockDeps) {
      const existingDep = dependencies.find(d => d.name === lockDep.name);
      if (existingDep) {
        existingDep.currentVersion = lockDep.currentVersion;
      } else {
        dependencies.push(lockDep);
      }
    }

    return dependencies;
  }

  private async parseGemfile(workspaceRoot: string): Promise<(DependencyInfo & { depType: 'prod' | 'dev' })[]> {
    const gemfilePath = path.join(workspaceRoot, 'Gemfile');
    
    if (!fs.existsSync(gemfilePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(gemfilePath, 'utf-8');
      const dependencies: (DependencyInfo & { depType: 'prod' | 'dev' })[] = [];
      
      const lines = content.split('\n');
      let currentGroup: 'prod' | 'dev' = 'prod';

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Detect group blocks
        if (trimmedLine.includes('group :development') || trimmedLine.includes('group :test')) {
          currentGroup = 'dev';
          continue;
        } else if (trimmedLine.includes('group :production') || trimmedLine.includes('end')) {
          currentGroup = 'prod';
          continue;
        }

        // Parse gem declarations
        const gemMatch = trimmedLine.match(/gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
        if (gemMatch) {
          const [, name, version] = gemMatch;
          const cleanVersion = version ? version.replace(/^[~>=<\s]+/, '') : undefined;
          
          const latestVersion = await this.registry.getLatestVersion(name);
          const packageInfo = await this.registry.getPackageInfo(name);
          
          const isOutdated = latestVersion && cleanVersion ? 
            this.compareVersions(cleanVersion, latestVersion) < 0 : false;

          dependencies.push({
            name,
            currentVersion: cleanVersion || 'unknown',
            latestVersion: latestVersion || undefined,
            isOutdated,
            type: this.categorizeRubyGem(name),
            category: packageInfo?.category || 'General',
            description: packageInfo?.description,
            depType: currentGroup
          });
        }
      }

      return dependencies;
    } catch {
      return [];
    }
  }

  private async parseGemfileLock(workspaceRoot: string): Promise<DependencyInfo[]> {
    const gemfileLockPath = path.join(workspaceRoot, 'Gemfile.lock');
    
    if (!fs.existsSync(gemfileLockPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(gemfileLockPath, 'utf-8');
      const dependencies: DependencyInfo[] = [];
      
      // Parse DEPENDENCIES section for exact versions
      const specsMatch = content.match(/GEM\s*\n\s*remote:[^\n]*\n\s*specs:\s*\n([\s\S]*?)(?:\n\nPLATFORMS|\n\nDEPENDENCIES|$)/);
      if (specsMatch) {
        const specsSection = specsMatch[1];
        const lines = specsSection.split('\n');

        for (const line of lines) {
          const gemMatch = line.match(/^\s{4}([a-zA-Z0-9_-]+)\s+\(([^)]+)\)/);
          if (gemMatch) {
            const [, name, version] = gemMatch;
            
            const latestVersion = await this.registry.getLatestVersion(name);
            const packageInfo = await this.registry.getPackageInfo(name);
            
            const isOutdated = latestVersion ? 
              this.compareVersions(version, latestVersion) < 0 : false;

            dependencies.push({
              name,
              currentVersion: version,
              latestVersion: latestVersion || undefined,
              isOutdated,
              type: this.categorizeRubyGem(name),
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

  private categorizeRubyGem(gemName: string): 'framework' | 'library' | 'tool' | 'runtime' {
    const frameworks = ['rails', 'sinatra', 'hanami', 'padrino', 'volt', 'camping'];
    const runtimeGems = ['rspec', 'minitest', 'rubocop', 'pry', 'byebug', 'factory_bot', 'capybara', 
                        'simplecov', 'guard', 'spring', 'listen', 'web-console'];
    const tools = ['rake', 'bundler', 'thor', 'capistrano', 'whenever', 'sidekiq', 'delayed_job'];

    if (frameworks.some(fw => gemName.includes(fw))) {
      return 'framework';
    }
    
    if (runtimeGems.some(tool => gemName.includes(tool))) {
      return 'runtime';
    }
    
    if (tools.some(tool => gemName.includes(tool))) {
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
    if (framework === 'Ruby on Rails') {
      if (!dependencies.some(dep => dep.name.includes('rspec'))) {
        recommendations.push('Considere adicionar RSpec para testes');
      }
      if (!dependencies.some(dep => dep.name.includes('rubocop'))) {
        recommendations.push('Considere adicionar RuboCop para linting');
      }
    }

    // Security recommendations
    const securityGems = ['brakeman', 'bundler-audit'];
    for (const gem of securityGems) {
      if (!dependencies.some(dep => dep.name === gem)) {
        recommendations.push(`Considere adicionar ${gem} para análise de segurança`);
      }
    }

    return recommendations;
  }

  private getConfigFiles(workspaceRoot: string): string[] {
    const configFiles: string[] = [];
    const possibleConfigs = [
      'Gemfile',
      '.ruby-version',
      '.rubocop.yml',
      '.reek.yml',
      'config/application.rb',
      'config/database.yml',
      'config/routes.rb'
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
    const possibleLocks = ['Gemfile.lock'];

    for (const lock of possibleLocks) {
      if (fs.existsSync(path.join(workspaceRoot, lock))) {
        lockFiles.push(lock);
      }
    }

    return lockFiles;
  }

  private calculateConfidence(workspaceRoot: string): number {
    let confidence = 0;

    // Gemfile exists
    if (fs.existsSync(path.join(workspaceRoot, 'Gemfile'))) {
      confidence += 40;
    }

    // Gemfile.lock exists
    if (fs.existsSync(path.join(workspaceRoot, 'Gemfile.lock'))) {
      confidence += 30;
    }

    // Ruby version specified
    if (fs.existsSync(path.join(workspaceRoot, '.ruby-version'))) {
      confidence += 15;
    }

    // Rails app structure
    if (fs.existsSync(path.join(workspaceRoot, 'config/application.rb'))) {
      confidence += 15;
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