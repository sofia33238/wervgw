// Движки сервис-воркера (мониторинг, обзор, omnibox, контекст) на заглушке chrome.* — без браузера.
import test from 'node:test';
import assert from 'node:assert/strict';

const ADS = 'https://ads.tiktok.com/i18n/manage/campaign?aadvid=7412345678901234567';
const mk = (n, extra = {}) => ({ id: `74123456789012345${String(n).padStart(2, '0')}`, name: `Acc ${n}`, country: 'ES', currency: 'EUR', status: 1, bcId: '7700000000000000001', businessCenter: 'BC One', ...extra });
const row = (id, o = {}) => ({ campaign_id: id, campaign_name: `C${id.slice(-3)}`, opt_status: 1, primary_status: 'delivery_ok', stat_cost: 2, show_cnt: 100, click_cnt: 5, time_attr_convert_cnt: 1, ...o });

function setup({ tabs = [{ id: 1, url: ADS, status: 'complete', active: true }], accounts = [mk(1), mk(2)], rows = {}, withNotifications = true, notify = false, scriptError = false } = {}) {
  const store = { local: {}, session: {} };
  const area = (s) => ({
    get: async (keys) => { const list = keys == null ? Object.keys(s) : Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.filter((k) => k in s).map((k) => [k, structuredClone(s[k])])); },
    set: async (o) => { for (const [k, v] of Object.entries(o)) s[k] = structuredClone(v); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete s[k]; }
  });
  const calls = { badge: [], titles: [], notes: [], created: [], updated: [], scripts: [] };
  const state = { accounts, rows, scriptError };
  globalThis.chrome = {
    storage: { local: area(store.local), session: area(store.session) },
    runtime: { getURL: (p) => `chrome-extension://test/${p}` },
    tabs: {
      query: async (q = {}) => tabs.filter((t) => !q.url || t.url.startsWith(q.url.replace('*', ''))).filter((t) => !('active' in q) || t.active === q.active),
      get: async (id) => tabs.find((t) => t.id === id),
      create: async (o) => { calls.created.push(o); return { id: 50, ...o }; },
      update: async (...a) => { calls.updated.push(a.length === 1 ? { url: a[0].url } : { id: a[0], ...a[1] }); }
    },
    action: { setBadgeText: async ({ text }) => { calls.badge.push(text); }, setBadgeBackgroundColor: async () => {}, setTitle: async ({ title }) => { calls.titles.push(title); } },
    scripting: {
      executeScript: async ({ func, args }) => {
        calls.scripts.push({ name: func.name, args });
        if (state.scriptError) throw new Error('Frame was removed');
        if (func.name === 'listAccountsInPage') return [{ result: { currentAccount: '7412345678901234567', accounts: state.accounts, businessCenters: [{ id: '7700000000000000001', name: 'BC One', accountCount: state.accounts.length }], total: state.accounts.length, at: Date.now() } }];
        if (func.name === 'listObjectsInPage') return [{ result: { at: Date.now(), results: args[0].accounts.map((a) => ({ id: a.id, rows: state.rows[a.id] ?? [], total: (state.rows[a.id] ?? []).length, truncated: false })) } }];
        return [{ result: null }];
      }
    }
  };
  if (withNotifications) globalThis.chrome.notifications = { create: async (id, o) => { calls.notes.push({ id, ...o }); return id; }, clear() {}, onClicked: { addListener() {} } };
  if (notify) store.local.settings = { monitor: { enabled: true, intervalMin: 15, notify: true } };
  return { store, calls, state, tabs };
}

const fresh = async (path) => import(`../../extension/background/${path}?t=${Math.random()}`);

