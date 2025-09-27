/**
 * Sistema de Pipeline Plan-Execute-Check v2.0.0
 */
import { loadConfig } from '../config.js';
import { executeLLMWithPool } from './llm-pool.js';
import { getLogger } from './logger.js';
import { PromptTemplateEngine } from './prompt-template-engine.js';
import { retrieveForFiles } from '../rag/index.js';
import { makeEmbeddings } from '../embeddings/provider.js';
import { McpClient } from '../mcp/client.js';
import { ContextTruncator } from './context-truncator.js';
import { ProgressManager } from './progress-manager.js';

export interface PipelineContext {
  command: string;
  version: string;
  input: any;
  metadata: {
    startTime: number;
    tier: 'basic' | 'default' | 'premium';
    sessionId?: string;
  };
  progress?: ProgressManager;
}

export interface PlanResult {
  strategy: {
    approach: string;
    steps: Array<{
      id: string;
      description: string;
      estimatedComplexity: 'low' | 'medium' | 'high';
    }>;
    riskAssessment: {
      level: 'low' | 'medium' | 'high';
      factors: string[];
    };
  };
  confidence: number;
}

export interface ExecuteResult {
  output: any;
  steps: Array<{
    id: string;
    status: 'completed' | 'failed';
    output?: any;
    error?: string;
    duration: number;
  }>;
  totalTokens: number;
  duration: number;
}

export interface CheckResult {
  passed: boolean;
  score: number;
  recommendation: 'accept' | 'iterate' | 'reject';
  validations: Array<{
    gate: string;
    passed: boolean;
    score: number;
    feedback: string;
  }>;
  iterationSuggestions?: string[];
}

export interface PipelineResult {
  context: PipelineContext;
  plan: PlanResult;
  execution: ExecuteResult;
  check: CheckResult;
  finalOutput: any;
  iterations: number;
  success: boolean;
}

export class PipelineEngine {
  private config: any;
  private logger: any;

  constructor() {
    this.config = loadConfig();
    this.logger = getLogger();
  }

