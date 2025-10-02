import { loadConfig } from '../config.js';
import { LLMTier } from '../llm/hierarchy.js';
import { makeLLMForTier } from '../llm/provider.js';
import { getLogger } from './logger.js';
import { PromptTemplateEngine } from './prompt-template-engine.js';

export async function sleep(seg: number) {
  return new Promise((resolve) => setTimeout(resolve, seg * 1000));
}

export async function execPrompt<PC, T>(
  promptName: string,
  promptContext: PC,
  promptVersion: string,
  llmTier: LLMTier = 'default',
  temperature = 5,
  retries = 3
): Promise<T> {
  const config = await loadConfig();
  const llm = await makeLLMForTier(config, llmTier);
  const logger = getLogger();

  const prompt = PromptTemplateEngine.renderPrompt(
    promptName,
    promptContext,
    promptVersion
  );
  console.log(promptName, promptVersion, promptContext);
  let parsed: T | undefined;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      logger.debug(
        `[execPrompt] Attempt ${attempt + 1}/${retries} for prompt: ${promptName}`
      );

      const response = await Promise.race([
        llm.chat(prompt, (temperature + attempt) / 10),
        new Promise<never>(
          (_, reject) =>
        setTimeout(() => reject(new Error('LLM timeout')), 180000) // 3 minutes timeout
        ),
      ]);

      // Debug: Log raw response details
      logger.debug(`[execPrompt] Raw response type: ${typeof response}`);
      logger.debug(
        `[execPrompt] Raw response length: ${response?.length || 0}`
      );
      logger.debug(
        `[execPrompt] Raw response preview: ${response?.substring(0, 200) || 'null/undefined'}...`
      );

      if (!response?.trim()) {
        logger.warn(
          `[execPrompt] Empty response received on attempt ${attempt + 1}`
        );
        throw new Error('Empty response');
      }

      logger.debug(`[execPrompt] Response looks valid, attempting to parse...`);
      
      // Debug especial para commit/split-grouping
      if (promptName.includes('commit/split-grouping')) {
        console.log(`[COMMIT DEBUG] Raw LLM response for split-grouping:`, response);
        logger.error(`[COMMIT DEBUG] Raw LLM response for split-grouping: ${response}`);
      }
      
      parsed = parseJSONResponse(response, promptName) as T;
      
      // Debug adicional para commit/split-grouping 
      if (promptName.includes('commit/split-grouping') && parsed) {
        console.log(`[COMMIT DEBUG] Parsed response structure:`, JSON.stringify(parsed, null, 2));
        logger.error(`[COMMIT DEBUG] Parsed response structure: ${JSON.stringify(parsed, null, 2)}`);
      }
      
      if (parsed) {
        logger.debug(
          `[execPrompt] Successfully parsed response on attempt ${attempt + 1}`
        );
        break; // Sucesso, sair do loop
      }
    } catch (error) {
      const logger = getLogger();
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(
        `[execPrompt] Attempt ${attempt + 1}/${retries} failed: ${errorMessage}`
      );

      // Log more details about the error
      if (error instanceof Error) {
        logger.debug(`[execPrompt] Error details:`, {
          name: error.name,
          message: error.message,
          stack: error.stack?.substring(0, 500),
        });
      }

      if (attempt === retries - 1) {
        logger.error(
          `[execPrompt] All ${retries} attempts failed for prompt: ${promptName}`
        );

        // Análise do tipo de erro para sugestões ao usuário
        const errorStr = errorMessage.toLowerCase();
        if (
          errorStr.includes('rate limit') ||
          errorStr.includes('too many requests')
        ) {
          logger.error('💡 Suggestion: You are hitting rate limits. Try:');
          logger.error(
            '   - Using fewer files: stage only specific files instead of --auto-stage'
          );
          logger.error(
            '   - Using a different LLM provider (check your config)'
          );
          logger.error('   - Waiting a few minutes before trying again');
        } else if (errorStr.includes('403') || errorStr.includes('forbidden')) {
          logger.error('💡 Suggestion: API access denied. Check:');
          logger.error('   - Your API key in .clia/.env');
          logger.error('   - API key permissions and account status');
          logger.error('   - Network connectivity and firewall settings');
        } else if (
          errorStr.includes('500') ||
          errorStr.includes('unavailable')
        ) {
          logger.error('💡 Suggestion: LLM service is down. Try:');
          logger.error(
            '   - Using a different LLM provider (Ollama for local)'
          );
          logger.error('   - Checking the service status page');
          logger.error('   - Trying again in a few minutes');
        } else if (errorStr.includes('timeout')) {
          logger.error('💡 Suggestion: Request timed out. Try:');
          logger.error('   - Processing fewer files at once');
          logger.error('   - Using a faster LLM provider');
          logger.error('   - Checking your internet connection');
        }

        throw new Error(
          `LLM failed after ${retries} attempts: ${errorMessage}`
        );
      }

      // Sleep progressivo entre tentativas com jitter para evitar rate limits
      const baseDelay = Math.min(2 ** attempt * 1000, 30000); // Backoff exponencial, max 30s
      const jitter = Math.random() * 1000; // Random jitter de 0-1000ms
      const delayMs = baseDelay + jitter;

      logger.debug(
        `[execPrompt] Waiting ${Math.round(delayMs)}ms before retry... (exponential backoff)`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!parsed) {
    throw new Error('Failed to get valid response');
  }

  return parsed;
}

