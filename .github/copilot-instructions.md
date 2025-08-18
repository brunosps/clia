# CLIA - AI Coding Agent Instructions

## Project Overview
CLIA is a developer productivity tool that combines LLM capabilities, RAG (Retrieval-Augmented Generation), and Trello integration for automated development workflows. The CLI generates code refactors, creates features from Trello cards, and maintains development context through semantic search.

## Architecture & Core Components

### Configuration System (`src/config.ts`)
- Uses cascading config: `clia.config.json` → `config.json` → `config.sample.json` fallback
- Central configuration drives all LLM, RAG, Trello, and Git workflows
- Budget-aware LLM provider selection based on cost estimates

### Command Structure (`src/index.ts`)
- Built on Commander.js with Portuguese command names (`refatore`, not `refactor`)
- Entry commands: `refatore <file> [instruction]`, `rag`, `trello feature/bugfix <cardId>`
- All commands load config first, then instantiate providers

### LLM Provider Pattern (`src/llm/provider.ts`)
- Single `LLM` interface with `chat()` method and provider name
- Supports Anthropic (default), OpenAI, DeepSeek, and Ollama with fallback logic
- Environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`

### Budget-Driven Model Selection (`src/shared/budget.ts`)
- Cost estimation based on input tokens + expected output tokens
- Auto-downgrades to cheaper models when cost exceeds `perRunUSD` budget
- Downgrade priority: Ollama (free) → DeepSeek → other providers
- Token approximation: ~4 chars per token

### RAG System (`src/rag/index.ts`)
- Simple document chunking with configurable size/overlap from config
- Selective retrieval filters docs by file path hints for context relevance
- Embeddings support: Ollama (preferred) or local Transformers fallback
- **Current limitation**: Simplified JSON storage instead of HNSWLIB vector store due to dependency conflicts

## Key Workflows

### Refactor Command (`src/commands/refactor.ts`)
- Generates unified diff patches that apply via `git apply --index`
- Falls back to saving patch in `.clia/patch.diff` if application fails
- Always includes git staging (`--index`) for clean workflow

### Trello Feature/Bug Workflow (`src/commands/trello.ts`)
- **Two-phase LLM approach**: Card → Lean Task Spec → Implementation Plan
- **Branch creation**: `features/<prefix>-<slugified-title>` from main branch
- **RAG integration**: Retrieves relevant docs based on changed files or app directories
- **Auto-commits** with conventional format: `feat: <title>`
- **GitHub CLI integration**: Creates PR using template at `cfg.pr.template`
- **Trello automation**: Moves cards between configured columns

### Essential File Patterns
- Output directory: `.clia/` for patches, specs, plans
- Changelog generation in configurable directory with date-prefixed files
- Git operations use `simple-git` library with main branch sync before feature branches

## Development Commands

```bash
# Build & Development
npm run build          # Compile TypeScript to dist/
npm run dev           # Watch mode compilation
npm start             # Run compiled CLI

# RAG Operations  
npm run rag:index     # Build vector index from configured paths
npm run rag:query     # Test query against index

# CLI Usage
./dist/index.js refatore src/file.ts "improvement instruction"
./dist/index.js trello feature CARD_ID
```

## Project-Specific Conventions

### Error Handling
- Portuguese error messages throughout codebase
- Git operations have graceful fallbacks (save patches vs. throw)
- User confirmation prompts for MCP operations (`src/mcp/stubs.ts`)

### File Organization
- TypeScript with ES2022 modules and `.js` imports for compiled output
- Providers follow factory pattern: `make*()` functions return interfaces
- Commands are separate modules imported into main CLI router

### Integration Points
- **Trello API**: REST calls with key/token auth, board/list/card operations
- **Git**: Both `execa` shell commands and `simple-git` library usage  
- **GitHub CLI**: `gh pr create --fill` for PR automation
- **MCP Protocol**: Stub implementations for filesystem, git, fetch operations

## Critical Dependencies
- `commander` for CLI structure
- `langchain` + `hnswlib-node` for RAG vector operations
- `@xenova/transformers` for local embeddings fallback
- `simple-git` for Git operations alongside `execa` for shell commands

When implementing features, prioritize the two-phase LLM workflow pattern and maintain the Portuguese CLI interface while ensuring all generated patches are git-applicable.