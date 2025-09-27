// Review Strategies - SOLID Implementation
// Seguindo princípios de Clean Code e SOLID

interface ReviewStrategy {
  analyzeRisk(filePath: string, diffHunks: string, context?: string): Promise<RiskAnalysis>;
  generateReview(context: ReviewContext): Promise<ReviewResult>;
}

interface RiskAnalysis {
  level: 'low' | 'medium' | 'high';
  needsDeepReview: boolean;
  reasons: string[];
  scores: SecurityScores;
}

interface SecurityScores {
  security: number;
  solid: number;
  clean_code: number;
  maintainability: number;
  performance: number;
}

interface ReviewContext {
  filePath: string;
  diffHunks: string;
  ragContext?: string;
  userLanguage: string;
}

interface ReviewResult {
  file: string;
  answer: string;
  intent_inferred: string;
  language: string;
  overall: {
    risk_level: 'low' | 'medium' | 'high';
    scores: SecurityScores;
  };
  confidence: number;
  risks?: Array<{
    category: 'security' | 'maintainability' | 'performance' | 'solid' | 'clean_code';
    title: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    evidence?: string;
    recommendation: string;
  }>;
}

// Heuristic Strategy - Clean and focused implementation
class HeuristicReviewStrategy implements ReviewStrategy {
  async analyzeRisk(filePath: string, diffHunks: string, context?: string): Promise<RiskAnalysis> {
    const analyzer = new FileRiskAnalyzer(filePath, diffHunks);
    
    return {
      level: analyzer.calculateRiskLevel(),
      needsDeepReview: analyzer.requiresDeepReview(),
      reasons: analyzer.getRiskReasons(),
      scores: analyzer.calculateScores(),
    };
  }

  async generateReview(context: ReviewContext): Promise<ReviewResult> {
    const analyzer = new FileRiskAnalyzer(context.filePath, context.diffHunks);
    const riskAnalysis = await this.analyzeRisk(context.filePath, context.diffHunks, context.ragContext);

    return {
      file: context.filePath,
      answer: this.generateAnalysisDescription(context, riskAnalysis),
      intent_inferred: 'Análise heurística automatizada de código',
      language: context.userLanguage,
      overall: {
        risk_level: riskAnalysis.level,
        scores: riskAnalysis.scores,
      },
      confidence: 85,
      risks: analyzer.generateRiskRecommendations(),
    };
  }

  private generateAnalysisDescription(context: ReviewContext, analysis: RiskAnalysis): string {
    const ext = this.getFileExtension(context.filePath);
    const lineCount = context.diffHunks.split('\n').length;
    const contextInfo = context.ragContext ? `Context disponível: ${context.ragContext.substring(0, 100)}...` : 'Sem contexto RAG';
    
    return `Análise ${ext} com ${lineCount} linhas de mudanças. Nível de risco: ${analysis.level}. ${contextInfo}`;
  }

  private getFileExtension(filePath: string): string {
    const ext = filePath.split('.').pop() || 'unknown';
    const typeMap: Record<string, string> = {
      'ts': 'TypeScript',
      'js': 'JavaScript',
      'py': 'Python',
      'java': 'Java',
      'json': 'JSON',
    };
    return typeMap[ext] || ext;
  }
}

// Risk Analysis Engine - Single Responsibility
class FileRiskAnalyzer {
  private readonly filePath: string;
  private readonly diffContent: string;
  private readonly patterns: SecurityPatterns;

  constructor(filePath: string, diffContent: string) {
    this.filePath = filePath;
    this.diffContent = diffContent;
    this.patterns = new SecurityPatterns();
  }

  calculateRiskLevel(): 'low' | 'medium' | 'high' {
    if (this.patterns.hasSecuritySensitiveChanges(this.diffContent)) return 'high';
    if (this.hasLargeChanges() || this.patterns.hasArchitecturalChanges(this.diffContent)) return 'medium';
    return 'low';
  }

  requiresDeepReview(): boolean {
    return this.calculateRiskLevel() !== 'low' || this.hasLargeChanges();
  }

  getRiskReasons(): string[] {
    const reasons = [];
    if (this.patterns.hasSecuritySensitiveChanges(this.diffContent)) {
      reasons.push('Mudanças sensíveis à segurança detectadas');
    }
    if (this.hasLargeChanges()) {
      reasons.push('Grande volume de alterações');
    }
    if (this.patterns.hasArchitecturalChanges(this.diffContent)) {
      reasons.push('Mudanças arquiteturais significativas');
    }
    if (this.isTestFile()) {
      reasons.push('Alterações em arquivos de teste');
    }
    if (reasons.length === 0) {
      reasons.push('Mudanças padrão de código detectadas');
    }
    return reasons;
  }

  calculateScores(): SecurityScores {
    const base = 8;
    return {
      security: this.patterns.hasSecuritySensitiveChanges(this.diffContent) ? 5 : base,
      solid: this.isTestFile() ? 9 : 7,
      clean_code: this.isTypescriptFile() ? base : 7,
      maintainability: this.hasLargeChanges() ? 6 : base,
      performance: 7,
    };
  }

  generateRiskRecommendations() {
    const risks = [];

    if (this.patterns.hasSecuritySensitiveChanges(this.diffContent)) {
      risks.push({
        category: 'security' as const,
        title: 'Alterações sensíveis à segurança',
        severity: 'medium' as const,
        evidence: 'Detectadas palavras-chave relacionadas a autenticação/autorização',
        recommendation: 'Revisar cuidadosamente credenciais, tokens e configurações de segurança',
      });
    }

    if (this.hasLargeChanges()) {
      risks.push({
        category: 'maintainability' as const,
        title: 'Volume elevado de alterações',
        severity: 'low' as const,
        evidence: `Arquivo possui mais de 500 caracteres de modificações`,
        recommendation: 'Considerar dividir em múltiplos commits para melhor rastreabilidade',
      });
    }

    return risks;
  }

  private hasLargeChanges(): boolean {
    return this.diffContent.length > 1000;
  }

  private isTestFile(): boolean {
    return /\.(test|spec)\.(ts|js)$/.test(this.filePath);
  }

  private isTypescriptFile(): boolean {
    return this.filePath.endsWith('.ts');
  }
}

// Security Patterns Detection - Interface Segregation
class SecurityPatterns {
  private readonly securityKeywords = [
    'password', 'secret', 'key', 'token', 'auth', 'credential',
    'oauth', 'jwt', 'session', 'cookie', 'csrf', 'xss'
  ];

  private readonly architecturalPatterns = [
    'class ', 'interface ', 'extends', 'implements', 'abstract',
    'async function', 'Promise<', 'Observable<'
  ];

  hasSecuritySensitiveChanges(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return this.securityKeywords.some(keyword => lowerContent.includes(keyword));
  }

  hasArchitecturalChanges(content: string): boolean {
    return this.architecturalPatterns.some(pattern => content.includes(pattern));
  }
}

export { ReviewStrategy, HeuristicReviewStrategy, RiskAnalysis, ReviewContext, ReviewResult };