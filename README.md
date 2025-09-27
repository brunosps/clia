# CLIA v0.2.3 - AI Coding Agent

[![npm version](https://badge.fury.io/js/clia.svg)](https://badge.fury.io/js/clia)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **CLIA** é uma ferramenta de produtividade para desenvolvedores com **100% de dados reais via MCP (Model Context Protocol)**. Combina capacidades LLM, RAG, análise de segurança, detecção de stack e análise estratégica para workflows de desenvolvimento automatizados.

## 🚀 Instalação

```bash
npm install -g clia
clia install  # Setup interativo
```

## ✨ Principais Recursos

- 🧠 **Sistema RAG Inteligente** - Indexação e busca semântica de documentos
- �️ **Análise de Segurança** - Integração Semgrep + Trivy via MCP
- 📊 **Detecção de Stack** - Análise automática de tecnologias do projeto
- 🤖 **Múltiplos Provedores LLM** - OpenRouter, Anthropic, OpenAI, DeepSeek, Ollama
- 🔍 **Análise de Código** - Métricas de qualidade, SOLID, clean code
- 📝 **Commits Inteligentes** - Geração automática de mensagens convencionais
- 🌍 **Multilíngue** - Suporte completo a português e inglês
- 📦 **Integração MCP** - 100% dados reais, zero simulações

## 🎯 Comandos Principais

### Setup e Configuração
```bash
clia install                    # Setup inicial interativo
clia configure                  # Configurar provedores LLM
```

### Análise de Projeto
```bash
clia analyze                    # Análise completa de qualidade
clia inspect                    # Análise de estrutura e otimização RAG
clia stack                      # Detecção de stack tecnológico
clia security-scan              # Análise de vulnerabilidades
clia review                     # Code review com métricas
```

### Sistema RAG
```bash
clia rag index                  # Indexar documentos
clia rag query "busca"          # Busca semântica
clia rag stats                  # Estatísticas do sistema
clia rag clear --force          # Limpar índice
```

### Desenvolvimento
```bash
clia ask "Como implementar JWT?" # Perguntas contextuais
clia commit                     # Commit inteligente
clia commit TASK-123            # Commit com rastreamento
```

## 🧠 Sistema RAG Avançado

O CLIA inclui um sistema RAG (Retrieval-Augmented Generation) completo:

- **Indexação Inteligente**: Chunking otimizado respeitando estrutura de código
- **Busca Híbrida**: Combina similaridade semântica + BM25
- **Embeddings Locais**: Ollama para embeddings gratuitos e privados
- **Configuração Otimizada**: Usa análise do projeto para melhor performance
- **Cache Inteligente**: Evita reprocessamento desnecessário

## �️ Segurança Integrada

### Análise Completa
- **Semgrep**: Análise estática de vulnerabilidades
- **Trivy**: Scanner de dependências e IaC
- **Políticas Configuráveis**: 3 níveis de segurança
- **Mitigação Automática**: Sugestões de correção

### Exemplo de Uso
```bash
clia security-scan --trivy --format json
clia security-scan --severity high -o relatorio.md
```

### 🧠 rag - Project Knowledge System
Build and query a semantic knowledge base of your codebase.

```bash
# Build semantic index of your project
clia rag index

# Search for specific concepts
clia rag query "authentication implementation"

# Get system statistics and information
clia rag stats

# Rebuild index after major changes
clia rag clear && clia rag index
```

**🎯 Features:**
## 📊 Detecção de Stack

Detecta automaticamente tecnologias do projeto:

### Linguagens Suportadas (9)
- **C#** (.NET, ASP.NET, Blazor, Entity Framework)
- **Java** (Spring Boot, Hibernate, Quarkus)
- **JavaScript/TypeScript** (React, Vue, Angular, Next.js, Express)
- **Python** (Django, Flask, FastAPI, Pyramid)
- **Ruby** (Rails, Sinatra, Hanami)
- **Rust** (Actix, Rocket, Warp, Axum)
- **PHP** (Laravel, Symfony, CodeIgniter)
- **Go** (Gin, Echo, Fiber, Beego)

### Análise Completa
```bash
clia stack                      # Detecção básica
clia stack --analyze            # Análise com IA
clia stack --analyze --deep     # Análise aprofundada
```

## 🤖 Provedores LLM

### OpenRouter (Recomendado - 100% GRATUITO) ✨
```json
{
  "basic": "microsoft/phi-3-mini-128k-instruct:free",
  "default": "meta-llama/llama-3.1-8b-instruct:free", 
  "premium": "deepseek/deepseek-r1:free"
}
```

### Outros Provedores
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Haiku
- **OpenAI**: GPT-4o, GPT-4o-mini
- **DeepSeek**: DeepSeek R1 (mais recente)
- **Ollama**: Modelos locais (llama3.1, llama3.2)

# Review specific commit
clia review --commit abc123f

# Compare against branch  
clia review --branch main

# Review with detailed analysis
clia review --detailed --verbose
```

**🎯 Three-Stage Architecture:**
1. **Individual File Analysis**: Security, Quality, Architecture, and Maintainability experts analyze each file
## ⚙️ Configuração

### Estrutura de Configuração
```
projeto/
├── .clia/
│   ├── clia.config.json        # Configuração principal
│   ├── .env                    # Chaves API (git-ignored)
│   ├── rag/                    # Índices RAG
│   └── logs/                   # Logs do sistema
```

### Exemplo de Configuração
```json
{
  "language": "pt-BR",
  "translateReports": true,
  "project": {
    "name": "MeuProjeto"
  },
  "llm": {
    "providers": {
      "openrouter": {
        "endpoint": "https://openrouter.ai/api/v1",
        "apiKeyEnv": "OPENROUTER_API_KEY"
      }
    },
    "tiers": {
      "basic": { "provider": "openrouter", "model": "microsoft/phi-3-mini-128k-instruct:free" },
      "default": { "provider": "openrouter", "model": "meta-llama/llama-3.1-8b-instruct:free" },
      "premium": { "provider": "openrouter", "model": "deepseek/deepseek-r1:free" },
      "embed": { "provider": "ollama", "model": "nomic-embed-text:latest" }
    }
  },
  "mcp": {
    "enabled": true,
    "servers": {
      "semgrep": "mcp+local://semgrep",
      "trivy": "mcp+local://trivy",
      "stack-detector": "mcp+local://stack-detector"
    }
  }
}
```

# Target specific directory
clia security-scan --target ./src --verbose
```

**🚨 Mandatory MCP Integration:**
## 📝 Exemplos de Uso

### Workflow Completo
```bash
# 1. Setup inicial
clia install

# 2. Análise do projeto
clia inspect                    # Estrutura e recomendações
clia stack --analyze            # Stack tecnológico
clia security-scan --trivy      # Vulnerabilidades

# 3. Configurar RAG
clia rag index                  # Indexar documentação

# 4. Desenvolvimento
clia ask "Como melhorar performance?" # Consulta contextual
clia analyze src/               # Análise de qualidade
clia commit                     # Commit inteligente
```

### Commits Inteligentes
```bash
# Commit automático
clia commit
# Output: feat: add user authentication with JWT tokens

# Com rastreamento de tarefa
clia commit JIRA-123
# Output: feat(auth): implement JWT authentication (JIRA-123)

# Múltiplos commits
clia commit --split
# Gera commits separados por componente
```

### Sistema de Perguntas
```bash
clia ask "Como configurar HTTPS no Express?"
clia ask "Qual a melhor prática para validação de dados?"
clia ask "Como otimizar consultas ao banco de dados?"
```

## 🏗️ Arquitetura

### Componentes Principais
- **Sistema de Configuração**: Configuração em cascata com fallbacks
- **Cliente MCP**: Integração com servidores MCP reais
- **Sistema RAG**: Indexação e busca semântica
- **Provedores LLM**: Abstração para múltiplos provedores
- **Sistema de Prompts**: Prompts versionados por comando

### Padrões de Arquivos
- **Saída**: `.clia/` para patches, relatórios, análises
- **Logs**: `.clia/logs/` com rotação automática
- **Cache**: Sistema inteligente para evitar reprocessamento
- **Versionamento**: `src/prompts/{comando}/{versão}/`

## 🚀 Comandos de Desenvolvimento

```bash
# Build & Desenvolvimento
npm run build          # Compilar TypeScript
npm run dev            # Modo watch
npm start              # Executar CLI compilado

# Análise Estratégica
npm start -- inspect                    # Análise de projeto
npm start -- inspect --format json     # Saída JSON

# Segurança & Stack
npm start -- security-scan              # Análise Semgrep
npm start -- security-scan --trivy      # Incluir Trivy
npm start -- stack --analyze --deep     # Análise profunda

# RAG
npm start -- rag index                  # Construir índice
npm start -- rag query "termo busca"    # Consultar RAG
```

## 📚 Documentação

- [Guia Completo de Desenvolvimento](docs/COMPLETE_DEVELOPMENT_GUIDE.md)
- [Padrões TypeScript](docs/TYPESCRIPT_CODING_STANDARDS.md) 
- [Guia de Construção de Commits](docs/COMMIT_COMMAND_CONSTRUCTION_GUIDE.md)

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 🌟 Recursos Principais

- ✅ **100% dados reais** via protocolo MCP
- ✅ **Zero simulações** - tudo via implementações reais
- ✅ **Análise inteligente** com IA contextual
- ✅ **Segurança integrada** com scanners profissionais
- ✅ **RAG avançado** para busca semântica
- ✅ **Multilíngue** com tradução automática
- ✅ **Commits inteligentes** com padrões convencionais
- ✅ **Detecção automática** de stack tecnológico