  async execute(context: PipelineContext, maxIterations = 3): Promise<PipelineResult> {
    const startTime = Date.now();
    this.logger.info(` Iniciando pipeline ${context.command} v${context.version}`);

    // Se há progress manager, atualizar com início do pipeline
    if (context.progress) {
      context.progress.update('Starting pipeline execution...');
    }

    let iterations = 0;
    let lastResult: PipelineResult | null = null;

    while (iterations < maxIterations) {
      iterations++;
      this.logger.info(` Iteração ${iterations}/${maxIterations}`);

      // Atualizar progress para iteração atual
      if (context.progress) {
        context.progress.update(`Pipeline iteration ${iterations}/${maxIterations}`);
      }

      try {
        const plan = await this.runPlanPhase(context, lastResult);
        const execution = await this.runExecutePhase(context, plan);
        const check = await this.runCheckPhase(context, plan, execution);

        const result: PipelineResult = {
          context,
          plan,
          execution,
          check,
          finalOutput: execution.output,
          iterations,
          success: check.passed && check.recommendation === 'accept'
        };

        if (result.success) {
          this.logger.info(` Pipeline concluído na iteração ${iterations}`);
          if (context.progress) {
            context.progress.completeStep('pipeline', `Pipeline completed in ${iterations} iterations`);
          }
          return result;
        }

        if (check.recommendation === 'reject') {
          this.logger.error(` Pipeline rejeitado na iteração ${iterations}`);
          if (context.progress) {
            context.progress.update(`Pipeline rejected in iteration ${iterations}`);
          }
          return { ...result, success: false };
        }

        if (check.recommendation === 'iterate' && iterations < maxIterations) {
          this.logger.warn(` Iteração necessária (${iterations}/${maxIterations})`);
          if (context.progress) {
            context.progress.update(`Iteration required (${iterations}/${maxIterations})`);
          }
          lastResult = result;
          // Avoid circular reference by passing only essential data
          context.input = { 
            ...context.input, 
            previousResult: {
              finalOutput: result.finalOutput,
              execution: {
                output: result.execution?.output
              },
              check: {
                score: result.check?.score,
                recommendation: result.check?.recommendation
              }
            }
          };
          continue;
        }

        const finalSuccess = check.score > 0.7;
        if (context.progress) {
          if (finalSuccess) {
            context.progress.update(`Pipeline completed successfully (score: ${check.score.toFixed(2)})`);
          } else {
            context.progress.update(`Pipeline completed with low score (${check.score.toFixed(2)})`);
          }
        }
        return { ...result, success: finalSuccess };

      } catch (error) {
        if (context.progress) {
          context.progress.update(`Pipeline error in iteration ${iterations}: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        if (iterations === maxIterations) {
          throw error;
        }
        continue;
      }
    }

    const errorMsg = `Pipeline falhou após ${maxIterations} iterações`;
    if (context.progress) {
      context.progress.update(`Pipeline failed after ${maxIterations} iterations`);
    }
    throw new Error(errorMsg);
  }

  private async runPlanPhase(context: PipelineContext, previousResult?: PipelineResult | null): Promise<PlanResult> {
    this.logger.info(` Executing PLAN phase`);
    
    // Progress callback granular
    if (context.progress) {
      context.progress.update('Planning phase: Collecting context...');
    }

    // Gather context first
    const { ragContext, mcpContext, securityContext, stackContext } = await this.enrichContextWithRagAndMcp(context, 'Planning phase');
    
    if (context.progress) {
      context.progress.update('Planning phase: Building prompt...');
    }

    // Build the prompt for the planning phase
    const planPrompt = `Como assistente especializado em ${context.command}, analise o contexto e crie um plano estruturado.

Contexto RAG: ${ragContext}
Contexto MCP: ${mcpContext}
Contexto de Segurança: ${securityContext}
Contexto de Stack: ${stackContext}
Resultado Anterior: ${previousResult?.finalOutput || 'N/A'}

Input: ${JSON.stringify(context.input)}

Retorne APENAS um JSON com a seguinte estrutura:
{
  "strategy": {
    "approach": "descrição da abordagem",
    "steps": [
      {
        "id": "step-1",
        "description": "descrição do passo",
        "estimatedComplexity": "low|medium|high"
      }
    ],
    "riskAssessment": {
      "level": "low|medium|high",
      "factors": ["fator1", "fator2"]
    }
  },
  "confidence": 0.85
}`;

    if (context.progress) {
      context.progress.update('Planning phase: Calling LLM...');
    }

    // Call LLM for planning
    const contextStr = `RAG: ${ragContext}\nMCP: ${mcpContext}\nSecurity: ${securityContext}\nStack: ${stackContext}`;
    const planResponse = await executeLLMWithPool(
      this.config,
      context.metadata.tier,
      planPrompt,
      contextStr,
      60000
    );

    if (context.progress) {
      context.progress.update('Planning phase: Processing response...');
    }

    let planResult: PlanResult;
    try {
      const parsed = JSON.parse(planResponse);
      planResult = {
        strategy: parsed.strategy,
        confidence: parsed.confidence || 0.8
      };
    } catch (error) {
      // Fallback se o JSON não foi válido
      planResult = {
        strategy: {
          approach: "Plan generation with fallback approach",
          steps: [
            {
              id: "step-1",
              description: "Execute command with available context",
              estimatedComplexity: "medium" as const
            }
          ],
          riskAssessment: {
            level: "medium" as const,
            factors: ["JSON parsing error in plan phase"]
          }
        },
        confidence: 0.7
      };
    }

    this.logger.info(` Fase PLAN concluída`);
    
    if (context.progress) {
      context.progress.update('Planning phase: Complete');
    }

    return planResult;
  }

  private async enrichContextWithRagAndMcp(context: PipelineContext, phasePrefix?: string): Promise<{
    ragContext: string;
    mcpContext: string;
    securityContext: string;
    stackContext: string;
  }> {
    let ragContext = '';
    let mcpContext = '';
    let securityContext = '';
    let stackContext = '';

    const phase = phasePrefix || 'Context enrichment';

    try {
      // RAG Context
      if (context.input?.filePaths || context.input?.diffAnalysis?.files) {
        if (context.progress) {
          context.progress.update(`${phase}: Collecting RAG context...`);
        }

        const filePaths = context.input.filePaths || 
                         context.input.diffAnalysis?.files?.map((f: any) => f.file || f.path) || 
                         [];
        
        if (filePaths.length > 0) {
          try {
            // Carregar configuração para criar embedder
            const config = await loadConfig();
            const embedder = await makeEmbeddings(config.project.rag, config);
            
            const ragResults = await retrieveForFiles(
              `${context.command}: ${JSON.stringify(context.input).substring(0, 200)}`,
              filePaths,
              6,
              embedder
            );
            
            if (ragResults.length > 0) {
              ragContext = ragResults.map((content: string, index: number) => 
                `### RAG Context ${index + 1}\n${content}`
              ).join('\n\n');
              
              this.logger.info(` RAG: ${ragResults.length} contextos coletados`);
            }
          } catch (embedError) {
            // Fallback para busca sem embeddings
            this.logger.warn(' Falha ao carregar embeddings, usando busca por arquivo:', embedError);
            const ragResults = await retrieveForFiles(
              `${context.command}: ${JSON.stringify(context.input).substring(0, 200)}`,
              filePaths,
              6
            );
            
            if (ragResults.length > 0) {
              ragContext = ragResults.map((content: string, index: number) => 
                `### RAG Context ${index + 1}\n${content}`
              ).join('\n\n');
              
              this.logger.info(` RAG: ${ragResults.length} contextos coletados`);
            }
          }
        }
      }

