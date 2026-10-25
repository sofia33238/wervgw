// Общая обвязка e2e: мок TikTok, настоящий Chrome с расширением, помощники для проверок и итог.
import { chromium } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, ACCOUNT } from './mock-tiktok.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const extensionPath = process.env.EXTENSION_PATH ? resolve(process.env.EXTENSION_PATH) : resolve(root, 'extension');
export const outDir = resolve(root, 'tests/e2e/out');
mkdirSync(outDir, { recursive: true });
export const PORT = 8443;
export const HOST = 'https://ads.tiktok.com';

export const results = [];
export const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '  ✔' : '  ✖'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};
export const section = (title) => console.log(`\n▶ ${title}`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function poll(fn, { timeout = 30000, interval = 250, label = 'условие' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(interval);
  }
  throw new Error(`Таймаут: ${label}${last instanceof Error ? ` (${last.message})` : ''}`);
}

export async function createHarness({ scale = 1 } = {}) {
  const mock = await startMock({ port: PORT });
  const profile = mkdtempSync(join(tmpdir(), 'tth-profile-'));
  const hosts = ['ads.tiktok.com', 'business-api.tiktok.com', 'business.tiktok.com', 'library.tiktok.com', 'track.example.com'];
  const context = await chromium.launchPersistentContext(profile, {
    headless: false, deviceScaleFactor: scale,
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    args: [
      '--headless=new', '--no-sandbox', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
      `--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1:${PORT}`).join(', ')}`, '--ignore-certificate-errors'
    ]
  });
  context.on('weberror', (e) => console.log('   [page error]', e.error().message));

  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  const swErrors = [], uiErrors = [];
  sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });

  const tabIdOf = (page) => sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, page.url());
  async function openUi(tabId, { width = 440, height = 640, tab = null } = {}) {
    const ui = await context.newPage();
    ui.on('pageerror', (e) => uiErrors.push(e.message));
    ui.on('console', (m) => { if (m.type() === 'error') uiErrors.push(m.text()); });
    await ui.setViewportSize({ width, height });
    await ui.goto(`chrome-extension://${extId}/ui/app.html?tab=${tabId}`);
    await ui.locator('.tab').first().waitFor();
    if (tab) await ui.locator(`.tab[data-tab="${tab}"]`).click();
    return ui;
  }
  const shot = async (page, name) => { await page.screenshot({ path: join(outDir, `${name}.png`) }); };
  const journal = () => sw.evaluate(async () => (await chrome.storage.local.get('journal')).journal ?? []);
  const sendMessage = (ui, ns, type, extra = {}) => ui.evaluate(([n, t, e]) => chrome.runtime.sendMessage({ ns: n, type: t, ...e }), [ns, type, extra]);
  const heroTitle = (ui) => ui.locator('.hero-title').innerText();

  async function newTikTokPage(path, host = HOST) {
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('   [tiktok page error]', e.message));
    await page.goto(`${host}${path}`);
    return page;
  }
  const draftUrl = async (page, goal) => page.evaluate(async ([g, account]) => (await (await fetch(`/mock/new-draft?aadvid=${account}&goal=${g}`, { method: 'POST' })).json()).url, [goal, ACCOUNT]);
  const extensionSaves = () => mock.state.saves.filter((s) => s.fromExtension);

  // Ждёт новую вкладку, открытую действием fn (клик по ссылке), и возвращает её адрес.
  async function opensTab(fn, timeout = 15000) {
    const [page] = await Promise.all([context.waitForEvent('page', { timeout }), fn()]);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const url = page.url();
    return { page, url };
  }

  async function finish() {
    await context.close().catch(() => {});
    await mock.stop().catch(() => {});
    const failed = results.filter((r) => !r.ok);
    console.log(`\nИтого: ${results.length - failed.length}/${results.length} проверок пройдено`);
    if (failed.length) { console.log('Провалены:\n' + failed.map((f) => ` - ${f.name}: ${f.detail}`).join('\n')); process.exitCode = 1; }
  }

  return { mock, context, sw, extId, swErrors, uiErrors, tabIdOf, openUi, shot, journal, sendMessage, heroTitle, newTikTokPage, draftUrl, extensionSaves, opensTab, finish };
}