test('overview.scan: caches, honours period, persist:false and serialises different periods', async () => {
  const env = setup({ rows: { '7412345678901234501': [row('8000000000001')] }, accounts: [mk(1), mk(2)] });
  const { scan, cached } = await fresh('overview/engine.js');
  const first = await scan(1, { period: '7d' });
  assert.equal(first.accounts.length, 2);
  assert.equal(env.store.local.overviewCache.period, '7d');
  const scriptsAfterFirst = env.calls.scripts.length;
  const again = await scan(1, { period: '7d' });
  assert.equal(again.fromCache, true);
  assert.equal(env.calls.scripts.length, scriptsAfterFirst, 'свежий кэш — без новых запросов');
  const today = await scan(1, { period: 'today' });
  assert.equal(today.period, 'today');
  assert.ok(env.calls.scripts.length > scriptsAfterFirst, 'другой период — новая проверка');

  const before = JSON.stringify(await cached());
  const silent = await scan(1, { period: '30d', force: true, persist: false });
  assert.equal(silent.period, '30d');
  assert.equal(JSON.stringify(await cached()), before, 'фоновая проверка не затирает кэш вкладки «Обзор»');

  const [a, b] = await Promise.all([scan(1, { period: '7d', force: true }), scan(1, { period: 'yesterday', force: true })]);
  assert.deepEqual([a.period, b.period], ['7d', 'yesterday'], 'одновременные проверки разных периодов не подменяют друг друга');
});

