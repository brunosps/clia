import path from 'path';
import fs from 'fs';
import { getLogger } from '../shared/logger.js';

const logger = getLogger();

export interface SanitizedCommand {
  ok: boolean;
  reason?: string;
  original: string;
  normalized: string;
  bin: string;
  args: string[];
  subcmd?: string;
}

export interface PolicyDecision {
  action: 'allow' | 'deny' | 'unknown';
  matched?: string;
  reason: string;
  policy?: 'permissive' | 'restrictive' | 'moderate';
}

/**
 * Verifica se um diretório está dentro do workspace atual
 */
export function withinWorkspace(targetPath: string): boolean {
  const workspace = process.cwd();
  const resolved = path.resolve(targetPath);
  const relative = path.relative(workspace, resolved);
  
  // Se começa com '..' está fora do workspace
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Sanitiza e analisa um comando único
 */
export function sanitizeSingleCommand(command: string): SanitizedCommand {
  const original = command;
  const trimmed = command.trim();
  
  if (!trimmed) {
    return {
      ok: false,
      reason: 'Comando vazio',
      original,
      normalized: '',
      bin: '',
      args: []
    };
  }
  
  // Verifica encadeamentos perigosos
  const dangerousPatterns = [
    /[;&|`]/,  // ; && || | `
    /\$\(/,    // $(...)
    />\s*\/dev\/null\s*2>&1/,  // redirecionamentos suspeitos
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        reason: 'Comando contém encadeamento ou redirecionamento suspeito',
        original,
        normalized: trimmed,
        bin: '',
        args: []
      };
    }
  }
  
  // Remove variáveis de ambiente inline (FOO=bar comando → comando)
  const withoutEnv = trimmed.replace(/^(\w+=\S+\s+)+/, '');
  
  // Separa comando e argumentos
  const parts = withoutEnv.split(/\s+/).filter(p => p.length > 0);
  if (parts.length === 0) {
    return {
      ok: false,
      reason: 'Comando inválido após sanitização',
      original,
      normalized: withoutEnv,
      bin: '',
      args: []
    };
  }
  
  const bin = parts[0];
  const args = parts.slice(1);
  
  // Detecta subcomando para melhor matching
  let subcmd: string | undefined;
  if (args.length > 0 && !args[0].startsWith('-')) {
    subcmd = args[0];
  }
  
  // Para comandos perigosos, incluir mais contexto na normalização
  let normalized: string;
  if (bin === 'rm' && args.includes('-rf')) {
    // Para rm -rf, incluir o argumento para detectar paths perigosos
    normalized = withoutEnv; // comando completo normalizado
  } else {
    normalized = [bin, subcmd].filter(Boolean).join(' ');
  }
  
  return {
    ok: true,
    original,
    normalized,
    bin,
    args,
    subcmd
  };
}

/**
 * Avalia política de segurança para um comando
 */
export function matchPolicy(normalizedCommand: string, security: any): PolicyDecision {
  const { 
    allowCommands = [], 
    denyCommands = [], 
    requireApprovalForUnknown = true,
    policy = 'moderate' // padrão: moderate
  } = security;

  // SEMPRE verificar deny list primeiro (nunca executar comandos negados)
  for (const denied of denyCommands) {
    if (normalizedCommand.startsWith(denied.trim())) {
      return {
        action: 'deny',
        matched: denied,
        reason: `Comando explicitamente negado: ${denied}`,
        policy
      };
    }
  }

  // Heurísticas extras de segurança (sempre aplicadas)
  const dangerousHeuristics = [
    { pattern: /^rm\s+.*-rf.*\/$/, reason: 'Tentativa de deletar root filesystem' },
    { pattern: /^rm\s+.*-rf.*\.$/, reason: 'Tentativa de deletar diretório atual' },
    { pattern: /^rm\s+.*-rf.*\/\s*$/, reason: 'Tentativa de deletar root filesystem' },
    { pattern: /^git\s+push.*origin\s+(main|master)/, reason: 'Push direto para branch principal' },
    { pattern: /^shutdown|^reboot|^halt/, reason: 'Comando de sistema perigoso' },
    { pattern: /^iptables|^ufw|^firewall/, reason: 'Modificação de firewall' },
    { pattern: /^systemctl|^service/, reason: 'Modificação de serviços do sistema' },
    { pattern: /^docker\s+system\s+prune\s+-a/, reason: 'Limpeza agressiva do Docker' },
    { pattern: /^npm\s+publish|^yarn\s+publish/, reason: 'Publicação de pacote' },
    { pattern: /^sudo\s+/, reason: 'Execução com privilégios elevados' },
    { pattern: /^su\s+/, reason: 'Mudança de usuário' },
    { pattern: /^chmod\s+777/, reason: 'Permissões muito permissivas' },
    { pattern: /:\(\)\{.*\|\:.*\}/, reason: 'Fork bomb detectado' },
    { pattern: /curl.*\|.*sh/, reason: 'Download e execução de script' },
    { pattern: /wget.*\|.*sh/, reason: 'Download e execução de script' }
  ];

  for (const heuristic of dangerousHeuristics) {
    if (heuristic.pattern.test(normalizedCommand)) {
      return {
        action: 'deny',
        matched: normalizedCommand,
        reason: heuristic.reason,
        policy
      };
    }
  }

  // Aplicar política específica
  switch (policy) {
    case 'permissive':
      // PERMISSIVE: Permite tudo que não está em denyCommands
      return {
        action: 'allow',
        reason: 'Política permissiva: comando permitido (não está em denyCommands)',
        policy
      };

    case 'restrictive':
      // RESTRICTIVE: Só permite o que está em allowCommands
      for (const allowed of allowCommands) {
        if (normalizedCommand.startsWith(allowed.trim())) {
          return {
            action: 'allow',
            matched: allowed,
            reason: `Política restritiva: comando explicitamente permitido: ${allowed}`,
            policy
          };
        }
      }
      return {
        action: 'deny',
        reason: 'Política restritiva: comando não está na lista de permitidos',
        policy
      };

    case 'moderate':
    default:
      // MODERATE: Permite allowCommands, nega denyCommands, pede aprovação para o resto
      
      // Verificar allow list
      for (const allowed of allowCommands) {
        if (normalizedCommand.startsWith(allowed.trim())) {
          return {
            action: 'allow',
            matched: allowed,
            reason: `Política moderada: comando explicitamente permitido: ${allowed}`,
            policy
          };
        }
      }

      // Comando desconhecido - pedir aprovação
      return {
        action: 'unknown',
        reason: requireApprovalForUnknown 
          ? 'Política moderada: comando não está na lista de permitidos - requer aprovação'
          : 'Política moderada: comando não permitido',
        policy
      };
  }
}

/**
 * Avalia riscos de um comando desconhecido
 */
export function assessRisk(command: string): { level: 'low' | 'medium' | 'high', reasons: string[], alternatives: string[] } {
  const risks: string[] = [];
  const alternatives: string[] = [];
  let level: 'low' | 'medium' | 'high' = 'low';
  
  // Análise de risco baseada em padrões
  if (/install|add|remove|delete|update|upgrade/.test(command)) {
    risks.push('Modifica dependências ou sistema');
    level = 'medium';
    if (command.includes('npm')) {
      alternatives.push('Considere adicionar "npm install" ou comandos específicos à allowCommands');
    }
  }
  
  if (/push|deploy|publish|release/.test(command)) {
    risks.push('Pode afetar ambientes externos');
    level = 'high';
    alternatives.push('Execute deploy via pipeline CI/CD');
  }
  
  if (/^npx|^pnpm\s+dlx|^yarn\s+dlx/.test(command)) {
    risks.push('Executa código de pacotes externos');
    level = 'medium';
    alternatives.push('Instale a ferramenta localmente primeiro');
  }
  
  if (risks.length === 0) {
    risks.push('Comando não analisado anteriormente');
  }
  
  if (alternatives.length === 0) {
    alternatives.push('Adicione à lista allowCommands se for seguro');
  }
  
  return { level, reasons: risks, alternatives };
}

/**
 * Adiciona um comando à lista de permitidos no arquivo de configuração
 */
export function addToAllowList(command: string, configPath: string = './clia.config.json'): boolean {
  try {
    // Ler configuração atual
    const configFile = path.resolve(configPath);
    if (!fs.existsSync(configFile)) {
      logger.error(` Arquivo de configuração não encontrado: ${configFile}`);
      return false;
    }
    
    const configContent = fs.readFileSync(configFile, 'utf-8');
    const config = JSON.parse(configContent);
    
    // Verificar se já existe
    const allowCommands = config.security?.allowCommands || [];
    const normalizedCommand = command.trim();
    
    if (allowCommands.some((cmd: string) => cmd.trim() === normalizedCommand)) {
      logger.info(`ℹ️ Comando já está na lista de permitidos: ${normalizedCommand}`);
      return true;
    }
    
    // Adicionar à lista
    config.security = config.security || {};
    config.security.allowCommands = config.security.allowCommands || [];
    config.security.allowCommands.push(normalizedCommand);
    
    // Salvar arquivo
    const updatedContent = JSON.stringify(config, null, 2);
    fs.writeFileSync(configFile, updatedContent, 'utf-8');
    
    logger.info(` Comando adicionado à lista de permitidos: ${normalizedCommand}`);
    logger.info(` Configuração atualizada em: ${configFile}`);
    
    return true;
    
  } catch (error) {
    logger.error(` Erro ao adicionar comando à lista de permitidos:`, error);
    return false;
  }
}

/**
 * Remove um comando da lista de permitidos
 */
export function removeFromAllowList(command: string, configPath: string = './clia.config.json'): boolean {
  try {
    // Ler configuração atual
    const configFile = path.resolve(configPath);
    if (!fs.existsSync(configFile)) {
      logger.error(` Arquivo de configuração não encontrado: ${configFile}`);
      return false;
    }
    
    const configContent = fs.readFileSync(configFile, 'utf-8');
    const config = JSON.parse(configContent);
    
    // Verificar se existe
    const allowCommands = config.security?.allowCommands || [];
    const normalizedCommand = command.trim();
    
    const index = allowCommands.findIndex((cmd: string) => cmd.trim() === normalizedCommand);
    if (index === -1) {
      logger.info(`ℹ️ Comando não está na lista de permitidos: ${normalizedCommand}`);
      return true;
    }
    
    // Remover da lista
    allowCommands.splice(index, 1);
    
    // Salvar arquivo
    const updatedContent = JSON.stringify(config, null, 2);
    fs.writeFileSync(configFile, updatedContent, 'utf-8');
    
    logger.info(` Comando removido da lista de permitidos: ${normalizedCommand}`);
    logger.info(` Configuração atualizada em: ${configFile}`);
    
    return true;
    
  } catch (error) {
    logger.error(` Erro ao remover comando da lista de permitidos:`, error);
    return false;
  }
}

/**
 * Lista as políticas de segurança disponíveis
 */
export function getAvailablePolicies(): { name: string; description: string }[] {
  return [
    {
      name: 'permissive',
      description: 'Permite todos os comandos exceto os explicitamente negados (denyCommands)'
    },
    {
      name: 'moderate', 
      description: 'Permite allowCommands, nega denyCommands, pede aprovação para outros'
    },
    {
      name: 'restrictive',
      description: 'Só executa comandos explicitamente permitidos (allowCommands)'
    }
  ];
}