import { StackDetector } from './detector.js';
import { StackInfo } from './types.js';
import { getLogger } from '../shared/logger.js';

const logger = getLogger();

/**
 * MCP Server para Stack Detection
 * Fornece detecção automática de tecnologias via protocolo MCP
 */
export class StackDetectionMcpServer {
  private detector: StackDetector;

  constructor(workspaceRoot?: string) {
    this.detector = new StackDetector(workspaceRoot);
  }

  /**
   * Detecta a stack completa do projeto
   */
  async detectStack(): Promise<StackInfo> {
    try {
      return await this.detector.detectStack();
    } catch (error) {
      logger.warn(' Erro na detecção de stack:', error);
      return this.getEmptyStackInfo();
    }
  }

  /**
   * Detecta apenas a tecnologia primária (mais rápido)
   */
  async detectPrimaryStack(): Promise<{ name: string; confidence: number }> {
    try {
      const stackInfo = await this.detector.detectStack();
      return {
        name: stackInfo.primary.name,
        confidence: stackInfo.primary.confidence
      };
    } catch (error) {
      logger.warn(' Erro na detecção de stack primária:', error);
      return { name: 'unknown', confidence: 0 };
    }
  }

  /**
   * Verifica se uma tecnologia específica está presente
   */
  async hasTechnology(techName: string): Promise<boolean> {
    try {
      const stackInfo = await this.detector.detectStack();
      
      // Verifica na stack primária
      if (stackInfo.primary.name === techName) return true;
      
      // Verifica nas stacks secundárias
      if (stackInfo.secondary.some(s => s.name === techName)) return true;
      
      // Verifica nos frameworks
      if (stackInfo.frameworks.some(f => f.name === techName)) return true;
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Obtém comandos recomendados baseados na stack detectada
   */
  async getRecommendedCommands(): Promise<Record<string, string[]>> {
    try {
      const stackInfo = await this.detector.detectStack();
      const commands: Record<string, string[]> = {};

      // Comandos baseados na stack primária
      const primaryStack = stackInfo.primary.name;
      
      if (primaryStack === 'nodejs' || stackInfo.frameworks.some(f => f.ecosystem === 'nodejs')) {
        commands.lint = ['npx eslint --format=json'];
        commands.format = ['npx prettier --write'];
        commands.test = ['npm test'];
        commands.build = ['npm run build'];
        
        // Comandos específicos por package manager
        const hasYarn = stackInfo.packageManagers.some(pm => pm.name === 'yarn');
        const hasPnpm = stackInfo.packageManagers.some(pm => pm.name === 'pnpm');
        
        if (hasPnpm) {
          commands.install = ['pnpm install'];
          commands.test = ['pnpm test'];
          commands.build = ['pnpm build'];
        } else if (hasYarn) {
          commands.install = ['yarn install'];
          commands.test = ['yarn test'];
          commands.build = ['yarn build'];
        } else {
          commands.install = ['npm install'];
        }
      }
      
      if (primaryStack === 'php' || stackInfo.frameworks.some(f => f.ecosystem === 'php')) {
        commands.lint = ['vendor/bin/phpstan analyse --error-format=json'];
        commands.format = ['vendor/bin/php-cs-fixer fix'];
        commands.test = ['vendor/bin/phpunit'];
        commands.install = ['composer install'];
      }
      
      if (primaryStack === 'python' || stackInfo.frameworks.some(f => f.ecosystem === 'python')) {
        commands.lint = ['flake8 --format=json'];
        commands.format = ['black .'];
        commands.test = ['python -m pytest'];
        commands.install = ['pip install -r requirements.txt'];
      }
      
      if (primaryStack === 'java') {
        const hasMaven = stackInfo.packageManagers.some(pm => pm.name === 'maven');
        const hasGradle = stackInfo.packageManagers.some(pm => pm.name === 'gradle');
        
        if (hasMaven) {
          commands.test = ['mvn test'];
          commands.build = ['mvn compile'];
          commands.install = ['mvn install'];
        } else if (hasGradle) {
          commands.test = ['./gradlew test'];
          commands.build = ['./gradlew build'];
          commands.install = ['./gradlew build'];
        }
      }
      
      // Comandos para frameworks específicos
      const frameworks = stackInfo.frameworks.map(f => f.name);
      
      if (frameworks.includes('nextjs')) {
        commands.dev = ['npm run dev'];
        commands.build = ['npm run build'];
      }
      
      if (frameworks.includes('django')) {
        commands.dev = ['python manage.py runserver'];
        commands.migrate = ['python manage.py migrate'];
      }
      
      if (frameworks.includes('laravel')) {
        commands.dev = ['php artisan serve'];
        commands.migrate = ['php artisan migrate'];
      }

      return commands;
    } catch (error) {
      logger.warn(' Erro ao obter comandos recomendados:', error);
      return {};
    }
  }

  /**
   * Obtém extensões de linting recomendadas para a stack
   */
  async getRecommendedLinters(): Promise<Record<string, { command: string; configFile?: string }>> {
    try {
      const stackInfo = await this.detector.detectStack();
      const linters: Record<string, { command: string; configFile?: string }> = {};

      const primaryStack = stackInfo.primary.name;
      const languages = stackInfo.languages.map(l => l.name);
      const frameworks = stackInfo.frameworks.map(f => f.name);

      // Linters para JavaScript/TypeScript
      if (languages.includes('javascript') || languages.includes('typescript')) {
        linters.eslint = {
          command: 'npx eslint --format=json',
          configFile: '.eslintrc.json'
        };
        
        if (languages.includes('typescript')) {
          linters.typescript = {
            command: 'npx tsc --noEmit',
            configFile: 'tsconfig.json'
          };
        }
      }

      // Linters para PHP
      if (primaryStack === 'php' || languages.includes('php')) {
        linters.phpstan = {
          command: 'vendor/bin/phpstan analyse --error-format=json',
          configFile: 'phpstan.neon'
        };
        
        linters.psalm = {
          command: 'vendor/bin/psalm --output-format=json',
          configFile: 'psalm.xml'
        };
      }

      // Linters para Python
      if (primaryStack === 'python' || languages.includes('python')) {
        linters.flake8 = {
          command: 'flake8 --format=json'
        };
        
        linters.mypy = {
          command: 'mypy --show-error-codes',
          configFile: 'mypy.ini'
        };
      }

      // Linters de segurança universais
      linters.semgrep = {
        command: 'semgrep --config=auto --json'
      };

      return linters;
    } catch (error) {
      logger.warn(' Erro ao obter linters recomendados:', error);
      return {};
    }
  }

  /**
   * Obtém informações de contexto para o RAG
   */
  async getContextInfo(): Promise<{ 
    summary: string; 
    technologies: string[]; 
    searchHints: string[] 
  }> {
    try {
      const stackInfo = await this.detector.detectStack();
      
      const technologies = [
        stackInfo.primary.name,
        ...stackInfo.secondary.map(s => s.name),
        ...stackInfo.frameworks.map(f => f.name),
        ...stackInfo.languages.map(l => l.name)
      ].filter(Boolean);

      const summary = `Projeto ${stackInfo.primary.name} com ${stackInfo.confidence}% de confiança. ` +
        `Frameworks: ${stackInfo.frameworks.map(f => f.name).join(', ') || 'Nenhum'}. ` +
        `Linguagens: ${stackInfo.languages.map(l => l.name).join(', ')}.`;

      const searchHints = [
        `${stackInfo.primary.name} development`,
        `${stackInfo.primary.name} best practices`,
        ...stackInfo.frameworks.map(f => `${f.name} tutorial`),
        ...stackInfo.frameworks.map(f => `${f.name} configuration`)
      ];

      return {
        summary,
        technologies: [...new Set(technologies)],
        searchHints: [...new Set(searchHints)]
      };
    } catch (error) {
      logger.warn(' Erro ao obter contexto:', error);
      return {
        summary: 'Stack não detectada',
        technologies: [],
        searchHints: []
      };
    }
  }

  private getEmptyStackInfo(): StackInfo {
    return {
      primary: {
        name: 'unknown',
        type: 'language',
        configFiles: [],
        confidence: 0
      },
      secondary: [],
      packageManagers: [],
      frameworks: [],
      tools: [],
      languages: [],
      confidence: 0
    };
  }
}

/**
 * Factory function para criar instância do MCP Server
 */
export function createStackDetectionMcpServer(workspaceRoot?: string): StackDetectionMcpServer {
  return new StackDetectionMcpServer(workspaceRoot);
}