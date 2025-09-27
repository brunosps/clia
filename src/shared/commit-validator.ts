import { getProjectName } from "../config.js";
import { getLogger } from './logger.js';

/**
 * Comprehensive list of valid conventional commit types
 */
export const VALID_COMMIT_TYPES = [
  'feat',     // New feature
  'fix',      // Bug fix
  'docs',     // Documentation
  'style',    // Code style changes
  'refactor', // Code refactoring
  'test',     // Tests
  'chore',    // Maintenance
  'perf',     // Performance improvements
  'build',    // Build system changes
  'ci',       // CI configuration
  'revert'    // Revert previous commit
] as const;

/**
 * Technical scopes that must remain in English
 */
export const VALID_SCOPES = [
  // Core system
  'core', 'config', 'shared', 'utils', 'types',
  
  // Features
  'auth', 'security', 'api', 'ui', 'cli', 'mcp',
  
  // Development
  'test', 'tests', 'docs', 'build', 'ci', 'deps',
  
  // Technologies
  'docker', 'k8s', 'aws', 'gcp', 'azure',
  
  // CLIA specific
  'translation', 'rag', 'llm', 'stack', 'analysis',
  'firewall', 'policy', 'preflight', 'redact',
  'trello', 'git', 'filesystem', 'semgrep', 'trivy'
] as const;

/**
 * Common Portuguese->English scope mappings for automatic correction
 */
export const SCOPE_CORRECTIONS = {
  'segurança': 'security',
  'seguranca': 'security',
  'tradução': 'translation',
  'traducao': 'translation',
  'integração': 'integration',  
  'integracao': 'integration',
  'configuração': 'config',
  'configuracao': 'config',
  'autenticação': 'auth',
  'autenticacao': 'auth',
  'documentação': 'docs',
  'documentacao': 'docs',
  'teste': 'test',
  'testes': 'tests',
  'ferramentas': 'tools',
  'utilitários': 'utils',
  'utilitarios': 'utils'
} as const;

/**
 * Enhanced validation result for commit messages
 */
export interface EnhancedCommitValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  correctedMessage?: string;
  suggestions: string[];
  autoCorrections: string[];
}

export interface CommitClassification {
  type:
    | "feat"
    | "fix"
    | "refactor"
    | "docs"
    | "test"
    | "chore"
    | "build"
    | "ci"
    | "perf"
    | "style";
  scopes: string[];
  summaryByFile: Array<{ file: string; bullets: string[] }>;
  breaking: boolean;
  notes: string[];
  riskLevel: "low" | "medium" | "high";
}

export interface CommitValidation {
  isValid: boolean;
  score: number; // 0-1
  issues: string[];
  suggestions: string[];
}

export interface CommitGroup {
  type: string;
  scope: string;
  files: string[];
  summaryByFile: Array<{ file: string; bullets: string[] }>;
  breaking: boolean;
  riskLevel: "low" | "medium" | "high";
}

// Mapeamento de escopo por caminhos
const SCOPE_MAPPING: Record<string, string> = {
  "src/actions": "actions",
  "src/repositories": "data",
  "src/components": "ui",
  "src/app": "app",
  "src/pages": "pages",
  "src/lib": "lib",
  "src/utils": "utils",
  "src/hooks": "hooks",
  "src/types": "types",
  "src/shared": "shared",
  "src/config": "config",
  "src/commands": "commands",
  "src/llm": "llm",
  "src/rag": "rag",
  scripts: "scripts",
  docs: "docs",
  test: "test",
  __tests__: "test",
  ".github": "ci",
  public: "assets",
  assets: "assets",
};

/**
 * Determina se mudanças são críticas (requerem premium)
 */
export function needsPremiumReview(
  classification: CommitClassification,
  changedFiles: string[]
): boolean {
  // Breaking changes sempre precisam de premium
  if (classification.breaking) return true;

  // Arquivos críticos
  const criticalPatterns = [
    /auth/i,
    /security/i,
    /payment/i,
    /billing/i,
    /migration/i,
    /schema/i,
    /database/i,
    /config/i,
    /env/i,
    /.env/,
    /package\.json/,
    /docker/i,
    /k8s/i,
    /helm/i,
    /api/i,
    /server/i,
    /middleware/i,
  ];

  const hasCriticalFiles = changedFiles.some((file) =>
    criticalPatterns.some((pattern) => pattern.test(file))
  );

  if (hasCriticalFiles) return true;

  // Muitas mudanças (> 10 arquivos ou > 400 linhas estimadas)
  if (changedFiles.length > 10) return true;

  // Risco alto
  if (classification.riskLevel === "high") return true;

  return false;
}

