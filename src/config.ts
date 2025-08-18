import fs from 'fs';
import path from 'path';

export type Config = typeof import('../config.sample.json');

export function loadConfig(cwd = process.cwd()): Config {
  const candidates = [
    path.join(cwd, 'clia.config.json'),
    path.join(cwd, 'config.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  }
  // fallback to sample defaults
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.sample.json'), 'utf-8'));
}