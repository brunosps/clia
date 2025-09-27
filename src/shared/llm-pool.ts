/**
 * Pool de LLM com controle de concorrência e rate limiting
 * Limita a 3 operações simultâneas com intervalo de 1s entre inicializações
 */

import { makeLLM } from '../llm/provider.js';
import type { Config } from '../config.js';
import type { LLM } from '../llm/provider.js';
import { getLogger } from './logger.js';

interface LLMRequest {
  id: string;
  config: Config;
  tier: string;
  prompt: string;
  context: string;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: number;
}

interface LLMPoolStats {
  activeRequests: number;
  queuedRequests: number;
  completedRequests: number;
  failedRequests: number;
  averageResponseTime: number;
}

export class LLMPool {
  private static instance: LLMPool;
  private queue: LLMRequest[] = [];
  private activeRequests: Map<string, LLMRequest> = new Map();
  private readonly maxConcurrency = 3;
  private readonly initDelay = 1000; // 1 segundo entre inicializações
  private lastInitTime = 0;
  private stats: LLMPoolStats = {
    activeRequests: 0,
    queuedRequests: 0,
    completedRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0
  };
  private logger = getLogger();

  private constructor() {}

  static getInstance(): LLMPool {
    if (!LLMPool.instance) {
      LLMPool.instance = new LLMPool();
    }
    return LLMPool.instance;
  }