/**
 * Enhanced validation for commit messages with auto-correction
 */
export function enhancedValidateCommitMessage(message: string): EnhancedCommitValidationResult {
  const logger = getLogger();
  const result: EnhancedCommitValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    suggestions: [],
    autoCorrections: []
  };

  try {
    // Clean the message first
    const cleanedMessage = cleanMessage(message);
    if (cleanedMessage !== message) {
      result.autoCorrections.push(`Cleaned formatting: ${message} → ${cleanedMessage}`);
    }
    
    // Check for malformed syntax
    const syntaxIssues = detectSyntaxIssues(cleanedMessage);
    if (syntaxIssues.length > 0) {
      result.errors.push(...syntaxIssues);
      result.isValid = false;
    }

    // Parse commit message
    const parts = parseCommitMessage(cleanedMessage);
    
    if (!parts) {
      result.isValid = false;
      result.errors.push('Invalid conventional commit format. Expected: type(scope): subject');
      result.suggestions.push('Use format: feat(scope): add new feature description');
      return result;
    }

    // Validate and auto-correct each part
    validateAndCorrectType(parts.type, result);
    validateAndCorrectScope(parts.scope, result);
    validateSubjectContent(parts.subject, result);
    
    // Generate corrected message if needed
    if (result.errors.length > 0 || result.warnings.length > 0 || result.autoCorrections.length > 0) {
      result.correctedMessage = generateCorrectedMessage(parts, result.autoCorrections);
    }

    return result;
  } catch (error) {
    logger.error('Error validating commit message:', error);
    result.isValid = false;
    result.errors.push('Unexpected error during validation');
    return result;
  }
}

/**
 * Clean commit message of common formatting issues
 */
function cleanMessage(message: string): string {
  return message
    .trim()
    // Remove extra braces/brackets  
    .replace(/^[{[\(]+|[}\]\)]+$/g, '')
    // Fix malformed syntax
    .replace(/^{([^}]+)$/, '$1') // Remove unclosed opening brace
    .replace(/^([^{]+)}$/, '$1') // Remove unmatched closing brace
    // Remove extra quotes
    .replace(/^["'`]+|["'`]+$/g, '')
    // Fix duplicate scopes like "test(test):"
    .replace(/^(\w+)\(\1\)/, '$1')
    // Fix invalid characters in scopes (replace with valid alternatives)
    .replace(/\(([^)]*[ãáâàçéêíóôõú][^)]*)\)/gi, (match, scope) => {
      // Convert Portuguese characters to ASCII equivalents
      const normalizedScope = scope
        .replace(/[ãáâà]/g, 'a')
        .replace(/[çć]/g, 'c')
        .replace(/[éê]/g, 'e')
        .replace(/[í]/g, 'i')
        .replace(/[óôõ]/g, 'o')
        .replace(/[ú]/g, 'u');
      return `(${normalizedScope})`;
    })
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect syntax issues in commit message
 */
function detectSyntaxIssues(message: string): string[] {
  const issues: string[] = [];
  
  // Check for unmatched braces
  const openBraces = (message.match(/[{([\]]/g) || []).length;
  const closeBraces = (message.match(/[})\]]/g) || []).length;
  if (openBraces !== closeBraces) {
    issues.push('Unmatched braces or brackets detected');
  }
  
  // Check for missing colon
  if (!message.includes(':')) {
    issues.push('Missing colon (:) separator in conventional commit format');
  }
  
  return issues;
}

/**
 * Parse commit message into components
 */
function parseCommitMessage(message: string): { type: string; scope?: string; breaking: boolean; subject: string; body?: string; footer?: string } | null {
  // Enhanced conventional commit regex that handles special characters in scopes
  const conventionalPattern = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?\s*:\s*(?<subject>.+?)(?:\n\n(?<body>[\s\S]*?))?(?:\n\n(?<footer>[\s\S]*))?$/;
  
  const match = message.match(conventionalPattern);
  
  if (!match || !match.groups) {
    return null;
  }

  return {
    type: match.groups.type.toLowerCase(),
    scope: match.groups.scope?.toLowerCase(),
    breaking: !!match.groups.breaking,
    subject: match.groups.subject.trim(),
    body: match.groups.body?.trim(),
    footer: match.groups.footer?.trim()
  };
}

