import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAccount, countAccounts, filterAccounts, sortAccounts, spendByCurrency, needsTopUp, accountsToCsv, isProblem } from '../../extension/background/overview/model.js';
import { problemsOf, diffProblems, badgeText, notificationFor, badgeTitle } from '../../extension/background/monitor/logic.js';

const acct = (id, extra = {}) => ({ id, name: `Acc ${id.slice(-2)}`, country: 'ES', currency: 'EUR', status: 1, bcId: '7700000000000000001', businessCenter: 'BC One', ...extra });
const row = (id, o = {}) => ({ campaign_id: id, campaign_name: `C${id.slice(-2)}`, opt_status: 1, primary_status: 'delivery_ok', stat_cost: 2, show_cnt: 100, click_cnt: 5, time_attr_convert_cnt: 1, ...o });
const result = (rows, o = {}) => ({ id: 'x', rows, total: rows.length, truncated: false, ...o });

test('summarizeAccount: delivering / issue / paused / empty / error states', () => {
  const ok = summarizeAccount(acct('7412345678901234567'), result([row('8000000000001'), row('8000000000002', { primary_status: 'not_delivery', campaign_status: 'balance_not_enough' }), row('8000000000003', { opt_status: 2, primary_status: 'disable' })]));
  assert.equal(ok.state, 'delivering');
  assert.deepEqual([ok.totalCampaigns, ok.deliveringCampaigns, ok.enabledCampaigns, ok.problemCampaigns, ok.spend], [3, 1, 2, 1, 6]);
  assert.deepEqual(ok.reasons, [{ text: 'Недостаточно средств', kind: 'balance', count: 1 }]);
  assert.equal(ok.campaigns[0].status, 'issue', 'проблемные кампании показываются первыми');
  assert.equal(needsTopUp(ok), true);

  const issue = summarizeAccount(acct('7412345678901234568'), result([row('8000000000004', { primary_status: 'not_delivery', campaign_status: 'campaign_out_of_budget' })]));
  assert.equal(issue.state, 'issue');
  assert.equal(needsTopUp(issue), false);
  assert.equal(summarizeAccount(acct('7412345678901234569'), result([row('8000000000005', { opt_status: 2, primary_status: 'disable' })])).state, 'paused');
  assert.equal(summarizeAccount(acct('7412345678901234570'), result([])).state, 'empty');
  const err = summarizeAccount(acct('7412345678901234571'), { id: 'x', error: 'No permission' });
  assert.deepEqual([err.state, err.error, err.campaigns.length], ['error', 'No permission', 0]);
  assert.equal(summarizeAccount(acct('7412345678901234572'), undefined).state, 'error');
  const big = summarizeAccount(acct('7412345678901234573'), result(Array.from({ length: 60 }, (_, i) => row(`80000000${String(i).padStart(5, '0')}`)), { total: 400, truncated: true }));
  assert.equal(big.campaigns.length, 30);
  assert.equal(big.totalCampaigns, 400);
  assert.equal(big.truncated, true);
});

const set = [
  { ...summarizeAccount(acct('7412345678901234501', { name: 'Zeta' }), result([row('8000000000001')])), spend: 5 },
  { ...summarizeAccount(acct('7412345678901234502', { name: 'Alpha', currency: 'USD' }), result([row('8000000000002', { primary_status: 'not_delivery', campaign_status: 'balance_not_enough' })])), spend: 9 },
  { ...summarizeAccount(acct('7412345678901234503', { name: 'Mid' }), result([])), spend: 0 },
  { ...summarizeAccount(acct('7412345678901234504', { name: 'Broken' }), { error: 'No permission' }), spend: 0 }
];

test('counts, filters and search (name, id, BC, label, note)', () => {
  assert.deepEqual(countAccounts(set), { all: 4, issues: 2, working: 1, off: 1 });
  assert.deepEqual(filterAccounts(set, { filter: 'issues' }).map((a) => a.name), ['Alpha', 'Broken']);
  assert.deepEqual(filterAccounts(set, { filter: 'working' }).map((a) => a.name), ['Zeta']);
  assert.deepEqual(filterAccounts(set, { filter: 'off' }).map((a) => a.name), ['Mid']);
  assert.deepEqual(filterAccounts(set, { q: 'alp' }).map((a) => a.name), ['Alpha']);
  assert.deepEqual(filterAccounts(set, { q: '4503' }).map((a) => a.name), ['Mid']);
  assert.deepEqual(filterAccounts(set, { q: 'bc one' }).length, 4);
  const meta = { '7412345678901234501': { label: 'Прогрев', note: 'карта 2230' } };
  assert.deepEqual(filterAccounts(set, { q: 'прогрев' }, meta).map((a) => a.name), ['Zeta']);
  assert.deepEqual(filterAccounts(set, { q: '2230' }, meta).map((a) => a.name), ['Zeta']);
  assert.ok(isProblem(set[3]));
});

