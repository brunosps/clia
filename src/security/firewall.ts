/**
 * Sistema de Firewall de Segurança para Plan-Execute-Check (PEC)
 * Implementa pré-firewall (entrada) e pós-firewall (saída) com schemas JSON estrito
 */

import { getLogger } from '../shared/logger.js';
import { makeLLM } from '../llm/provider.js';

// ========== SCHEMAS JSON ==========

export interface RiskReport {
  phase: 'pre_firewall' | 'post_firewall';
  timestamp: string;
  decision: 'allow' | 'review' | 'block';
  confidence: number;
  flags: {
    prompt_injection: boolean;
    pii_detection: boolean;
    content_violation: boolean;
    scope_violation: boolean;
    privilege_escalation: boolean;
    data_exfiltration: boolean;
  };
  threats: Array<{
    type: 'injection' | 'leakage' | 'manipulation' | 'scope' | 'content';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    evidence: string;
    mitigation?: string;
  }>;
  justification: string;
  sanitization_applied?: string[];
}

export interface ErrorEnvelope {
  error: true;
  type: 'security_block' | 'validation_error' | 'schema_violation' | 'execution_error';
  message: string;
  risk_report?: RiskReport;
  timestamp: string;
  request_id: string;
}

export interface PlanResult {
  strategy: {
    approach: string;
    objective: string;
    constraints: string[];
    allowed_tools: string[];
    forbidden_actions: string[];
  };
  steps: Array<{
    id: string;
    description: string;
    tool: string;
    scope: string[];
    estimated_risk: 'low' | 'medium' | 'high';
    dependencies: string[];
  }>;
  risk_assessment: {
    overall_level: 'low' | 'medium' | 'high' | 'critical';
    factors: string[];
    mitigations: string[];
  };
  success_criteria: string[];
  citations?: Array<{
    source_id: string;
    kind: 'file' | 'documentation' | 'code' | 'config';
    uri?: string;
    hash_range?: string;
    notes?: string;
  }>;
  confidence: number;
  version: string;
}

export interface ExecuteIntent {
  plan_id: string;
  tool_calls: Array<{
    id: string;
    tool: string;
    scope: string[];
    arguments: Record<string, any>;
    rationale: string;
    risk_level: 'low' | 'medium' | 'high';
  }>;
  expected_outputs: Array<{
    tool_call_id: string;
    output_type: string;
    schema_ref?: string;
  }>;
  safety_constraints: string[];
  version: string;
}

export interface ExecuteResult {
  intent_id: string;
  tool_results: Array<{
    tool_call_id: string;
    status: 'success' | 'error' | 'blocked';
    output?: any;
    error?: string;
    execution_time_ms: number;
    warnings?: string[];
  }>;
  summary: {
    successful: number;
    failed: number;
    blocked: number;
    total_time_ms: number;
  };
  citations?: Array<{
    source_id: string;
    kind: 'file' | 'documentation' | 'code' | 'config';
    uri?: string;
    hash_range?: string;
    notes?: string;
  }>;
  version: string;
}

export interface CheckReport {
  plan_id: string;
  execute_id: string;
  validation: {
    plan_adherence: {
      score: number;
      deviations: string[];
    };
    output_quality: {
      score: number;
      issues: string[];
    };
    security_compliance: {
      score: number;
      violations: string[];
    };
  };
  findings: {
    achievements: string[];
    discrepancies: string[];
    residual_risks: Array<{
      type: string;
      severity: 'low' | 'medium' | 'high';
      description: string;
    }>;
  };
  recommendations: {
    next_steps: string[];
    improvements: string[];
    iterations_needed: boolean;
  };
  overall_score: number;
  decision: 'accept' | 'iterate' | 'reject';
  version: string;
}

export interface McpAllowlist {
  tools: Array<{
    name: string;
    scopes: string[];
    max_usage: number;
    risk_level: 'low' | 'medium' | 'high';
  }>;
  global_constraints: {
    max_file_operations: number;
    allowed_paths: string[];
    forbidden_paths: string[];
    max_network_requests: number;
    allowed_domains: string[];
  };
}

