/**
 * Registries para verificação de versões das diferentes linguagens
 */

import { PackageRegistry } from './types.js';

/**
 * Registry para packages do NPM (JavaScript/TypeScript)
 */
export class NPMRegistry implements PackageRegistry {
  private cache = new Map<string, any>();
  private cacheTTL = 5 * 60 * 1000; // 5 minutos

  async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const cached = this.cache.get(packageName);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.version;
      }

      const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
      if (!response.ok) return null;
      
      const data = await response.json();
      const version = data.version;
      
      this.cache.set(packageName, { version, timestamp: Date.now() });
      return version;
    } catch {
      return null;
    }
  }

  async getPackageInfo(packageName: string): Promise<{
    description?: string;
    vulnerabilities?: number;
    category?: string;
  } | null> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${packageName}`);
      if (!response.ok) return null;
      
      const data = await response.json();
      
      return {
        description: data.description,
        category: this.categorizePackage(packageName, data.keywords || [])
      };
    } catch {
      return null;
    }
  }

  private categorizePackage(name: string, keywords: string[]): string {
    if (keywords.includes('react') || name.includes('react')) return 'React Ecosystem';
    if (keywords.includes('vue') || name.includes('vue')) return 'Vue Ecosystem';
    if (keywords.includes('angular') || name.includes('angular')) return 'Angular Ecosystem';
    if (keywords.includes('testing') || keywords.includes('test')) return 'Testing';
    if (keywords.includes('build') || keywords.includes('bundler')) return 'Build Tools';
    if (keywords.includes('ui') || keywords.includes('component')) return 'UI Components';
    return 'General';
  }
}

/**
 * Registry para packages do Packagist (PHP)
 */
export class PackagistRegistry implements PackageRegistry {
  private cache = new Map<string, any>();
  private cacheTTL = 5 * 60 * 1000;

  async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const cached = this.cache.get(packageName);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.version;
      }

      const response = await fetch(`https://packagist.org/packages/${packageName}.json`);
      if (!response.ok) return null;
      
      const data = await response.json();
      const version = data.package.versions[Object.keys(data.package.versions)[0]]?.version;
      
      this.cache.set(packageName, { version, timestamp: Date.now() });
      return version?.replace(/^v/, ''); // Remove 'v' prefix
    } catch {
      return null;
    }
  }

  async getPackageInfo(packageName: string): Promise<{
    description?: string;
    vulnerabilities?: number;
    category?: string;
  } | null> {
    try {
      const response = await fetch(`https://packagist.org/packages/${packageName}.json`);
      if (!response.ok) return null;
      
      const data = await response.json();
      const packageData = data.package;
      
      return {
        description: packageData.description,
        category: this.categorizePhpPackage(packageName, packageData.keywords || [])
      };
    } catch {
      return null;
    }
  }

  private categorizePhpPackage(name: string, keywords: string[]): string {
    if (keywords.includes('laravel') || name.includes('laravel')) return 'Laravel Ecosystem';
    if (keywords.includes('symfony') || name.includes('symfony')) return 'Symfony Ecosystem';
    if (keywords.includes('wordpress') || name.includes('wordpress')) return 'WordPress';
    if (keywords.includes('framework')) return 'Framework';
    if (keywords.includes('testing')) return 'Testing';
    return 'General';
  }
}

/**
 * Registry para packages do PyPI (Python)
 */
export class PyPIRegistry implements PackageRegistry {
  private cache = new Map<string, any>();
  private cacheTTL = 5 * 60 * 1000;

  async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const cached = this.cache.get(packageName);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.version;
      }

      const response = await fetch(`https://pypi.org/pypi/${packageName}/json`);
      if (!response.ok) return null;
      
      const data = await response.json();
      const version = data.info.version;
      
      this.cache.set(packageName, { version, timestamp: Date.now() });
      return version;
    } catch {
      return null;
    }
  }

  async getPackageInfo(packageName: string): Promise<{
    description?: string;
    vulnerabilities?: number;
    category?: string;
  } | null> {
    try {
      const response = await fetch(`https://pypi.org/pypi/${packageName}/json`);
      if (!response.ok) return null;
      
      const data = await response.json();
      
      return {
        description: data.info.summary,
        category: this.categorizePythonPackage(packageName, data.info.keywords || '')
      };
    } catch {
      return null;
    }
  }

  private categorizePythonPackage(name: string, keywords: string): string {
    const keywordList = keywords.toLowerCase().split(/[,\s]+/);
    
    if (keywordList.includes('django') || name.includes('django')) return 'Django Ecosystem';
    if (keywordList.includes('flask') || name.includes('flask')) return 'Flask Ecosystem';
    if (keywordList.includes('fastapi') || name.includes('fastapi')) return 'FastAPI Ecosystem';
    if (keywordList.includes('web') || keywordList.includes('framework')) return 'Web Framework';
    if (keywordList.includes('machine-learning') || keywordList.includes('ml')) return 'Machine Learning';
    if (keywordList.includes('data') || keywordList.includes('science')) return 'Data Science';
    if (keywordList.includes('testing')) return 'Testing';
    return 'General';
  }
}

