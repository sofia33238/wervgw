import test from 'node:test';
import assert from 'node:assert/strict';
import { pageFunction } from './helpers.mjs';

const PAGE = 'background/appeals/page-scripts.js';

async function sender(reply, { failure = false, account = '123456', cookie = 'csrftoken=test%20x' } = {}) {
  let request;
  const send = await pageFunction(PAGE, 'sendAppealInPage', {
    location: { origin: 'https://ads.tiktok.com', href: `https://ads.tiktok.com/?aadvid=${account}` },
    document: { cookie },
    window: { fetch: async (url, options) => { request = { url, options }; if (failure) throw new Error('offline'); return { ok: true, json: async () => reply }; } }
  });
  const row = { id: '1878635788458353', adgroupId: '1878635639134369' };
  return { send: (reason = 1, r = row) => send('123456', r, 'Please review.', reason), request: () => request };
}

test('appeal: observed endpoint, session credentials, correct IDs and CSRF header', async () => {
  const t = await sender({ code: 0 });
  assert.equal((await t.send()).status, 'accepted');
  const { url, options } = t.request();
  assert.equal(new URL(url).pathname, '/api/v4/i18n/creation/audit/appeal_creative/');
  assert.equal(options.credentials, 'include');
  assert.equal(options.headers['X-CSRFToken'], 'test x');
  const body = JSON.parse(options.body);
  assert.equal(body.ad_id, '1878635639134369');
  assert.equal(body.creative_id, 1878635788458353);
  assert.equal(body.appeal_reason_type, 1);
  assert.equal(body.advertiser_id, '123456');
});

test('appeal: long creative IDs keep every digit', async () => {
  const t = await sender({ code: 0 });
  await t.send(1, { id: '1234567890123456789', adgroupId: '1878635639134369' });
  assert.match(t.request().options.body, /"creative_id":1234567890123456789[,}]/);
});

test('appeal: account switch, bad reason and bad IDs never reach the endpoint', async () => {
  const wrongAccount = await sender({ code: 0 }, { account: '654321' });
  assert.equal((await wrongAccount.send()).status, 'failed');
  assert.equal(wrongAccount.request(), undefined);
  const t = await sender({ code: 0 });
  assert.equal((await t.send(6)).status, 'failed');
  assert.equal((await t.send(1, { id: 'abc', adgroupId: '1' })).status, 'failed');
  assert.equal(t.request(), undefined);
  const noSession = await sender({ code: 0 }, { cookie: '' });
  assert.equal((await noSession.send()).stop, true);
});

test('appeal: network failure / unknown shapes can never count as sent', async () => {
  assert.equal((await (await sender(null, { failure: true })).send()).status, 'unknown');
  assert.equal((await (await sender({ success: true })).send()).status, 'unknown');
  assert.equal((await (await sender({ code: 400, message: 'Rejected' })).send()).status, 'failed');
});

test('appeal: every verified reason is sent as its own numeric value', async () => {
  for (const reason of [1, 2, 3, 4, 5]) {
    const t = await sender({ code: 0 });
    await t.send(reason);
    assert.equal(JSON.parse(t.request().options.body).appeal_reason_type, reason);
  }
});

test('appeal: native repeat limit (90071) is limited, not success, despite outer code 0', async () => {
  const reply = { code: 0, msg: 'success', data: { appeal_success: false, ticket_failed_info: { code: 90071, msg: 'multiple', data: { tickets: [{ error_code: 90071, error_msg: 'This ad has already been submitted multiple appeals.' }] } } } };
  const result = await (await sender(reply)).send();
  assert.equal(result.status, 'limited');
  assert.equal(result.responseCode, 90071);
  assert.match(result.message, /90071/);
  assert.equal((await (await sender({ code: 0, data: { appeal_success: true } })).send()).status, 'submitted');
  const other = await (await sender({ code: 0, data: { appeal_success: false, ticket_failed_info: { code: 123, msg: 'Not eligible' } } })).send();
  assert.equal(other.status, 'failed');
  assert.equal(other.responseCode, 123);
  assert.match(other.message, /Not eligible/);
});

/* ---------- загрузка вложенных объявлений ---------- */
async function resolver(pages) {
  const calls = [];
  const run = await pageFunction(PAGE, 'resolveAdsInPage', {
    location: { origin: 'https://ads.tiktok.com', href: 'https://ads.tiktok.com/?aadvid=123456&st=2026-10-04&et=2026-10-11' },
    document: { cookie: 'csrftoken=test' },
    fetch: async (url, req) => { calls.push(JSON.parse(req.body)); return { ok: true, json: async () => pages[calls.length - 1] }; }
  });
  return { calls, run: (parents, statusOnly) => run('123456', parents, statusOnly) };
}
const ad = (id, status = 'creative_offline_audit') => ({ creative_id: id, ad_id: '234567', campaign_id: '345678', creative_name: id, creative_status: status });
const reply = (rows, count = 1) => ({ code: 0, data: { table: rows, pagination: { page_count: count } } });

test('resolve: campaign loads every page and excludes healthy ads', async () => {
  const t = await resolver([reply([ad('456789'), ad('567890', 'creative_delivery_ok')], 2), reply([ad('678901')], 2)]);
  const r = await t.run([{ level: 'campaign', id: '345678' }]);
  assert.deepEqual(Array.from(r.rows, (x) => x.id), ['456789', '678901']);
  assert.equal(t.calls[1].common_req.page, 2);
  assert.equal(t.calls[0].common_req.filters[0].field, 'campaign_ids');
  assert.equal(r.rows[0].adgroupId, '234567');
});

test('resolve: adsets use ad_ids, duplicates merge, foreign parents and later failures are errors', async () => {
  const t = await resolver([reply([ad('456789')]), reply([ad('456789')])]);
  const r = await t.run([{ level: 'adgroup', id: '234567' }, { level: 'campaign', id: '345678' }]);
  assert.equal(r.rows.length, 1);
  assert.equal(t.calls[0].common_req.filters[0].field, 'ad_ids');
  assert.match((await (await resolver([reply([ad('456789')])])).run([{ level: 'campaign', id: '999999' }])).error, /другой кампании/);
  assert.match((await (await resolver([reply([ad('456789')], 2), { code: 401, msg: 'expired' }])).run([{ level: 'campaign', id: '345678' }])).error, /expired/);
});

test('resolve: statusOnly returns appeal status and version for many IDs in one filter', async () => {
  const withAppeal = { ...ad('456789'), row_data: { appeal_result: JSON.stringify({ status: 4, update_time: 1700000000 }) } };
  const t = await resolver([reply([withAppeal])]);
  const r = await t.run([{ level: 'ad', id: '456789' }, { level: 'ad', id: '567890' }], true);
  assert.deepEqual(t.calls[0].common_req.filters[0].in_field_values, ['456789', '567890']);
  assert.equal(t.calls[0].common_req.filters[0].field, 'creative_ids');
  assert.equal(r.rows[0].appealStatus, 4);
  assert.equal(r.rows[0].appealVersion, 1700000000);
});

test('resolve: paused ad with explicit appeal rejection is included', async () => {
  const paused = { ...ad('456789', 'creative_paused'), row_data: { appeal_result: 'appeal_rejected' } };
  const t = await resolver([reply([paused])]);
  assert.equal((await t.run([{ level: 'campaign', id: '345678' }])).rows.length, 1);
});
