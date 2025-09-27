# CLIA - AI Coding Agent Instructions

## Project Overview
CLIA v0.2.1 is a developer productivity tool with **100% real data via MCP (Model Context Protocol)** integration. Combines LLM capabilities, RAG, security scanning, stack detection, and strategic analysis for automated development workflows. Zero simulations - all data comes from real MCP servers.

## Architecture & Core Components

### Configuration System (`src/config.ts`)
- Uses cascading config: `clia.config.json` → `config.json` → `config.sample.json` fallback
- Loads credentials from `.clia/.env` file (git-ignored)
- Environment variables injected into config at runtime for integrations
- Central configuration drives all LLM, RAG, MCP, and Git workflows
- Budget-aware LLM provider selection based on cost estimates

### Command Structure (`src/index.ts`)
- Built on Commander.js with **Portuguese command names** (`refatore`, not `refactor`)
- Core commands: `install`, `refatore`, `rag`, `trello`, `insight`, `security-scan`, `stack`
- Install command provides interactive setup for new projects
- All commands load config first, then instantiate MCP client and providers

### MCP (Model Context Protocol) Integration (`src/mcp/client.ts`)
- **Real MCP implementations**: Semgrep MCP, Stack Detector MCP (live)
- **Pending implementations**: GitHub MCP, StackOverflow MCP, Context7 MCP
- `McpClient.fromConfig()` - centralized client instantiation
- No more simulated data - everything via real MCP protocol calls
- Handles git operations, security scanning, stack detection through MCP servers

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
- Real document indexing with configurable chunking (size/overlap from config)
- Selective retrieval filters docs by file path hints for context relevance
- Embeddings support: Ollama (preferred) or local Transformers fallback
- JSON storage for vector indices with query capabilities
- Enhanced with RAG context integration in insight command

## Key Workflows

### Refactor Command (`src/commands/refactor.ts`)
- Generates unified diff patches that apply via `git apply --index`
- Falls back to saving patch in `.clia/patch.diff` if application fails
- Always includes git staging (`--index`) for clean workflow

### Strategic Analysis (`src/commands/insight.ts`)
- **Design Thinking methodology** with 3-horizon strategic planning
- **RAG-enhanced analysis**: Integrates project documentation and context
- **Real MCP data collection**: Git commits, stack detection, repository stats
- Output formats: JSON, Markdown with actionable next steps
- Prompt: `src/prompts/insight/1.0.0/system.md` with comprehensive analysis framework

### Security Scanning (`src/commands/security-scan.ts`)
- **Real Semgrep integration** via MCP for code vulnerability analysis
- **Trivy scanning** for dependencies and infrastructure-as-code
- **Policy-driven security** (`src/security/policy.ts`) with three modes:
  - `permissive`: Allow all except explicitly denied
  - `moderate`: Allow list + approval for unknown commands
  - `restrictive`: Only allow explicitly permitted commands
- **Risk assessment** with automatic mitigation suggestions

### Stack Detection (`src/commands/stack.ts`)
- **Real stack analysis** via MCP Stack Detector server
- Detects languages, frameworks, package managers, linting tools
- AI-powered recommendations for tooling and modernization
- Integration with security and insight workflows

### Trello Feature/Bug Workflow (`src/commands/trello.ts`)
- **Two-phase LLM approach**: Card → Lean Task Spec → Implementation Plan
- **Branch creation**: `features/<prefix>-<slugified-title>` from main branch
- **RAG integration**: Retrieves relevant docs based on changed files or app directories
- **Auto-commits** with conventional format: `feat: <title>`
- **GitHub CLI integration**: Creates PR using template at `cfg.pr.template`
- **Trello automation**: Moves cards between configured columns

### Essential File Patterns
- Output directory: `.clia/` for patches, specs, plans, insights
- Changelog generation in configurable directory with date-prefixed files
- Git operations use `simple-git` library with main branch sync before feature branches
- Security policy configuration in `clia.config.json` with command allowlists/denylists
- Prompt versioning: `src/prompts/{command}/{version}/system.md` structure

## Development Commands

```bash
# Build & Development
npm run build          # Compile TypeScript to dist/
npm run dev           # Watch mode compilation
npm start             # Run compiled CLI

# Project Setup
npm start -- install  # Interactive setup for target project

# Strategic Analysis
npm start -- insight                    # Run strategic analysis with Design Thinking
npm start -- insight --detailed         # Include advanced metrics and deep analysis
npm start -- insight --format markdown # Output in markdown format

# Security & Stack Analysis
npm start -- security-scan              # Run Semgrep security analysis
npm start -- security-scan --trivy      # Include Trivy dependency/IaC scanning
npm start -- stack                      # Detect and analyze technology stack

# RAG Operations  
npm start -- rag index                  # Build vector index from configured paths
npm start -- rag query "search term"    # Query the RAG database

# CLI Usage
npm start -- refatore src/file.ts "improvement instruction"
npm start -- trello feature CARD_ID
```

## Project-Specific Conventions

### Error Handling
- Portuguese error messages throughout codebase
- Git operations have graceful fallbacks (save patches vs. throw)
- User confirmation prompts for MCP operations (`src/mcp/stubs.ts`)
- Security policy enforcement with approval workflows for unknown commands

### File Organization
- TypeScript with ES2022 modules and `.js` imports for compiled output
- Providers follow factory pattern: `make*()` functions return interfaces
- Commands are separate modules imported into main CLI router
- Prompts versioned in `src/prompts/{command}/{version}/` structure
- Real vs simulated data: **All data now comes from real MCP servers**

### Integration Points
- **MCP Protocol**: Real implementations for Semgrep, Stack Detector, Git operations
- **Pending MCP servers**: GitHub, StackOverflow, Context7 (stub implementations available)
- **Trello API**: REST calls with key/token auth, board/list/card operations
- **Git**: Both `execa` shell commands and `simple-git` library usage  
- **GitHub CLI**: `gh pr create --fill` for PR automation
- **Security Tools**: Semgrep for SAST, Trivy for dependency/IaC scanning

## Critical Dependencies
- `commander` for CLI structure
- `langchain` + `hnswlib-node` for RAG vector operations
- `@xenova/transformers` for local embeddings fallback
- `simple-git` for Git operations alongside `execa` for shell commands
- **Real MCP integrations**: All security scanning, stack detection, git operations via MCP protocol

When implementing features, prioritize the two-phase LLM workflow pattern, maintain the Portuguese CLI interface, ensure all generated patches are git-applicable, and leverage real MCP data sources over simulations.