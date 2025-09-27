/**
 * Translation service for internationalization support
 *
 * Handles automatic translation between user's configured language and English
 * for internal LLM processing while maintaining output localization.
 */

import { LLM } from '../llm/provider.js';
import { getLogger } from './logger.js';
import { PromptTemplateEngine } from './prompt-template-engine.js';
import type { Config } from '../config.js';

export type SupportedLanguage = 'pt-BR' | 'en-US';

export interface TranslationService {
  detectLanguage(text: string): Promise<SupportedLanguage>;
  translateToEnglish(
    text: string,
    sourceLanguage?: SupportedLanguage
  ): Promise<string>;
  translateFromEnglish(
    text: string,
    targetLanguage: SupportedLanguage
  ): Promise<string>;
}

/**
 * LLM-based translation service
 */
export class LLMTranslationService implements TranslationService {
  private llm: LLM;
  private defaultLanguage: SupportedLanguage;

  constructor(llm: LLM, config: Config) {
    this.llm = llm;
    this.defaultLanguage = config.language || 'en-US';
  }

  /**
   * Detect the language of input text
   */
  async detectLanguage(text: string): Promise<SupportedLanguage> {
    try {
      const prompt = `Analyze this text and determine if it's in Portuguese (Brazil) or English (US). 
Respond with exactly "pt-BR" or "en-US".

Text: "${text.substring(0, 200)}"`;

      const response = await this.llm.chat(prompt);
      const detected = response.trim().toLowerCase();

      if (detected.includes('pt-br') || detected.includes('portuguese')) {
        return 'pt-BR';
      } else if (detected.includes('en-us') || detected.includes('english')) {
        return 'en-US';
      }

      // Fallback to default language
      return this.defaultLanguage;
    } catch (error) {
      getLogger().warn('Error detecting language, using default:', error);
      return this.defaultLanguage;
    }
  }

  /**
   * Translate text from any supported language to English
   */
  async translateToEnglish(
    text: string,
    sourceLanguage?: SupportedLanguage
  ): Promise<string> {
    try {
      // If no source language provided, detect it
      const sourceLang = sourceLanguage || (await this.detectLanguage(text));

      // If already in English, return as-is
      if (sourceLang === 'en-US') {
        return text;
      }

      const prompt = PromptTemplateEngine.renderPrompt('translation/to-english', {
        text: text
      }, '1.0.0');

      const response = await this.llm.chat(prompt);
      return response.trim();
    } catch (error) {
      getLogger().warn(
        'Error translating to English, returning original text:',
        error
      );
      return text;
    }
  }

  /**
   * Translate text from English to target language
   */
  async translateFromEnglish(
    text: string,
    targetLanguage: SupportedLanguage
  ): Promise<string> {
    try {
      // If target is English, return as-is
      if (targetLanguage === 'en-US') {
        return text;
      }

      // Special handling for commit messages (detect by conventional commit pattern)
      const isCommitMessage = /^(feat|fix|docs|style|refactor|test|chore|perf|build|ci|revert)(\(.+\))?\s*:\s*.+/m.test(text);
      
      if (isCommitMessage) {
        return this.translateCommitMessageWithRetry(text, targetLanguage);
      }

      // Regular text translation with retry logic
      return this.translateWithRetry(text, targetLanguage, false);
    } catch (error) {
      getLogger().warn('Error translating from English, returning original text:', error);
      return text;
    }
  }

  /**
   * Translate with retry logic and rate limiting detection
   */
  private async translateWithRetry(
    text: string,
    targetLanguage: SupportedLanguage,
    isCommitMessage: boolean,
    maxRetries: number = 3
  ): Promise<string> {
    const logger = getLogger();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Add delay between attempts to avoid rate limiting
        if (attempt > 1) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 2), 10000); // Max 10s
          logger.info(`⏳ Waiting ${backoffDelay}ms before retry attempt ${attempt}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }

        let prompt: string;
        if (isCommitMessage) {
          prompt = PromptTemplateEngine.renderPrompt('translation/commit-message', {
            commitMessage: text,
            targetLanguage: targetLanguage
          }, '1.0.0');
        } else {
          prompt = PromptTemplateEngine.renderPrompt('translation/from-english', {
            text: text,
            targetLanguage: targetLanguage
          }, '1.0.0');
        }

        const response = await this.llm.chat(prompt);
        return response.trim().replace(/^["']|["']$/g, '');

      } catch (error: any) {
        const isRateLimit = this.isRateLimitError(error);
        
        if (isRateLimit) {
          logger.warn(`🚦 Rate limit detected on attempt ${attempt}/${maxRetries}:`, error?.data || error?.message || error);
          
          if (attempt === maxRetries) {
            logger.warn('❌ Max retries reached due to rate limiting, returning original text');
            return text; // Return original text when rate limited
          }
          continue; // Retry on rate limit
        } else {
          logger.warn(`❌ Translation error on attempt ${attempt}:`, error);
          return text; // Return original on other errors
        }
      }
    }
    
    return text; // Fallback
  }

  /**
   * Check if error is rate limiting (429)
   */
  private isRateLimitError(error: any): boolean {
    return (
      error?.data?.includes?.('429') || 
      error?.message?.includes?.('rate-limited') ||
      error?.code === 429 ||
      String(error).includes('429')
    );
  }

  /**
   * Translate commit message with retry logic
   */
  private async translateCommitMessageWithRetry(
    commitMessage: string,
    targetLanguage: SupportedLanguage
  ): Promise<string> {
    try {
      return await this.translateWithRetry(commitMessage, targetLanguage, true);
    } catch (error) {
      getLogger().warn('Error translating commit message, using fallback:', error);
      return commitMessage; // Return original on failure
    }
  }

  /**
   * Translate commit message preserving conventional commit structure (Legacy method - kept for compatibility)
   */
  private async translateCommitMessage(
    commitMessage: string,
    targetLanguage: SupportedLanguage
  ): Promise<string> {
    // Delegate to retry-enabled method
    return this.translateCommitMessageWithRetry(commitMessage, targetLanguage);
  }

  /**
   * Translate regular text (non-commit messages)
   */
  private async translateRegularText(
    text: string,
    targetLanguage: SupportedLanguage
  ): Promise<string> {
    const prompt = PromptTemplateEngine.renderPrompt('translation/from-english', {
      text: text,
      targetLanguage: targetLanguage
    }, '1.0.0');

    const response = await this.llm.chat(prompt);
    return response.trim().replace(/^["']|["']$/g, '');
  }
}

/**
 * Factory function to create translation service
 */
export function createTranslationService(
  llm: LLM,
  config: Config
): TranslationService {
  return new LLMTranslationService(llm, config);
}

/**
 * Utility function to check if translation is needed
 */
export function isTranslationNeeded(
  configLanguage: SupportedLanguage = 'en-US'
): boolean {
  // Always enable translation support for both languages
  return true;
}

/**
 * Check if reports should be translated based on config
 */
export function shouldTranslateReports(config: Config): boolean {
  // If translateReports is explicitly set, use that value
  if (config.translateReports !== undefined) {
    return config.translateReports;
  }
  // Default behavior: translate if language is not en-US
  return config.language !== 'en-US';
}

/**
 * Check if commit messages should be translated based on config
 */
export function shouldTranslateCommits(config: Config): boolean {
  // For commit messages, respect translateReports setting
  return shouldTranslateReports(config);
}

/**
 * Get the configured output language
 */
export function getOutputLanguage(config: Config): SupportedLanguage {
  return config.language || 'en-US';
}