function parseJSONResponse(response: string, context: string): any {
  const logger = getLogger();

  logger.debug(`[${context}] Raw LLM response:`, response);

  // Tentativa 0: Extrair JSON entre tags <JSON_START> e <JSON_END>
  try {
    const startTag = '<JSON_START>';
    const endTag = '<JSON_END>';
    const startIndex = response.indexOf(startTag);
    const endIndex = response.indexOf(endTag);

    if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
      const jsonContent = response
        .substring(startIndex + startTag.length, endIndex)
        .trim();
      logger.debug(`[${context}] Extracted JSON from sentinels:`, jsonContent);
      const parsed = JSON.parse(jsonContent);
      logger.debug(`[${context}] Successfully parsed JSON from sentinels`);
      return parsed;
    }
  } catch (e) {
    logger.debug(
      `[${context}] Sentinel extraction failed:`,
      e instanceof Error ? e.message : e
    );
  }

  // Tentativa 1: JSON direto
  try {
    const parsed = JSON.parse(response);
    logger.debug(`[${context}] Successfully parsed JSON directly`);
    return parsed;
  } catch (e) {
    logger.debug(
      `[${context}] Direct JSON parse failed:`,
      e instanceof Error ? e.message : e
    );
  }

  // Tentativa 2: Limpar markdown e texto extra
  try {
    let cleanResponse = response
      .replace(/```json\n/g, '')
      .replace(/```\n/g, '')
      .replace(/```/g, '')
      .replace(/^[^{]*/, '') // Remove texto antes do primeiro {
      .replace(/[^}]*$/, '') // Remove texto depois do último }
      .trim();

    // Se ainda não começa com {, procurar o primeiro {
    const firstBrace = cleanResponse.indexOf('{');
    if (firstBrace > 0) {
      cleanResponse = cleanResponse.substring(firstBrace);
    }

    logger.debug(`[${context}] Cleaned response:`, cleanResponse);
    const parsed = JSON.parse(cleanResponse);
    logger.debug(`[${context}] Successfully parsed cleaned JSON`);
    return parsed;
  } catch (e) {
    logger.debug(
      `[${context}] Cleaned JSON parse failed:`,
      e instanceof Error ? e.message : e
    );
  }

  // Tentativa 3: Extrair primeiro JSON válido
  try {
    const startIndex = response.indexOf('{');
    if (startIndex !== -1) {
      let braceCount = 0;
      let endIndex = startIndex;

      for (
        let i = startIndex;
        i < response.length && i < startIndex + 10000;
        i++
      ) {
        // limite de 10k chars
        if (response[i] === '{') braceCount++;
        if (response[i] === '}') braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }

      const jsonString = response.substring(startIndex, endIndex + 1);
      logger.debug(`[${context}] Extracted JSON string:`, jsonString);
      const parsed = JSON.parse(jsonString);
      logger.debug(`[${context}] Successfully parsed extracted JSON`);
      return parsed;
    }
  } catch (e) {
    logger.debug(
      `[${context}] Extracted JSON parse failed:`,
      e instanceof Error ? e.message : e
    );
  }

  // Tentativa 4: Procurar JSON com array (para casos onde começa com array)
  try {
    const startIndex = response.indexOf('[');
    if (startIndex !== -1) {
      let bracketCount = 0;
      let endIndex = startIndex;

      for (
        let i = startIndex;
        i < response.length && i < startIndex + 10000;
        i++
      ) {
        if (response[i] === '[') bracketCount++;
        if (response[i] === ']') bracketCount--;
        if (bracketCount === 0) {
          endIndex = i;
          break;
        }
      }

      const jsonString = response.substring(startIndex, endIndex + 1);
      logger.debug(`[${context}] Extracted JSON array:`, jsonString);
      const parsed = JSON.parse(jsonString);

      // Special case: if we get an array but context expects an object with groups
      if (Array.isArray(parsed) && context.includes('commit/split-grouping')) {
        logger.debug(
          `[${context}] Converting array response to expected format`
        );
        const convertedResponse = {
          analysis: {
            totalGroups: parsed.length,
            groupingStrategy: 'mixed',
            confidence: 0.9,
          },
          groups: parsed.map((item: any) => ({
            motivation: item.type || 'feat',
            scope: 'core',
            commitMessage: `${item.type || 'feat'}(core): ${item.subject}`,
            description: item.reason || item.subject,
            reasoning: item.reason || 'Grouped by type',
            priority: 1,
            dependencies: [],
            confidence: 0.9,
            files: (item.files || []).map((file: string) => ({
              path: file,
              intent: 'updated',
              motivation: item.reason || 'improvement',
              category: item.type || 'feat',
              scope: 'core',
              confidence: 0.9,
            })),
          })),
        };
        logger.debug(
          `[${context}] Converted to schema format:`,
          convertedResponse
        );
        return convertedResponse;
      }

      logger.debug(`[${context}] Successfully parsed extracted JSON array`);
      return parsed;
    }
  } catch (e) {
    logger.debug(
      `[${context}] Extracted JSON array parse failed:`,
      e instanceof Error ? e.message : e
    );
  }

  logger.error(
    `[${context}] All JSON parsing attempts failed for response:`,
    response
  );
  throw new Error(`Failed to parse JSON response for ${context}`);
}