test('sorting: problems first, pinned always on top, spend and name', () => {
  assert.deepEqual(sortAccounts(set, 'problems').map((a) => a.name), ['Broken', 'Alpha', 'Zeta', 'Mid']);
  assert.deepEqual(sortAccounts(set, 'spend').map((a) => a.name), ['Alpha', 'Zeta', 'Mid', 'Broken']);
  assert.deepEqual(sortAccounts(set, 'name').map((a) => a.name), ['Alpha', 'Broken', 'Mid', 'Zeta']);
  assert.deepEqual(sortAccounts(set, 'problems', { '7412345678901234503': { pinned: true } }).map((a) => a.name)[0], 'Mid');
  assert.deepEqual(set.map((a) => a.name), ['Zeta', 'Alpha', 'Mid', 'Broken'], 'исходный массив не меняется');
});

test('spendByCurrency groups, skips errors and zero spend', () => {
  assert.deepEqual(spendByCurrency(set), [{ currency: 'USD', spend: 9 }, { currency: 'EUR', spend: 5 }]);
  assert.deepEqual(spendByCurrency([]), []);
});

test('accountsToCsv: header, reasons and the label/note columns, injection-safe', () => {
  const csv = accountsToCsv(set, { '7412345678901234501': { label: '=evil', note: 'a,b' } });
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('\ufeffID;Название;Business Center;Страна;Валюта;Состояние'));
  assert.equal(lines.length, 6);
  assert.ok(lines[1].includes(`'=evil`) && lines[1].includes('"a,b"'));
  assert.ok(lines[2].includes('Недостаточно средств ×1'));
  assert.ok(lines[4].includes('No permission'));
});

test('monitor: problemsOf / diffProblems / badge / notification', () => {
  const p1 = problemsOf(set);
  assert.deepEqual(p1.map((p) => [p.id.slice(-2), p.kind, p.count]), [['02', 'issue', 1], ['04', 'error', 1]]);
  assert.equal(p1[0].reason, 'Недостаточно средств');
  assert.deepEqual(problemsOf(undefined), []);
  const same = diffProblems(p1, p1);
  assert.deepEqual([same.added.length, same.worsened.length, same.resolved.length], [0, 0, 0]);
  const worse = diffProblems(p1, [{ ...p1[0], count: 3 }, p1[1], { id: '7412345678901234599', name: 'New', kind: 'issue', count: 1, reason: 'Закончился бюджет' }]);
  assert.deepEqual([worse.added.map((p) => p.name), worse.worsened.map((p) => p.name), worse.resolved.length], [['New'], ['Alpha'], 0]);
  const fixed = diffProblems(p1, [p1[0]]);
  assert.deepEqual(fixed.resolved.map((p) => p.name), ['Broken']);
  const toError = diffProblems([{ ...p1[0] }], [{ ...p1[0], kind: 'error', count: 1 }]);
  assert.equal(toError.worsened.length, 1);
  assert.equal(notificationFor(same), null);
  const n = notificationFor(worse, 3);
  assert.equal(n.title, 'TTAds Hub: проблемы в кабинетах (3)');
  assert.deepEqual(n.message.split('\n'), ['New: Закончился бюджет', 'Alpha: Недостаточно средств (×3)']);
  const many = notificationFor({ added: Array.from({ length: 5 }, (_, i) => ({ id: `7${i}`, name: `N${i}`, kind: 'issue', count: 1, reason: 'r' })), worsened: [] }, 5);
  assert.equal(many.message.split('\n').at(-1), 'и ещё 2');
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(7), '7');
  assert.equal(badgeText(250), '99');
  assert.match(badgeTitle(2, Date.UTC(2026, 9, 25, 12, 0)), /проблем: 2/);
  assert.match(badgeTitle(0, 0), /^TTAds Hub$/);
});
