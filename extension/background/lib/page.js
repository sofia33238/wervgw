import { ORIGIN } from './constants.js';

export class HubError extends Error {
  constructor(message, code = 'error') {
    super(message);
    this.name = 'HubError';
    this.code = code;
  }
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseAdsUrl(url) {
  try {
    const u = new URL(url);
    return {
      ok: u.origin === ORIGIN,
      url: u,
      path: u.pathname,
      account: u.searchParams.get('aadvid') || u.searchParams.get('advertiser_id') || null,
      draft: u.searchParams.get('campaign_draft_id') || null
    };
  } catch {
    return { ok: false, url: null, path: '', account: null, draft: null };
  }
}

export const accountFromUrl = (url) => parseAdsUrl(url).account;

export async function requireAdsTab(tabId) {
  if (!Number.isInteger(tabId)) throw new HubError('Не выбрана вкладка TikTok Ads Manager.', 'no_tab');
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { throw new HubError('Вкладка закрыта. Откройте TikTok Ads Manager.', 'no_tab'); }
  const info = parseAdsUrl(tab.url ?? '');
  if (!info.ok) throw new HubError('Откройте вкладку TikTok Ads Manager (ads.tiktok.com).', 'not_ads');
  return { tab, info };
}

// Запуск функции в странице. Функция должна быть самодостаточной (без замыканий и импортов).
export async function runInPage(tabId, func, args = [], world = 'MAIN') {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, world, func, args });
  return frame?.result;
}

export function friendlyError(error) {
  if (error instanceof HubError) return error.message;
  const message = String(error?.message ?? error ?? 'Неизвестная ошибка');
  if (/Cannot access|cannot be scripted|extensions gallery/i.test(message)) return 'Эту страницу нельзя использовать. Откройте ads.tiktok.com.';
  if (/No tab with id|tab was closed|Frame with ID .* was removed/i.test(message)) return 'Вкладка закрыта или перезагружается. Повторите.';
  return message;
}
