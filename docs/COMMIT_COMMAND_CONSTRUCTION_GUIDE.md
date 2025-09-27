# Guia de Construção do Comando Commit - Instruções Arquiteturais

## Visão Geral

Este documento contém as instruções arquiteturais e comportamentais para construir um comando de commit inteligente em qualquer linguagem de programação. O sistema deve implementar geração automática de commits usando LLM, RAG e análise de diffs.

## Especificações Funcionais

### Contexto do Sistema

**Sistema Alvo**: CLIA v0.2.1 - Ferramenta de produtividade para desenvolvedores
**Tecnologias Core**: LLM (Large Language Models), RAG (Retrieval-Augmented Generation), MCP (Model Context Protocol)

### Requisitos Fundamentais

1. **Interface CLI**: Comando principal com nome "commit"
2. **Processamento Inteligente**: Análise de mudanças Git com contexto semântico
3. **Integração RAG**: Consulta obrigatória de contexto para cada arquivo
4. **Gestão de Estados**: Suporte completo a arquivos adicionados, modificados e deletados
5. **Processamento Escalável**: Algoritmo de lotes para grandes volumes de arquivos
6. **Commits Semânticos**: Geração seguindo padrões convencionais
7. **Tradução Automática**: Suporte multilíngue baseado em configuração

## Arquitetura do Comando

### Opções da Interface CLI

O comando deve aceitar as seguintes opções:

1. **`--amend`**: Modifica o último commit existente
2. **`--split`**: Divide mudanças em múltiplos commits semânticos
3. **`--auto-stage`**: Automaticamente adiciona todos os arquivos ao staging area
4. **`--dry-run`**: Executa análise sem aplicar commits, retorna estrutura JSON

### Dependências Externas Obrigatórias

1. **Sistema de Configuração**: Carregamento de configurações do projeto
2. **Provedor LLM**: Acesso a modelos de linguagem (tier 'default' exclusivamente)
3. **Motor de Templates**: Sistema de renderização de prompts versionados
4. **Analisador de Diffs**: Componente para análise de mudanças Git
5. **Sistema de Logging**: Para rastreamento de operações
6. **Executor de Comandos**: Para operações Git via shell
7. **Sistema RAG**: Para consultas de contexto de arquivos

## Fluxo Principal de Execução

### Fase 1: Inicialização e Validação

1. **Carregamento de Configuração**
   - Carregar configurações do projeto
   - Inicializar provedor LLM no tier 'default'
   - Configurar sistema de logging

2. **Gestão da Staging Area**
   - Se `--auto-stage` ativo: executar `git add -A`
   - Capturar lista de arquivos staged
   - Executar análise de diff apenas para arquivos staged
   - Se `--split` ativo: executar `git reset HEAD` para processamento individual

3. **Validações Críticas**
   - Verificar se existem mudanças para commit
   - Validar incompatibilidade: `--amend` + `--split` não podem coexistir
   - Falhar rapidamente se não há trabalho a fazer

### Fase 2: Análise e Enriquecimento

#### Algoritmo de Processamento em Lotes

**Constante de Batch**: 33 arquivos por lote principal
**Cálculo de Loops**: `ceil(total_arquivos / 33)`

Para cada lote de arquivos:

1. **Extração de Metadados**
   - Caminho do arquivo
   - Status Git (A=Added, M=Modified, D=Deleted)
   - Contadores de inserções/deleções
   - Indicador de arquivo binário
   - Caminho anterior (para renames)

2. **Consulta RAG Obrigatória** (para cada arquivo)
   - Query específica: `"What does the source file '{caminho}' do?"`
   - Usar modelo 'default' exclusivamente
   - Armazenar resposta como contexto do arquivo

3. **Análise Diferencial**
   - **Arquivos Deletados**: Contexto = "File Deleted"
   - **Arquivos Modificados**: Executar `git diff {caminho}` e capturar stdout
   - **Arquivos Novos**: Extrair conteúdo dos hunks ou usar diff completo

### Fase 3: Geração de Commits Semânticos

#### Processamento de Grupos (Modo Split)

1. **Prompt de Agrupamento Semântico**
   - Usar template 'commit/split-grouping' versão '1.0.0'
   - Contexto: metadados do projeto + dados enriquecidos dos arquivos
   - Objetivo: agrupar arquivos por motivação e escopo

2. **Estrutura de Contexto para LLM**
   - Nome do projeto
   - Timestamp atual
   - Branch Git ativo
   - Total de arquivos
   - Lista concatenada de caminhos
   - Idioma do usuário (para tradução)
   - Dados de análise de arquivos (JSON serializado)
   - Contexto MCP (metadados Git + timestamp)

3. **Transformação de Grupos em Commits**
   - **Subject**: `{motivação}({escopo}): {descrição}`
   - **Body**: Lista de arquivos com intenções (um por linha)
   - **Footer**: Raciocínio do agrupamento
   - **Files**: Array de caminhos dos arquivos

#### Agregação de Commits Similares

1. **Primeira Agregação**
   - Usar template 'commit/aggregate-similar' versão '1.0.0'
   - Consolidar commits com motivações/escopos similares

2. **Agregação Final** (apenas se não é modo split)
   - Usar template 'commit/single-aggregate' versão '1.0.0'
   - Adicionar mensagem do último commit se `--amend` ativo
   - Gerar um único commit consolidado

### Fase 4: Execução de Commits

#### Para Cada Commit Gerado

1. **Preparação da Mensagem**
   - Formato: `{subject}\n\n{body}\n\n({footer})`
   - Garantir quebras de linha corretas

