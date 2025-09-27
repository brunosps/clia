/**
 * Sistema de mapeamento inteligente de prompts para comandos CLIA
 */

interface CommandMapping {
  command: string;
  description: string;
  patterns: string[];
  examples: string[];
}

/**
 * Mapeamentos de prompts em português para comandos CLIA
 */
const COMMAND_MAPPINGS: CommandMapping[] = [
  {
    command: 'pricing list',
    description: 'Lista preços dos modelos LLM',
    patterns: [
      'preços? dos? modelos?',
      'consulte? (?:os )?preços?',
      'liste? (?:os )?preços?',
      'custo dos? modelos?',
      'valores? dos? modelos?',
      'pricing list',
      'price list'
    ],
    examples: [
      'consulte os preços dos modelos utilizados',
      'liste os preços',
      'preços dos modelos',
      'custo dos modelos'
    ]
  },
  {
    command: 'pricing clear',
    description: 'Limpa banco de preços',
    patterns: [
      'limpe? (?:os )?preços?',
      'clear (?:os )?preços?',
      'reset (?:os )?preços?',
      'apague? (?:os )?preços?',
      'pricing clear'
    ],
    examples: [
      'limpe os preços',
      'reset pricing',
      'clear preços'
    ]
  },
  {
    command: 'rag index',
    description: 'Constrói índice RAG',
    patterns: [
      'construa? (?:o )?(?:índice )?rag',
      'build rag',
      'indexe? (?:os )?arquivos?',
      'crie? (?:o )?índice',
      'rag (?:index|build)'
    ],
    examples: [
      'construa o índice RAG',
      'rag index',
      'indexe os arquivos'
    ]
  },
  {
    command: 'rag query',
    description: 'Consulta índice RAG',
    patterns: [
      'consulte? (?:o )?rag',
      'busque? no rag',
      'query rag',
      'procure? no (?:índice|rag)',
      'rag query'
    ],
    examples: [
      'consulte o RAG sobre autenticação',
      'busque no RAG por funções',
      'query rag authentication'
    ]
  },
  {
    command: 'refactor',
    description: 'Refatora código',
    patterns: [
      'refatore?',
      'refactor',
      'melhore? (?:o código|arquivo)',
      'otimize? (?:o código|arquivo)',
      'revise? (?:o código|arquivo)'
    ],
    examples: [
      'refatore src/utils.ts',
      'melhore o código em api.ts',
      'otimize a função login'
    ]
  },
  {
    command: 'inspect',
    description: 'Inspeciona arquivos',
    patterns: [
      'inspecione?',
      'inspect',
      'analise? (?:o arquivo|código)',
      'examine? (?:o arquivo|código)',
      'revise? (?:o arquivo|código)'
    ],
    examples: [
      'inspecione src/auth.ts',
      'analise o arquivo config.ts',
      'examine a função parseData'
    ]
  },
  {
    command: 'commit',
    description: 'Gera mensagens de commit',
    patterns: [
      'commit',
      'gere? (?:mensagem de )?commit',
      'crie? (?:mensagem de )?commit',
      'faça? commit',
      'mensagem (?:de )?commit'
    ],
    examples: [
      'gere mensagem de commit',
      'commit as mudanças',
      'crie commit message'
    ]
  },
  {
    command: 'trello feature',
    description: 'Implementa feature do Trello',
    patterns: [
      'trello feature',
      'implemente? (?:a )?feature (?:do )?trello',
      'crie? feature (?:do )?trello',
      'desenvolva? feature'
    ],
    examples: [
      'trello feature CARD123',
      'implemente a feature do trello CARD456',
      'desenvolva feature CARD789'
    ]
  },
  {
    command: 'ollama list',
    description: 'Lista servidores Ollama',
    patterns: [
      'ollama (?:list|ls)',
      'liste? (?:servidores? )?ollama',
      'servidores? (?:do )?ollama'
    ],
    examples: [
      'ollama list',
      'liste servidores ollama',
      'servidores do ollama'
    ]
  },
  {
    command: 'install',
    description: 'Instalação inicial do CLIA',
    patterns: [
      'install',
      'instale?',
      'configure? (?:o )?clia',
      'setup (?:do )?clia',
      'inicialize? (?:o )?clia'
    ],
    examples: [
      'install',
      'configure o clia',
      'setup inicial'
    ]
  },
  {
    command: 'review',
    description: 'Análise automatizada de commits',
    patterns: [
      'review',
      'analise? (?:commits?|código|alterações)',
      'revise? (?:commits?|código|alterações)',
      'examine? (?:commits?|alterações)'
    ],
    examples: [
      'review',
      'analise commits',
      'revise as alterações'
    ]
  },
  {
    command: 'rag stats',
    description: 'Estatísticas do índice RAG',
    patterns: [
      'rag stats',
      'estatísticas? (?:do )?rag',
      'status (?:do )?rag',
      'informações? (?:do )?rag'
    ],
    examples: [
      'rag stats',
      'estatísticas do rag',
      'status do índice'
    ]
  },
  {
    command: 'rag clear',
    description: 'Limpa índice RAG',
    patterns: [
      'rag clear',
      'limpe? (?:o )?rag',
      'clear rag',
      'reset rag',
      'apague? (?:o )?(?:índice )?rag'
    ],
    examples: [
      'rag clear',
      'limpe o rag',
      'reset índice rag'
    ]
  },
  {
    command: 'ask',
    description: 'Pergunta técnica geral',
    patterns: [
      'pergunt[ae]',
      'como (?:fazer|funciona|usar)',
      'o que é',
      'explique?',
      'qual (?:a diferença|é)',
      'ask',
      'dúvida (?:sobre|técnica)',
      'questão (?:sobre|técnica)'
    ],
    examples: [
      'como usar docker compose',
      'o que é typescript',
      'explique promises em javascript',
      'qual a diferença entre let e const',
      'ask about react hooks'
    ]
  }
];

