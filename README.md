# CLIA - AI Coding Agent

CLIA é uma ferramenta de produtividade para desenvolvedores que combina capacidades de LLM, RAG (Retrieval-Augmented Generation) e integração com Trello para workflows de desenvolvimento automatizados.

## Características

- 🤖 **Refatoração com IA**: Melhoramento automático de código usando LLMs
- 📚 **RAG System**: Busca semântica em documentação local para contexto relevante  
- 🔗 **Integração Trello**: Geração automática de features/bugfixes a partir de cards
- 💰 **Gestão de Orçamento**: Seleção inteligente de modelos baseada em custo
- 🔄 **Múltiplos Provedores**: Suporte para Anthropic, OpenAI, DeepSeek e Ollama

## Instalação

```bash
npm install
npm run build
```

## Configuração

Crie um arquivo `clia.config.json` ou use `config.json`:

```json
{
  "llm": {
    "defaultProvider": "deepseek",
    "models": {
      "anthropic": "claude-3-haiku-20240307",
      "openai": "gpt-4o-mini", 
      "deepseek": "deepseek-coder",
      "ollama": "qwen2.5-coder:7b"
    }
  }
}
```

### Variáveis de Ambiente

```bash
export ANTHROPIC_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
export DEEPSEEK_API_KEY="your-key"
export TRELLO_KEY="your-key"
export TRELLO_TOKEN="your-token"
```

## Uso

### Refatoração de Código

```bash
./dist/index.js refatore src/file.ts "melhorar legibilidade"
```

### Indexação RAG

```bash
./dist/index.js rag
```

### Integração Trello

```bash
# Criar feature a partir de card Trello
./dist/index.js trello feature CARD_ID

# Criar bugfix a partir de card Trello  
./dist/index.js trello bugfix CARD_ID
```

## Estrutura do Projeto

- `src/config.ts` - Sistema de configuração cascateada
- `src/llm/provider.ts` - Abstração para provedores LLM
- `src/commands/` - Comandos do CLI (refactor, trello)
- `src/rag/` - Sistema de busca semântica
- `src/shared/budget.ts` - Gestão de orçamento e downgrade de modelos

## Workflow Trello

1. **Análise do Card**: Extrai título e descrição
2. **Lean Task Spec**: Gera especificação detalhada via LLM
3. **Implementação**: Cria plano com diffs aplicáveis
4. **Branch & Commit**: Cria branch e commit automático
5. **Pull Request**: Integração com GitHub CLI
6. **Atualização Trello**: Move card para próxima coluna

## Licença

MIT