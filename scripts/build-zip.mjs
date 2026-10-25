#!/usr/bin/env node
// Собирает dist/TTAds-Hub-<версия>.zip из папки extension/ (внутри архива — папка TTAds-Hub с manifest.json).
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip } from '../extension/background/s2s/zip.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'extension');
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

const files = (await walk(source)).sort();
const entries = [];
for (const file of files) {
  entries.push({ name: `TTAds-Hub/${relative(source, file).split(sep).join('/')}`, data: new Uint8Array(await readFile(file)) });
}
const zip = buildZip(entries, new Date());
await mkdir(resolve(root, 'dist'), { recursive: true });
const target = resolve(root, 'dist', `TTAds-Hub-${manifest.version}.zip`);
await writeFile(target, zip);
console.log(`${relative(root, target)} — ${entries.length} файлов, ${(zip.length / 1024).toFixed(1)} КБ`);
