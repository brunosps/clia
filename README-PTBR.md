# CLIA - CLI de Desenvolvimento com IA

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/clia.svg)](https://badge.fury.io/js/clia)
[![Node.js CI](https://github.com/clia/clia/workflows/Node.js%20CI/badge.svg)](https://github.com/clia/clia/actions)

## 🚀 Visão Geral

**CLIA (AI Coding Agent)** é uma CLI abrangente de produtividade para desenvolvedores que revoluciona o desenvolvimento de código com **integração 100% real de dados**. Construído sobre o Model Context Protocol (MCP), CLIA combina Large Language Models (LLM), Retrieval-Augmented Generation (RAG), análise de segurança e análise inteligente de código para fornecer fluxos de trabalho de desenvolvimento automatizados que entendem profundamente seu projeto.

### 🎯 O que Torna o CLIA Diferente

- **🔍 Dados Reais, Zero Simulações**: Todas as análises usam scanners de segurança reais (Semgrep, Trivy), dados do git e contexto de projeto ao vivo
- **🧠 Inteligência Ciente do Projeto**: Sistema RAG aprende sua base de código e fornece respostas contextuais
- **💰 Custo Otimizado**: Suporta modelos 100% GRATUITOS via OpenRouter com gerenciamento inteligente de tiers
- **🌐 Multilíngue**: Suporte completo Português/Inglês com tradução automática
- **🏗️ Arquitetura Primeiro**: Estrutura de Comando Padrão garante consistência e confiabilidade
- **⚡ Performance Otimizada**: Processamento em lote inteligente e cache minimizam chamadas de API

## ✨ Recursos Principais

### 🤖 Análise Inteligente de Código
- **Avaliação de segurança arquivo por arquivo** com análise real de vulnerabilidades
- **Avaliação de princípios SOLID** e análise arquitetural
- **Detecção de gargalos de performance** e sugestões de otimização
- **Métricas de código limpo** com recomendações de melhoria acionáveis

### 🔄 Fluxo de Trabalho de Desenvolvimento Inteligente
- **Geração de commits semânticos** com análise de intenção arquivo por arquivo
- **Sistema de revisão de código em 3 estágios** (painéis Individual → Grupo → Executivo)
- **Detecção de stack tecnológica** com roadmaps de modernização
- **Análise automatizada de segurança** com integração Semgrep + Trivy

### 🧠 Sistema de Conhecimento do Projeto
- **Q&A aprimorado com RAG** que entende sua base de código específica
- **Integração de conhecimento externo** do StackOverflow e Context7
- **Cache inteligente** para evitar análises redundantes
- **Respostas conscientes do contexto** baseadas em padrões e convenções do projeto

## 🚀 Início Rápido

### Instalação

```bash
npm install -g clia
```

### Configuração do Projeto

```bash
cd seu-projeto
clia install
```

A configuração interativa configura:
- **Provedor LLM**: Escolha entre OpenRouter, Anthropic, OpenAI, DeepSeek ou Ollama
- **Tiers de Modelo**: Configure modelos para operações básicas, padrão, premium e embed
- **Idioma**: Interface em Português (pt-BR) ou Inglês (en-US)
- **Configurações RAG**: Otimize chunking e indexação de documentos para seu projeto
- **Servidores MCP**: Habilite integração de dados em tempo real com ferramentas de segurança

### Fluxo de Trabalho Essencial

```bash
# 1. Indexe seu projeto para contexto inteligente
clia rag index

# 2. Analise seu ambiente de desenvolvimento
clia inspect

# 3. Gere commits semânticos
git add .
clia commit

# 4. Execute revisão abrangente de código
clia review

# 5. Execute análise de segurança
clia security-scan --trivy

# 6. Faça perguntas específicas do projeto (usa contexto RAG)
clia ask "Como funciona a autenticação neste projeto?"
```

## 📦 Referência de Comandos

### 🤔 ask - Consultas de Projeto em Linguagem Natural
Faça perguntas sobre conceitos de desenvolvimento com contexto consciente do projeto.

```bash
clia ask "Como implementar autenticação JWT?"
clia ask "Qual é a melhor forma de lidar com operações assíncronas em TypeScript?"
clia ask "Como configurar um servidor Express.js?"  # Suporte ao português
```

**🎯 Recursos:**
- **Conhecimento Externo**: Enriquecido com Q&A do StackOverflow e documentação do Context7
- **Multilíngue**: Tradução automática entre português e inglês
- **Contexto do Projeto**: Entende sua stack tecnológica e padrões específicos
- **Fallbacks Graciosos**: Funciona offline com conhecimento LLM quando serviços externos indisponíveis

### 🧠 rag - Sistema de Conhecimento do Projeto
Construa e consulte uma base de conhecimento semântica de sua base de código.

```bash
# Construa índice semântico do seu projeto
clia rag index

# Busque conceitos específicos
clia rag query "implementação de autenticação"

# Obtenha estatísticas e informações do sistema
clia rag stats

# Reconstrua o índice após mudanças importantes
clia rag clear && clia rag index
```

**🎯 Recursos:**
- **Banco de Dados Vetorial HNSWLib**: Busca semântica de alta performance com batching de 32-64 chunks
- **Chunking Inteligente de Código**: Respeita estrutura da linguagem e limites semânticos
- **Integração Project-Inspection**: Usa resultados do `inspect` para estratégia de indexação otimizada
- **Processamento Eficiente em Memória**: Lida com grandes bases de código com garbage collection automático
- **Estatísticas do Sistema**: Métricas abrangentes via `clia rag stats`

### 🤖 commit - Geração de Commits Semânticos
Gere mensagens de commit inteligentes e contextuais através de análise arquivo por arquivo.

```bash
# Analise todas as mudanças e gere commit
clia commit

# Divida em múltiplos commits semânticos por motivação
clia commit --split

# Visualize mensagens de commit sem executar
clia commit --dry-run

# Analise apenas arquivos staged
clia commit --no-stage

# Altere o último commit com nova análise
clia commit --amend
```

**🎯 Recursos:**
- **Análise em Duas Fases**: Análise de arquivo individual → Consolidação semântica
- **Detecção de Intenção Arquivo por Arquivo**: Entende o que cada mudança realiza
- **Commits Convencionais**: Segue formato `feat(escopo): descrição` com corpo detalhado
- **Divisão Semântica**: Agrupa mudanças por motivação do desenvolvedor em commits separados
- **Integração de Contexto RAG**: Usa conhecimento do projeto para melhores mensagens de commit
- **Processamento Paralelo**: 3-4 workers concorrentes para grandes conjuntos de mudanças

**Exemplo de Saída de Commit Dividido:**
```bash
📦 Commit 1/3: feat(auth): implementar sistema de autenticação de usuário
   Arquivos: src/auth/login.ts, src/auth/jwt.ts, src/middleware/auth.ts
   
📦 Commit 2/3: test(auth): adicionar suite abrangente de testes de autenticação
   Arquivos: tests/auth/login.spec.ts, tests/auth/jwt.spec.ts
   
📦 Commit 3/3: docs(auth): atualizar documentação da API para autenticação
   Arquivos: docs/api/auth.md, README.md
```

### 🔍 review - Sistema de Revisão de Código Expert
Revisão avançada em 3 estágios com painéis de especialistas especializados.

```bash
# Revisar mudanças staged (padrão)
clia review

# Revisar commit específico
clia review --commit abc123f

# Comparar contra branch
clia review --branch main

# Revisar com análise detalhada
clia review --detailed --verbose
```

**🎯 Arquitetura de Três Estágios:**
1. **Análise de Arquivo Individual**: Especialistas em Segurança, Qualidade, Arquitetura e Manutenibilidade analisam cada arquivo
2. **Análise de Grupo**: Arquitetos de sistema avaliam grupos funcionais para coesão e riscos de integração
3. **Decisão Executiva**: Painel C-level (CTO, VP Engenharia, CSO) fornece recomendação final

**🎯 Recursos:**
- **Categorização Automática de Arquivos**: Agrupa arquivos por funcionalidade (core-business-logic, api-interfaces, security-auth, etc.)
- **Sistema de Painel de Especialistas**: Credenciais de especialistas realistas para análise especializada
- **Pontuação Abrangente**: Escala 0-10 para segurança, qualidade, manutenibilidade por arquivo
- **Integração com Segurança**: Contexto obrigatório Semgrep + Trivy para análise de segurança
- **Análise Consciente de Stack**: Usa detecção de stack tecnológica para recomendações específicas de linguagem

### 🔬 analyze - Análise de Qualidade de Código e Segurança
Análise abrangente de qualidade de código, segurança e padrões arquiteturais.

```bash
# Analisar projeto inteiro
clia analyze

# Focar em diretório específico
clia analyze --target ./src

# Formatos de saída
clia analyze --format markdown
clia analyze --format json
```

**🎯 Dimensões de Análise:**
- **Análise de Segurança**: Padrões de vulnerabilidade, segredos expostos, problemas de validação de entrada
- **Avaliação de Código Limpo**: Convenções de nomenclatura, preocupações de complexidade, problemas de organização
- **Princípios SOLID**: Responsabilidade única, injeção de dependência, segregação de interface
- **Manutenibilidade**: Lacunas de documentação, preocupações de teste, débito técnico
- **Performance**: Preocupações de memória, oportunidades de otimização, eficiência algorítmica
- **Análise de Integração**: APIs externas, endpoints, conexões de banco de dados, serviços de terceiros

**🎯 Recursos:**
- **Pontuação Arquivo por Arquivo**: Métricas individuais (0-10) para cada arquivo fonte
- **Descobertas Consolidadas**: Insights a nível de projeto e oportunidades de melhoria
- **Recomendações Acionáveis**: Melhorias específicas categorizadas por prioridade
- **Análise Consciente de Linguagem**: Padrões específicos para stack tecnológica detectada

### 🛡️ security-scan - Detecção Real de Vulnerabilidades de Segurança
Análise especializada de segurança usando ferramentas reais de análise de segurança.

```bash
# Análise SAST básica com Semgrep
clia security-scan

# Incluir análise de dependências com Trivy
clia security-scan --trivy

# Filtrar por nível de severidade
clia security-scan --severity high

# Direcionar diretório específico
clia security-scan --target ./src --verbose
```

**🚨 Integração MCP Obrigatória:**
- **Semgrep**: Static Application Security Testing (SAST) para vulnerabilidades de código
- **Trivy**: Análise de dependências e Infrastructure-as-Code
- **Apenas Dados Reais**: Sem descobertas simuladas - todas as vulnerabilidades de scanners reais

**🎯 Recursos:**
- **Avaliação de Risco Contextual**: Análise LLM aprimora descobertas do scanner com contexto do projeto
- **Mapeamento de Severidade**: Tradução adequada entre níveis de severidade do scanner e CLIA
- **Remediação Acionável**: Sugestões de correção específicas baseadas no tipo de vulnerabilidade e contexto
- **Análise Multi-ferramenta**: Combina SAST, dependência e análise IaC para cobertura abrangente
- **Integração de Política de Segurança**: Respeita políticas de segurança configuradas (permissivo/moderado/restritivo)

### 📊 stack - Análise de Stack Tecnológica
Detecção e análise automática da stack tecnológica do seu projeto.

```bash
clia stack
```

**🎯 Capacidades de Detecção:**
- **Linguagens**: C#, Java, JavaScript, TypeScript, Ruby, Rust, Python, PHP, Go
- **Frameworks**: React, Vue, Angular, Django, Flask, Spring Boot, Rails, Laravel, etc.
- **Ferramentas**: Sistemas de build, frameworks de teste, ferramentas de linting, gerenciadores de pacote
- **Versões**: Versões de dependências, status EOL, avaliação de vulnerabilidades

**🎯 Recursos:**
- **Estratégia de Saída Dupla**: `stack-analysis.json` (integração) + `.md` com timestamp (histórico)
- **Roadmap de Modernização**: Caminhos de upgrade específicos e avisos de breaking changes
- **Saúde de Dependências**: Indicadores desatualizados (⚠️), vulnerabilidades de segurança (🚨), status atual (✅)
- **Visão Geral da Arquitetura**: Padrões de projeto, convenções e análise estrutural
- **Impacto de Performance**: Identificação de dependências pesadas/inchadas

### 🔍 inspect - Análise do Ambiente de Desenvolvimento
Análise abrangente da estrutura do seu projeto para otimização RAG.

```bash
# Gerar relatório de inspeção do projeto
clia inspect

# Especificar formato de saída
clia inspect --format human
clia inspect --format json
```

**🎯 Recursos:**
- **Análise de Stack**: Linguagens, frameworks, bibliotecas com pontuação de confiança
- **Mapeamento de Configuração**: Gerenciadores de pacote, ferramentas de build, configuração CI/CD
- **Descoberta de Documentação**: README, docs/, padrões de documentação inline
- **Otimização RAG**: Estrutura de diretório e recomendações de indexação
- **Estratégia de Arquivo**: Gera `project-inspection.json` para integração entre comandos

### ⚙️ configure - Gerenciamento de Provedores e Configurações
Reconfigure provedores LLM e configurações após instalação inicial.

```bash
clia configure
```

**🎯 Recursos:**
- **Reconfiguração Interativa**: Atualize provedores, modelos e chaves de API
- **Gerenciamento de Tiers**: Configure modelos para tiers básico, padrão, premium, embed
- **Otimização de Custo**: Seleção de modelo com dicas de preço e recomendações
- **Validação em Tempo Real**: Teste conectividade com provedores selecionados
- **Backup de Configuração**: Preserva configurações existentes durante atualizações

## 🏗️ Arquitetura e Configuração

### Hierarquia de Configuração
```
1. .clia/.env                  # Variáveis de ambiente e chaves de API
2. .clia/clia.config.json     # Configuração específica do projeto
3. clia.config.json           # Fallback do projeto
4. config.json                # Fallback do sistema
5. config.sample.json         # Template padrão
```

### Sistema de Tiers LLM
CLIA usa seleção inteligente de tier para otimização de custo:

| **Tier** | **Propósito** | **Casos de Uso** | **Custo** |
|----------|---------------|------------------|-----------|
| `basic` | Validações simples | Validação JSON, verificações de sintaxe | Baixo |
| `default` | Operações padrão | Maioria das análises, geração de commit | Médio |
| `premium` | Planejamento complexo | Estratégia, decisões arquiteturais | Alto |
| `embed` | Operações RAG | Embeddings vetoriais, busca por similaridade | Específico |

### Provedores LLM Suportados

#### OpenRouter (Recomendado - Modelos 100% GRATUITOS) 💰
```json
{
  "basic": "microsoft/phi-3-mini-128k-instruct:free",
  "default": "meta-llama/llama-3.1-8b-instruct:free", 
  "premium": "deepseek/deepseek-r1:free"
}
```

#### Anthropic
```json
{
  "basic": "claude-3-haiku-20240307",
  "default": "claude-3-haiku-20240307",
  "premium": "claude-3-5-sonnet-20241022"
}
```

#### OpenAI
```json
{
  "basic": "gpt-4o-mini",
  "default": "gpt-4o",
  "premium": "gpt-4o" 
}
```

#### DeepSeek (Custo-Efetivo)
```json
{
  "basic": "deepseek-chat",
  "default": "deepseek-chat", 
  "premium": "deepseek-chat"
}
```

#### Ollama (Local/Offline)
```json
{
  "basic": "llama3.2:3b",
  "default": "llama3.2:8b",
  "premium": "llama3.1:70b",
  "embed": "nomic-embed-text:latest"
}
```

### Integração Model Context Protocol (MCP)
CLIA aproveita MCP para acesso a dados em tempo real:

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": "mcp+local://filesystem",
      "git": "mcp+local://git",
      "stack-detector": "mcp+local://stack-detector", 
      "semgrep": "mcp+local://semgrep",
      "trivy": "mcp+local://trivy",
      "context7": "https://mcp.context7.com/mcp",
      "stackoverflow": "mcp+community://stackoverflow",
      "github": "npx @modelcontextprotocol/server-github"
    }
  }
}
```

**Dependências MCP por Comando:**
- **security-scan**: **OBRIGATÓRIO** - semgrep, trivy
- **review**: **RECOMENDADO** - semgrep, trivy para contexto de segurança
- **analyze**: **OPCIONAL** - semgrep para análise de segurança aprimorada
- **stack**: **RECOMENDADO** - stack-detector para detecção de tecnologia
- **Todos os comandos**: **RECOMENDADO** - git, filesystem para contexto do projeto

## 🌐 Suporte Multilíngue

CLIA fornece suporte seamless Português/Inglês:

### Fluxo de Tradução
1. **Entrada do Usuário**: Português/Inglês → Inglês (para consistência LLM)
2. **Processamento LLM**: Sempre em inglês para qualidade ótima
3. **Tradução de Resposta**: Inglês → Idioma configurado do usuário
4. **Controle Granular**: Configuração `translateReports` para documentação técnica

### Configuração
```json
{
  "language": "pt-BR",           // Idioma da interface do usuário
  "translateReports": true,      // Traduzir relatórios e commits
  "project": {
    "name": "MeuProjeto"
  }
}
```

### Comandos Suportados
- **ask**: Consultas em qualquer idioma com respostas traduzidas (usa contexto RAG)
- **commit**: Mensagens de commit no idioma configurado
- **Todos os relatórios**: Tradução automática baseada na configuração `translateReports`

## 🔧 Recursos Avançados

### Processamento em Lote Inteligente
CLIA otimiza performance através de batching inteligente:

- **Workers Paralelos**: 3-4 chamadas LLM concorrentes com limitação de taxa
- **Tamanhos de Lote Adaptativos**: 8-12 arquivos para análise, 32-64 chunks para embeddings
- **Otimização Consciente de Provedor**: Lotes maiores para Ollama local, menores para APIs remotas
- **Gerenciamento de Memória**: Garbage collection automático para operações grandes
- **Isolamento de Erro**: Lotes falhados não afetam trabalho completado

### Sistema de Base de Conhecimento
Cache inteligente reduz custos de API:

- **Rastreamento de Hash MD5**: Monitora mudanças de conteúdo de arquivo
- **Atualizações Automáticas**: Atualiza análise apenas quando arquivos mudam
- **Integração de Projeto**: Usa padrões de project-inspection para descoberta de arquivos
- **Benefícios de Performance**: Redução significativa de chamadas LLM redundantes
- **Gerenciamento de Cache**: Limpeza automática de arquivos deletados

### Framework de Política de Segurança
Três modos de segurança para diferentes ambientes:

- **Permissivo**: Permitir tudo exceto comandos explicitamente negados
- **Moderado**: Lista de permissões + fluxo de aprovação para comandos desconhecidos
- **Restritivo**: Apenas comandos explicitamente permitidos

## 📚 Tecnologias Suportadas

### Linguagens de Programação (9 Suportadas)
- **C#**: .NET Core/.NET Framework, ASP.NET, Blazor, Entity Framework
- **Java**: Spring Boot, Spring MVC, Hibernate, Quarkus, Micronaut
- **JavaScript**: React, Vue, Angular, Next.js, Express, Node.js
- **TypeScript**: React, Vue, Angular, Next.js, Nest.js, Svelte
- **Ruby**: Rails, Sinatra, Hanami
- **Rust**: Actix, Rocket, Warp, Axum
- **Python**: Django, Flask, FastAPI, Pyramid, Tornado
- **PHP**: Laravel, Symfony, CodeIgniter, CakePHP
- **Go**: Gin, Echo, Fiber, Beego

### Gerenciadores de Pacote e Ferramentas de Build
npm/yarn, pip/pipenv, cargo, maven/gradle, bundler, composer, go modules, nuget, dotnet, webpack, vite, rollup, parcel

### Ferramentas de Desenvolvimento
ESLint, Pylint, RuboCop, Clippy, Jest, Mocha, PyTest, JUnit, Docker, Kubernetes

## 🛠️ Desenvolvimento e Contribuição

### Build do Código Fonte
```bash
git clone https://github.com/your-username/clia.git
cd clia
npm install
npm run build
npm pack
npm install -g clia-0.2.3.tgz
```

### Estrutura do Projeto
```
src/
├── commands/          # Implementações de comandos CLI
├── config.ts         # Sistema de configuração em cascata
├── embeddings/       # Provedores de embedding (Ollama, APIs remotas)
├── llm/              # Provedores LLM e gerenciamento de tier
├── mcp/              # Integração Model Context Protocol
├── prompts/          # Templates de prompt versionados
│   └── {command}/{version}/system.md
├── rag/              # Sistema RAG com HNSWLib
├── security/         # Políticas de segurança e análise
├── shared/           # Utilitários, cache, tradução
└── stack/            # Detecção de stack tecnológica
```

### Diretrizes de Contribuição
1. **Fork** do repositório
2. **Criar** branch de feature (`git checkout -b feature/recurso-incrivel`)
3. **Seguir** padrões TypeScript com tipagem estrita
4. **Testar** com múltiplos provedores LLM
5. **Documentar** novos recursos no README e prompts
6. **Submeter** Pull Request com descrição detalhada

## 💡 Melhores Práticas e Dicas

### Fluxo de Trabalho Ótimo
1. **Comece com `clia install`** para configuração adequada
2. **Execute `clia inspect`** para analisar estrutura do projeto
3. **Execute `clia rag index`** antes de outros comandos para melhor contexto
4. **Use `clia commit --split`** para organização semântica de commits
5. **Habilite `clia security-scan --trivy`** para análise abrangente de segurança

### Otimização de Custo
- **Configure OpenRouter** para acesso 100% GRATUITO a modelos
- **Use Ollama local** para operações de embedding
- **Habilite cache inteligente** com sistema de Base de Conhecimento
- **Visualize com opções `--dry-run`** antes de executar operações caras

### Dicas de Performance
- **Indexe projetos grandes** durante horários de menor movimento com `clia rag index`
- **Use flags `--target`** para focar análise em diretórios específicos
- **Habilite servidores MCP** para contexto aprimorado e dados reais
- **Configure `logLevel` apropriado** para reduzir ruído

### Recomendações de Segurança
- **Sempre execute `clia security-scan --trivy`** antes de releases
- **Configure políticas de segurança restritivas** para ambientes de produção
- **Revise configurações de servidor MCP** para projetos sensíveis
- **Use `.clia/.env`** para gerenciamento seguro de chaves de API

## 📄 Licença

Este projeto está licenciado sob a **Licença MIT** - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 🔗 Recursos

- 📖 **[Guia Completo de Desenvolvimento](docs/COMPLETE_DEVELOPMENT_GUIDE.md)** - Documentação técnica abrangente
- 📋 **[Padrões TypeScript](docs/TYPESCRIPT_CODING_STANDARDS.md)** - Diretrizes de qualidade de código
- 🔧 **[Guia de Construção de Commits](docs/COMMIT_COMMAND_CONSTRUCTION_GUIDE.md)** - Fluxos de trabalho avançados de commit
- 🐛 **[GitHub Issues](https://github.com/your-username/clia/issues)** - Relatórios de bug e solicitações de recursos
- 📦 **[Pacote NPM](https://www.npmjs.com/package/clia)** - Registro oficial de pacotes

## 🚀 Roadmap

- [ ] **Integração GitHub Actions** - Fluxos de trabalho CI/CD automatizados
- [ ] **Extensão VS Code** - Integração IDE para desenvolvimento seamless
- [ ] **Bots Slack/Discord** - Recursos de colaboração em equipe
- [ ] **SSO Empresarial** - Autenticação avançada para equipes
- [ ] **Treinamento de Modelo Personalizado** - Fine-tuning específico do projeto
- [ ] **Analytics Avançadas** - Métricas de qualidade de código ao longo do tempo

---

**CLIA v0.2.3** - Transformando desenvolvimento com automação inteligente 🤖✨

*Construído com ❤️ por desenvolvedores, para desenvolvedores. Capacitando qualidade de código, segurança e produtividade através de IA.*