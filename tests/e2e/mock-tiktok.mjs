// Мок TikTok Ads Manager для e2e-проверок: имитирует страницы, DOM-селекторы и внутренние API,
// с которыми работает расширение. Обслуживает ads.tiktok.com и business-api.tiktok.com по HTTPS.
import https from 'node:https';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ACCOUNT = '7412345678901234567';
const CSRF = 'csrf-test-token-123';
const GOALS = { LEAD_GENERATION: { objective_type: 8 }, SALES: { objective_type: 3, sales_destination: 3 }, APP_PROMOTION: { objective_type: 16 } };

function makeCert() {
  const dir = mkdtempSync(join(tmpdir(), 'tth-cert-'));
  const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=ads.tiktok.com',
    '-addext', 'subjectAltName=DNS:ads.tiktok.com,DNS:business-api.tiktok.com'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const smartForm = (goal) => ({
  campaign_sketch_id: null, campaign_snap_id: 5, ...GOALS[goal], universal_type: 1, spc_automation_type: 1, auto_creation_product_type: 1,
  budget_optimize_switch: 1, spc_upgrade_mode: 1, spc_multi_ad_mode: 1, universal_type_default_on: true
});

const page = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px sans-serif;padding:20px} .cs-campaign-option{padding:8px;border:1px solid #888;margin:4px;cursor:pointer} [data-cs-selected="true"]{background:#def} div[slot]{padding:2px}</style></head>
<body>${body}<script>${script}</script></body></html>`;

function dashboardPage() {
  return page('Ads Manager · Dashboard', `
  <h3>Create campaign</h3>
  <div data-testid="campaign-selector-modal">
    <div class="cs-campaign-option" data-cs-name="APP_PROMOTION" data-cs-selected="false"><div class="cs-campaign-option__title"><span class="truncate">App promotion</span></div></div>
    <div class="cs-campaign-option" data-cs-name="LEAD_GENERATION" data-cs-selected="true"><div class="cs-campaign-option__title"><span class="truncate">Lead generation</span></div></div>
    <div class="cs-campaign-option" data-cs-name="SALES" data-cs-selected="false"><div class="cs-campaign-option__title"><span class="truncate">Sales</span></div></div>
    <div id="confirm-host"></div>
  </div>`, `
  const options = [...document.querySelectorAll('.cs-campaign-option')];
  options.forEach((el) => el.addEventListener('click', () => { options.forEach((o) => o.setAttribute('data-cs-selected', 'false')); el.setAttribute('data-cs-selected', 'true'); }));
  const root = document.getElementById('confirm-host').attachShadow({ mode: 'open' });
  root.innerHTML = '<button part="confirmButton" style="padding:8px 18px">Confirm</button>';
  root.querySelector('button').addEventListener('click', async () => {
    const goal = document.querySelector('.cs-campaign-option[data-cs-selected="true"]').getAttribute('data-cs-name');
    const r = await fetch('/mock/new-draft?aadvid=${ACCOUNT}&goal=' + goal, { method: 'POST' });
    location.href = (await r.json()).url;
  });`);
}

function draftPage(draft) {
  return page('Ads Manager · Campaign', '<div id="app"></div>', `
  const DRAFT = ${JSON.stringify({ id: draft.id, form: draft.form })};
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
  fetch('/api/v4/i18n/creation/campaign_snap/save/?aadvid=${ACCOUNT}&req_src=ad_creation', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json;charset=UTF-8', 'x-csrftoken': csrf, 'app-name': 'i18n_ecom_alliance', 'x-ttam-version': '2.0.1', 'x-ttam-uuid': 'uuid-123' },
    body: JSON.stringify({ campaign_sketch_form_data: { ...DRAFT.form, campaign_sketch_id: DRAFT.id }, is_from_startup: true, with_sketch: false, clear_lower_level_sketches: true })
  });
  const manual = DRAFT.form.universal_type === 0;
  const app = document.getElementById('app');
  app.innerHTML = '<div data-testid="lego-hybrid-section-item"><span data-testid="lego-hybrid-section-item-displayText">Campaign type ' + (manual ? '(Manual)' : '(Smart+)') + '</span> ' + (manual ? '<button data-testid="lego-hybrid-section-item-operation">Change</button>' : '') + '</div><div id="chosen"></div>';
  const op = app.querySelector('[data-testid="lego-hybrid-section-item-operation"]');
  if (op) op.addEventListener('click', () => {
    document.getElementById('chosen').innerHTML = '<div class="cs-campaign-option" data-cs-name="LEAD_Manual" data-cs-selected="true"><div class="cs-campaign-option__title"><span class="truncate">Manual campaign</span></div></div>';
  });`);
}

function creationRoutePage() {
  return page('Ads Manager · Create (route)', `
  <button id="select-placement">Select placement</button> <span id="clicks">0</span>
  <button id="send">Send request</button><pre id="out"></pre>`, `
  let clicks = 0;
  document.getElementById('select-placement').addEventListener('click', () => { clicks++; document.getElementById('clicks').textContent = clicks; });
  document.getElementById('send').addEventListener('click', async () => {
    const r = await fetch('/mock/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ universal_type: 1, spc_automation_type: 1, keep: 'x' }) });
    document.getElementById('out').textContent = JSON.stringify(await r.json());
  });`);
}

const cells = (id, fields) => Object.entries(fields).map(([k, v]) => `<div slot="cell-${id}_${k}">${v}</div>`).join('');

function creativePage(ads) {
  return page('Ads Manager · Ads', ads.map((a) => cells(a.creative_id, { creative_id: a.creative_id, creative_name: a.name, creative_status: a.pageStatus, ad_id: a.ad_id })).join(''));
}

function adgroupPage() {
  return page('Ads Manager · Ad groups', cells('7000000000001', { name: 'Ad group one', status: 'Not delivered · Review issue' }) + cells('7000000000009', { name: 'Ad group healthy', status: 'Active' }));
}

export async function startMock({ port = 8443 } = {}) {
  const state = {
    drafts: new Map(), nextDraft: 777, saves: [], appeals: [], events: [], echoes: [], pixels: [],
    ads: [
      { creative_id: '9000000000001', ad_id: '7000000000001', campaign_id: '8000000000001', name: 'Ad A — will be sent', pageStatus: 'Not delivered · Rejected', appealMode: 'ok' },
      { creative_id: '9000000000002', ad_id: '7000000000001', campaign_id: '8000000000001', name: 'Ad B — platform limit', pageStatus: 'Not delivered · Rejected', appealMode: 'limit' },
      { creative_id: '9000000000003', ad_id: '7000000000001', campaign_id: '8000000000001', name: 'Ad C — needs verification', pageStatus: 'Not delivered · Review issue', appealMode: 'accepted' },
      { creative_id: '9000000000004', ad_id: '7000000000001', campaign_id: '8000000000001', name: 'Ad D — server error', pageStatus: 'Not delivered · Disapproved', appealMode: 'error' },
      { creative_id: '9000000000005', ad_id: '7000000000002', campaign_id: '8000000000001', name: 'Ad E — healthy', pageStatus: 'Active', appealMode: 'ok', healthy: true }
    ],
    appealResults: new Map(), inflight: 0, peakInflight: 0, failToken: false
  };
  const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve) => { let data = ''; req.on('data', (c) => { data += c; }); req.on('end', () => resolve(data)); });
  const cookieOf = (req, name) => (req.headers.cookie?.match(new RegExp(`${name}=([^;]+)`)) || [])[1];

  const server = https.createServer(makeCert(), async (req, res) => {
    const url = new URL(req.url, 'https://ads.tiktok.com');
    const host = (req.headers.host || '').split(':')[0];
    const raw = req.method === 'POST' ? await readBody(req) : '';
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();

    if (host === 'business-api.tiktok.com') {
      const record = { path: url.pathname, token: req.headers['access-token'], body };
      state.events.push(record);
      if (!record.token || String(record.token).startsWith('BAD')) return json(res, { code: 40105, message: 'Access token is invalid', request_id: 'mock-req' });
      return json(res, { code: 0, message: 'OK', request_id: 'mock-req' });
    }

    const html = (content) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': [`csrftoken=${CSRF}; Path=/`, 'sessionid=sess-xyz; Path=/; HttpOnly'] }); res.end(content); };

    if (req.method === 'GET') {
      if (url.pathname === '/i18n/dashboard') return html(dashboardPage());
      if (url.pathname === '/i18n/perf_campaign/create') return html(creationRoutePage());
      if (url.pathname === '/i18n/manage/creative') return html(creativePage(state.ads));
      if (url.pathname === '/i18n/manage/adgroup') return html(adgroupPage());
      if (url.pathname.endsWith('/create/campaign')) {
        const draft = state.drafts.get(url.searchParams.get('campaign_draft_id'));
        return draft ? html(draftPage(draft)) : (res.writeHead(404), res.end('no draft'));
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      res.writeHead(404); return res.end('not found');
    }

    // ---- API ----
    if (url.pathname === '/mock/new-draft') {
      const id = String(state.nextDraft++);
      state.drafts.set(id, { id, form: smartForm(url.searchParams.get('goal') || 'LEAD_GENERATION') });
      return json(res, { url: `/i18n/creation/1nn/x/create/campaign?aadvid=${url.searchParams.get('aadvid')}&campaign_draft_id=${id}` });
    }
    if (url.pathname === '/mock/echo') {
      state.echoes.push(body);
      return json(res, { received: body, flags: { universal_type: 1, web_all_in_one_catalog: true, other: 7 } });
    }
    if (url.pathname === '/api/v4/i18n/creation/campaign_snap/save/') {
      const header = req.headers['x-csrftoken'];
      const entry = { origin: req.headers.origin || '', referer: req.headers.referer || '', csrf: header, cookieSession: cookieOf(req, 'sessionid'), query: Object.fromEntries(url.searchParams), body };
      state.saves.push(entry);
      if (!header || header !== cookieOf(req, 'csrftoken')) return json(res, { code: 403, msg: 'csrf mismatch' });
      const form = body?.campaign_sketch_form_data;
      const draft = state.drafts.get(String(form?.campaign_sketch_id));
      if (!draft) return json(res, { code: 404, msg: 'draft not found' });
      entry.fromExtension = String(entry.origin).startsWith('chrome-extension://');
      draft.form = { ...form };
      return json(res, { code: 0, msg: 'success', data: { campaign_sketch_id: String(form.campaign_sketch_id) } });
    }
    if (url.pathname === '/api/v4/i18n/creation/audit/appeal_creative/') {
      state.appeals.push({ body, csrf: req.headers['x-csrftoken'], cookie: Boolean(cookieOf(req, 'sessionid')) });
      const ad = state.ads.find((a) => a.creative_id === String(body?.creative_id));
      state.inflight++; state.peakInflight = Math.max(state.peakInflight, state.inflight);
      await new Promise((r) => setTimeout(r, ad?.delayMs ?? 200));
      state.inflight--;
      if (!ad || req.headers['x-csrftoken'] !== CSRF) return json(res, { code: 403, msg: 'csrf' });
      if (ad.appealMode === 'ok') { state.appealResults.set(ad.creative_id, { status: 2, update_time: Math.floor(Date.now() / 1000) + 1 }); return json(res, { code: 0, msg: 'success', data: { appeal_success: true } }); }
      if (ad.appealMode === 'limit') return json(res, { code: 0, msg: 'success', data: { appeal_success: false, ticket_failed_info: { code: 90071, msg: 'multiple', data: { tickets: [{ error_code: 90071, error_msg: 'already submitted multiple appeals' }] } } } });
      if (ad.appealMode === 'accepted') { state.appealResults.set(ad.creative_id, { status: 2, update_time: Math.floor(Date.now() / 1000) + 1 }); return json(res, { code: 0, msg: 'success', data: {} }); }
      return json(res, { code: 50001, msg: 'internal error' });
    }
    if (url.pathname === '/api/v4/i18n/statistics/op/ad/list/') {
      const filter = body?.common_req?.filters?.[0] || {};
      const wanted = filter.in_field_values || [];
      const pick = (a) => (filter.field === 'campaign_ids' ? wanted.includes(a.campaign_id) : filter.field === 'ad_ids' ? wanted.includes(a.ad_id) : wanted.includes(a.creative_id));
      const table = state.ads.filter(pick).map((a) => ({
        creative_id: a.creative_id, ad_id: a.ad_id, campaign_id: a.campaign_id, creative_name: a.name, ad_name: 'Adgroup 1', campaign_name: 'Campaign 1',
        creative_status: a.healthy ? 'creative_delivery_ok' : 'creative_offline_audit',
        row_data: state.appealResults.has(a.creative_id) ? { appeal_result: JSON.stringify(state.appealResults.get(a.creative_id)) } : {}
      }));
      return json(res, { code: 0, data: { table, pagination: { page_count: 1 } } });
    }
    if (url.pathname === '/i18n/events_manager/v2/api/pixel/create') {
      state.pixels.push({ create: body });
      return json(res, { code: 0, data: { PixelCode: 'CTESTPIXEL000000001' } });
    }
    if (/\/pixel\/[^/]+\/update_event_trigger_setting$/.test(url.pathname)) { state.pixels.push({ trigger: body }); return json(res, { code: 0 }); }
    if (url.pathname === '/i18n/events_manager/api/graphql' && state.failToken) return json(res, { code: 500 }, 500);
    if (url.pathname === '/i18n/events_manager/api/graphql') return json(res, { data: { getPixelSettingDeveloperToken: { token: 'DEVTOKEN0123456789ABCDEFGHIJ', status: 0 } } });
    res.writeHead(404); res.end('not found');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { state, port, stop: () => new Promise((resolve) => server.close(resolve)) };
}
