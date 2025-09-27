/**
 * Progress Manager para CLIA v0.2.1
 * Sistema centralizado para gerenciar progress bars e spinners em todos os comandos
 */

import cliProgress from 'cli-progress';
import ora, { Ora } from 'ora';
import { getLogger, type ProgressCoordinator } from './logger.js';

export type ProgressType = 'spinner' | 'bar' | 'multi-bar' | 'silent';

export interface ProgressStep {
  id: string;
  name: string;
  total?: number;
  current?: number;
  status?: 'pending' | 'running' | 'completed' | 'error';
}

export interface ProgressConfig {
  type: ProgressType;
  title?: string;
  steps?: ProgressStep[];
  silent?: boolean;
  showTime?: boolean;
}

export class ProgressManager implements ProgressCoordinator {
  private spinner: Ora | null = null;
  private singleBar: cliProgress.SingleBar | null = null;
  private multiBar: cliProgress.MultiBar | null = null;
  private stepBars: Map<string, cliProgress.SingleBar> = new Map();
  private config: ProgressConfig;
  private logger = getLogger();
  private startTime: number = Date.now();
  private activeState: boolean = false;
  private isPaused: boolean = false;
  private pausedState: any = null;

  constructor(config: ProgressConfig) {
    this.config = {
      silent: false,
      showTime: true,
      ...config
    };
    
    // Registrar este ProgressManager como coordinator do logger
    this.logger.setProgressCoordinator(this);
  }

  /**
   * Inicializa o progress manager baseado na configuração
   */
  start(title?: string): void {
    if (this.config.silent) return;
    
    this.startTime = Date.now();
    this.activeState = true;
    const displayTitle = title || this.config.title || 'Processing...';

    switch (this.config.type) {
      case 'spinner':
        this.startSpinner(displayTitle);
        break;
      case 'bar':
        this.startSingleBar(displayTitle);
        break;
      case 'multi-bar':
        this.startMultiBar(displayTitle);
        break;
      case 'silent':
        // Log apenas início da operação
        this.logger.info(`Starting ${displayTitle}`);
        break;
    }
  }

  /**
   * Atualiza o progresso - funciona para todos os tipos
   */
  update(step: Partial<ProgressStep> | string | number): void {
    if (this.config.silent || !this.activeState) return;

    if (typeof step === 'string') {
      // Update spinner text or log progress
      if (this.spinner) {
        this.spinner.text = step;
      } else {
        this.logger.info(`Progress: ${step}`);
      }
    } else if (typeof step === 'number') {
      // Update single bar progress
      if (this.singleBar) {
        this.singleBar.update(step);
      }
    } else {
      // Update specific step
      const stepId = step.id;
      if (!stepId) return;

      if (this.multiBar && this.stepBars.has(stepId)) {
        const bar = this.stepBars.get(stepId)!;
        if (step.current !== undefined) {
          bar.update(step.current);
        }
        if (step.status === 'completed') {
          bar.update(step.total || 100);
        }
      } else if (this.spinner) {
        this.spinner.text = step.name || stepId;
      }
    }
  }

  /**
   * Adiciona uma nova etapa (para multi-bar)
   */
  addStep(step: ProgressStep): void {
    if (this.config.silent || !this.activeState) return;

    if (this.multiBar) {
      const bar = this.multiBar.create(step.total || 100, step.current || 0, {
        name: step.name,
        status: step.status || 'pending'
      });
      this.stepBars.set(step.id, bar);
    }
  }

  /**
   * Marca uma etapa como completada
   */
  completeStep(stepId: string, message?: string): void {
    if (this.config.silent || !this.activeState) return;

    if (this.multiBar && this.stepBars.has(stepId)) {
      const bar = this.stepBars.get(stepId)!;
      bar.update(bar.getTotal());
      // Atualizar status na payload
      bar.update(bar.getTotal(), { status: 'completed' });
    } else if (this.spinner) {
      this.spinner.succeed(message || `Step ${stepId} completed`);
      // Reiniciar spinner para próxima etapa se ainda ativo
      if (this.activeState) {
        this.spinner = ora().start();
      }
    } else {
      this.logger.info(`Completed: ${message || `Step ${stepId} completed`}`);
    }
  }