test('overview.scan: pinned accounts are scanned first when the 50-account limit applies', async () => {
  const many = Array.from({ length: 60 }, (_, i) => mk(i + 1));
  const pinnedId = many.at(-1).id;
  const env = setup({ accounts: many });
  env.store.local.settings = { accounts: { meta: { [pinnedId]: { label: 'x', pinned: true } } } };
  const { scan, pickTargets } = await fresh('overview/engine.js');
  const result = await scan(1, { period: '7d', force: true });
  assert.equal(result.accounts.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(result.totalAccounts, 60);
  assert.equal(result.accounts[0].id, pinnedId, 'закреплённый кабинет проверен первым');
  assert.deepEqual(pickTargets(many, {}, 3).map((a) => a.id), many.slice(0, 3).map((a) => a.id));
});

test('monitor.tick: baseline, new problem notification, failure keeps the baseline, no permission', async () => {
  const env = setup({ notify: true, accounts: [mk(1), mk(2)], rows: { '7412345678901234501': [row('8000000000001')], '7412345678901234502': [row('8000000000002')] } });
  const monitor = await fresh('monitor/engine.js');

  let s = await monitor.tick({ reason: 'manual', tabId: 1 });
  assert.equal(s.ok, true);
  assert.equal(env.calls.badge.at(-1), '', 'проблем нет — значок пуст');
  assert.equal(env.calls.notes.length, 0);
  assert.equal(env.store.local.overviewCache, undefined, 'мониторинг не пишет кэш обзора');

  env.state.rows['7412345678901234502'] = [row('8000000000002', { primary_status: 'not_delivery', campaign_status: 'balance_not_enough' })];
  s = await monitor.tick({ reason: 'manual', tabId: 1 });
  assert.equal(env.calls.badge.at(-1), '1');
  assert.equal(env.calls.notes.length, 1);
  assert.ok(env.calls.notes[0].iconUrl.startsWith('chrome-extension://test/assets/'));
  assert.match(env.calls.notes[0].message, /Acc 2: Недостаточно средств/);
  assert.match(env.calls.titles.at(-1), /проблем: 1/);

  await monitor.tick({ reason: 'manual', tabId: 1 });
  assert.equal(env.calls.notes.length, 1, 'без изменений уведомления нет');

  // Сбой посреди работы не сбрасывает базовую линию: проблема, появившаяся за это время, будет замечена.
  env.state.scriptError = true;
  s = await monitor.tick({ reason: 'manual', tabId: 1 });
  assert.equal(s.ok, false);
  assert.equal(s.baselined, true);
  assert.equal(s.problems.length, 1, 'прежние проблемы сохранены в состоянии сбоя');
  env.state.scriptError = false;
  env.state.rows['7412345678901234501'] = [row('8000000000001', { primary_status: 'not_delivery', campaign_status: 'campaign_out_of_budget' })];
  await monitor.tick({ reason: 'manual', tabId: 1 });
  assert.equal(env.calls.notes.length, 2, 'после сбоя новая проблема всё равно вызывает уведомление');
  assert.equal(env.calls.badge.at(-1), '2');

  delete globalThis.chrome.notifications;
  env.state.rows['7412345678901234501'] = [row('8000000000001')];
  env.state.rows['7412345678901234502'] = [row('8000000000002')];
  await monitor.tick({ reason: 'manual', tabId: 1 });
  env.state.rows['7412345678901234502'] = [row('8000000000002', { primary_status: 'not_delivery', campaign_status: 'balance_not_enough' })];
  s = await monitor.tick({ reason: 'manual', tabId: 1 });
  assert.equal(s.notified, false, 'без разрешения на уведомления — только значок, без исключения');
  assert.equal(env.calls.badge.at(-1), '1');
});

test('monitor.tick: no Ads tab is skipped with a clear error; alarm tick honours the enabled flag', async () => {
  const env = setup({ tabs: [{ id: 5, url: 'https://example.com/', status: 'complete' }] });
  const monitor = await fresh('monitor/engine.js');
  const s = await monitor.tick({ reason: 'manual' });
  assert.equal(s.ok, false);
  assert.match(s.error, /Нет открытой вкладки/);
  assert.equal(await monitor.tick({ reason: 'alarm' }), null, 'по таймеру при выключенном мониторинге ничего не делается');
  assert.equal(env.calls.scripts.length, 0);
});

test('monitor badge title mentions partial coverage when accounts exceed the scan limit', async () => {
  const { badgeTitle } = await fresh('monitor/logic.js');
  assert.match(badgeTitle(2, Date.UTC(2026, 9, 25, 12, 0), { total: 83, checked: 50 }), /проверено 50 из 83 кабинетов/);
  assert.doesNotMatch(badgeTitle(0, 0, { total: 5, checked: 5 }), /из/);
});

test('omnibox.enter: dispositions, recents, unknown input, and BC pairing for standalone accounts', async () => {
  const env = setup({ tabs: [{ id: 1, url: ADS, status: 'complete', active: true }] });
  env.store.local.accountsCache = { at: Date.now(), accounts: [mk(1, { id: '7412345678901234567', bcId: '', businessCenter: '' })], businessCenters: [] };
  env.store.local.lastContext = { aadvid: '7412345678901234567', bcid: '7700000000000000999' };
  const { enter, suggestFor, currentContext } = await fresh('links/omnibox.js');

  assert.deepEqual(await currentContext(), { aadvid: '7412345678901234567', bcid: '' }, 'BC чужого кабинета не подставляется');
  const create = await enter('создать кабинет', 'newForegroundTab');
  assert.equal(create.ok, true);
  assert.equal(create.url, 'https://business.tiktok.com/', 'у кабинета нет BC → главная Business Center, а не чужой org_id');
  assert.deepEqual(env.calls.created.at(-1), { url: 'https://business.tiktok.com/', active: true });

  const billing = await enter('биллинг', 'newBackgroundTab');
  assert.equal(billing.url, 'https://ads.tiktok.com/i18n/account/payment?aadvid=7412345678901234567');
  assert.equal(env.calls.created.at(-1).active, false);
  await enter('link:campaigns', 'currentTab');
  assert.equal(env.calls.updated.at(-1).url, 'https://ads.tiktok.com/i18n/manage/campaign?aadvid=7412345678901234567');
  assert.deepEqual(await enter('qqqqzzzz'), { ok: false, reason: 'not-found' });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(env.store.local.settings.links.recents.slice(0, 3), ['campaigns', 'billing', 'adaccount-create']);
  assert.equal((await suggestFor('биллинг'))[0].content, 'link:billing');

  env.store.local.accountsCache.accounts = [mk(1, { id: '7412345678901234567', bcId: '7700000000000000001' })];
  assert.deepEqual(await currentContext(), { aadvid: '7412345678901234567', bcid: '7700000000000000001' });
  env.store.local.accountsCache = null;
  assert.equal((await currentContext()).bcid, '7700000000000000999', 'кабинета нет в кэше — используется последний BC');
});

test('context.remember keeps ids separately and ignores foreign sites', async () => {
  const env = setup();
  const { remember, getLastContext } = await fresh('links/context.js');
  await remember('https://ads.tiktok.com/x?aadvid=7412345678901234567');
  await remember('https://business.tiktok.com/manage/overview?org_id=7700000000000000001');
  await remember('https://evil.example/?aadvid=7412345678901234999&org_id=7700000000000000999');
  await remember('not a url');
  assert.deepEqual(await getLastContext(), { aadvid: '7412345678901234567', bcid: '7700000000000000001' });
  assert.ok(env.store.local.lastContext);
});
