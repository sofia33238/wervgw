// TTAds Hub — оболочка интерфейса: вкладки, контекст активной вкладки TikTok, тема, настройки.
import { h, $, clear, toast, copyText, fill } from './lib/dom.js';
import { icon } from './lib/icons.js';
import * as bus from './lib/bus.js';
import { mountManual } from './views/manual.js';
import { mountAppeals } from './views/appeals.js';
import { mountS2S } from './views/s2s.js';
import { mountJournal } from './views/journal.js';
import { openSettings } from './views/settings.js';

const params = new URLSearchParams(location.search);
const fixedTabId = Number(params.get('tab')) || null;
const mode = fixedTabId ? 'window' : 'popup';
document.body.classList.add(mode);

const TABS = [
  { id: 'manual', title: 'Manual', icon: 'zap', mount: mountManual },
  { id: 'appeals', title: 'Апелляции', icon: 'send', mount: mountAppeals },
  { id: 's2s', title: 'S2S', icon: 'link', mount: mountS2S },
  { id: 'journal', title: 'Журнал', icon: 'activity', mount: mountJournal }
];

const state = { tab: null, settings: null, current: null, unmount: null, listeners: new Set(), badges: {} };

const ctx = {
  mode,
  get tab() { return state.tab; },
  get tabId() { return state.tab?.id ?? null; },
  get onAds() { return /^https:\/\/ads\.tiktok\.com\//.test(state.tab?.url ?? ''); },
  get settings() { return state.settings; },
  async saveSettings(patch) {
    state.settings = await bus.settings.patch(patch);
    applyTheme();
    return state.settings;
  },
  onTab(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener); },
  refreshTab: () => refreshTab(true),
  setBadge(tabId, value) { state.badges[tabId] = value; renderTabs(); },
  show: (id) => select(id),
  toast
};

function applyTheme() {
  const pref = state.settings?.ui?.theme ?? 'auto';
  const theme = pref === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = theme;
}

async function resolveTab() {
  try {
    if (fixedTabId) return await chrome.tabs.get(fixedTabId);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch { return null; }
}

async function refreshTab(force = false) {
  const tab = await resolveTab();
  const changed = force || tab?.id !== state.tab?.id || tab?.url !== state.tab?.url;
  state.tab = tab;
  if (changed) { renderContext(); for (const listener of state.listeners) listener(tab); }
}

function accountOf(url) {
  try { return new URL(url).searchParams.get('aadvid') || new URL(url).searchParams.get('advertiser_id'); } catch { return null; }
}

function renderContext() {
  const line = $('#ctx-line'), chip = $('#btn-account');
  if (!state.tab) { line.textContent = 'Вкладка не найдена'; chip.hidden = true; return; }
  if (!ctx.onAds) {
    line.textContent = 'Откройте ads.tiktok.com';
    chip.hidden = true;
    return;
  }
  const account = accountOf(state.tab.url);
  line.textContent = account ? 'Ads Manager · подключён' : 'Ads Manager · нет aadvid';
  chip.hidden = false;
  fill(chip, h('span', { class: account ? 'dot' : 'dot warn' }), account ? `…${account.slice(-6)}` : 'нет aadvid');
  chip.title = account ? `Кабинет ${account} — нажмите, чтобы скопировать` : 'В адресе нет aadvid';
  chip.onclick = async () => { if (account && await copyText(account)) toast('ID кабинета скопирован', 'ok'); };
}

function buildTabs() {
  const nav = clear($('#tabs'));
  for (const tab of TABS) {
    nav.append(h('button', {
      class: 'tab', type: 'button', role: 'tab', dataset: { tab: tab.id }, onclick: () => select(tab.id)
    }, h('span', { class: 'tab-ico' }, icon(tab.icon, 15)), tab.title));
  }
  nav.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const index = (TABS.findIndex((t) => t.id === state.current) + step + TABS.length) % TABS.length;
    select(TABS[index].id);
    nav.querySelector(`[data-tab="${TABS[index].id}"]`).focus();
    event.preventDefault();
  });
}

// Обновляем существующие кнопки, а не пересоздаём: так не теряются фокус и клики.
function renderTabs() {
  for (const button of document.querySelectorAll('#tabs .tab')) {
    const id = button.dataset.tab, badge = state.badges[id];
    button.setAttribute('aria-selected', String(id === state.current));
    button.tabIndex = id === state.current ? 0 : -1;
    const ico = button.querySelector('.tab-ico');
    let mark = ico.querySelector('.badge');
    if (badge && !mark) ico.append(mark = h('span', { class: 'badge' }));
    if (mark) { if (badge) mark.textContent = badge > 99 ? '99+' : String(badge); else mark.remove(); }
  }
}

function select(id) {
  if (!TABS.some((t) => t.id === id)) id = 'manual';
  if (state.current === id && state.unmount) return;
  state.unmount?.();
  state.current = id;
  try { localStorage.setItem('tth.tab', id); } catch { /* необязательно */ }
  renderTabs();
  const view = $('#view');
  clear(view);
  view.classList.remove('flush');
  state.unmount = TABS.find((t) => t.id === id).mount(view, ctx) ?? null;
}

async function boot() {
  $('#btn-window').append(icon('external', 17));
  $('#btn-settings').append(icon('sliders', 17));
  if (mode === 'window') $('#btn-window').hidden = true;
  $('#btn-settings').onclick = () => openSettings(ctx);
  $('#btn-window').onclick = async () => {
    if (!state.tab) return toast('Нет активной вкладки', 'error');
    await chrome.windows.create({ url: chrome.runtime.getURL(`ui/app.html?tab=${state.tab.id}`), type: 'popup', width: 470, height: 790 });
    window.close();
  };
  buildTabs();
  try { state.settings = await bus.settings.get(); } catch { state.settings = null; }
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  await refreshTab(true);
  setInterval(() => refreshTab(false), 1500);
  let initial = 'manual';
  try { initial = localStorage.getItem('tth.tab') || 'manual'; } catch { /* необязательно */ }
  select(initial);
}

boot();
