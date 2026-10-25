import test from 'node:test';
import assert from 'node:assert/strict';
import { pageFunction } from './helpers.mjs';
import { webcrypto } from 'node:crypto';
import { ROW_KEYS } from '../../extension/background/explorer/model.js';

const PAGE = 'background/data/page-scripts.js';
const location = (account = '7412345678901234567') => ({ origin: 'https://ads.tiktok.com', href: `https://ads.tiktok.com/i18n/manage/campaign?aadvid=${account}` });
const doc = { cookie: 'a=1; csrftoken=tok%20en; b=2' };

test('listAccountsInPage: BC with children, personal account, empty BC; ids and BC links', async () => {
  const calls = [];
  const run = await pageFunction(PAGE, 'listAccountsInPage', {
    location: location(), document: doc,
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ code: 0, data: { data: [
      { id: '7700000000000000001', name: 'BC One', role: 1, child: [{ id: '7412345678901234567', name: 'Main', country: 'ES', currency: 'EUR', status: 1 }, { id: '7412345678901234568', name: 'Second', country: 'DE', currency: 'EUR', status: 1 }] },
      { id: '7412345678901234569', name: 'Personal', country: 'US', currency: 'USD', status: 1, role: 1 },
      { id: '7700000000000000003', name: 'Empty BC', role: '99', child: [] },
      { id: 'bad', name: 'Bad id', country: 'US' },
      { id: '7700000000000000009', name: 'Weird root without data' }
    ] } }) }; }
  });
  const r = await run('7412345678901234567');
  assert.equal(r.error, undefined);
  assert.equal(calls[0].url, '/api/v2/i18n/account/account_switch_list/?aadvid=7412345678901234567');
  assert.equal(calls[0].init.headers['x-csrftoken'], 'tok en');
  assert.deepEqual(Array.from(r.accounts, (a) => [a.id.slice(-3), a.bcId.slice(-1), a.businessCenter]), [['567', '1', 'BC One'], ['568', '1', 'BC One'], ['569', '', '']]);
  assert.deepEqual(Array.from(r.businessCenters, (b) => [b.id.slice(-1), b.name, b.accountCount]), [['1', 'BC One', 2], ['3', 'Empty BC', 0]]);
  assert.equal(r.currentAccount, '7412345678901234567');
  assert.equal(r.total, 3);
});

test('listAccountsInPage: API errors and a wrong host are reported, not thrown', async () => {
  const bad = await pageFunction(PAGE, 'listAccountsInPage', { location: location(), document: doc, fetch: async () => ({ ok: true, json: async () => ({ code: 40001, msg: 'No permission' }) }) });
  assert.match((await bad()).error, /No permission/);
  const wrongHost = await pageFunction(PAGE, 'listAccountsInPage', { location: { origin: 'https://evil.example', href: 'https://evil.example/' }, document: doc, fetch: async () => { throw new Error('must not fetch'); } });
  assert.match((await wrongHost()).error, /Откройте TikTok Ads Manager/);
  const offline = await pageFunction(PAGE, 'listAccountsInPage', { location: location(), document: doc, fetch: async () => { throw new Error('offline'); } });
  assert.match((await offline()).error, /offline/);
  const fallback = await pageFunction(PAGE, 'listAccountsInPage', { location: location(), document: doc, fetch: async () => ({ ok: true, json: async () => ({ code: 0, data: { data: [] } }) }) });
  const r = await fallback();
  assert.deepEqual(Array.from(r.accounts, (a) => a.id), ['7412345678901234567'], 'пустой список → текущий кабинет из адреса');
});

async function lister(handler) {
  const calls = [];
  let active = 0, peak = 0;
  const run = await pageFunction(PAGE, 'listObjectsInPage', {
    location: location(), document: doc, crypto: webcrypto,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, body, headers: init.headers });
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true, json: async () => handler(new URL(url, 'https://ads.tiktok.com'), body) };
    }
  });
  return { calls, peak: () => peak, run: (spec) => run({ keys: ROW_KEYS, st: '2026-10-19', et: '2026-10-25', ...spec }) };
}
const table = (rows, total = rows.length, pages = 1) => ({ code: 0, data: { table: rows, pagination: { total_count: total, page_count: pages } } });

