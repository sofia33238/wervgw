import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers.mjs';

const api = () => loadScript('content/interceptor.js').__tthInterceptor;
const FIELDS = ['universal_type', 'spc_automation_type', 'web_all_in_one_catalog'];

test('transformJson flips 1/true → 0/false at any depth, ignores others', () => {
  const { transformJson } = api();
  const out = transformJson(JSON.stringify({ universal_type: 1, nested: { arr: [{ spc_automation_type: true }, { universal_type: 2 }] }, other: 1 }), FIELDS);
  assert.deepEqual(JSON.parse(out.text), { universal_type: 0, nested: { arr: [{ spc_automation_type: false }, { universal_type: 2 }] }, other: 1 });
  assert.deepEqual(Array.from(out.changes, (c) => c.key), ['universal_type', 'spc_automation_type']);
  assert.equal(transformJson('{"universal_type":0}', FIELDS), null);
  assert.equal(transformJson('not json', FIELDS), null);
  assert.equal(transformJson('5', FIELDS), null);
  assert.equal(transformJson('', FIELDS), null);
});

function makeScope({ reply }) {
  const posted = [], calls = [];
  class XHR { open(...a) { this.opened = a; } send(body) { calls.push({ xhr: true, body, url: this.opened?.[1] }); } }
  const scope = {
    location: { origin: 'https://ads.tiktok.com' }, Response, XMLHttpRequest: XHR,
    postMessage: (msg, origin) => posted.push({ msg, origin }),
    fetch: async (resource, options) => { calls.push({ resource, options }); return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } }); }
  };
  return { scope, posted, calls, XHR };
}

test('install rewrites fetch request bodies and responses, reports edits', async () => {
  const { install } = api();
  const { scope, posted, calls } = makeScope({ reply: { data: { universal_type: 1 } } });
  assert.equal(install(scope, FIELDS), true);
  assert.equal(install(scope, FIELDS), false, 'повторная установка игнорируется');
  const response = await scope.fetch('/api/x', { method: 'POST', body: JSON.stringify({ spc_automation_type: 1, keep: 'a' }) });
  assert.deepEqual(JSON.parse(calls[0].options.body), { spc_automation_type: 0, keep: 'a' });
  assert.deepEqual(await response.clone().json(), { data: { universal_type: 0 } });
  assert.equal(response.status, 200);
  assert.deepEqual(posted.map((p) => p.msg.direction), ['request', 'response']);
  assert.ok(posted.every((p) => p.origin === 'https://ads.tiktok.com' && p.msg.__tthMnl === true));
});

test('install passes untouched responses through and rewrites XHR bodies', async () => {
  const { install } = api();
  const { scope, calls, posted } = makeScope({ reply: { ok: true } });
  install(scope, FIELDS);
  const response = await scope.fetch('/api/y', { method: 'POST', body: '{"a":1}' });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(posted.length, 0);
  const xhr = new scope.XMLHttpRequest();
  xhr.open('POST', '/api/z');
  xhr.send('{"web_all_in_one_catalog":1}');
  assert.equal(calls.at(-1).body, '{"web_all_in_one_catalog":0}');
  assert.equal(calls.at(-1).url, '/api/z');
});

test('start installs nothing while the flag is off, and honours stored fields', async () => {
  const { start } = api();
  const storage = (data) => ({ getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } });
  const off = makeScope({ reply: {} });
  const offScope = { ...off.scope, localStorage: storage({}), sessionStorage: storage({}) };
  const original = offScope.fetch;
  assert.equal(start(offScope), false);
  assert.equal(offScope.fetch, original);

  const on = makeScope({ reply: {} });
  const onScope = { ...on.scope, localStorage: storage({ __tth_mnl: '1', __tth_mnl_fields: JSON.stringify(['custom_flag']) }), sessionStorage: storage({}) };
  assert.equal(start(onScope), true);
  await onScope.fetch('/x', { method: 'POST', body: JSON.stringify({ custom_flag: 1, universal_type: 1 }) });
  assert.deepEqual(JSON.parse(on.calls[0].options.body), { custom_flag: 0, universal_type: 1 });

  const legacy = makeScope({ reply: {} });
  assert.equal(start({ ...legacy.scope, localStorage: storage({ tt_force_manual: '1' }), sessionStorage: storage({}) }), true, 'старый флаг MNL v4 тоже включает режим');
});

test('non-JSON and streaming responses are returned untouched without buffering', async () => {
  const { install } = api();
  const streaming = { headers: { get: () => 'text/event-stream' }, clone() { throw new Error('поток нельзя буферизовать'); } };
  const scope = { ...makeScope({ reply: {} }).scope, fetch: async () => streaming };
  install(scope, FIELDS);
  assert.equal(await scope.fetch('/stream', { method: 'GET' }), streaming);
});
