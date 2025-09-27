/**
 * Sistema de Cache de Análises - Evita reprocessar arquivos não modificados
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { getLogger } from './logger.js';

const logger = getLogger();

export interface FileAnalysis {
  file_path: string;
  hash: string;
  analysis: {
    identification: {
      component_type: string;
      architectural_layer: string;
      primary_purpose: string;
    };
    functional: {
      responsibilities: string[];
      main_exports: string[];
      dependencies: string[];
      integrations: string[];
    };
    quality: {
      complexity: 'low' | 'medium' | 'high';
      design_patterns: string[];
      anti_patterns: string[];
      code_smells: string[];
    };
    recommendations: {
      immediate: string[];
      architectural: string[];
      security: string[];
      performance: string[];
      maintainability: string[];
    };
    business_context: {
      business_value: 'low' | 'medium' | 'high';
      criticality: 'low' | 'important' | 'critical';
      change_frequency: 'low' | 'medium' | 'high';
    };
  };
}

export interface CacheEntry {
  hash: string;
  timestamp: number;
  analysis: FileAnalysis;
}

export interface AnalysisCache {
  [fileHash: string]: CacheEntry;
}

export class AnalysisCacheManager {
  private cacheDir: string;
  private cacheFile: string;
  private cache: AnalysisCache = {};

  constructor(baseDir: string = process.cwd()) {
    this.cacheDir = path.join(baseDir, '.clia');
    this.cacheFile = path.join(this.cacheDir, 'analysis-cache.json');
    this.loadCache();
  }

  /**
   * Calcula hash SHA256 do conteúdo do arquivo
   */
  private calculateFileHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Carrega cache existente do disco
   */
  private loadCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const cacheData = fs.readFileSync(this.cacheFile, 'utf-8');
        this.cache = JSON.parse(cacheData);
      }
    } catch (error) {
      // Se não conseguir carregar, inicia com cache vazio
      this.cache = {};
    }
  }

  /**
   * Salva cache no disco
   */
  private saveCache(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      logger.warn(' Erro ao salvar cache de análise:', error);
    }
  }

  /**
   * Verifica se um arquivo precisa ser analisado (não está em cache ou mudou)
   */
  needsAnalysis(filePath: string, content: string): boolean {
    const hash = this.calculateFileHash(content);
    const cacheKey = this.getCacheKey(filePath, hash);
    
    return !this.cache[cacheKey];
  }

  /**
   * Gera chave única para o cache baseada no caminho e hash
   */
  private getCacheKey(filePath: string, hash: string): string {
    return crypto
      .createHash('md5')
      .update(`${filePath}:${hash}`)
      .digest('hex');
  }

  /**
   * Obtém análise do cache se existir
   */
  getAnalysis(filePath: string, content: string): FileAnalysis | null {
    const hash = this.calculateFileHash(content);
    const cacheKey = this.getCacheKey(filePath, hash);
    
    const cacheEntry = this.cache[cacheKey];
    if (cacheEntry) {
      return cacheEntry.analysis;
    }
    
    return null;
  }

  /**
   * Armazena análise no cache
   */
  storeAnalysis(filePath: string, content: string, analysis: FileAnalysis): void {
    const hash = this.calculateFileHash(content);
    const cacheKey = this.getCacheKey(filePath, hash);
    
    // Garantir que o hash está correto na análise
    analysis.hash = hash;
    analysis.file_path = filePath;
    
    this.cache[cacheKey] = {
      hash,
      timestamp: Math.floor(Date.now() / 1000),
      analysis
    };
    
    this.saveCache();
  }

  /**
   * Limpa entradas antigas do cache (mais de 30 dias)
   */
  cleanup(): void {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    let cleanedCount = 0;
    
    for (const [key, entry] of Object.entries(this.cache)) {
      if (entry.timestamp < thirtyDaysAgo) {
        delete this.cache[key];
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.saveCache();
      const logger = getLogger();
      logger.info(`🧹 Cache cleaned: ${cleanedCount} old entries removed`);
    }
  }

  /**
   * Obtém estatísticas do cache
   */
  getStats(): { totalEntries: number; cacheSize: string; oldestEntry: string; newestEntry: string } {
    const entries = Object.values(this.cache);
    const timestamps = entries.map(e => e.timestamp);
    
    return {
      totalEntries: entries.length,
      cacheSize: this.formatBytes(JSON.stringify(this.cache).length),
      oldestEntry: timestamps.length > 0 ? new Date(Math.min(...timestamps) * 1000).toISOString() : 'N/A',
      newestEntry: timestamps.length > 0 ? new Date(Math.max(...timestamps) * 1000).toISOString() : 'N/A'
    };
  }

  /**
   * Formata bytes em formato legível
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Força reconstrução do cache (útil para debugging)
   */
  rebuild(): void {
    this.cache = {};
    this.saveCache();
  }
}