import { loadConfig, type Config } from '../config.js';
import { FileLogger, createLogger as createFileLogger, LogLevel } from './file-logger.js';

export type { LogLevel };

// Interface para coordenação com ProgressManager
export interface ProgressCoordinator {
  pause(): void;
  resume(): void;
  isActive(): boolean;
}

export interface Logger {
  debug(message: string, data?: any): Promise<void>;
  info(message: string, data?: any): Promise<void>;
  warn(message: string, data?: any): Promise<void>;
  error(message: string, data?: any): Promise<void>;

  // Debug specific methods for LLM
  llmPrompt(originalPrompt: string, refinedPrompt?: string): Promise<void>;
  llmResponse(response: string, translatedResponse?: string): Promise<void>;
  llmConversation(provider: string, model: string, prompt: string, response: string): Promise<void>;

  // Debug specific methods for RAG
  ragContext(context: string[], relevantDocs?: string[]): Promise<void>;

  // Debug specific methods for prompt refinement
  promptRefinement(original: string, refined: string, language: string): Promise<void>;

  // Convenience methods
  logStartup(component: string, details?: any): Promise<void>;
  logError(component: string, error: Error | string, metadata?: any): Promise<void>;
  logPerformance(operation: string, duration: number, metadata?: any): Promise<void>;
  logConfig(component: string, config: any): Promise<void>;
  
  // Utility methods
  flush(): Promise<void>;
  getLevel(): LogLevel;
  setLevel(level: LogLevel): void;

  // Progress coordination methods
  setProgressCoordinator(coordinator: ProgressCoordinator | null): void;
  logWithProgressCoordination(level: LogLevel, message: string, data?: any): Promise<void>;
}

class FileBasedLogger implements Logger {
  private fileLogger: FileLogger;
  private debugConfig?: Config['llm']['debug'];
  private progressCoordinator: ProgressCoordinator | null = null;

  constructor(config: Config) {
    this.fileLogger = createFileLogger(config);
    this.debugConfig = config.llm?.debug;
  }

  private formatData(data: any): string {
    if (!data) return '';
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  async debug(message: string, data?: any): Promise<void> {
    const formattedData = this.formatData(data);
    await this.fileLogger.debug(message, formattedData ? { data: formattedData } : undefined);
  }

  async info(message: string, data?: any): Promise<void> {
    const formattedData = this.formatData(data);
    await this.fileLogger.info(message, formattedData ? { data: formattedData } : undefined);
  }

  async warn(message: string, data?: any): Promise<void> {
    const formattedData = this.formatData(data);
    await this.fileLogger.warn(message, formattedData ? { data: formattedData } : undefined);
  }

  async error(message: string, data?: any): Promise<void> {
    const formattedData = this.formatData(data);
    await this.fileLogger.error(message, formattedData ? { data: formattedData } : undefined);
  }

  async llmPrompt(originalPrompt: string, refinedPrompt?: string): Promise<void> {
    if (this.debugConfig?.enabled && this.debugConfig?.showPromptRefinement) {
      const metadata = {
        originalLength: originalPrompt.length,
        originalPreview: originalPrompt.substring(0, 200),
        refinedLength: refinedPrompt?.length,
        refinedPreview: refinedPrompt?.substring(0, 200),
        wasRefined: refinedPrompt && refinedPrompt !== originalPrompt
      };
      await this.fileLogger.debug('LLM Prompt Refinement', metadata, 'LLM');
    }
  }

  async llmResponse(response: string, translatedResponse?: string): Promise<void> {
    if (this.debugConfig?.enabled && this.debugConfig?.showPromptRefinement) {
      const metadata = {
        responseLength: response.length,
        responsePreview: response.substring(0, 200),
        translatedLength: translatedResponse?.length,
        translatedPreview: translatedResponse?.substring(0, 200),
        wasTranslated: translatedResponse && translatedResponse !== response
      };
      await this.fileLogger.debug('LLM Response Translation', metadata, 'LLM');
    }
  }

  async llmConversation(provider: string, model: string, prompt: string, response: string): Promise<void> {
    if (this.debugConfig?.enabled && this.debugConfig?.showLLMConversation) {
      const metadata = {
        provider,
        model,
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 300),
        responseLength: response.length,
        responsePreview: response.substring(0, 300)
      };
      await this.fileLogger.debug('LLM Conversation', metadata, 'LLM');
    }
  }

  async ragContext(context: string[], relevantDocs?: string[]): Promise<void> {
    if (this.debugConfig?.enabled && this.debugConfig?.showRAGContext) {
      const metadata = {
        contextChunks: context.length,
        relevantDocs: relevantDocs || [],
        chunks: context.slice(0, 3).map((chunk, i) => ({
          index: i + 1,
          preview: chunk.substring(0, 150)
        }))
      };
      await this.fileLogger.debug('RAG Context', metadata, 'RAG');
    }
  }

  async promptRefinement(original: string, refined: string, language: string): Promise<void> {
    if (this.debugConfig?.enabled && this.debugConfig?.showPromptRefinement) {
      const metadata = {
        language,
        originalLength: original.length,
        originalPreview: original.substring(0, 200),
        refinedLength: refined.length,
        refinedPreview: refined.substring(0, 200)
      };
      await this.fileLogger.debug('Prompt Refinement', metadata, 'REFINEMENT');
    }
  }

  async logStartup(component: string, details?: any): Promise<void> {
    await this.fileLogger.logStartup(component, details);
  }

  async logError(component: string, error: Error | string, metadata?: any): Promise<void> {
    await this.fileLogger.logError(component, error, metadata);
  }

  async logPerformance(operation: string, duration: number, metadata?: any): Promise<void> {
    await this.fileLogger.logPerformance(operation, duration, metadata);
  }

  async logConfig(component: string, config: any): Promise<void> {
    await this.fileLogger.logConfig(component, config);
  }

  async flush(): Promise<void> {
    await this.fileLogger.flush();
  }

  getLevel(): LogLevel {
    return this.fileLogger.getLevel();
  }

  setLevel(level: LogLevel): void {
    this.fileLogger.setLevel(level);
  }

  /**
   * Define o coordinator de progresso para coordenação de UI
   */
  setProgressCoordinator(coordinator: ProgressCoordinator | null): void {
    this.progressCoordinator = coordinator;
  }

  /**
   * Log com coordenação de progress - pausa progress bars temporariamente
   */
  async logWithProgressCoordination(level: LogLevel, message: string, data?: any): Promise<void> {
    const wasProgressActive = this.progressCoordinator?.isActive() || false;
    
    if (wasProgressActive) {
      this.progressCoordinator?.pause();
      // Pequeno delay para garantir que o terminal foi limpo
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
      switch (level) {
        case 'debug':
          await this.debug(message, data);
          break;
        case 'info':
          await this.info(message, data);
          break;
        case 'warn':
          await this.warn(message, data);
          break;
        case 'error':
          await this.error(message, data);
          break;
      }
    } finally {
      if (wasProgressActive) {
        // Outro pequeno delay antes de retomar
        await new Promise(resolve => setTimeout(resolve, 50));
        this.progressCoordinator?.resume();
      }
    }
  }
}

// Factory function to create logger based on configuration
export function createLogger(config: Config): Logger {
  return new FileBasedLogger(config);
}

// Convenience export for singleton logger
let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  // Always create a fresh logger to ensure latest config is used
  loggerInstance = createLogger(loadConfig());
  return loggerInstance;
}

export function setLogger(logger: Logger): void {
  loggerInstance = logger;
}
