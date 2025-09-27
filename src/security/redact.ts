import fs from 'fs';
import path from 'path';

interface SecretPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

// Padrões comuns de segredos
const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'OpenAI API Key',
    regex: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: 'sk-****************'
  },
  {
    name: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: 'AKIA****************'
  },
  {
    name: 'Anthropic API Key',
    regex: /sk-ant-[a-zA-Z0-9-]{20,}/g,
    replacement: 'sk-ant-****************'
  },
  {
    name: 'DeepSeek API Key',
    regex: /sk-[a-f0-9]{32}/g,
    replacement: 'sk-****************'
  },
  {
    name: 'JWT Token',
    regex: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    replacement: 'eyJ****************'
  },
  {
    name: 'GitHub Token',
    regex: /gh[ps]_[a-zA-Z0-9]{36}/g,
    replacement: 'gh*_****************'
  },
  {
    name: 'Password in URL',
    regex: /:\/\/[^:]+:([^@]+)@/g,
    replacement: '://[USER]:[REDACTED]@'
  }
];

let envSecrets: string[] = [];

/**
 * Carrega segredos do arquivo .env para redação
 */
export function loadEnvSecrets(): void {
  try {
    const envPath = path.join(process.cwd(), '.clia', '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.split('\n');
      
      envSecrets = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [, value] = trimmed.split('=', 2);
          if (value && value.length > 8) { // Só considera valores longos como segredos
            envSecrets.push(value.replace(/["']/g, '')); // Remove aspas
          }
        }
      }
    }
  } catch (error) {
    // Ignora erros de carregamento do .env
  }
}

/**
 * Redige segredos de um texto, substituindo por máscaras
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  
  let redacted = text;
  
  // Aplica padrões regex
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern.regex, pattern.replacement);
  }
  
  // Aplica segredos do .env
  for (const secret of envSecrets) {
    if (secret.length > 8) {
      const masked = secret.substring(0, 4) + '****************';
      redacted = redacted.replace(new RegExp(escapeRegex(secret), 'g'), masked);
    }
  }
  
  return redacted;
}

/**
 * Escapa caracteres especiais para uso em regex
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redige segredos de um comando, mantendo a estrutura
 */
export function redactCommand(command: string): string {
  return redactSecrets(command);
}

// Carrega segredos na inicialização
loadEnvSecrets();