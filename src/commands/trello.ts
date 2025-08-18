import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { TrelloClient } from '../trello/client.js';
import { execa } from 'execa';
import path from 'path';
import fs from 'fs';
import simpleGit from 'simple-git';
import { makeLLM } from '../llm/provider.js';
import { estimateCostUSD, shouldUpgradeModel } from '../shared/budget.js';
import { retrieveForFiles } from '../rag/index.js';

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

async function ensureBranch(base: string, featureBranch: string) {
  const git = simpleGit();
  await git.fetch();
  await git.checkout(base);
  await git.pull('origin', base);
  await git.checkoutLocalBranch(featureBranch);
}

async function readGitDiffNames(): Promise<string[]> {
  const { stdout } = await execa('git', ['diff', '--name-only']);
  return stdout.split('\n').filter(Boolean);
}

async function commitAll(message: string) {
  const git = simpleGit();
  await git.add(['-A']);
  await git.commit(message);
}

async function openPR(templatePath: string | undefined) {
  try {
    const args = ['pr', 'create', '--fill'];
    if (templatePath && fs.existsSync(templatePath)) {
      // gh respects PR template from repo; --fill uses it. We'll just rely on template existing.
    }
    await execa('gh', args, { stdio: 'inherit' });
  } catch (e) {
    console.error('Falha ao abrir PR com gh CLI. Instale e autentique `gh`.');
  }
}

function buildLeanSpecPrompt(cardTitle: string, cardDesc: string, type: 'feature'|'bug') {
  return [
    `Gere um Lean Task Spec a partir do card Trello (${type}).`,
    `Título: ${cardTitle}`,
    `Descrição do Card (markdown):\n${cardDesc}`,
    '',
    'Formato de saída (markdown):',
    '# Lean Task Spec',
    '## Job Story',
    'Quando ..., eu quero ..., para que ...',
    '## Critérios de Aceitação (Gherkin)',
    '- Dado ..., Quando ..., Então ...',
    '## Requisitos Não Funcionais',
    '- ...',
    '## Plano de Mudança (alto nível)',
    '1) ...',
    '## Testes',
    '- Unit, Integration, E2E',
    '## Definition of Done',
    '- [ ] Itens objetivos',
  ].join('\n');
}

function buildImplementationPrompt(leanSpec: string, ragSnippets: string[]) {
  const rag = ragSnippets.length ? ('\n\n# Regras/Referências relevantes\n' + ragSnippets.join('\n---\n')) : '';
  return [
    'Gere um plano de implementação detalhado com diffs unificados por arquivo conforme o Lean Task Spec.',
    'Restrições:',
    '- Use diffs `unified` aplicáveis com `git apply`.',
    '- Respeite arquitetura (Server Actions + Repositórios) e padrões do projeto.',
    leanSpec,
    rag
  ].join('\n');
}

export function trelloCommands() {
  const cmd = new Command('trello');

  async function runCard(type: 'feature'|'bug', cardId: string) {
    const cfg = loadConfig();
    const trello = new TrelloClient(cfg.trello);
    const card = await trello.getCard(cardId) as any;
    const lists = await trello.getListsOnBoard(cfg.trello.boardId) as any[];
    const listMap = Object.fromEntries(lists.map((l: any) => [l.name, l.id]));

    const title: string = card.name || `${type.toUpperCase()} ${cardId}`;
    const desc: string = card.desc || '';
    const idPrefix = cfg.trello.idPrefix ? (cfg.trello.idPrefix + '-') : '';
    const branchBase = cfg.git.main;
    const branchName = `${cfg.git.featurePrefix}${idPrefix}${toSlug(title)}`;

    // Budget guard rough estimate: instructions + card desc
    const llmCfg = { ...cfg.llm };
    const provider = llmCfg.defaultProvider as keyof typeof llmCfg.models;
    const providerKey = `${llmCfg.defaultProvider}:${llmCfg.models[provider]}`;
    const estCost = estimateCostUSD(llmCfg, providerKey, desc, 800);
    if (shouldUpgradeModel(llmCfg.budget.perRunUSD, estCost)) {
      // try cheaper: ollama (free) > deepseek > others
      if (llmCfg.defaultProvider !== 'ollama') {
        if (llmCfg.defaultProvider !== 'deepseek') {
          llmCfg.defaultProvider = 'deepseek';
        } else {
          llmCfg.defaultProvider = 'ollama';
        }
      }
    }

    const llm = await makeLLM(llmCfg);

    // Step 1: Lean Task Spec from card
    const spec = await llm.chat(buildLeanSpecPrompt(title, desc, type));

    // Step 2: create branch
    await ensureBranch(branchBase, branchName);

    // Step 3: RAG selective by current diff names (likely empty initially) or by app dirs
    const changed = await readGitDiffNames();
    const ragSnippets = await retrieveForFiles('implementation rules', changed.length ? changed : ['src', 'apps', 'packages']);

    // Step 4: Implementation plan + diffs
    const impl = await llm.chat(buildImplementationPrompt(spec, ragSnippets));

    // Write plan to .clia/plan.md
    const outDir = path.join(process.cwd(), '.clia'); fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'lean_spec.md'), spec, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'impl_plan.md'), impl, 'utf-8');

    // Try apply patch blocks present
    const patchStart = impl.indexOf('--- a/');
    if (patchStart >= 0) {
      const patch = impl.slice(patchStart);
      try {
        await execa('git', ['apply', '--index', '--whitespace=fix', '-'], { input: patch, stdio: 'inherit' });
      } catch {
        // keep patch on disk
        fs.writeFileSync(path.join(outDir, 'patch.diff'), patch, 'utf-8');
      }
    }

    // Step 5: Commit
    const commitMsg = `feat: ${title}`;
    await commitAll(commitMsg);

    // Step 6: PR
    await openPR(cfg.pr.template);

    // Step 7: Changelog
    const chDir = path.join(process.cwd(), cfg.changelogs.dir);
    fs.mkdirSync(chDir, { recursive: true });
    const date = new Date().toISOString().slice(0,10);
    const chName = `${date}-${toSlug(title)}.md`;
    fs.writeFileSync(path.join(chDir, chName), `# ${title}\n\nGerado pelo clia (feature).\n`, 'utf-8');

    // Step 8: Move card to next column
    const next = cfg.trello.columns.inProgress && listMap[cfg.trello.columns.inProgress];
    if (next) {
      await trello.moveCardToList(cardId, next);
    }

    console.log('Feature fluxo concluído (parcialmente automatizado).');
  }

  cmd
    .command('feature')
    .argument('<cardId>')
    .action(async (cardId: string) => runCard('feature', cardId));

  cmd
    .command('bugfix')
    .argument('<cardId>')
    .action(async (cardId: string) => runCard('bug', cardId));

  return cmd;
}