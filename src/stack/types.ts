/**
 * Tipos para detecção de stack e tecnologias
 */

export interface StackInfo {
  primary: TechStack;
  secondary: TechStack[];
  packageManagers: PackageManager[];
  frameworks: Framework[];
  tools: Tool[];
  languages: Language[];
  confidence: number; // 0-100
  outdatedDependencies?: OutdatedDependency[];
}

export interface OutdatedDependency {
  name: string;
  currentVersion: string;
  latestVersion: string;
  severity: 'minor' | 'major' | 'critical';
  ecosystem: string; // 'npm', 'composer', 'pip', etc.
  securityVulnerabilities?: number;
}

export interface TechStack {
  name: string;
  type: 'language' | 'runtime' | 'framework' | 'library';
  version?: string;
  configFiles: string[];
  confidence: number;
}

export interface PackageManager {
  name: 'npm' | 'yarn' | 'pnpm' | 'composer' | 'pip' | 'maven' | 'gradle' | 'cargo' | 'go-mod';
  lockFile?: string;
  configFile?: string;
}

export interface Framework {
  name: string;
  type: 'web' | 'mobile' | 'desktop' | 'api' | 'test' | 'build';
  version?: string;
  ecosystem: string; // 'nodejs', 'php', 'python', etc.
}

export interface Tool {
  name: string;
  type: 'linter' | 'formatter' | 'bundler' | 'compiler' | 'test' | 'ci' | 'docker';
  configFile?: string;
  confidence: number;
}

export interface Language {
  name: string;
  version?: string;
  dialect?: string; // ex: TypeScript, JSX
  confidence: number;
}

export interface DetectionPattern {
  files?: string[];
  keywords?: string[];
  dependencies?: string[];
  scripts?: string[];
  weight: number;
}

export interface StackDetectorOptions {
  scanDepth?: number;
  includeDevDependencies?: boolean;
  detectVersions?: boolean;
  workspaceRoot?: string;
}