/**
 * Validate and correct commit type
 */
function validateAndCorrectType(type: string, result: EnhancedCommitValidationResult): void {
  if (!VALID_COMMIT_TYPES.includes(type as any)) {
    result.isValid = false;
    result.errors.push(`Invalid commit type '${type}'. Valid types: ${VALID_COMMIT_TYPES.join(', ')}`);
    
    // Auto-correct if close match found
    const suggestions = findClosestMatches(type, VALID_COMMIT_TYPES);
    if (suggestions.length > 0) {
      result.suggestions.push(`Did you mean: ${suggestions.join(', ')}?`);
      result.autoCorrections.push(`Auto-corrected type: ${type} → ${suggestions[0]}`);
    }
  }
}

/**
 * Validate and correct commit scope
 */
function validateAndCorrectScope(scope: string | undefined, result: EnhancedCommitValidationResult): void {
  if (!scope) return; // Scope is optional

  // Check if scope is in Portuguese and needs correction
  const correctedScope = SCOPE_CORRECTIONS[scope as keyof typeof SCOPE_CORRECTIONS];
  if (correctedScope) {
    result.warnings.push(`Scope '${scope}' should be in English: '${correctedScope}'`);
    result.autoCorrections.push(`Auto-corrected scope: ${scope} → ${correctedScope}`);
    return;
  }

  // Validate against valid scopes
  if (!VALID_SCOPES.includes(scope as any)) {
    result.warnings.push(`Scope '${scope}' is not in the standard list. Consider using: ${VALID_SCOPES.slice(0, 10).join(', ')}, etc.`);
    
    // Suggest closest matches
    const suggestions = findClosestMatches(scope, VALID_SCOPES);
    if (suggestions.length > 0) {
      result.suggestions.push(`Similar scopes: ${suggestions.join(', ')}`);
    }
  }
}

/**
 * Validate commit subject content
 */
function validateSubjectContent(subject: string, result: EnhancedCommitValidationResult): void {
  if (!subject || subject.length === 0) {
    result.isValid = false;
    result.errors.push('Commit subject cannot be empty');
    return;
  }

  if (subject.length > 72) {
    result.warnings.push(`Subject is too long (${subject.length} chars). Keep under 72 characters.`);
  }

  // Check for mixed languages (Portuguese + English verbs)
  const hasPortugueseVerbs = /\b(adicionar|implementar|atualizar|criar|remover|corrigir|melhorar|atualize|introduzir)\b/i.test(subject);
  const hasEnglishVerbs = /\b(add|implement|update|create|remove|fix|improve|introduce)\b/i.test(subject);
  
  if (hasPortugueseVerbs && hasEnglishVerbs) {
    result.warnings.push('Subject mixes Portuguese and English verbs. Choose one language consistently.');
  }
  
  // Detect common Portuguese verbs that should be corrected
  if (hasPortugueseVerbs) {
    result.warnings.push('Subject contains Portuguese verbs. Consider using English for consistency.');
    result.suggestions.push('Common translations: adicionar→add, atualizar→update, implementar→implement, criar→create');
  }
}

/**
 * Generate corrected commit message
 */
function generateCorrectedMessage(
  parts: { type: string; scope?: string; breaking: boolean; subject: string; body?: string; footer?: string }, 
  autoCorrections: string[]
): string {
  // Apply auto-corrections
  let correctedType = parts.type;
  let correctedScope = parts.scope;

  // Correct the type if needed
  if (!VALID_COMMIT_TYPES.includes(parts.type as any)) {
    const suggestions = findClosestMatches(parts.type, VALID_COMMIT_TYPES);
    if (suggestions.length > 0) {
      correctedType = suggestions[0];
    }
  }

  // Correct the scope if needed
  if (parts.scope) {
    const scopeCorrection = SCOPE_CORRECTIONS[parts.scope as keyof typeof SCOPE_CORRECTIONS];
    if (scopeCorrection) {
      correctedScope = scopeCorrection;
    }
  }

  // Build corrected message
  let corrected = correctedType;
  if (correctedScope) {
    corrected += `(${correctedScope})`;
  }
  if (parts.breaking) {
    corrected += '!';
  }
  corrected += `: ${parts.subject}`;
  
  if (parts.body) {
    corrected += `\n\n${parts.body}`;
  }
  
  if (parts.footer) {
    corrected += `\n\n${parts.footer}`;
  }

  return corrected;
}

