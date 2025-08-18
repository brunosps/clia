import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
// TODO: HNSWLib import needs to be fixed based on available langchain version
// import { HNSWLib } from 'langchain/vectorstores/hnswlib';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import type { Embeddings } from '../embeddings/provider.js';

export async function buildIndex(baseDir: string, paths: string[], exclude: string[], chunkSize: number, chunkOverlap: number, embedder: Embeddings) {
  const files: string[] = [];
  for (const p of paths) {
    const found = await glob(path.join(baseDir, p, '**/*.*'), { ignore: exclude });
    files.push(...found);
  }
  const docs: Document[] = [];
  for (const f of files) {
    try {
      const text = fs.readFileSync(f, 'utf-8');
      docs.push(new Document({ pageContent: text, metadata: { source: path.relative(baseDir, f) } }));
    } catch {}
  }
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  const splitDocs = await splitter.splitDocuments(docs);

  // TODO: Replace with actual vector store implementation
  // const vectorStore = await HNSWLib.fromDocuments(splitDocs, {
  //   embedQuery: async (txt: string) => (await embedder.embed([txt]))[0],
  //   embedDocuments: (arr: string[]) => embedder.embed(arr)
  // } as any);

  const indexPath = path.join(baseDir, '.clia', 'hnswlib');
  fs.mkdirSync(indexPath, { recursive: true });
  // await vectorStore.save(indexPath);
  
  // Simple fallback: save split docs as JSON for now
  fs.writeFileSync(path.join(indexPath, 'docs.json'), JSON.stringify(splitDocs, null, 2));
  return indexPath;
}

// Simple selective retrieval by filename hints
export async function retrieveForFiles(query: string, changedFiles: string[], k = 6) {
  const indexPath = path.join(process.cwd(), '.clia', 'hnswlib');
  if (!fs.existsSync(indexPath)) return [];
  
  // TODO: Replace with actual vector store loading
  // const vectorStore = await HNSWLib.load(indexPath, {
  //   embedQuery: async () => { throw new Error('embedQuery not wired here'); },
  //   embedDocuments: async () => { throw new Error('embedDocuments not wired here'); }
  // } as any);

  // Simple fallback: load from JSON for now
  const docsPath = path.join(indexPath, 'docs.json');
  if (!fs.existsSync(docsPath)) return [];
  
  const docs = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));

  // naive filter: prefer docs whose source path shares directory prefixes with changed files
  const hints = new Set(changedFiles.map(f => f.split(path.sep)[0]));
  const filtered = docs.filter((d: any) => {
    const src = (d.metadata?.source || '') as string;
    return Array.from(hints).some(h => src.startsWith(h + path.sep)) || src.includes('instructions');
  }).map((d: any) => d.pageContent.slice(0, 2000));

  // return top-k filtered chunks (no real scoring here to avoid re-embedding); caller can join for prompt
  return filtered.slice(0, k);
}