      // MCP Context
      if (this.config.mcp?.enabled) {
        if (context.progress) {
          context.progress.update(`${phase}: Collecting MCP context...`);
        }

        const mcpClient = McpClient.fromConfig();
        const mcpData: any = {};

        if (context.command === 'commit') {
          try {
            const gitStatus = await mcpClient.gitStatus();
            mcpData.gitStatus = gitStatus;
          } catch (error) {
            this.logger.warn(' MCP Git erro:', error);
          }
        }

        if (context.command === 'analyze' || context.command === 'review') {
          try {
            const stackInfo = await mcpClient.detectStack();
            mcpData.stackInfo = stackInfo;
            
            // For review command, also get Git status for more context
            if (context.command === 'review') {
              try {
                const gitStatus = await mcpClient.gitStatus();
                mcpData.gitStatus = gitStatus;
              } catch (gitError) {
                this.logger.warn(' MCP Git erro durante review:', gitError);
              }
            }
          } catch (error) {
            this.logger.warn(' MCP Stack erro:', error);
          }
        }

        if (context.command === 'security-scan') {
          try {
            const gitStatus = await mcpClient.gitStatus();
            const stackInfo = await mcpClient.detectStack();
            mcpData.gitStatus = gitStatus;
            mcpData.stackInfo = stackInfo;
          } catch (error) {
            this.logger.warn(' MCP Security erro:', error);
          }
        }

        if (context.command === 'stack-analysis') {
          try {
            const stackInfo = await mcpClient.detectStack();
            mcpData.stackInfo = stackInfo;
          } catch (error) {
            this.logger.warn(' MCP Stack Analysis erro:', error);
          }
        }

        if (Object.keys(mcpData).length > 0) {
          mcpContext = JSON.stringify(mcpData, null, 2);
          this.logger.info(` MCP: ${Object.keys(mcpData).length} fontes coletadas`);
        }
      }

      if (context.progress) {
        context.progress.update(`${phase}: Processing security & stack context...`);
      }

      // Security Context - extrair do input se existir
      if (context.input?.securityContext) {
        securityContext = context.input.securityContext;
      }