2. **Staging Inteligente por Arquivo**
   - Localizar status do arquivo na análise original
   - **Arquivos Deletados (status 'D')**:
     - Executar: `git rm --cached --ignore-unmatch -- {arquivo}`
   - **Arquivos Normais (status 'A' ou 'M')**:
     - Executar: `git add {arquivo}`
   - Capturar e logar erros, mas continuar processamento

3. **Aplicação do Commit**
   - Executar: `git commit -m "{mensagem}"`
   - Em caso de erro: capturar stderr e falhar com contexto

4. **Reset para Próximo Commit** (apenas no modo split)
   - Executar: `git reset HEAD`
   - Isso unstage todos os arquivos para o próximo commit

#### Tratamento de Modo Dry-Run

Se `--dry-run` ativo:
- **Não executar** nenhuma operação Git
- **Retornar** estrutura JSON com todos os commits gerados
- **Formato**: `{"commits": [array_de_commits]}`

## Algoritmos de Retry e Robustez

### Sistema de Retry para LLM

**Configuração**: 3 tentativas máximas
**Temperatura**: Crescente (base + índice_tentativa) / 10
**Delay**: Crescente entre tentativas (índice + 1 segundos)

Para cada tentativa:
1. Executar chamada LLM com temperatura ajustada
2. Tentar fazer parsing JSON da resposta
3. Se sucesso: retornar resultado
4. Se falha: aguardar delay e tentar novamente
5. Após 3 falhas: retornar erro

### Tratamento de Erros Git

#### Operações de Staging
- **Filosofia**: Falhas individuais não devem interromper o fluxo
- **Log**: Registrar warnings para arquivos problemáticos
- **Continuação**: Processar arquivos restantes

#### Operações de Commit
- **Filosofia**: Falhas de commit devem interromper o fluxo
- **Contexto**: Incluir stderr do comando git no erro
- **Formato**: "Git commit failed: {stderr_original}"

## Especificações de Integração

### Sistema RAG

**Query Obrigatória**: Para cada arquivo processado
**Formato da Query**: `"What does the source file '{caminho}' do?"`
**Modelo**: Sempre 'default'
**Tratamento**: Resultado como string simples no contexto do arquivo

### Templates de Prompt

#### Versionamento
- **commit/split-grouping**: v1.0.0
- **commit/aggregate-similar**: v1.0.0  
- **commit/single-aggregate**: v1.0.0

#### Sistema de Renderização
- Motor deve suportar substituição de variáveis
- Contexto estruturado como objeto/dict
- Suporte a JSON serialization para dados complexos

### Provedor LLM

**Tier Exclusivo**: 'default'
**Interface Mínima**: Método `chat(prompt, temperature)`
**Retorno**: String com resposta do modelo
**Parsing**: JSON automático pelo sistema de retry

## Comportamentos Críticos

### Gestão de Estados Git

1. **Auto-Stage + Split**:
   - `git add -A` → `git reset HEAD` → processamento individual

2. **Auto-Stage + Normal**:
   - `git add -A` → manter staged → processamento único

3. **Manual + Split**:
   - usar staged atual → `git reset HEAD` → processamento individual

4. **Manual + Normal**:
   - usar staged atual → processamento único

### Compatibilidade de Opções

- **`--amend` + `--split`**: INCOMPATÍVEL - falhar com erro explícito
- **`--dry-run`**: Compatível com qualquer combinação
- **`--auto-stage`**: Compatível com qualquer combinação

### Loops e Índices

**CRÍTICO**: Loops sobre arrays devem usar `< array.length`, nunca `<=`
**Razão**: Evitar acesso a índices indefinidos

### Tratamento de Arquivos Deletados

**Status 'D'**: Usar `git rm --cached --ignore-unmatch`
**Razão**: `git add` falha para arquivos que não existem mais no filesystem

## Estruturas de Dados

### Arquivo Enriquecido
- `file`: caminho do arquivo
- `status`: status Git ('A', 'M', 'D')
- `insertions`: número de linhas adicionadas
- `deletions`: número de linhas removidas
- `isBinary`: booleano indicando arquivo binário
- `oldFile`: caminho anterior (para renames)
- `path`: caminho normalizado
- `ragContext`: resultado da consulta RAG
- `diffAnalysis`: conteúdo do diff ou "File Deleted"

### Commit Gerado
- `commitSubject`: linha de subject do commit
- `commitBody`: corpo com lista de arquivos e intenções
- `commitFooter`: explicação/raciocínio
- `files`: array de caminhos de arquivos

## Validações Finais

### Dependências Funcionais
1. Sistema de configuração carregável
2. Provedor LLM com tier 'default'
3. Analisador de diffs Git
4. Executor de comandos shell
5. Sistema RAG funcional
6. Motor de templates com versionamento

### Comportamentos Essenciais
1. Processamento em lotes de 33 arquivos
2. Consulta RAG para cada arquivo
3. Tratamento especial de arquivos deletados
4. Sistema de retry com temperatura crescente
5. Validação de incompatibilidade de opções
6. Output JSON para dry-run

### Resultado Esperado
- ✅ Processar 160+ arquivos sem falhar
- ✅ Gerar commits semânticos agrupados logicamente
- ✅ Tratar todos os estados Git (A/M/D)
- ✅ Integrar contexto RAG meaningfully
- ✅ Suportar todos os modos (split, amend, dry-run)
- ✅ Seguir padrões de commits convencionais
- ✅ Funcionar de forma robusta com retry/error handling