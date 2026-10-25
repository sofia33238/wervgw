// Рендер PNG-иконок из assets/logo.svg через Chrome (нужен CHROME_PATH или google-chrome в PATH).
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(resolve(root, 'extension/assets/logo.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(resolve(root, `extension/assets/icon-${size}.png`), png);
  console.log('icon', size, png.length, 'bytes');
}
await browser.close();
