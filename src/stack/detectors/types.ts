/**
 * Tipos para detectores especializados por linguagem
 */

export interface DependencyInfo {
  name: string;
  currentVersion: string;
  latestVersion?: string;
  isOutdated: boolean;
  type: 'framework' | 'library' | 'tool' | 'runtime';
  category?: string;
  description?: string;
  securityVulnerabilities?: number;
}

export interface LanguageDetectionResult {
  language: string;
  ecosystem: string;
  packageManager: string;
  mainFrameworks: DependencyInfo[];
  dependencies: DependencyInfo[];
  devDependencies: DependencyInfo[];
  runtimeVersion?: string;
  configFiles: string[];
  lockFiles: string[];
  confidence: number;
  recommendations: string[];
  securityIssues: string[];
}

export interface LanguageDetector {
  detect(workspaceRoot: string): Promise<LanguageDetectionResult | null>;
  isApplicable(workspaceRoot: string): Promise<boolean>;
}

export interface PackageRegistry {
  getLatestVersion(packageName: string): Promise<string | null>;
  getPackageInfo(packageName: string): Promise<{
    description?: string;
    vulnerabilities?: number;
    category?: string;
  } | null>;
}