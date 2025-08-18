#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { refactor } from './commands/refactor.js';
import { makeEmbeddings } from './embeddings/provider.js';
import { buildIndex } from './rag/index.js';
import { trelloCommands } from './commands/trello.js';

const program = new Command();
program.name('clia').description('Dev CLI with LLM, RAG, Trello and plugins').version('0.2.0');

program
  .command('refatore')
  .argument('<file>', 'arquivo alvo, ex.: src/users.ts')
  .argument('[instruction...]', 'instrução')
  .action(async (file: string, instruction: string[]) => {
    const instr = instruction.join(' ').trim() || 'Refatore melhorando legibilidade e extraindo funções.';
    const msg = await refactor(file, instr);
    console.log(msg);
  });

program
  .command('rag')
  .description('Indexa documentos locais')
  .action(async () => {
    const cfg = loadConfig();
    const rag = cfg.project.rag;
    const embedder = await makeEmbeddings(rag);
    const indexPath = await buildIndex(process.cwd(), rag.paths, rag.excludeGlobs, rag.chunkSize, rag.chunkOverlap, embedder);
    console.log('Index salvo em:', indexPath);
    console.log('Embeddings provider:', embedder.name);
  });

program.addCommand(trelloCommands());

program.parseAsync(process.argv);