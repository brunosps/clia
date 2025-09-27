/**
 * Centralized timestamp generation for consistent file naming
 * Ensures all commands use the same timestamp format: YYYY-MM-DD_HH-MM-SS
 */

/**
 * Generates standardized timestamp for file naming
 * @returns {string} Timestamp in format YYYY-MM-DD_HH-MM-SS
 */
export function generateTimestamp(): string {
  const now = new Date();
  
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Generates filename with standardized timestamp prefix
 * @param commandName - Name of the command (e.g., 'inspect', 'analyze')
 * @param extension - File extension (e.g., 'md', 'json')
 * @param target - Optional target specification (e.g., 'working_tree')
 * @returns {string} Filename in format: YYYY-MM-DD_HH-MM-SS_commandName[_target].extension
 */
export function generateTimestampedFilename(
  commandName: string, 
  extension: string, 
  target?: string
): string {
  const timestamp = generateTimestamp();
  const targetSuffix = target ? `_${target}` : '';
  return `${timestamp}_${commandName}${targetSuffix}.${extension}`;
}