/**
 * Registry para packages do RubyGems
 */
export class RubyGemsRegistry implements PackageRegistry {
  private cache = new Map<string, any>();
  private cacheTTL = 5 * 60 * 1000;

  async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const cached = this.cache.get(packageName);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.version;
      }

      const response = await fetch(`https://rubygems.org/api/v1/gems/${packageName}.json`);
      if (!response.ok) return null;
      
      const data = await response.json();
      const version = data.version;
      
      this.cache.set(packageName, { version, timestamp: Date.now() });
      return version;
    } catch {
      return null;
    }
  }

  async getPackageInfo(packageName: string): Promise<{
    description?: string;
    vulnerabilities?: number;
    category?: string;
  } | null> {
    try {
      const response = await fetch(`https://rubygems.org/api/v1/gems/${packageName}.json`);
      if (!response.ok) return null;
      
      const data = await response.json();
      
      return {
        description: data.info,
        category: this.categorizeRubyGem(packageName)
      };
    } catch {
      return null;
    }
  }

  private categorizeRubyGem(name: string): string {
    if (name.includes('rails') || name.startsWith('rails-')) return 'Rails Ecosystem';
    if (name.includes('sinatra')) return 'Sinatra Ecosystem';
    if (name.includes('test') || name.includes('spec')) return 'Testing';
    if (name.includes('rack')) return 'Rack Middleware';
    return 'General';
  }
}

/**
 * Registry para packages do Crates.io (Rust)
 */
export class CratesRegistry implements PackageRegistry {
  private cache = new Map<string, any>();
  private cacheTTL = 5 * 60 * 1000;

  async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const cached = this.cache.get(packageName);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.version;
      }

      const response = await fetch(`https://crates.io/api/v1/crates/${packageName}`);
      if (!response.ok) return null;
      
      const data = await response.json();
      const version = data.crate.max_version;
      
      this.cache.set(packageName, { version, timestamp: Date.now() });
      return version;
    } catch {
      return null;
    }
  }

  async getPackageInfo(packageName: string): Promise<{
    description?: string;
    vulnerabilities?: number;
    category?: string;
  } | null> {
    try {
      const response = await fetch(`https://crates.io/api/v1/crates/${packageName}`);
      if (!response.ok) return null;
      
      const data = await response.json();
      
      return {
        description: data.crate.description,
        category: this.categorizeRustCrate(packageName, data.crate.categories || [])
      };
    } catch {
      return null;
    }
  }

  private categorizeRustCrate(name: string, categories: string[]): string {
    if (categories.includes('web-programming::http-server')) return 'Web Framework';
    if (categories.includes('asynchronous')) return 'Async Runtime';
    if (categories.includes('parsing')) return 'Parsing';
    if (categories.includes('database')) return 'Database';
    if (categories.includes('development-tools::testing')) return 'Testing';
    return 'General';
  }
}

/**
 * Registry para packages do NuGet (C#)
 */
export class NuGetRegistry implements PackageRegistry {
  private cache = new Map<string, any>();
  private cacheTTL = 5 * 60 * 1000;

  async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const cached = this.cache.get(packageName);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.version;
      }

      const response = await fetch(`https://api.nuget.org/v3-flatcontainer/${packageName.toLowerCase()}/index.json`);
      if (!response.ok) return null;
      
      const data = await response.json();
      const versions = data.versions || [];
      const latestVersion = versions[versions.length - 1];
      
      this.cache.set(packageName, { version: latestVersion, timestamp: Date.now() });
      return latestVersion;
    } catch {
      return null;
    }
  }

  async getPackageInfo(packageName: string): Promise<{
    description?: string;
    vulnerabilities?: number;
    category?: string;
  } | null> {
    try {
      // NuGet API v3 é mais complexa para metadata, usando busca simplificada
      const response = await fetch(`https://azuresearch-usnc.nuget.org/query?q=${packageName}&take=1`);
      if (!response.ok) return null;
      
      const data = await response.json();
      const packageData = data.data?.[0];
      
      if (!packageData) return null;
      
      return {
        description: packageData.description,
        category: this.categorizeNuGetPackage(packageName, packageData.tags || [])
      };
    } catch {
      return null;
    }
  }

  private categorizeNuGetPackage(name: string, tags: string[]): string {
    const tagString = tags.join(' ').toLowerCase();
    
    if (tagString.includes('aspnet') || name.includes('AspNet')) return 'ASP.NET Ecosystem';
    if (tagString.includes('entityframework') || name.includes('EntityFramework')) return 'Entity Framework';
    if (tagString.includes('testing') || tagString.includes('test')) return 'Testing';
    if (tagString.includes('logging')) return 'Logging';
    if (tagString.includes('json') || tagString.includes('serialization')) return 'Serialization';
    return 'General';
  }
}