  /**
   * Marca uma etapa como falhada
   */
  failStep(stepId: string, error?: string): void {
    if (this.config.silent || !this.activeState) return;

    if (this.multiBar && this.stepBars.has(stepId)) {
      const bar = this.stepBars.get(stepId)!;
      // Não podemos obter o valor atual, então mantemos onde está
      bar.update(0, { status: 'error' });
    } else if (this.spinner) {
      this.spinner.fail(error || `Step ${stepId} failed`);
      // Reiniciar spinner se ainda ativo
      if (this.activeState) {
        this.spinner = ora().start();
      }
    } else {
      this.logger.error(`Failed: ${error || `Step ${stepId} failed`}`);
    }
  }

  /**
   * Finaliza o progress com sucesso
   */
  succeed(message?: string): void {
    if (this.config.silent) {
      if (message) {
        this.logger.info(`✅ ${message}`);
      }
      return;
    }

    if (!this.isActive) return;

    const duration = this.config.showTime ? ` (${this.getDuration()})` : '';
    const finalMessage = message ? `${message}${duration}` : `Completed${duration}`;

    if (this.spinner) {
      this.spinner.succeed(finalMessage);
    } else if (this.singleBar) {
      this.singleBar.update(this.singleBar.getTotal());
      this.singleBar.stop();
      this.logger.info(`✅ ${finalMessage}`);
    } else if (this.multiBar) {
      this.multiBar.stop();
      this.logger.info(`✅ ${finalMessage}`);
    } else {
      this.logger.info(`✅ ${finalMessage}`);
    }

    this.cleanup();
  }

  /**
   * Finaliza o progress com falha
   */
  fail(message?: string): void {
    if (this.config.silent) {
      if (message) {
        this.logger.error(`❌ ${message}`);
      }
      return;
    }

    if (!this.isActive) return;

    const duration = this.config.showTime ? ` (${this.getDuration()})` : '';
    const finalMessage = message ? `${message}${duration}` : `Failed${duration}`;

    if (this.spinner) {
      this.spinner.fail(finalMessage);
    } else if (this.singleBar) {
      this.singleBar.stop();
      this.logger.error(`❌ ${finalMessage}`);
    } else if (this.multiBar) {
      this.multiBar.stop();
      this.logger.error(`❌ ${finalMessage}`);
    } else {
      this.logger.error(`❌ ${finalMessage}`);
    }

    this.cleanup();
  }

  /**
   * Para o progress sem indicar sucesso ou falha
   */
  stop(): void {
    if (this.config.silent || !this.isActive) return;

    if (this.spinner) {
      this.spinner.stop();
    } else if (this.singleBar) {
      this.singleBar.stop();
    } else if (this.multiBar) {
      this.multiBar.stop();
    }

    this.cleanup();
  }

  /**
   * Para coordenação com Logger - pausa progress temporariamente
   */
  pause(): void {
    if (!this.activeState || this.isPaused) return;
    
    this.isPaused = true;
    
    if (this.spinner) {
      this.pausedState = { text: this.spinner.text, isSpinning: this.spinner.isSpinning };
      this.spinner.stop();
    } else if (this.singleBar) {
      // cli-progress não tem pause, mas podemos parar temporariamente
      this.singleBar.stop();
    } else if (this.multiBar) {
      this.multiBar.stop();
    }
  }

  /**
   * Para coordenação com Logger - retoma progress após pausa
   */
  resume(): void {
    if (!this.activeState || !this.isPaused) return;
    
    this.isPaused = false;
    
    if (this.spinner && this.pausedState) {
      this.spinner = ora({
        text: this.pausedState.text,
        spinner: 'dots',
        color: 'cyan'
      });
      if (this.pausedState.isSpinning) {
        this.spinner.start();
      }
      this.pausedState = null;
    } else if (this.singleBar) {
      // Recriar single bar (cli-progress não tem resume)
      this.startSingleBar(this.config.title || 'Processing...');
    } else if (this.multiBar) {
      // Recriar multi bar
      this.startMultiBar(this.config.title || 'Processing...');
    }
  }

  /**
   * Implementação de ProgressCoordinator interface
   */
  isActive(): boolean {
    return this.activeState && !this.isPaused;
  }

  /**
   * Método existente renomeado para evitar conflito
   */
  isRunning(): boolean {
    return this.activeState;
  }

  /**
   * Cria um spinner simples para operações rápidas
   */
  private startSpinner(title: string): void {
    this.spinner = ora({
      text: title,
      spinner: 'dots',
      color: 'cyan'
    }).start();
  }

