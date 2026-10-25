// Сводка по всем кабинетам: список кабинетов → кампании каждого кабинета за период → состояние и причины.
import { HubError, requireAdsTab, runInPage } from '../lib/page.js';
import { listObjectsInPage } from '../data/page-scripts.js';
import { ROW_KEYS, periodRange } from '../explorer/model.js';
import { summarizeAccount } from './model.js';
import * as accounts from '../accounts/engine.js';

const KEY = 'overviewCache';
const FRESH_MS = 90 * 1000;
const SCAN_LIMIT = 50;
let inflight = null;

export async function cached() {
  return (await chrome.storage.local.get(KEY))[KEY] ?? null;
}

// Свежий результат из кэша отдаётся сразу; одновременные запросы делят одну проверку.
export function scan(tabId, { force = false, period = '7d' } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    const hit = await cached();
    if (!force && hit && hit.period === period && Date.now() - hit.scannedAt < FRESH_MS) return { ...hit, fromCache: true };
    const { tab } = await requireAdsTab(tabId);
    const list = await accounts.list(tab.id, { force: true });
    const targets = list.accounts.slice(0, SCAN_LIMIT);
    const range = periodRange(period);
    const data = await runInPage(tab.id, listObjectsInPage, [{ accounts: targets, level: 'campaign', ...range, keys: [...ROW_KEYS], pageSize: 200, maxRows: 400, concurrency: 3 }]);
    if (!data) throw new HubError('Не удалось прочитать данные TikTok Ads. Обновите страницу и повторите.');
    if (data.error) throw new HubError(data.error);
    const byId = new Map(data.results.map((r) => [r.id, r]));
    const result = {
      scannedAt: Date.now(), period, ...range, currentAccount: list.currentAccount,
      accounts: targets.map((a) => summarizeAccount(a, byId.get(a.id))),
      businessCenters: list.businessCenters, totalAccounts: list.total, truncated: list.total > targets.length
    };
    await chrome.storage.local.set({ [KEY]: result });
    return result;
  })().finally(() => { inflight = null; });
  return inflight;
}