/**
 * Find closest string matches using Levenshtein distance
 */
function findClosestMatches(input: string, candidates: readonly string[], maxDistance = 2): string[] {
  const matches: { match: string; distance: number }[] = [];
  
  for (const candidate of candidates) {
    const distance = levenshteinDistance(input.toLowerCase(), candidate.toLowerCase());
    if (distance <= maxDistance) {
      matches.push({ match: candidate, distance });
    }
  }
  
  return matches
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(m => m.match);
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Auto-correct a commit message with the most obvious fixes
 */
export function autoCorrectCommitMessage(message: string): string {
  const validation = enhancedValidateCommitMessage(message);
  return validation.correctedMessage || message;
}

/**
 * Valida mensagem de commit deterministicamente
 */
export function validateCommitMessage(message: string): CommitValidation {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 1.0;

  const lines = message.split("\n");
  const subject = lines[0];
  const body = lines.slice(2).join("\n"); // Pula linha vazia

  // Validação do assunto
  const hasBreakingChange = subject.includes("!:");
  const maxLength = hasBreakingChange ? 100 : 72; // Mais flexível para breaking changes

  if (subject.length > maxLength) {
    issues.push(`Assunto excede ${maxLength} caracteres`);
    score -= 0.2; // Penalidade menor
  }

  if (subject.length < 10) {
    issues.push("Assunto muito curto (< 10 caracteres)");
    score -= 0.2;
  }

  if (subject.endsWith(".")) {
    issues.push("Assunto não deve terminar com ponto");
    score -= 0.1;
  }

  // Validação do tipo conventional commit
  const conventionalMatch = subject.match(
    /^(feat|fix|docs|style|refactor|test|chore|perf|build|ci)(\([^)]+\))?!?\s*:\s*(.+)$/
  );
  if (!conventionalMatch) {
    issues.push("Não segue formato Conventional Commits");
    score -= 0.4;
  } else {
    const [, type, scope, description] = conventionalMatch;

    // Validação do escopo
    if (scope) {
      const scopeContent = scope.slice(1, -1); // Remove parênteses
      const scopes = scopeContent.split(",").map((s) => s.trim());

      for (const individualScope of scopes) {
        if (!/^[a-z0-9\-]+$/.test(individualScope)) {
          issues.push(
            "Escopo deve conter apenas letras minúsculas, números e hífens"
          );
          score -= 0.1;
          break;
        }
      }
    }

    // Validação da descrição
    if (description.length < 5) {
      issues.push("Descrição muito curta");
      score -= 0.2;
    }

    if (!/^[a-z]/.test(description)) {
      issues.push("Descrição deve começar com letra minúscula");
      score -= 0.1;
    }
  }

  // Validação do corpo
  const bodyLines = body.split("\n").filter((line) => line.trim());
  bodyLines.forEach((line) => {
    if (line.length > 100) {
      issues.push("Linha do corpo excede 100 caracteres");
      score -= 0.1;
    }
  });

  // Detecção de segredos
  const secretPatterns = [
    /AKIA[0-9A-Z]{16}/, // AWS Access Key
    /sk-[a-zA-Z0-9]{32,}/, // OpenAI API Key
    /ghp_[a-zA-Z0-9]{36}/, // GitHub Personal Access Token
    /glpat-[a-zA-Z0-9\-]{20}/, // GitLab Personal Access Token
    /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/, // Slack Bot Token
    /ya29\.[a-zA-Z0-9_\-]+/, // Google OAuth Access Token
    /AIza[0-9A-Za-z\-_]{35}/, // Google API Key
    /postgres:\/\/[^:]+:[^@]+@/, // Database URL with credentials
    /mysql:\/\/[^:]+:[^@]+@/, // MySQL URL with credentials
  ];

  secretPatterns.forEach((pattern) => {
    if (pattern.test(message)) {
      issues.push("Possível segredo detectado na mensagem");
      score -= 0.5;
    }
  });

  // Sugestões baseadas em padrões comuns
  if (subject.includes("update") || subject.includes("change")) {
    suggestions.push(
      "Considere ser mais específico sobre o que foi atualizado/alterado"
    );
  }

  if (
    subject.includes("fix") &&
    !body.includes("resolve") &&
    !body.includes("corrige")
  ) {
    suggestions.push(
      "Para fixes, considere explicar o problema resolvido no corpo"
    );
  }

  if (
    bodyLines.length === 0 &&
    conventionalMatch &&
    conventionalMatch[1] === "feat"
  ) {
    suggestions.push(
      "Features se beneficiam de explicação no corpo da mensagem"
    );
  }

  return {
    isValid: issues.length === 0,
    score: Math.max(0, score),
    issues,
    suggestions,
  };
}