export interface SecurityConfig {
  enabled: boolean;
  strict_mode: boolean;
  max_prompt_length: number;
  max_response_length: number;
  allowed_providers: string[];
  pii_detection_enabled: boolean;
  content_filtering_level: 'permissive' | 'moderate' | 'strict';
  mcp_allowlist: McpAllowlist;
  owasp_llm_protections: {
    injection_detection: boolean;
    insecure_output_handling: boolean;
    training_poisoning_detection: boolean;
    model_dos_protection: boolean;
    supply_chain_vulnerabilities: boolean;
    sensitive_information_disclosure: boolean;
    insecure_plugin_design: boolean;
    excessive_agency: boolean;
    overreliance: boolean;
    model_theft: boolean;
  };
}

// ========== FIREWALL IMPLEMENTATION ==========

export class SecurityFirewall {
  private config: SecurityConfig;
  private logger: any;

  constructor(config: SecurityConfig) {
    this.config = config;
    this.logger = getLogger();
  }

  /**
   * Pré-firewall: Validação antes de enviar para LLM
   */
  async preFirewall(
    input: string, 
    context: any, 
    provider_config: any
  ): Promise<{ allow: boolean; report: RiskReport; sanitized_input?: string }> {
    const startTime = Date.now();
    
    const report: RiskReport = {
      phase: 'pre_firewall',
      timestamp: new Date().toISOString(),
      decision: 'allow',
      confidence: 0.8,
      flags: {
        prompt_injection: false,
        pii_detection: false,
        content_violation: false,
        scope_violation: false,
        privilege_escalation: false,
        data_exfiltration: false
      },
      threats: [],
      justification: 'Input passed validation'
    };

    try {
      // Verificar se o input é principalmente JSON estruturado interno ou template do sistema
      const isInternalJson = this.isInternalJsonStructure(input);
      
      // 1. Verificar tamanho do input
      if (input.length > this.config.max_prompt_length) {
        report.decision = 'block';
        report.flags.scope_violation = true;
        report.threats.push({
          type: 'scope',
          severity: 'medium',
          description: 'Input exceeds maximum allowed length',
          evidence: `Input length: ${input.length}, Max: ${this.config.max_prompt_length}`
        });
      }

      // 2. Detectar tentativas de injeção (com consideração para JSON interno)
      if (!isInternalJson) {
        const injectionResult = await this.detectPromptInjection(input, provider_config);
        if (injectionResult.detected) {
          report.decision = 'block';
          report.flags.prompt_injection = true;
          report.threats.push({
            type: 'injection',
            severity: injectionResult.severity,
            description: 'Prompt injection attempt detected',
            evidence: injectionResult.evidence
          });
        }
      }

      // 3. Detectar PII (exceto em contextos internos seguros)
      if (!isInternalJson || this.config.strict_mode) {
        const piiResult = this.detectPII(input);
        if (piiResult.detected) {
          report.flags.pii_detection = true;
          if (this.config.strict_mode) {
            report.decision = 'block';
          } else {
            report.decision = 'review';
          }
          report.threats.push({
            type: 'leakage',
            severity: 'high',
            description: 'PII detected in input',
            evidence: piiResult.evidence
          });
        }
      }

      // 4. Validar conteúdo geral
      const contentResult = await this.validateContent(input, provider_config);
      if (!contentResult.allowed) {
        report.decision = 'block';
        report.flags.content_violation = true;
        report.threats.push({
          type: 'content',
          severity: 'medium',
          description: 'Content policy violation',
          evidence: contentResult.reason
        });
      }

      // 5. Aplicar sanitização se necessário
      let sanitized_input = input;
      const sanitization_applied: string[] = [];

      if (report.flags.pii_detection && report.decision !== 'block') {
        // Aplicar redação básica de PII
        sanitized_input = input.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF_REDACTED]')
                               .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
        sanitization_applied.push('pii_redaction');
      }

      if (sanitization_applied.length > 0) {
        report.sanitization_applied = sanitization_applied;
      }

      // 6. Decisão final
      const allow = report.decision === 'allow';
      report.confidence = this.calculateConfidence(report);

      this.logger.info(`🛡️ Pre-firewall: ${report.decision}`, {
        threats: report.threats.length,
        confidence: report.confidence,
        duration: Date.now() - startTime
      });

      return { allow, report, sanitized_input: sanitized_input !== input ? sanitized_input : undefined };

    } catch (error) {
      this.logger.error(' Error in pre-firewall:', error);
      report.decision = 'block';
      report.justification = `Pre-firewall error: ${error instanceof Error ? error.message : String(error)}`;
      return { allow: false, report };
    }
  }

  /**
   * Verifica se o input é principalmente estrutura JSON interna ou template do sistema
   */
  private isInternalJsonStructure(input: string): boolean {
    // Verifica se o input contém estruturas JSON típicas do sistema interno
    const jsonStructureIndicators = [
      /"strategy":\s*{/,
      /"steps":\s*\[/,
      /"risk_assessment":/,
      /"allowed_tools":/,
      /"constraints":/,
      /"version":\s*"3\.0\.0"/
    ];

    // Verifica se o input contém templates de prompt do sistema
    const templateIndicators = [
      /\{\{command\}\}/,
      /\{\{input\.question\}\}/,
      /\{\{plan\}\}/,
      /\{\{tier\}\}/,
      /## CONTEXTO/,
      /## TAREFA/,
      /## FERRAMENTAS APROVADAS/,
      /RESPONDA APENAS COM JSON ESTRITO/
    ];

    let jsonIndicatorCount = 0;
    let templateIndicatorCount = 0;

    for (const indicator of jsonStructureIndicators) {
      if (indicator.test(input)) {
        jsonIndicatorCount++;
      }
    }

    for (const indicator of templateIndicators) {
      if (indicator.test(input)) {
        templateIndicatorCount++;
      }
    }

    // Se tem 3 ou mais indicadores de JSON interno, OU 4 ou mais indicadores de template
    return jsonIndicatorCount >= 3 || templateIndicatorCount >= 4;
  }

  /**
   * Pós-firewall: Validação após receber resposta da LLM
   */
  async postFirewall(
    llm_output: string, 
    expected_schema: string,
    context: any
  ): Promise<{ allow: boolean; report: RiskReport; sanitized_output?: any }> {
    const startTime = Date.now();
    
    const report: RiskReport = {
      phase: 'post_firewall',
      timestamp: new Date().toISOString(),
      decision: 'allow',
      confidence: 0.8,
      flags: {
        prompt_injection: false,
        pii_detection: false,
        content_violation: false,
        scope_violation: false,
        privilege_escalation: false,
        data_exfiltration: false
      },
      threats: [],
      justification: 'Output passed validation'
    };

    try {
      // 1. Verificar tamanho da resposta
      if (llm_output.length > this.config.max_response_length) {
        report.decision = 'block';
        report.flags.scope_violation = true;
        report.threats.push({
          type: 'scope',
          severity: 'medium',
          description: 'Output exceeds maximum allowed length',
          evidence: `Output length: ${llm_output.length}, Max: ${this.config.max_response_length}`
        });
      }

      // 2. Validar formato JSON estrito
      const jsonValidation = this.validateJsonStrict(llm_output, expected_schema);
      if (!jsonValidation.valid) {
        this.logger.error('JSON validation failed:', {
          error: jsonValidation.error,
          llm_output_preview: llm_output.slice(0, 500) + (llm_output.length > 500 ? '...' : ''),
          expected_schema
        });
        report.decision = 'block';
        report.threats.push({
          type: 'manipulation',
          severity: 'high',
          description: 'Invalid JSON format or schema violation',
          evidence: jsonValidation.error
        });
      }

      // 3. Detectar tentativa de injeção tardia
      const lateInjectionResult = this.detectLateInjection(llm_output);
      if (lateInjectionResult.detected) {
        report.decision = 'block';
        report.flags.prompt_injection = true;
        report.threats.push({
          type: 'injection',
          severity: 'critical',
          description: 'Late injection attempt in output',
          evidence: lateInjectionResult.evidence
        });
      }

      // 4. Verificar vazamento de informações
      const leakageResult = this.detectInformationLeakage(llm_output);
      if (leakageResult.detected) {
        report.flags.data_exfiltration = true;
        if (this.config.strict_mode) {
          report.decision = 'block';
        } else {
          report.decision = 'review';
        }
        report.threats.push({
          type: 'leakage',
          severity: leakageResult.severity,
          description: 'Information leakage detected',
          evidence: leakageResult.evidence
        });
      }

      // 5. Aplicar sanitização da saída
      let sanitized_output = llm_output;
      const sanitization_applied: string[] = [];

      if (report.flags.data_exfiltration && report.decision !== 'block') {
        sanitized_output = this.sanitizeOutput(llm_output);
        sanitization_applied.push('information_redaction');
      }

      // 6. Escapar para renderização segura
      if (!jsonValidation.valid || report.threats.length > 0) {
        sanitized_output = this.escapeForSafeRendering(sanitized_output);
        sanitization_applied.push('html_escaping');
      }

      if (sanitization_applied.length > 0) {
        report.sanitization_applied = sanitization_applied;
      }

      // 7. Decisão final
      const allow = report.decision === 'allow';
      report.confidence = this.calculateConfidence(report);

      this.logger.info(`🛡️ Post-firewall: ${report.decision}`, {
        threats: report.threats.length,
        confidence: report.confidence,
        duration: Date.now() - startTime
      });

      // Prepare sanitized output safely
      let finalOutput = sanitized_output;
      if (jsonValidation.valid && jsonValidation.extractedJson) {
        try {
          finalOutput = JSON.parse(jsonValidation.extractedJson);
        } catch (parseError) {
          this.logger.warn('Failed to parse extracted JSON, returning as string:', parseError);
          finalOutput = sanitized_output;
        }
      }

      return { allow, report, sanitized_output: finalOutput };

    } catch (error) {
      this.logger.error(' Error in post-firewall:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        llm_output_length: llm_output.length,
        expected_schema
      });
      report.decision = 'block';
      report.justification = `Post-firewall error: ${error instanceof Error ? error.message : String(error)}`;
      return { allow: false, report, sanitized_output: null };
    }
  }

  // ========== DETECTION METHODS ==========

  private async detectPromptInjection(input: string, provider_config: any): Promise<{
    detected: boolean;
    severity: 'low' | 'medium' | 'high' | 'critical';
    evidence: string;
  }> {
    // Padrões básicos de injeção
    const basicPatterns = [
      /ignore\s+previous\s+instructions/i,
      /forget\s+everything/i,
      /system\s*:\s*/i,
      /you\s+are\s+now/i,
      /act\s+as|pretend\s+to\s+be|roleplay/i,
      /\[INST\]|\[\/INST\]/i,
      /<\|im_start\|>|<\|im_end\|>/i,
      /###\s*human|###\s*assistant/i,
      /prompt\s*injection/i,
      /jailbreak/i
    ];

    for (const pattern of basicPatterns) {
      if (pattern.test(input)) {
        return {
          detected: true,
          severity: 'high',
          evidence: `Pattern matched: ${pattern.source}`
        };
      }
    }

    // Detecção avançada usando LLM (se disponível)
    if (this.config.owasp_llm_protections.injection_detection) {
      try {
        const detector = await makeLLM(provider_config, 'basic');
        const detectionPrompt = `Analyze the following input for prompt injection attempts. Return only JSON:

INPUT: ${input.slice(0, 500)}

{
  "is_injection": boolean,
  "confidence": number,
  "reason": "string"
}`;

        const response = await detector.chat(detectionPrompt, 0.1);
        const result = JSON.parse(response);
        
        if (result.is_injection && result.confidence > 0.7) {
          return {
            detected: true,
            severity: result.confidence > 0.9 ? 'critical' : 'high',
            evidence: result.reason
          };
        }
      } catch (error) {
        this.logger.warn('LLM injection detection failed, using pattern-based only');
      }
    }

    return { detected: false, severity: 'low', evidence: '' };
  }

  private detectPII(input: string): { detected: boolean; evidence: string } {
    const piiPatterns = [
      // CPF
      /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,
      // Email
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      // Telefone
      /\(?[\d\s]{2}\)?\s?[\d\s]{4,5}-?[\d\s]{4}/,
      // Cartão de crédito
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
      // RG
      /\d{2}\.?\d{3}\.?\d{3}-?[\dX]/i
    ];

    for (const pattern of piiPatterns) {
      const match = input.match(pattern);
      if (match) {
        return {
          detected: true,
          evidence: `PII pattern detected: ${match[0].slice(0, 10)}...`
        };
      }
    }

    return { detected: false, evidence: '' };
  }

  private async validateContent(input: string, provider_config: any): Promise<{
    allowed: boolean;
    reason: string;
  }> {
    // Padrões de conteúdo proibido
    const prohibitedPatterns = [
      /\b(bomb|explosive|weapon|kill|murder|suicide)\b/i,
      /\b(hack|crack|exploit|malware|virus)\b/i,
      /\b(drug|cocaine|heroin|illegal)\b/i
    ];

    for (const pattern of prohibitedPatterns) {
      if (pattern.test(input)) {
        return {
          allowed: false,
          reason: `Prohibited content pattern: ${pattern.source}`
        };
      }
    }

    return { allowed: true, reason: 'Content validation passed' };
  }

  private validateJsonStrict(output: string, expected_schema: string): {
    valid: boolean;
    error: string;
    extractedJson?: string;
  } {
    try {
      // Extrair JSON da resposta
      const jsonMatch = output.match(/```json\s*(\{[\s\S]*?\})\s*```/) || 
                       output.match(/(\{[\s\S]*\})/);
      
      if (!jsonMatch) {
        return {
          valid: false,
          error: 'No valid JSON found in output'
        };
      }

      // Validar se é JSON válido
      const parsed = JSON.parse(jsonMatch[1]);
      
      // Validação básica de schema por tipo
      const schemaValidation = this.validateBasicSchema(parsed, expected_schema);
      if (!schemaValidation.valid) {
        return schemaValidation;
      }

      return { valid: true, error: '', extractedJson: jsonMatch[1] };
    } catch (error) {
      return {
        valid: false,
        error: `JSON parsing error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private validateBasicSchema(obj: any, schema_type: string): {
    valid: boolean;
    error: string;
  } {
    const requiredFields: { [key: string]: string[] } = {
      'PlanResult': ['strategy', 'steps', 'risk_assessment', 'confidence', 'version'],
      'ExecuteIntent': ['plan_id', 'tool_calls', 'safety_constraints', 'version'],
      'ExecuteResult': ['answer', 'version'], // Simplificado para comando ask
      'CheckReport': ['plan_id', 'execute_id', 'validation', 'findings', 'overall_score', 'decision', 'version']
    };

    const required = requiredFields[schema_type];
    if (!required) {
      return { valid: true, error: '' }; // Schema não reconhecido, permitir
    }

    // Validação especial para ExecuteResult
    if (schema_type === 'ExecuteResult') {
      if (!('answer' in obj) || !('version' in obj)) {
        const missing = [];
        if (!('answer' in obj)) missing.push('answer');
        if (!('version' in obj)) missing.push('version');
        return {
          valid: false,
          error: `Missing required fields: ${missing.join(', ')}`
        };
      }
      
      // Para comando ask, deve ter answer direto
      return { valid: true, error: '' };
    }

    // Validação padrão para outros schemas
    for (const field of required) {
      if (!(field in obj)) {
        return {
          valid: false,
          error: `Missing required field: ${field}`
        };
      }
    }

    return { valid: true, error: '' };
  }

  private detectLateInjection(output: string): {
    detected: boolean;
    evidence: string;
  } {
    const lateInjectionPatterns = [
      /ignore\s+this\s+response/i,
      /previous\s+answer\s+was\s+wrong/i,
      /actually,?\s+let\s+me/i,
      /wait,?\s+that's\s+not\s+right/i
    ];

    for (const pattern of lateInjectionPatterns) {
      const match = output.match(pattern);
      if (match) {
        return {
          detected: true,
          evidence: `Late injection pattern: ${match[0]}`
        };
      }
    }

    return { detected: false, evidence: '' };
  }

  private detectInformationLeakage(output: string): {
    detected: boolean;
    severity: 'low' | 'medium' | 'high';
    evidence: string;
  } {
    const leakagePatterns = [
      { pattern: /api[_-]?key\s*[:=]\s*[^\s"',}]+/i, severity: 'high' as const },
      { pattern: /\btoken\s*[:=]\s*[^\s"',}]+/i, severity: 'high' as const },
      { pattern: /\bsecret\s*[:=]\s*[^\s"',}]+/i, severity: 'high' as const },
      { pattern: /\bpassword\s*[:=]\s*[^\s"',}]+/i, severity: 'high' as const },
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/, severity: 'high' as const }, // SSN
      { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/, severity: 'high' as const },
      { pattern: /[A-Za-z0-9]{32,}/, severity: 'medium' as const } // Long strings that could be tokens
    ];

    for (const { pattern, severity } of leakagePatterns) {
      const match = output.match(pattern);
      if (match) {
        // Debug temporário
        this.logger.info(' DEBUG - Padrão detectado:', {
          pattern: pattern.toString(),
          match: match[0],
          severity
        });
        
        return {
          detected: true,
          severity,
          evidence: `Information leakage pattern: ${match[0].slice(0, 20)}...`
        };
      }
    }

    return { detected: false, severity: 'low', evidence: '' };
  }

  // ========== SANITIZATION METHODS ==========

  private sanitizePII(input: string): string {
    return input
      .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '[CPF_REDACTED]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
      .replace(/\(?[\d\s]{2}\)?\s?[\d\s]{4,5}-?[\d\s]{4}/g, '[PHONE_REDACTED]')
      .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD_REDACTED]');
  }

  private sanitizeOutput(output: string): string {
    return output
      .replace(/api[_-]?key\s*[:=]\s*[^\s"',}]+/gi, 'api_key: [REDACTED]')
      .replace(/token\s*[:=]\s*[^\s"',}]+/gi, 'token: [REDACTED]')
      .replace(/secret\s*[:=]\s*[^\s"',}]+/gi, 'secret: [REDACTED]')
      .replace(/password\s*[:=]\s*[^\s"',}]+/gi, 'password: [REDACTED]');
  }

  private escapeForSafeRendering(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  private calculateConfidence(report: RiskReport): number {
    let confidence = 0.9;
    
    // Reduzir confiança baseado em ameaças
    const threatWeights = {
      'low': 0.05,
      'medium': 0.15,
      'high': 0.25,
      'critical': 0.4
    };

    for (const threat of report.threats) {
      confidence -= threatWeights[threat.severity];
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }
}

/**
 * Factory para criar instância do firewall
 */
export function createSecurityFirewall(config: any): SecurityFirewall {
  const securityConfig: SecurityConfig = {
    enabled: config.security?.enabled ?? true,
    strict_mode: config.security?.strict_mode ?? false,
    max_prompt_length: config.security?.max_prompt_length ?? 50000,
    max_response_length: config.security?.max_response_length ?? 100000,
    allowed_providers: config.security?.allowed_providers ?? ['openai', 'anthropic', 'ollama', 'deepseek', 'openrouter'],
    pii_detection_enabled: config.security?.pii_detection ?? true,
    content_filtering_level: config.security?.content_filtering ?? 'moderate',
    mcp_allowlist: config.security?.mcp_allowlist ?? {
      tools: [],
      global_constraints: {
        max_file_operations: 10,
        allowed_paths: ['./src', './docs'],
        forbidden_paths: ['./node_modules', './.git'],
        max_network_requests: 5,
        allowed_domains: ['api.github.com', 'stackoverflow.com']
      }
    },
    owasp_llm_protections: config.security?.owasp_llm ?? {
      injection_detection: true,
      insecure_output_handling: true,
      training_poisoning_detection: false,
      model_dos_protection: true,
      supply_chain_vulnerabilities: true,
      sensitive_information_disclosure: true,
      insecure_plugin_design: true,
      excessive_agency: true,
      overreliance: false,
      model_theft: false
    }
  };

  return new SecurityFirewall(securityConfig);
}