/**
 * File-based logging system with rotation support
 */

import fs from 'fs';
import path from 'path';
import { Config } from '../config.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: any;
  context?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  maxFileSize: number; // in MB
  maxFiles: number;
  datePattern: string;
  enableConsole: boolean;
}

export class FileLogger {
  private static instance: FileLogger;
  private config: LoggerConfig;
  private logDir: string;
  private currentLogFile: string;
  private logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  private constructor(config: LoggerConfig, baseDir: string = process.cwd()) {
    this.config = config;
    this.logDir = path.join(baseDir, '.clia', 'logs');
    this.ensureLogDirectory();
    this.currentLogFile = this.getCurrentLogFileName();
  }

  static getInstance(config?: Config): FileLogger {
    // Always recreate to ensure fresh configuration
    const loggerConfig: LoggerConfig = {
      level: config?.logging?.level || 'info',
      maxFileSize: config?.logging?.file?.maxSize
        ? parseInt(config.logging.file.maxSize.replace('MB', ''))
        : 10,
      maxFiles: config?.logging?.file?.maxFiles || 10,
      datePattern: 'YYYY-MM-DD', // Fixed pattern for now
      enableConsole: config?.logging?.enableConsole ?? true,
    };
    FileLogger.instance = new FileLogger(loggerConfig);
    return FileLogger.instance;
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getCurrentLogFileName(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `clia-${date}.log`);
  }

  private shouldLog(level: LogLevel): boolean {
    return this.logLevels[level] <= this.logLevels[this.config.level];
  }

  private formatLogEntry(entry: LogEntry): string {
    const metadataStr = entry.metadata
      ? ` ${JSON.stringify(entry.metadata)}`
      : '';
    const contextStr = entry.context ? ` [${entry.context}]` : '';
    return `[${entry.timestamp}] ${entry.level.toUpperCase()}${contextStr}: ${entry.message}${metadataStr}\n`;
  }

  private async writeToFile(content: string): Promise<void> {
    try {
      // Check if file needs rotation
      await this.rotateIfNeeded();

      // Append to current log file
      await fs.promises.appendFile(this.currentLogFile, content, 'utf8');
    } catch (error) {
      // Fallback to console if file writing fails
      logger.error('Failed to write to log file:', error);
      logger.info(content.trim());
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      // Update current log file name (for date rotation)
      const newLogFile = this.getCurrentLogFileName();

      if (newLogFile !== this.currentLogFile) {
        this.currentLogFile = newLogFile;
        return;
      }

      // Check file size for size-based rotation
      if (fs.existsSync(this.currentLogFile)) {
        const stats = await fs.promises.stat(this.currentLogFile);
        const fileSizeMB = stats.size / (1024 * 1024);
        if (fileSizeMB >= this.config.maxFileSize) {
          await this.performSizeRotation();
        }
      }
    } catch (error) {
      logger.error('Log rotation failed:', error);
    }
  }

  private async performSizeRotation(): Promise<void> {
    const baseFileName = this.currentLogFile.replace('.log', '');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedFileName = `${baseFileName}-${timestamp}.log`;

    // Rename current file
    await fs.promises.rename(this.currentLogFile, rotatedFileName);

    // Clean up old files
    await this.cleanupOldFiles();
  }

  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.logDir);
      const logFiles = files
        .filter((file) => file.startsWith('clia-') && file.endsWith('.log'))
        .map((file) => ({
          name: file,
          path: path.join(this.logDir, file),
          stats: fs.statSync(path.join(this.logDir, file)),
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

      // Keep only maxFiles most recent files
      if (logFiles.length > this.config.maxFiles) {
        const filesToDelete = logFiles.slice(this.config.maxFiles);
        for (const file of filesToDelete) {
          await fs.promises.unlink(file.path);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup old log files:', error);
    }
  }

  private async log(
    level: LogLevel,
    message: string,
    metadata?: any,
    context?: string
  ): Promise<void> {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
      context,
    };

    const formattedEntry = this.formatLogEntry(entry);

    // Write to file
    await this.writeToFile(formattedEntry);

    if (
      level == 'error' ||
      (this.config.enableConsole && this.shouldLog(level))
    ) {
      const consoleMethod =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log;
      consoleMethod(formattedEntry.trim());
    }
  }

  async error(
    message: string,
    metadata?: any,
    context?: string
  ): Promise<void> {
    await this.log('error', message, metadata, context);
  }

  async warn(message: string, metadata?: any, context?: string): Promise<void> {
    await this.log('warn', message, metadata, context);
  }

  async info(message: string, metadata?: any, context?: string): Promise<void> {
    await this.log('info', message, metadata, context);
  }

  async debug(
    message: string,
    metadata?: any,
    context?: string
  ): Promise<void> {
    await this.log('debug', message, metadata, context);
  }

  // Convenience methods for common logging patterns
  async logStartup(component: string, details?: any): Promise<void> {
    await this.info(`Starting ${component}`, details, 'STARTUP');
  }

  async logError(
    component: string,
    error: Error | string,
    metadata?: any
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorMetadata =
      error instanceof Error
        ? {
            stack: error.stack,
            name: error.name,
            ...metadata,
          }
        : metadata;
    await this.error(`${component}: ${errorMessage}`, errorMetadata, 'ERROR');
  }

  async logPerformance(
    operation: string,
    duration: number,
    metadata?: any
  ): Promise<void> {
    await this.info(
      `${operation} completed in ${duration}ms`,
      metadata,
      'PERFORMANCE'
    );
  }

  async logConfig(component: string, config: any): Promise<void> {
    await this.debug(`${component} configuration`, config, 'CONFIG');
  }

  // Method to flush logs (useful for shutdown)
  async flush(): Promise<void> {
    // File system writes are typically immediate, but this provides a hook for future enhancements
    return Promise.resolve();
  }

  // Get current log level
  getLevel(): LogLevel {
    return this.config.level;
  }

  // Update log level at runtime
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  // Get log statistics
  async getStats(): Promise<{
    currentFile: string;
    totalFiles: number;
    totalSize: number;
  }> {
    try {
      const files = await fs.promises.readdir(this.logDir);
      const logFiles = files.filter(
        (file) => file.startsWith('clia-') && file.endsWith('.log')
      );

      let totalSize = 0;
      for (const file of logFiles) {
        const stats = await fs.promises.stat(path.join(this.logDir, file));
        totalSize += stats.size;
      }

      return {
        currentFile: this.currentLogFile,
        totalFiles: logFiles.length,
        totalSize,
      };
    } catch (error) {
      return {
        currentFile: this.currentLogFile,
        totalFiles: 0,
        totalSize: 0,
      };
    }
  }
}

// Export singleton instance factory
export function createLogger(config?: Config): FileLogger {
  return FileLogger.getInstance(config);
}

// Export default logger for easy import
export const logger = FileLogger.getInstance();
