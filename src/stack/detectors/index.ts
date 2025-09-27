/**
 * Detectores especializados por linguagem
 * Cada detector implementa análise profunda de dependências com integração aos registros de pacotes
 */

import { JavaScriptTypeScriptDetector } from './javascript-typescript.js';
import { PHPDetector } from './php.js';
import { PythonDetector } from './python.js';
import { RubyDetector } from './ruby.js';
import { RustDetector } from './rust.js';
import { CSharpDetector } from './csharp.js';

export { JavaScriptTypeScriptDetector } from './javascript-typescript.js';
export { PHPDetector } from './php.js';
export { PythonDetector } from './python.js';
export { RubyDetector } from './ruby.js';
export { RustDetector } from './rust.js';
export { CSharpDetector } from './csharp.js';

export type { 
  DependencyInfo, 
  LanguageDetectionResult, 
  LanguageDetector, 
  PackageRegistry 
} from './types.js';

export { 
  NPMRegistry, 
  PackagistRegistry, 
  PyPIRegistry, 
  RubyGemsRegistry, 
  CratesRegistry, 
  NuGetRegistry 
} from './registries.js';

/**
 * Detectores disponíveis organizados por linguagem
 */
export const AVAILABLE_DETECTORS = {
  javascript: JavaScriptTypeScriptDetector,
  typescript: JavaScriptTypeScriptDetector,
  php: PHPDetector,
  python: PythonDetector,
  ruby: RubyDetector,
  rust: RustDetector,
  csharp: CSharpDetector,
  'c#': CSharpDetector
} as const;

/**
 * Lista de todas as linguagens suportadas
 */
export const SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript', 
  'php',
  'python',
  'ruby',
  'rust',
  'csharp'
] as const;

/**
 * Instancia todos os detectores disponíveis
 */
export function createAllDetectors() {
  return [
    new JavaScriptTypeScriptDetector(),
    new PHPDetector(),
    new PythonDetector(),
    new RubyDetector(),
    new RustDetector(),
    new CSharpDetector()
  ];
}