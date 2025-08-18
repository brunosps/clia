import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { execa } from 'execa';

export async function mcpFilesystemRead(p: string): Promise<string> {
  const confirm = await askConfirm(`MCP filesystem: ler ${p}? [y/N] `);
  if (!confirm) throw new Error('Negado pelo usuário');
  return fs.readFileSync(path.resolve(p), 'utf-8');
}

export async function mcpGitShow(ref: string, filePath: string): Promise<string> {
  const confirm = await askConfirm(`MCP git: show ${ref}:${filePath}? [y/N] `);
  if (!confirm) throw new Error('Negado pelo usuário');
  const { stdout } = await execa('git', ['show', `${ref}:${filePath}`]);
  return stdout;
}

export async function mcpFetch(url: string): Promise<string> {
  const confirm = await askConfirm(`MCP fetch: GET ${url}? [y/N] `);
  if (!confirm) throw new Error('Negado pelo usuário');
  const r = await fetch(url); return await r.text();
}

async function askConfirm(q: string): Promise<boolean> {
  process.stdout.write(q);
  return await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', d => {
      const v = (d+'').trim().toLowerCase();
      resolve(v === 'y' || v === 'yes' || v === 's' || v === 'sim');
    });
  });
}