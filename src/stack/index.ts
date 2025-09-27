/**
 * Stack Detection Module
 * 
 * Detecção automática de tecnologias e stack do projeto
 * Integrado via MCP para uso pelos comandos do CLIA
 */

export { StackDetector } from './detector.js';
export { StackDetectionMcpServer, createStackDetectionMcpServer } from './mcp-server.js';
export * from './types.js';
export { DETECTION_PATTERNS, LANGUAGE_EXTENSIONS } from './patterns.js';

// Re-export para compatibilidade
export type { 
  StackInfo, 
  TechStack, 
  PackageManager, 
  Framework, 
  Tool, 
  Language,
  StackDetectorOptions 
} from './types.js';