import { h, toast, copyText, download, debounce, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { PIXEL_EVENTS } from '../../background/lib/constants.js';
import { buildPostbackUrl } from '../../background/s2s/events.js';
import { buildZip } from '../../background/s2s/zip.js';

const SESSION_KEY = 'tth:s2s:test';

export function mountS2S(root, ctx) {
  const saved = ctx.settings?.s2s ?? { domain: '', path: '/lander/tts2s', event: 'Purchase', api: '1', value: '', currency: 'USD' };
  const form = { ...saved };
  let stopped = false;

  /* ---------- общие элементы ---------- */
  const datalist = h('datalist', { id: 'tth-events' }, PIXEL_EVENTS.map((e) => h('option', { value: e })));
  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
  const persist = debounce(() => ctx.saveSettings({ s2s: { ...form } }).catch(() => {}), 500);
  const bind = (input, key, after) => { input.addEventListener('input', () => { form[key] = input.value.trim(); persist(); after?.(); }); return input; };
  const copyBtn = (getText, label = 'Скопировать') => h('button', { class: 'btn sm', type: 'button', title: label, onclick: async () => { const t = getText(); if (t && await copyText(t)) toast('Скопировано', 'ok'); } }, icon('copy', 13));

  /* ---------- 1. Постбэк ---------- */
  const domain = bind(h('input', { class: 'input mono', placeholder: 'track.example.com', value: form.domain, autocomplete: 'off', spellcheck: 'false' }), 'domain', renderUrl);
  const path = bind(h('input', { class: 'input mono', placeholder: '/lander/tts2s', value: form.path, spellcheck: 'false' }), 'path', renderUrl);
  const event = bind(h('input', { class: 'input', list: 'tth-events', value: form.event, placeholder: 'Purchase' }), 'event', renderUrl);
  const value = bind(h('input', { class: 'input mono', placeholder: '{payout} или 12.5', value: form.value, spellcheck: 'false' }), 'value', renderUrl);
  const currency = bind(h('input', { class: 'input mono', maxlength: '3', value: form.currency, placeholder: 'USD' }), 'currency', renderUrl);
  const api = h('select', { class: 'select' }, h('option', { value: '1', selected: form.api !== '2' }, 'Events API 1.0 (как в исходном скрипте)'), h('option', { value: '2', selected: form.api === '2' }, 'Events API 2.0 (рекомендует TikTok)'));
  api.addEventListener('change', () => { form.api = api.value; persist(); renderUrl(); });
  const urlBox = h('div', { class: 'code' });
  const urlError = h('p', { class: 'hint', style: { color: 'var(--warn)' } });
  let currentUrl = '';
  function renderUrl() {
    try {
      currentUrl = buildPostbackUrl({ domain: form.domain, path: form.path, event: form.event, api: form.api, value: form.value, currency: form.currency });
      urlError.textContent = '';
    } catch (e) { currentUrl = ''; urlError.textContent = e.message; }
    fill(urlBox, currentUrl || h('span', { class: 'muted' }, 'Заполните домен, чтобы получить ссылку'),
      h('span', { class: 'copy' }, copyBtn(() => currentUrl, 'Скопировать ссылку')));
  }
  const postback = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('link', 15), 'Постбэк для Keitaro'), h('span', { class: 'pill cyan' }, 'S2S')),
    h('div', { class: 'stack' },
      field('Домен из вашего Keitaro', domain),
      h('div', { class: 'grid2' }, field('Путь загрузки', path), field('Событие', event)),
      h('div', { class: 'grid2' }, field('Value (необязательно)', value), field('Валюта', currency)),
      field('Версия Events API', api),
      urlBox, urlError,
      h('p', { class: 'hint' }, 'В кампании Keitaro добавьте параметры: ', h('b', null, 'px'), ' — Pixel Code, ', h('b', null, 'tk'), ' — Access Token, ', h('b', null, 'ttclid'), ' — ttclid. Не называйте токен «token»: в Keitaro это системный параметр.')));

  /* ---------- 2. Серверный пакет ---------- */
  async function phpFiles() {
    const [main, index] = await Promise.all(['s2s/indexpix1.php', 's2s/index.php'].map(async (p) => (await fetch(chrome.runtime.getURL(p))).text()));
    return [{ name: 'index.php', data: index }, { name: 'indexpix1.php', data: main }];
  }
  const pkg = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('package', 15), 'Серверный скрипт')),
    h('p', { class: 'card-sub', style: { marginBottom: '10px' } }, 'PHP-скрипт принимает постбэк и передаёт событие в TikTok. Загрузите архив в Keitaro: Лендинги → Загрузить архив, путь — как в поле выше.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary sm', type: 'button', onclick: async () => {
        try { download('S2S_TTAds.zip', buildZip(await phpFiles()), 'application/zip'); toast('Архив S2S_TTAds.zip сохранён', 'ok'); } catch (e) { toast(e.message, 'error'); }
      } }, icon('download', 14), 'Скачать S2S_TTAds.zip'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try { const [, main] = await phpFiles(); download('indexpix1.php', main.data, 'text/x-php'); } catch (e) { toast(e.message, 'error'); }
      } }, icon('code', 14), 'Только indexpix1.php')),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Сервер должен поддерживать PHP 7.4+ с cURL. Скрипт больше не зависит от ipify, поэтому события не теряются при его недоступности.'));

  /* ---------- 3. Тест события ---------- */
  const t = { pixel: '', token: '', ttclid: '', testCode: '', value: '' };
  const tPixel = h('input', { class: 'input mono', placeholder: 'Pixel Code', autocomplete: 'off', spellcheck: 'false' });
  const tToken = h('input', { class: 'input mono', type: 'password', placeholder: 'Access Token (Developer token)', autocomplete: 'off', spellcheck: 'false' });
  const tEvent = h('input', { class: 'input', list: 'tth-events', value: form.event, placeholder: 'Purchase' });
  const tTtclid = h('input', { class: 'input mono', placeholder: 'abc123…', autocomplete: 'off', spellcheck: 'false' });
  const tCode = h('input', { class: 'input mono', placeholder: 'TEST12345', autocomplete: 'off', spellcheck: 'false' });
  const result = h('div');
  const sendBtn = h('button', { class: 'btn primary sm', type: 'button' }, icon('play', 14), 'Отправить тест');
  const storeTest = () => chrome.storage.session.set({ [SESSION_KEY]: { pixel: tPixel.value.trim(), token: tToken.value.trim(), ttclid: tTtclid.value.trim(), testCode: tCode.value.trim() } }).catch(() => {});
  for (const el of [tPixel, tToken, tTtclid, tCode]) el.addEventListener('input', debounce(storeTest, 400));
  chrome.storage.session.get(SESSION_KEY).then((r) => {
    const v = r[SESSION_KEY]; if (!v || stopped) return;
    tPixel.value = v.pixel || ''; tToken.value = v.token || ''; tTtclid.value = v.ttclid || ''; tCode.value = v.testCode || '';
  }).catch(() => {});
  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true; fill(result, h('div', { class: 'row' }, h('span', { class: 'spinner' }), 'Отправляю…'));
    try {
      const res = await bus.s2s.test({
        api: form.api, pixel: tPixel.value.trim(), token: tToken.value.trim(), event: tEvent.value.trim(), ttclid: tTtclid.value.trim(),
        testCode: tCode.value.trim(), value: form.value && /^\d/.test(form.value) ? form.value : '', currency: form.currency
      });
      fill(result, 
        h('div', { class: `alert ${res.ok ? 'ok' : 'err'}` }, icon(res.ok ? 'check' : 'alert', 15),
          h('div', null, h('b', null, res.ok ? 'TikTok принял событие' : 'TikTok не принял событие'),
            h('div', { class: 'small muted' }, `HTTP ${res.http} · code ${res.code ?? '—'}${res.message ? ' · ' + res.message : ''}${res.requestId ? ' · ' + res.requestId : ''}`))),
        h('details', { class: 'group', style: { marginTop: '8px' } }, h('summary', null, 'Отправленный запрос'), h('div', { class: 'ids' }, `POST ${res.endpoint}\n${JSON.stringify(res.sent, null, 1)}`)));
    } catch (e) { fill(result, h('div', { class: 'alert err' }, icon('alert', 15), h('div', null, e.message))); } finally { sendBtn.disabled = false; }
  });
  const test = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('activity', 15), 'Тест события'), h('span', { class: 'pill' }, 'прямо в TikTok')),
    h('div', { class: 'stack' },
      h('div', { class: 'alert warn' }, icon('alert', 15), h('div', null, 'Тест отправляет настоящее событие в пиксель. Чтобы не засорять статистику, используйте API 2.0 и test_event_code из Events Manager → Test Events.')),
      h('div', { class: 'grid2' }, field('Pixel Code', tPixel), field('Событие', tEvent)),
      field('Access Token', tToken, 'Хранится только до закрытия браузера.'),
      h('div', { class: 'grid2' }, field('ttclid (необязательно)', tTtclid), field('test_event_code (API 2.0)', tCode)),
      h('div', { class: 'row wrap' }, sendBtn), h('span', { class: 'hint' }, 'Версия API — как в блоке «Постбэк» выше.'),
      result));

  /* ---------- 4. Быстрый пиксель ---------- */
  const pName = h('input', { class: 'input', placeholder: 'Pixel_<кабинет>_<время> (по умолчанию)' });
  const pRule = h('input', { type: 'checkbox', checked: true });
  const pWords = h('input', { class: 'input mono', value: 'thank-you, approved', spellcheck: 'false' });
  const pEvent = h('input', { class: 'input', list: 'tth-events', value: 'Purchase' });
  const pResult = h('div');
  const pBtn = h('button', { class: 'btn sm', type: 'button' }, icon('zap', 14), 'Создать пиксель и получить токен');
  pBtn.addEventListener('click', async () => {
    pBtn.disabled = true; fill(pResult, h('div', { class: 'row' }, h('span', { class: 'spinner' }), 'Создаю пиксель в кабинете…'));
    try {
      const keywords = pWords.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5);
      const res = await bus.s2s.pixel(ctx.tabId, { name: pName.value.trim(), createRule: pRule.checked, keywords, ruleEvent: pEvent.value.trim() || 'Purchase' });
      fill(pResult, 
        h('div', { class: 'alert ok' }, icon('check', 15), h('div', null, h('b', null, 'Пиксель создан'), h('div', { class: 'small muted' }, `${res.pixelName}${res.ruleCreated ? ' · URL-правило добавлено' : ''}`))),
        ...(res.warnings ?? []).map((w) => h('div', { class: 'alert warn', style: { marginTop: '8px' } }, icon('alert', 15), h('div', null, w))),
        h('dl', { class: 'kv', style: { marginTop: '8px' } },
          h('dt', null, 'Pixel Code'), h('dd', null, res.pixelCode, ' ', copyBtn(() => res.pixelCode)),
          h('dt', null, 'Token'), h('dd', null, res.devToken ? `${res.devToken.slice(0, 6)}…${res.devToken.slice(-4)}` : 'не получен', ' ', res.devToken ? copyBtn(() => res.devToken) : null)),
        h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onclick: () => { tPixel.value = res.pixelCode; tToken.value = res.devToken || ''; storeTest(); toast('Подставлено в «Тест события»', 'ok'); } }, 'Подставить в тест'));
    } catch (e) { fill(pResult, h('div', { class: 'alert err' }, icon('alert', 15), h('div', null, e.message))); } finally { pBtn.disabled = !ctx.onAds; }
  });
  const pixel = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('target', 15), 'Быстрый пиксель'), h('span', { class: 'pill warn' }, 'из вкладки TikTok')),
    h('div', { class: 'stack' },
      field('Название (необязательно)', pName),
      h('label', { class: 'check' }, pRule, h('span', null, 'Добавить URL-правило события по ключевым словам')),
      h('div', { class: 'grid2' }, field('Слова в URL (до 5)', pWords), field('Событие правила', pEvent)),
      h('div', { class: 'row wrap' }, pBtn), h('span', { class: 'hint' }, 'Нужна открытая вкладка кабинета: пиксель создаётся в нём от имени вашей сессии.'),
      pResult));
  const syncPixelState = () => { pBtn.disabled = !ctx.onAds; };
  const stopTab = ctx.onTab(syncPixelState);
  syncPixelState();

  renderUrl();
  root.append(h('div', { class: 'stack' }, datalist, postback, pkg, test, pixel));
  return () => { stopped = true; stopTab(); };
}
