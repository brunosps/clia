import * as fs from 'fs';
import * as path from 'path';
import { LanguageDetector, LanguageDetectionResult, DependencyInfo } from './types.js';
import { NuGetRegistry } from './registries.js';

export class CSharpDetector implements LanguageDetector {
  private registry: NuGetRegistry;

  constructor() {
    this.registry = new NuGetRegistry();
  }

  async isApplicable(workspaceRoot: string): Promise<boolean> {
    // Check for .NET project files
    try {
      const files = fs.readdirSync(workspaceRoot);
      const projectFiles = files.filter(f => 
        f.endsWith('.csproj') || 
        f.endsWith('.sln') || 
        f.endsWith('.vbproj') || 
        f.endsWith('.fsproj')
      );
      
      if (projectFiles.length > 0) {
        return true;
      }

      // Check for global.json or Directory.Build.props
      if (fs.existsSync(path.join(workspaceRoot, 'global.json')) ||
          fs.existsSync(path.join(workspaceRoot, 'Directory.Build.props'))) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async detect(workspaceRoot: string): Promise<LanguageDetectionResult | null> {
    if (!await this.isApplicable(workspaceRoot)) {
      return null;
    }

    const dotnetVersion = await this.detectDotNetVersion(workspaceRoot);
    const framework = await this.detectFramework(workspaceRoot);
    const allDependencies = await this.analyzeDependencies(workspaceRoot);
    
    const prodDependencies = allDependencies.filter(dep => 'depType' in dep && dep.depType === 'prod');
    const devDependencies = allDependencies.filter(dep => 'depType' in dep && dep.depType === 'dev');
    const frameworks = prodDependencies.filter(dep => dep.type === 'framework');

    return {
      language: 'C#',
      ecosystem: 'NuGet',
      packageManager: 'NuGet/dotnet',
      mainFrameworks: frameworks,
      dependencies: prodDependencies,
      devDependencies: devDependencies,
      runtimeVersion: dotnetVersion,
      configFiles: this.getConfigFiles(workspaceRoot),
      lockFiles: this.getLockFiles(workspaceRoot),
      confidence: this.calculateConfidence(workspaceRoot),
      recommendations: this.generateRecommendations(allDependencies, framework),
      securityIssues: []
    };
  }

  private async detectDotNetVersion(workspaceRoot: string): Promise<string | undefined> {
    // Check global.json
    const globalJsonPath = path.join(workspaceRoot, 'global.json');
    if (fs.existsSync(globalJsonPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(globalJsonPath, 'utf-8'));
        if (content.sdk?.version) {
          return content.sdk.version;
        }
      } catch {
        // Continue to next method
      }
    }

    // Check .csproj files for TargetFramework
    try {
      const files = fs.readdirSync(workspaceRoot);
      const csprojFiles = files.filter(f => f.endsWith('.csproj'));
      
      for (const csprojFile of csprojFiles) {
        const csprojPath = path.join(workspaceRoot, csprojFile);
        const content = fs.readFileSync(csprojPath, 'utf-8');
        
        const targetFrameworkMatch = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
        if (targetFrameworkMatch) {
          return targetFrameworkMatch[1];
        }
        
        const targetFrameworksMatch = content.match(/<TargetFrameworks>([^<]+)<\/TargetFrameworks>/);
        if (targetFrameworksMatch) {
          return targetFrameworksMatch[1].split(';')[0]; // Return first framework
        }
      }
    } catch {
      // Continue
    }

    return undefined;
  }

  private async detectFramework(workspaceRoot: string): Promise<string | undefined> {
    try {
      const files = fs.readdirSync(workspaceRoot);
      const csprojFiles = files.filter(f => f.endsWith('.csproj'));
      
      for (const csprojFile of csprojFiles) {
        const csprojPath = path.join(workspaceRoot, csprojFile);
        const content = fs.readFileSync(csprojPath, 'utf-8');
        
        // Check for ASP.NET Core
        if (content.includes('Microsoft.AspNetCore') || 
            content.includes('Microsoft.NET.Sdk.Web')) {
          return 'ASP.NET Core';
        }
        
        // Check for Blazor
        if (content.includes('Microsoft.AspNetCore.Blazor') || 
            content.includes('Microsoft.AspNetCore.Components')) {
          return 'Blazor';
        }
        
        // Check for .NET MAUI
        if (content.includes('Microsoft.NET.Sdk.Maui')) {
          return '.NET MAUI';
        }
        
        // Check for WPF
        if (content.includes('Microsoft.WindowsDesktop.App') || 
            content.includes('UseWPF')) {
          return 'WPF';
        }
        
        // Check for WinForms
        if (content.includes('UseWindowsForms')) {
          return 'Windows Forms';
        }
        
        // Check for Entity Framework
        if (content.includes('Microsoft.EntityFrameworkCore')) {
          return 'Entity Framework Core';
        }
      }
    } catch {
      // Continue
    }

    return undefined;
  }

  private async analyzeDependencies(workspaceRoot: string): Promise<DependencyInfo[]> {
    const dependencies: DependencyInfo[] = [];

    // Parse .csproj files
    const csprojDeps = await this.parseCsprojFiles(workspaceRoot);
    dependencies.push(...csprojDeps);

    // Parse packages.lock.json if available
    const lockFileDeps = await this.parsePackagesLockJson(workspaceRoot);
    
    // Merge information from lock file
    for (const lockDep of lockFileDeps) {
      const existingDep = dependencies.find(d => d.name === lockDep.name);
      if (existingDep) {
        existingDep.currentVersion = lockDep.currentVersion;
      } else {
        dependencies.push(lockDep);
      }
    }

    return dependencies;
  }

  private async parseCsprojFiles(workspaceRoot: string): Promise<(DependencyInfo & { depType: 'prod' | 'dev' })[]> {
    const dependencies: (DependencyInfo & { depType: 'prod' | 'dev' })[] = [];
    
    try {
      const files = fs.readdirSync(workspaceRoot);
      const csprojFiles = files.filter(f => f.endsWith('.csproj'));
      
      for (const csprojFile of csprojFiles) {
        const csprojPath = path.join(workspaceRoot, csprojFile);
        const content = fs.readFileSync(csprojPath, 'utf-8');
        
        // Parse PackageReference elements
        const packageRefs = content.match(/<PackageReference[^>]*\/?>[\s\S]*?(?:<\/PackageReference>)?/g);
        if (packageRefs) {
          for (const packageRef of packageRefs) {
            const includeMatch = packageRef.match(/Include\s*=\s*"([^"]+)"/);
            const versionMatch = packageRef.match(/Version\s*=\s*"([^"]+)"/);
            
            if (includeMatch) {
              const name = includeMatch[1];
              const version = versionMatch ? versionMatch[1] : undefined;
              
              // Determine if it's a dev dependency
              const isDevDep = packageRef.includes('PrivateAssets="all"') || 
                             name.includes('.Test') || 
                             name.includes('.Testing') ||
                             name.includes('xunit') ||
                             name.includes('NUnit') ||
                             name.includes('MSTest');
              
              const latestVersion = await this.registry.getLatestVersion(name);
              const packageInfo = await this.registry.getPackageInfo(name);
              
              const isOutdated = latestVersion && version ? 
                this.compareVersions(version, latestVersion) < 0 : false;

              dependencies.push({
                name,
                currentVersion: version || 'unknown',
                latestVersion: latestVersion || undefined,
                isOutdated,
                type: this.categorizeNuGetPackage(name),
                category: packageInfo?.category || 'General',
                description: packageInfo?.description,
                depType: isDevDep ? 'dev' : 'prod'
              });
            }
          }
        }
      }
    } catch {
      // Handle error silently
    }