/**
 * Mapeia um prompt em português para comandos CLIA
 */
export function mapPromptToCommand(prompt: string): { command: string; confidence: number; description: string } | null {
  const normalizedPrompt = prompt.toLowerCase().trim();
  
  for (const mapping of COMMAND_MAPPINGS) {
    for (const pattern of mapping.patterns) {
      const regex = new RegExp(pattern, 'i');
      
      if (regex.test(normalizedPrompt)) {
        // Calcular confiança baseada na complexidade do match
        const confidence = calculateConfidence(normalizedPrompt, pattern, mapping);
        
        return {
          command: mapping.command,
          confidence,
          description: mapping.description
        };
      }
    }
  }
  
  return null;
}

/**
 * Calcula confiança do match baseado em vários fatores
 */
function calculateConfidence(prompt: string, pattern: string, mapping: CommandMapping): number {
  let confidence = 70; // Base confidence
  
  // Boost se o prompt é similar aos exemplos
  const similarToExamples = mapping.examples.some(example => 
    calculateSimilarity(prompt, example.toLowerCase()) > 0.6
  );
  if (similarToExamples) confidence += 20;
  
  // Boost se o padrão é específico (menos caracteres especiais de regex)
  const patternSpecificity = pattern.replace(/[()?\[\].*+^${}|\\]/g, '').length / pattern.length;
  confidence += patternSpecificity * 10;
  
  // Penalizar se o prompt tem muitas palavras não relacionadas
  const promptWords = prompt.split(/\s+/).length;
  const patternWords = pattern.replace(/[()?\[\].*+^${}|\\]/g, '').split(/\s+/).length;
  if (promptWords > patternWords * 2) {
    confidence -= 10;
  }
  
  return Math.min(100, Math.max(0, confidence));
}

/**
 * Calcula similaridade entre duas strings usando distância de Levenshtein simplificada
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.split(/\s+/);
  const words2 = str2.split(/\s+/);
  
  let commonWords = 0;
  for (const word1 of words1) {
    if (words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
      commonWords++;
    }
  }
  
  return commonWords / Math.max(words1.length, words2.length);
}

/**
 * Lista todos os comandos mapeados
 */
export function listMappedCommands(): CommandMapping[] {
  return [...COMMAND_MAPPINGS];
}

/**
 * Busca comandos por descrição ou padrão
 */
export function searchCommands(query: string): CommandMapping[] {
  const normalizedQuery = query.toLowerCase();
  
  return COMMAND_MAPPINGS.filter(mapping => 
    mapping.description.toLowerCase().includes(normalizedQuery) ||
    mapping.command.toLowerCase().includes(normalizedQuery) ||
    mapping.patterns.some(pattern => pattern.toLowerCase().includes(normalizedQuery)) ||
    mapping.examples.some(example => example.toLowerCase().includes(normalizedQuery))
  );
}

/**
 * Extrai parâmetros do prompt para comandos que requerem argumentos
 */
export function extractCommandParameters(prompt: string, command: string): string[] {
  const parameters: string[] = [];
  
  // Para comandos específicos, extrair parâmetros
  if (command.startsWith('trello feature')) {
    // Extrair ID do card do Trello
    const cardMatch = prompt.match(/(?:card|cartão)\s*[:-]?\s*([A-Z0-9]+)/i);
    if (cardMatch) {
      parameters.push(cardMatch[1]);
    }
  }
  
  if (command.startsWith('refactor')) {
    // Extrair nome do arquivo
    const fileMatch = prompt.match(/(?:arquivo|file|src)\s*[\/\\]?([^\s]+\.(?:ts|js|jsx|tsx|py|java|cpp|c|h))/i);
    if (fileMatch) {
      parameters.push(fileMatch[1]);
    }
  }
  
  if (command.startsWith('rag query')) {
    // Extrair termo de busca
    const queryMatch = prompt.match(/(?:sobre|por|query|busque?)\s+(.+?)(?:\s|$)/i);
    if (queryMatch) {
      parameters.push(`"${queryMatch[1].trim()}"`);
    }
  }
  
  return parameters;
}