test('listObjectsInPage: per-level request shape, projection of row/stat/custom data', async () => {
  const t = await lister(() => table([{ row_data: { campaign_id: '8000000000001', campaign_name: 'C', opt_status: 1, primary_status: 'delivery_ok', junk: 'drop me' }, stat_data: { stat_cost: '1.5', show_cnt: 10 }, custom_metrics: { click_cnt: 2 } }]));
  const r = await t.run({ level: 'campaign', accounts: [{ id: '7412345678901234567' }] });
  assert.equal(r.results.length, 1);
  assert.deepEqual({ ...r.results[0].rows[0] }, { campaign_id: '8000000000001', campaign_name: 'C', opt_status: 1, primary_status: 'delivery_ok', stat_cost: '1.5', show_cnt: 10, click_cnt: 2 });
  const { url, body, headers } = t.calls[0];
  assert.equal(url, '/api/v4/i18n/statistics/op/campaign/list/?aadvid=7412345678901234567');
  assert.deepEqual(body.common_req.dimensions, ['campaign_id']);
  assert.deepEqual(body.common_req.filters, [{ field: 'campaign_platform_status', filter_type: 0, in_field_values: ['999'] }]);
  assert.ok(body.common_req.metrics.includes('stat_cost') && body.common_req.metrics.includes('campaign_budget'));
  assert.deepEqual([body.common_req.st, body.common_req.et, body.common_req.page, body.common_req.page_size], ['2026-10-19', '2026-10-25', 1, 200]);
  assert.equal(headers['x-csrftoken'], 'tok en');
  assert.equal(body.extra.scene, 'campaign_list_v2');

  await t.run({ level: 'adgroup', accounts: [{ id: '7412345678901234567' }] });
  assert.equal(t.calls.at(-1).url, '/api/v4/i18n/statistics/op/adgroup/list/?aadvid=7412345678901234567');
  assert.deepEqual([t.calls.at(-1).body.common_req.dimensions, t.calls.at(-1).body.common_req.filters], [['ad_id'], []]);
  await t.run({ level: 'ad', accounts: [{ id: '7412345678901234567' }] });
  assert.deepEqual(t.calls.at(-1).body.common_req.dimensions, ['creative_id']);
  assert.ok(t.calls.at(-1).body.common_req.metrics.includes('appeal_result'));
});

test('listObjectsInPage: pagination, maxRows, per-account errors and bounded concurrency', async () => {
  const paged = await lister((url, body) => {
    const p = body.common_req.page;
    return table(Array.from({ length: p < 3 ? 2 : 1 }, (_, i) => ({ campaign_id: `800000000${p}${i}0`, campaign_name: `n${p}${i}` })), 5, 3);
  });
  const all = await paged.run({ level: 'campaign', accounts: ['7412345678901234567'], pageSize: 2 });
  assert.deepEqual([all.results[0].rows.length, all.results[0].total, all.results[0].truncated, paged.calls.length], [5, 5, false, 3]);
  const capped = await paged.run({ level: 'campaign', accounts: ['7412345678901234567'], pageSize: 2, maxRows: 3 });
  assert.deepEqual([capped.results[0].rows.length, capped.results[0].truncated], [3, true]);

  const many = Array.from({ length: 8 }, (_, i) => ({ id: `74123456789012345${String(60 + i)}` }));
  const t = await lister((url) => (url.search.includes('aadvid=7412345678901234563') ? { code: 403, msg: 'No permission' } : table([{ campaign_id: '8000000000001', campaign_name: 'X' }])));
  const r = await t.run({ level: 'campaign', accounts: many, concurrency: 3 });
  assert.equal(r.results.length, 8);
  assert.ok(t.peak() <= 3 && t.peak() >= 2, `пик ${t.peak()}`);
  assert.equal(r.results[3].error, 'No permission');
  assert.equal(r.results.filter((x) => !x.error).length, 7);
  assert.deepEqual(Array.from(r.results, (x) => x.id), many.map((a) => a.id), 'порядок результатов сохраняется');
});

test('listObjectsInPage validates input and host', async () => {
  const t = await lister(() => table([]));
  assert.match((await t.run({ level: 'bogus', accounts: ['7412345678901234567'] })).error, /уровень/);
  assert.match((await t.run({ level: 'campaign', accounts: ['7412345678901234567'], st: '2026/10/01' })).error, /период/);
  assert.equal((await t.run({ level: 'campaign', accounts: ['not-id', 'x'] })).results.length, 0);
  const wrong = await pageFunction(PAGE, 'listObjectsInPage', { location: { origin: 'https://evil.example', href: 'https://evil.example/' }, document: doc, fetch: async () => { throw new Error('nope'); } });
  assert.match((await wrong({ level: 'campaign', accounts: ['7412345678901234567'], st: '2026-10-01', et: '2026-10-02' })).error, /Откройте/);
});
