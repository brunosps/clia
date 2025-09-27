#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registerAnalyzeCommand } from './commands/analyze.js';
import { askCommand } from './commands/ask.js';
import { commitCommand } from './commands/commit.js';
import { configureCommand } from './commands/configure.js';
import { installCommand } from './commands/install.js';
import { inspectCommand } from './commands/inspect.js';
import { ragCommand } from './commands/rag.js';
import { reviewCommand } from './commands/review.js';
import { securityScanCommand } from './commands/security-scan.js';
import { stackCommand } from './commands/stack.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;

const program = new Command();
program.name('clia').description('Dev CLI with LLM, RAG, Trello and plugins').version(version);

registerAnalyzeCommand(program);
program.addCommand(askCommand());
program.addCommand(commitCommand());
program.addCommand(configureCommand());
program.addCommand(installCommand());
program.addCommand(inspectCommand());
program.addCommand(ragCommand());
program.addCommand(reviewCommand());
program.addCommand(securityScanCommand());
program.addCommand(stackCommand());

program.parseAsync(process.argv);