  /**
   * Cria uma barra de progresso única
   */
  private startSingleBar(title: string): void {
    this.singleBar = new cliProgress.SingleBar({
      format: `${title} |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false
    });
    
    // Iniciar com 0 de 100 por padrão, pode ser atualizado depois
    this.singleBar.start(100, 0);
  }

  /**
   * Cria múltiplas barras de progresso para diferentes etapas
   */
  private startMultiBar(title: string): void {
    this.logger.info(`Starting ${title}`);
    
    this.multiBar = new cliProgress.MultiBar({
      format: ' {name} |{bar}| {percentage}% | {value}/{total} | {status}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false
    }, cliProgress.Presets.shades_grey);

    // Adicionar steps pré-configurados se existem
    if (this.config.steps) {
      for (const step of this.config.steps) {
        this.addStep(step);
      }
    }
  }

  /**
   * Calcula duração formatada
   */
  private getDuration(): string {
    const duration = Date.now() - this.startTime;
    if (duration < 1000) {
      return `${duration}ms`;
    } else if (duration < 60000) {
      return `${(duration / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
  }

  /**
   * Limpa recursos e marca como inativo
   */
  private cleanup(): void {
    this.activeState = false;
    this.spinner = null;
    this.singleBar = null;
    this.multiBar = null;
    this.stepBars.clear();
  }

  /**
   * Factory method para diferentes tipos de progress
   */
  static createSpinner(title: string, silent: boolean = false): ProgressManager {
    return new ProgressManager({
      type: silent ? 'silent' : 'spinner',
      title,
      silent
    });
  }

  static createBar(title: string, silent: boolean = false): ProgressManager {
    return new ProgressManager({
      type: silent ? 'silent' : 'bar',
      title,
      silent
    });
  }

  static createMultiBar(title: string, steps: ProgressStep[], silent: boolean = false): ProgressManager {
    return new ProgressManager({
      type: silent ? 'silent' : 'multi-bar',
      title,
      steps,
      silent
    });
  }

  /**
   * Cria progress manager baseado no contexto da operação
   */
  static createForCommand(commandName: string, options: any = {}): ProgressManager {
    const silent = options.silent || process.env.CLIA_SILENT === 'true';
    
    // Determinar melhor tipo baseado no comando
    switch (commandName) {
      case 'commit':
        return ProgressManager.createMultiBar('Generating commit', [
          { id: 'staging', name: 'Auto-staging files', total: 100 },
          { id: 'analysis', name: 'Analyzing changes', total: 100 },
          { id: 'pipeline', name: 'Running pipeline', total: 100 },
          { id: 'apply', name: 'Applying commit', total: 100 }
        ], silent);

      case 'analyze':
        return ProgressManager.createMultiBar('Code analysis', [
          { id: 'setup', name: 'Initializing systems', total: 100 },
          { id: 'scan', name: 'Scanning files', total: 100 },
          { id: 'batch', name: 'Processing batches', total: 100 },
          { id: 'report', name: 'Generating report', total: 100 }
        ], silent);

      case 'ask':
        return ProgressManager.createSpinner('Processing question', silent);

      case 'rag':
        if (options.subCommand === 'index') {
          return ProgressManager.createBar('Building RAG index', silent);
        } else {
          return ProgressManager.createSpinner('Querying RAG database', silent);
        }

      case 'security-scan':
        return ProgressManager.createMultiBar('Security scan', [
          { id: 'setup', name: 'Initializing scanners', total: 100 },
          { id: 'scan', name: 'Running security checks', total: 100 },
          { id: 'analysis', name: 'Analyzing results', total: 100 }
        ], silent);

      case 'stack':
        return ProgressManager.createSpinner('Detecting technology stack', silent);

      case 'install':
        return ProgressManager.createMultiBar('CLIA setup', [
          { id: 'detect', name: 'Detecting project', total: 100 },
          { id: 'config', name: 'Configuring providers', total: 100 },
          { id: 'structure', name: 'Creating structure', total: 100 },
          { id: 'validate', name: 'Validating setup', total: 100 }
        ], silent);

      default:
        return ProgressManager.createSpinner(`Running ${commandName}`, silent);
    }
  }
}

/**
 * Helper para criar progress de forma simplificada
 */
export function createProgress(
  type: ProgressType,
  title: string,
  options: Partial<ProgressConfig> = {}
): ProgressManager {
  return new ProgressManager({
    type,
    title,
    ...options
  });
}

/**
 * Progress wrapper para operações assíncronas
 */
export async function withProgress<T>(
  progressManager: ProgressManager,
  operation: (progress: ProgressManager) => Promise<T>,
  title?: string
): Promise<T> {
  try {
    progressManager.start(title);
    const result = await operation(progressManager);
    progressManager.succeed();
    return result;
  } catch (error) {
    progressManager.fail(error instanceof Error ? error.message : 'Operation failed');
    throw error;
  }
}