  /**
   * Executa uma requisição LLM com controle de pool
   */
  async executeRequest(
    config: Config,
    tier: string,
    prompt: string,
    context: string,
    timeout: number = 60000
  ): Promise<any> {
    const requestId = `llm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      const request: LLMRequest = {
        id: requestId,
        config,
        tier,
        prompt,
        context,
        resolve,
        reject,
        timeout
      };

      this.queue.push(request);
      this.stats.queuedRequests++;
      
      this.logger.info(`LLM request added to queue: ${context}`);
      this.logger.info(`Pool Status - Active: ${this.activeRequests.size}, Queue: ${this.queue.length}`);
      
      this.processQueue();
    });
  }

  
  /**
   * Processa a fila respeitando limites de concorrência
   */
  private async processQueue(): Promise<void> {
    if (this.queue.length === 0 || this.activeRequests.size >= this.maxConcurrency) {
      return;
    }

    // Verificar rate limiting - 1s entre inicializações
    const now = Date.now();
    const timeSinceLastInit = now - this.lastInitTime;
    
    if (timeSinceLastInit < this.initDelay && this.activeRequests.size > 0) {
      setTimeout(() => this.processQueue(), this.initDelay - timeSinceLastInit);
      return;
    }

    const request = this.queue.shift();
    if (!request) return;

    this.stats.queuedRequests--;
    this.stats.activeRequests++;
    this.activeRequests.set(request.id, request);
    this.lastInitTime = now;

    this.logger.info(`[${request.id}] Starting processing: ${request.context}`);
    
    // Executar com timeout próprio
    this.executeWithTimeout(request)
      .finally(() => {
        // Continuar processando próxima requisição após delay
        setTimeout(() => this.processQueue(), 100);
      });
  }

  /**
   * Executa requisição com timeout e cleanup
   */
  private async executeWithTimeout(request: LLMRequest): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Criar LLM para esta requisição
      const llm = await makeLLM(request.config, request.tier);
      
      // Executar com timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout ${request.timeout}ms`)), request.timeout)
      );
      
      const llmPromise = llm.chat(request.prompt);
      const response = await Promise.race([llmPromise, timeoutPromise]);
      
      if (!response || typeof response !== 'string') {
        throw new Error('Invalid LLM response');
      }

      // Parse JSON robusto
      const result = this.parseJsonRobust(response, request.context);
      
      const responseTime = Date.now() - startTime;
      this.updateStats(true, responseTime);
      
      this.logger.info(`[${request.id}] Completed in ${responseTime}ms: ${request.context}`);
      request.resolve(result);
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateStats(false, responseTime);
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${request.id}] Failed in ${responseTime}ms: ${errorMsg}`);
      
      // Retornar fallback em vez de rejeitar
      const fallback = this.createFallbackResponse(request.context);
      request.resolve(fallback);
      
    } finally {
      this.activeRequests.delete(request.id);
      this.stats.activeRequests--;
    }
  }

  /**
   * Parse JSON robusto com fallback
   */
  private parseJsonRobust(text: string, context: string): any {
    try {
      // Tentar parsing direto
      return JSON.parse(text);
    } catch (error) {
      try {
        // Tentar extrair JSON do texto
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        
        // Tentar limpar markdown
        const cleanText = text
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
        
        return JSON.parse(cleanText);
      } catch (secondError) {
        this.logger.warn(` JSON parsing falhou para ${context}, usando fallback`);
        return this.createFallbackResponse(context);
      }
    }
  }

  /**
   * Cria resposta de fallback estruturada
   */
  private createFallbackResponse(context: string): any {
    const baseResponse = {
      error: true,
      fallback: true,
      context,
      timestamp: new Date().toISOString()
    };

    // Customizar fallback baseado no contexto
    if (context.includes('Plan')) {
      return {
        ...baseResponse,
        strategy: {
          approach: 'fallback-analysis',
          steps: [
            { id: 'analyze-files', description: 'Analyze file structure and content', estimatedComplexity: 'medium' },
            { id: 'identify-issues', description: 'Identify code quality issues', estimatedComplexity: 'medium' },
            { id: 'generate-recommendations', description: 'Generate improvement recommendations', estimatedComplexity: 'low' }
          ],
          riskAssessment: { level: 'medium', factors: ['complex codebase', 'multiple technologies'] }
        },
        confidence: 0.5
      };
    }

    if (context.includes('Execute')) {
      return {
        ...baseResponse,
        batchMetadata: {
          batchId: 'fallback-batch',
          analysisTimestamp: new Date().toISOString(),
          filesAnalyzed: 0,
          executionTimeMinutes: 0,
          strategyUsed: 'fallback',
          contextSourcesUsed: []
        },
        fileAnalyses: [],
        batchSummary: {
          overallQuality: 'unknown',
          averageScore: 50,
          recommendations: ['Manual review required due to analysis failure']
        }
      };
    }

    if (context.includes('Check')) {
      return {
        ...baseResponse,
        validation: {
          planAdherence: { score: 0.5, issues: ['Analysis incomplete'] },
          outputQuality: { score: 0.5, issues: ['Fallback response'] },
          completeness: { score: 0.5, issues: ['Manual review needed'] }
        },
        overallScore: 0.5,
        decision: 'review-required',
        recommendations: ['Manual verification needed']
      };
    }

    return baseResponse;
  }

  /**
   * Atualiza estatísticas do pool
   */
  private updateStats(success: boolean, responseTime: number): void {
    if (success) {
      this.stats.completedRequests++;
    } else {
      this.stats.failedRequests++;
    }

    // Atualizar média de tempo de resposta
    const totalRequests = this.stats.completedRequests + this.stats.failedRequests;
    this.stats.averageResponseTime = 
      (this.stats.averageResponseTime * (totalRequests - 1) + responseTime) / totalRequests;
  }

  /**
   * Retorna estatísticas do pool
   */
  getStats(): LLMPoolStats {
    return {
      ...this.stats,
      activeRequests: this.activeRequests.size,
      queuedRequests: this.queue.length
    };
  }

  /**
   * Limpa o pool (útil para testes)
   */
  clear(): void {
    this.queue = [];
    this.activeRequests.clear();
    this.stats = {
      activeRequests: 0,
      queuedRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0
    };
  }
}

/**
 * Função de conveniência para usar o pool
 */
export async function executeLLMWithPool(
  config: Config,
  tier: string,
  prompt: string,
  context: string,
  timeout: number = 60000
): Promise<any> {
  const pool = LLMPool.getInstance();
  return pool.executeRequest(config, tier, prompt, context, timeout);
}