    return dependencies;
  }

  private async parsePackagesLockJson(workspaceRoot: string): Promise<DependencyInfo[]> {
    const packagesLockPath = path.join(workspaceRoot, 'packages.lock.json');
    
    if (!fs.existsSync(packagesLockPath)) {
      return [];
    }

    try {
      const content = JSON.parse(fs.readFileSync(packagesLockPath, 'utf-8'));
      const dependencies: DependencyInfo[] = [];
      
      // Parse dependencies from lock file
      if (content.dependencies) {
        for (const [targetFramework, deps] of Object.entries(content.dependencies)) {
          if (typeof deps === 'object' && deps !== null) {
            for (const [name, depInfo] of Object.entries(deps as Record<string, any>)) {
              const version = depInfo.resolved || depInfo.requested;
              
              if (version) {
                const latestVersion = await this.registry.getLatestVersion(name);
                const packageInfo = await this.registry.getPackageInfo(name);
                
                const isOutdated = latestVersion ? 
                  this.compareVersions(version, latestVersion) < 0 : false;

                dependencies.push({
                  name,
                  currentVersion: version,
                  latestVersion: latestVersion || undefined,
                  isOutdated,
                  type: this.categorizeNuGetPackage(name),
                  category: packageInfo?.category || 'General',
                  description: packageInfo?.description
                });
              }
            }
          }
        }
      }

      return dependencies;
    } catch {
      return [];
    }
  }

  private categorizeNuGetPackage(packageName: string): 'framework' | 'library' | 'tool' | 'runtime' {
    const frameworks = [
      'Microsoft.AspNetCore', 'Microsoft.NET.Sdk', 'Microsoft.WindowsDesktop.App',
      'Microsoft.EntityFrameworkCore', 'Microsoft.Extensions'
    ];
    const runtimePackages = [
      'System.', 'Microsoft.Extensions.Logging', 'Microsoft.Extensions.DependencyInjection',
      'Newtonsoft.Json', 'AutoMapper', 'FluentValidation'
    ];
    const tools = [
      'Microsoft.CodeAnalysis', 'StyleCop', 'SonarAnalyzer', 'xunit', 'NUnit', 'MSTest'
    ];

    if (frameworks.some(fw => packageName.includes(fw))) {
      return 'framework';
    }
    
    if (runtimePackages.some(runtime => packageName.includes(runtime))) {
      return 'runtime';
    }
    
    if (tools.some(tool => packageName.includes(tool))) {
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
    if (framework === 'ASP.NET Core') {
      if (!dependencies.some(dep => dep.name.includes('Microsoft.Extensions.Logging'))) {
        recommendations.push('Considere adicionar Microsoft.Extensions.Logging para logging estruturado');
      }
      if (!dependencies.some(dep => dep.name.includes('Swashbuckle'))) {
        recommendations.push('Considere adicionar Swashbuckle para documentação da API');
      }
    }

    // General .NET recommendations
    if (!dependencies.some(dep => dep.name === 'Newtonsoft.Json' || dep.name === 'System.Text.Json')) {
      recommendations.push('Considere usar System.Text.Json ou Newtonsoft.Json para serialização JSON');
    }

    // Testing recommendations
    if (!dependencies.some(dep => dep.name.includes('xunit') || dep.name.includes('NUnit') || dep.name.includes('MSTest'))) {
      recommendations.push('Considere adicionar um framework de testes (xUnit, NUnit, ou MSTest)');
    }

    return recommendations;
  }

  private getConfigFiles(workspaceRoot: string): string[] {
    const configFiles: string[] = [];
    const possibleConfigs = [
      'global.json',
      'Directory.Build.props',
      'Directory.Build.targets',
      'nuget.config',
      'appsettings.json',
      'appsettings.Development.json',
      'web.config'
    ];

    // Add .csproj files
    try {
      const files = fs.readdirSync(workspaceRoot);
      const projectFiles = files.filter(f => 
        f.endsWith('.csproj') || 
        f.endsWith('.sln') || 
        f.endsWith('.vbproj') || 
        f.endsWith('.fsproj')
      );
      configFiles.push(...projectFiles);
    } catch {
      // Handle silently
    }

    for (const config of possibleConfigs) {
      if (fs.existsSync(path.join(workspaceRoot, config))) {
        configFiles.push(config);
      }
    }

    return configFiles;
  }

  private getLockFiles(workspaceRoot: string): string[] {
    const lockFiles: string[] = [];
    const possibleLocks = ['packages.lock.json', 'project.assets.json'];

    for (const lock of possibleLocks) {
      if (fs.existsSync(path.join(workspaceRoot, lock))) {
        lockFiles.push(lock);
      }
    }

    return lockFiles;
  }

  private calculateConfidence(workspaceRoot: string): number {
    let confidence = 0;

    // Project files exist
    try {
      const files = fs.readdirSync(workspaceRoot);
      const projectFiles = files.filter(f => 
        f.endsWith('.csproj') || 
        f.endsWith('.sln') || 
        f.endsWith('.vbproj') || 
        f.endsWith('.fsproj')
      );
      
      if (projectFiles.length > 0) {
        confidence += 60;
      }
    } catch {
      // Handle silently
    }

    // global.json exists
    if (fs.existsSync(path.join(workspaceRoot, 'global.json'))) {
      confidence += 20;
    }

    // Lock file exists
    if (fs.existsSync(path.join(workspaceRoot, 'packages.lock.json'))) {
      confidence += 15;
    }

    // Directory.Build.props exists
    if (fs.existsSync(path.join(workspaceRoot, 'Directory.Build.props'))) {
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