      // Stack Context - extrair do input se existir ou coletar via MCP
      if (context.input?.stackContext) {
        stackContext = context.input.stackContext;
      } else if (this.config.mcp?.enabled) {
        try {
          const mcpClient = McpClient.fromConfig();
          const stackInfo = await mcpClient.detectStack();
          if (stackInfo) {
            stackContext = JSON.stringify(stackInfo, null, 2);
          }
        } catch (error) {
          this.logger.warn(' MCP Stack erro:', error);
        }
      }

    } catch (error) {
      this.logger.warn(' Error enriching context:', error);
    }

    return { ragContext, mcpContext, securityContext, stackContext };
  }

  private async runExecutePhase(context: PipelineContext, plan: PlanResult): Promise<ExecuteResult> {
    this.logger.info(' Executing EXECUTE phase');

    // Atualizar progress para fase EXECUTE
    if (context.progress) {
      context.progress.update('Execute phase: Starting execution...');
    }

    const startTime = Date.now();
    const executedSteps: Array<{
      id: string;
      status: 'completed' | 'failed';
      output?: any;
      error?: string;
      duration: number;
    }> = [];

    if (context.progress) {
      context.progress.update('Execute phase: Enriching context...');
    }

    // Enriquecer contexto com RAG e MCP para execute também
    const enrichedContext = await this.enrichContextWithRagAndMcp(context, 'Execute phase');

    if (context.progress) {
      context.progress.update(`Execute phase: Processing ${plan.strategy.steps.length} steps...`);
    }

    // Executar cada step do plano individualmente
    for (let i = 0; i < plan.strategy.steps.length; i++) {
      const currentStep = plan.strategy.steps[i];
      const stepStartTime = Date.now();
      
      this.logger.info(` Executing step: ${currentStep.id} (${i + 1}/${plan.strategy.steps.length})`);

      // Atualizar progress para step atual
      if (context.progress) {
        context.progress.update(`Execute phase: Step ${i + 1}/${plan.strategy.steps.length} - ${currentStep.description.substring(0, 50)}...`);
      }

      try {
        if (context.progress) {
          context.progress.update(`Execute phase: Step ${i + 1}/${plan.strategy.steps.length} - Building prompt...`);
        }

        // Truncar contextos para EXECUTE phase
        const planText = ContextTruncator.truncateText(JSON.stringify(plan, null, 2), 5000);
        const previousStepsText = ContextTruncator.truncateText(JSON.stringify(executedSteps, null, 2), 8000);
        const inputText = ContextTruncator.truncateInputJson(context.input, 15000);
        const ragText = ContextTruncator.truncateRagContext(enrichedContext.ragContext || '', 10000);
        
        const variables = {
          command: context.command,
          input: inputText.text,
          plan: planText.text,
          step: JSON.stringify(currentStep, null, 2),
          previousSteps: previousStepsText.text,
          currentOutput: executedSteps.length > 0 ? JSON.stringify(executedSteps[executedSteps.length - 1].output, null, 2) : '{}',
          tier: context.metadata.tier,
          ragContext: ragText.text || 'No RAG context available',
          mcpContext: ContextTruncator.truncateText(enrichedContext.mcpContext || '', 3000).text || 'No MCP context available',
          securityContext: ContextTruncator.truncateSecurityContext(enrichedContext.securityContext || '', 5000).text || 'No security context available',
          stackContext: ContextTruncator.truncateText(enrichedContext.stackContext || '', 2000).text || 'No stack context available'
        };

        const prompt = PromptTemplateEngine.renderPrompt(
          `${context.command}/execute`, 
          variables, 
          context.version
        );

        if (context.progress) {
          context.progress.update(`Execute phase: Step ${i + 1}/${plan.strategy.steps.length} - Calling LLM...`);
        }

        const response = await executeLLMWithPool(this.config, context.metadata.tier, prompt, `${context.command}-execute-step-${currentStep.id}`);
        
        if (context.progress) {
          context.progress.update(`Execute phase: Step ${i + 1}/${plan.strategy.steps.length} - Processing response...`);
        }

        const stepResult = this.parseJsonResponse(response, 'StepExecuteResult') as any;

        const stepDuration = Date.now() - stepStartTime;
        executedSteps.push({
          id: currentStep.id,
          status: 'completed',
          output: stepResult.output || stepResult,
          duration: stepDuration
        });

        this.logger.info(` Step concluído: ${currentStep.id} (${stepDuration}ms)`);

        if (context.progress) {
          context.progress.update(`Execute phase: Step ${i + 1}/${plan.strategy.steps.length} completed (${stepDuration}ms)`);
        }

      } catch (error) {
        const stepDuration = Date.now() - stepStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        executedSteps.push({
          id: currentStep.id,
          status: 'failed',
          error: errorMessage,
          duration: stepDuration
        });

        this.logger.error(`Step failed: ${currentStep.id} - ${errorMessage}`);
        
        if (context.progress) {
          context.progress.update(`Execute phase: Step ${i + 1}/${plan.strategy.steps.length} failed - ${errorMessage.substring(0, 50)}...`);
        }
        
        // Se é um step crítico, interromper execução
        if (currentStep.estimatedComplexity === 'high') {
          if (context.progress) {
            context.progress.update(`Execute phase: Critical step ${currentStep.id} failed - ${errorMessage.substring(0, 50)}...`);
          }
          throw new Error(`Step crítico falhou: ${currentStep.id} - ${errorMessage}`);
        }
      }
    }

    if (context.progress) {
      context.progress.update('Execute phase: Consolidating outputs...');
    }

    // Consolidar outputs de todos os steps
    const consolidatedOutput = executedSteps.reduce((acc, step) => {
      if (step.output && step.status === 'completed') {
        return { ...acc, [step.id]: step.output };
      }
      return acc;
    }, {});

    // Completar etapa de execução
    if (context.progress) {
      const successfulSteps = executedSteps.filter(s => s.status === 'completed').length;
      context.progress.update(`Execute phase: Complete - ${successfulSteps}/${executedSteps.length} steps successful`);
    }

    return {
      output: consolidatedOutput,
      steps: executedSteps,
      totalTokens: 0, // TODO: calcular tokens corretamente
      duration: Date.now() - startTime
    };
  }

  private async runCheckPhase(context: PipelineContext, plan: PlanResult, execution: ExecuteResult): Promise<CheckResult> {
    this.logger.info(' Executing CHECK phase');

    // Atualizar progress para fase CHECK
    if (context.progress) {
      context.progress.update('Check phase: Starting validation...');
    }

    if (context.progress) {
      context.progress.update('Check phase: Enriching context...');
    }

    // Enriquecer contexto com RAG e MCP para check também
    const enrichedContext = await this.enrichContextWithRagAndMcp(context, 'Check phase');

    if (context.progress) {
      context.progress.update('Check phase: Defining quality gates...');
    }

    // Definir quality gates baseados no comando e tier
    const qualityGates = this.getQualityGatesForCommand(context.command, context.metadata.tier);

    if (context.progress) {
      context.progress.update('Check phase: Building validation prompt...');
    }

    // Truncar contextos para CHECK phase
    const inputText = ContextTruncator.truncateInputJson(context.input, 10000);
    const planText = ContextTruncator.truncateText(JSON.stringify(plan, null, 2), 5000);
    const executionText = ContextTruncator.truncateText(JSON.stringify(execution, null, 2), 15000);
    const ragText = ContextTruncator.truncateRagContext(enrichedContext.ragContext || '', 8000);
    
    const variables = {
      command: context.command,
      input: inputText.text,
      plan: planText.text,
      execution: executionText.text,
      qualityGates: JSON.stringify(qualityGates, null, 2),
      tier: context.metadata.tier,
      ragContext: ragText.text || 'No RAG context available',
      mcpContext: ContextTruncator.truncateText(enrichedContext.mcpContext || '', 3000).text || 'No MCP context available',
      securityContext: ContextTruncator.truncateSecurityContext(enrichedContext.securityContext || '', 5000).text || 'No security context available',
      stackContext: ContextTruncator.truncateText(enrichedContext.stackContext || '', 2000).text || 'No stack context available'
    };

    const prompt = PromptTemplateEngine.renderPrompt(
      `${context.command}/check`, 
      variables, 
      context.version
    );

    if (context.progress) {
      context.progress.update('Check phase: Calling LLM for validation...');
    }

    const response = await executeLLMWithPool(this.config, context.metadata.tier, prompt, `${context.command}-check`);
    
    if (context.progress) {
      context.progress.update('Check phase: Processing validation results...');
    }

    const result = this.parseJsonResponse<CheckResult>(response, 'CheckResult');

    this.logger.info(' Validação concluída', {
      passed: result.passed,
      score: result.score,
      recommendation: result.recommendation
    });

    // Completar etapa de verificação
    if (context.progress) {
      context.progress.update(`Check phase: Complete - Score: ${result.score}, Recommendation: ${result.recommendation}`);
    }

    return result;
  }

  private getQualityGatesForCommand(command: string, tier: string): any {
    const commonGates = [
      {
        name: 'completeness',
        weight: 0.3,
        criteria: ['all required analyses completed', 'no missing critical information']
      },
      {
        name: 'accuracy',
        weight: 0.25,
        criteria: ['technically correct information', 'precise identification of technologies']
      },
      {
        name: 'actionability',
        weight: 0.25,
        criteria: ['clear actionable recommendations', 'prioritized suggestions']
      },
      {
        name: 'documentation',
        weight: 0.2,
        criteria: ['well-structured output', 'clear for stakeholders']
      }
    ];

    // Gates específicos por comando
    const commandSpecificGates: any = {
      inspect: [
        ...commonGates,
        {
          name: 'depth',
          weight: 0.15,
          criteria: ['architectural insights', 'implementation quality analysis']
        }
      ],
      review: [
        ...commonGates,
        {
          name: 'security',
          weight: 0.15,
          criteria: ['security considerations', 'vulnerability assessment']
        }
      ],
      'security-scan': [
        ...commonGates,
        {
          name: 'risk_assessment',
          weight: 0.2,
          criteria: ['comprehensive risk analysis', 'mitigation strategies']
        }
      ]
    };

    return {
      gates: commandSpecificGates[command] || commonGates,
      tier,
      minimumScore: tier === 'premium' ? 0.85 : tier === 'default' ? 0.75 : 0.65
    };
  }

  private parseJsonResponse<T>(response: any, expectedType: string): T {
    // Se já é um objeto, retornar diretamente (resultado do LLM pool)
    if (typeof response === 'object' && response !== null) {
      this.logger.info(` Objeto JSON já parseado para ${expectedType}`);
      return response as T;
    }
    
    // Se é string, fazer parsing tradicional
    if (typeof response !== 'string') {
      this.logger.error(` Invalid response for ${expectedType}:`, typeof response);
      throw new Error(`Resposta deve ser string ou objeto para ${expectedType}`);
    }
    
    this.logger.info(` Analyzing LLM response for ${expectedType}`, {
      responseLength: response.length,
      preview: response.substring(0, 200) + '...'
    });
    
    try {
      const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n\s*```/) || 
                       response.match(/{[\s\S]*}/);
      
      if (!jsonMatch) {
        this.logger.error(` Resposta sem JSON para ${expectedType}:`, response);
        throw new Error(`Resposta não contém JSON válido para ${expectedType}`);
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      
      this.logger.info(` JSON parseado para ${expectedType}`);
      return parsed;
      
    } catch (error) {
      this.logger.error(` Error parsing JSON for ${expectedType}:`, {
        error: error instanceof Error ? error.message : String(error),
        response: response.substring(0, 500)
      });
      throw new Error(`Error parsing ${expectedType}: ${error}`);
    }
  }
}

export async function runPipeline(
  command: string, 
  version: string, 
  input: any, 
  options: {
    tier?: 'basic' | 'default' | 'premium';
    maxIterations?: number;
    sessionId?: string;
    progress?: ProgressManager;
  } = {}
): Promise<PipelineResult> {
  const context: PipelineContext = {
    command,
    version,
    input,
    metadata: {
      startTime: Date.now(),
      tier: options.tier || 'default',
      sessionId: options.sessionId || `${command}-${Date.now()}`
    },
    progress: options.progress
  };

  const engine = new PipelineEngine();
  return engine.execute(context, options.maxIterations || 3);
}