/**
 * Calcula pontuação de qualidade da mensagem
 */
export function scoreMessageQuality(
  message: string,
  classification: CommitClassification
): number {
  const validation = validateCommitMessage(message);
  let score = validation.score;

  // Bônus especial para breaking changes bem marcados
  if (message.includes("!:") && classification.breaking) {
    score += 0.3; // Grande bônus para breaking changes bem indicados
  }

  // Bônus por alinhamento com classificação
  const type = classification.type;
  if (message.startsWith(type)) {
    score += 0.1;
  }

  // Bônus por incluir escopo apropriado
  const hasScope = message.includes("(") && message.includes(")");
  if (hasScope && classification.scopes.length > 0) {
    score += 0.1;
  }

  // Penalidade por breaking change sem marcação
  if (
    classification.breaking &&
    !message.includes("BREAKING CHANGE") &&
    !message.includes("!:")
  ) {
    score -= 0.3;
  }

  // Bônus por corpo explicativo
  const lines = message.split("\n");
  if (
    lines.length > 2 &&
    lines.slice(2).some((line) => line.trim().length > 0)
  ) {
    score += 0.1;
  }

  return Math.min(1.0, Math.max(0, score));
}

/**
 * Agrupa mudanças por domínio lógico para possível split
 */
export function groupChangesByDomain(
  classification: CommitClassification
): CommitGroup[] {
  const groups: Map<string, CommitGroup> = new Map();

  classification.summaryByFile.forEach(({ file, bullets }) => {
    // Determinar domínio baseado no caminho
    let domain = "misc";

    for (const [pathPattern, scope] of Object.entries(SCOPE_MAPPING)) {
      if (file.startsWith(pathPattern)) {
        domain = scope;
        break;
      }
    }

    // Agrupar por domínio
    if (!groups.has(domain)) {
      groups.set(domain, {
        type: classification.type,
        scope: domain,
        files: [],
        summaryByFile: [],
        breaking: false,
        riskLevel: classification.riskLevel,
      });
    }

    const group = groups.get(domain)!;
    group.files.push(file);
    group.summaryByFile.push({ file, bullets });

    // Propagar breaking change se qualquer arquivo for breaking
    if (classification.breaking) {
      group.breaking = true;
    }
  });

  return Array.from(groups.values());
}

/**
 * Gera mensagem de commit formatada
 */
export function formatCommitMessage(
  type: string,
  scope: string | null,
  subject: string,
  body: string[],
  breaking: boolean,
  taskId?: string
): string {
  const scopePart = scope ? `(${scope})` : "";
  const taskPart = taskId ? ` – ${taskId}` : "";
  const subjectLine = `${type}: ${subject}${taskPart} - ${scopePart}`;

  const parts = [subjectLine];

  if (body.length > 0) {
    parts.push(""); // linha vazia
    body.forEach((line) => {
      if (line.startsWith("-") || line.startsWith("*")) {
        parts.push(line);
      } else {
        parts.push(`- ${line}`);
      }
    });
  }

  if (breaking) {
    parts.push("");
    parts.push(
      "BREAKING CHANGE: veja descrição acima para detalhes da mudança incompatível"
    );
  }

  return parts.join("\n");
}

/**
 * Obtém nome do projeto para logging
 */
export function getProjectNameForLogging(): string {
  try {
    return getProjectName();
  } catch {
    return "unknown-project";
  }
}
