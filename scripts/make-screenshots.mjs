// Снимает чистые скриншоты интерфейса для README на моке TikTok (без всплывающих уведомлений, 2× разрешение).
// Запуск: node scripts/make-screenshots.mjs   (нужны Chrome и openssl; результат — docs/screenshots/)
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, poll } from '../tests/e2e/harness.mjs';
import { ACCOUNT } from '../tests/e2e/mock-tiktok.mjs';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/screenshots');
mkdirSync(out, { recursive: true });
const h = await createHarness({ scale: 2 });
const shot = (ui, name) => ui.screenshot({ path: resolve(out, `${name}.png`) });
const settings = (ui, patch) => h.sendMessage(ui, 'settings', 'patch', { patch });
try {
  const ads = await h.newTikTokPage(`/i18n/manage/campaign?aadvid=${ACCOUNT}`);
  const tabId = await h.tabIdOf(ads);
  let ui = await h.openUi(tabId, { tab: 'links', height: 700 });
  await ui.addStyleTag({ content: '#toasts{display:none!important}' });
  await settings(ui, { ui: { theme: 'dark' }, accounts: { meta: { [ACCOUNT]: { label: 'Прогрев', color: 'blue', note: 'карта 2230, прокси US', pinned: true } } } });
  await poll(async () => (await ui.locator('.link-tile').count()) === 6, { label: 'плитки' });
  await poll(async () => (await ui.locator('.links-ctx select[aria-label="Кабинет"] option').count()) > 3, { label: 'кабинеты' });
  await shot(ui, 'links');

  await ui.close();
  ui = await h.openUi(tabId, { tab: 'pixel', height: 700 });
  await ui.addStyleTag({ content: '#toasts{display:none!important}' });
  await ui.locator('.alert.info').waitFor();
  await ui.locator('.btn', { hasText: 'Создать пиксель и получить токен' }).click();
  await ui.locator('.alert.ok', { hasText: 'Пиксель создан' }).waitFor();
  await shot(ui, 'pixel');

  await ui.close();
  ui = await h.openUi(tabId, { tab: 'overview', height: 760 });
  await ui.addStyleTag({ content: '#toasts{display:none!important}' });
  await poll(async () => (await ui.locator('.account-card').count()) === 4, { label: 'карточки', timeout: 40000 });
  await ui.evaluate(() => document.querySelector('#view').scrollTo(0, 150));
  await shot(ui, 'overview');

  await ui.locator(`.account-card[data-id="${ACCOUNT}"]`).getByRole('button', { name: 'Подробнее' }).click();
  await poll(async () => (await ui.locator('.ex-row').count()) === 3, { label: 'кампании' });
  await ui.locator('.ex-row', { hasText: 'Campaign A' }).locator('.ex-main').click();
  await shot(ui, 'explorer');

  await ui.locator('.ex-head').getByRole('button', { name: 'Обзор' }).click();
  await ui.locator('#btn-account').click();
  await ui.locator('.picker-row').first().waitFor();
  await shot(ui, 'picker');
  await ui.keyboard.press('Escape');

  await ui.locator('#btn-settings').click();
  await ui.locator('.sheet').waitFor();
  await ui.locator('.sheet .section-label', { hasText: 'Мониторинг' }).scrollIntoViewIfNeeded();
  await ui.waitForTimeout(500);
  await shot(ui, 'settings');
  await ui.keyboard.press('Escape');

  await settings(ui, { ui: { theme: 'light' } });
  await ui.close();
  ui = await h.openUi(tabId, { tab: 'links', height: 700 });
  await ui.addStyleTag({ content: '#toasts{display:none!important}' });
  await poll(async () => (await ui.locator('.link-tile').count()) === 6, { label: 'плитки (светлая тема)' });
  await shot(ui, 'links-light');
  console.log('Скриншоты сохранены в docs/screenshots');
} finally {
  await h.finish();
}
