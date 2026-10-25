import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRow, normalizeRows, withDerived, totals, filterRows, sortRows, periodRange, csvCell, toCsv, ROW_COLUMNS, ROW_KEYS, LEVELS
} from '../../extension/background/explorer/model.js';
import { classifyReason, reasonText } from '../../extension/background/lib/reasons.js';

const campaign = (o = {}) => ({ campaign_id: '8000000000001', campaign_name: 'Camp A', opt_status: 1, primary_status: 'delivery_ok', stat_cost: '12.50', show_cnt: '1000', click_cnt: 50, time_attr_convert_cnt: 5, campaign_budget: '35', ...o });

test('reasons: exact codes, fuzzy classification and prettified fallbacks', () => {
  assert.equal(reasonText('account_balance_not_enough'), 'Недостаточно средств');
  assert.equal(reasonText('CAMPAIGN_OUT_OF_BUDGET'), 'Закончился бюджет');
  assert.equal(reasonText('some_new_balance_problem'), 'Недостаточно средств', 'нечёткая классификация');
  assert.equal(reasonText('weird_new_code'), 'weird new code');
  assert.equal(reasonText(''), 'Причина не указана');
  assert.equal(classifyReason('creative_offline_audit'), 'rejected');
  assert.equal(classifyReason('under_review'), 'review');
  assert.equal(classifyReason('time_done'), 'schedule');
  assert.equal(classifyReason('adgroup_disable'), 'off');
  assert.equal(classifyReason(null), 'other');
});

test('normalizeRow(campaign): statuses, numbers from strings, budget', () => {
  const working = normalizeRow('campaign', campaign());
  assert.deepEqual([working.id, working.name, working.status, working.enabled], ['8000000000001', 'Camp A', 'working', true]);
  assert.deepEqual([working.spend, working.impressions, working.clicks, working.conversions, working.budget], [12.5, 1000, 50, 5, 35]);
  const issue = normalizeRow('campaign', campaign({ primary_status: 'not_delivery', campaign_status: 'account_balance_not_enough' }));
  assert.equal(issue.status, 'issue');
  assert.equal(issue.reason, 'Недостаточно средств');
  assert.equal(issue.reasonKind, 'balance');
  const off = normalizeRow('campaign', campaign({ opt_status: 2, primary_status: 'disable' }));
  assert.deepEqual([off.status, off.enabled, off.reason], ['off', false, '']);
  const listStatus = normalizeRow('campaign', campaign({ primary_status: 'not_delivery', campaign_status: '-', campaign_status_list: '["campaign_out_of_budget","audit"]' }));
  assert.deepEqual(listStatus.reasons, ['campaign_out_of_budget', 'audit']);
  assert.equal(listStatus.reason, 'Закончился бюджет');
  assert.equal(normalizeRow('campaign', { campaign_name: 'no id' }), null);
  assert.equal(normalizeRow('campaign', null), null);
  assert.equal(normalizeRow('bogus', campaign()), null);
  assert.equal(normalizeRow('campaign', campaign({ stat_cost: 'abc', show_cnt: null })).spend, 0);
  assert.equal(normalizeRow('campaign', campaign({ stat_cost: '1,5' })).spend, 1.5, 'десятичная запятая');
});

test('normalizeRow(adgroup / ad): id mapping and parents; ad moderation flags', () => {
  const group = normalizeRow('adgroup', { ad_id: '7000000000001', ad_name: 'AG', campaign_id: '8000000000001', campaign_name: 'Camp A', opt_status: 1, primary_status: 'delivery_ok', stat_cost: 3 });
  assert.deepEqual([group.id, group.name, group.campaignId, group.campaignName, group.adgroupId], ['7000000000001', 'AG', '8000000000001', 'Camp A', '']);
  const ad = normalizeRow('ad', { creative_id: '9000000000001', creative_name: 'Ad A', ad_id: '7000000000001', ad_name: 'AG', campaign_id: '8000000000001', opt_status: 1, primary_status: 'not_delivery', creative_status: 'creative_offline_audit' });
  assert.deepEqual([ad.id, ad.adgroupId, ad.adgroupName, ad.moderation, ad.status], ['9000000000001', '7000000000001', 'AG', 'rejected', 'issue']);
  assert.equal(ad.reasonKind, 'rejected');
  const review = normalizeRow('ad', { creative_id: '9000000000002', opt_status: 2, primary_status: 'disable', creative_aggr_tag_info: 'review_issue' });
  assert.equal(review.moderation, 'review');
  assert.equal(review.status, 'issue', 'выключенное, но с проблемой модерации — всё равно проблема');
  const healthy = normalizeRow('ad', { creative_id: '9000000000003', opt_status: 1, primary_status: 'delivery_ok', creative_status: 'creative_delivery_ok' });
  assert.deepEqual([healthy.moderation, healthy.status], [null, 'working']);
  const appealRejected = normalizeRow('ad', { creative_id: '9000000000004', opt_status: 1, primary_status: 'not_delivery', appeal_result: '{"status":4}', creative_status: 'appeal_rejected' });
  assert.equal(appealRejected.moderation, 'rejected');
});

test('derived metrics return null on zero denominators; totals recompute ratios', () => {
  const zero = withDerived({ spend: 5, impressions: 0, clicks: 0, conversions: 0 });
  assert.deepEqual([zero.ctr, zero.cpc, zero.cpm, zero.cpa, zero.cvr], [null, null, null, null, null]);
  const d = withDerived({ spend: 10, impressions: 2000, clicks: 100, conversions: 4 });
  assert.deepEqual([d.ctr, d.cpc, d.cpm, d.cpa, d.cvr], [5, 0.1, 5, 2.5, 4]);
  const rows = normalizeRows('campaign', [campaign(), campaign({ campaign_id: '8000000000002', stat_cost: 7.5, show_cnt: 1000, click_cnt: 50, time_attr_convert_cnt: 5 }), { junk: true }]);
  assert.equal(rows.length, 2);
  const t = totals(rows);
  assert.deepEqual([t.spend, t.impressions, t.clicks, t.conversions, t.ctr, t.cpa], [20, 2000, 100, 10, 5, 2]);
  assert.equal(totals([]).cpa, null);
});

test('filterRows and sortRows (nulls last, input untouched)', () => {
  const rows = normalizeRows('campaign', [
    campaign({ campaign_id: '8000000000001', campaign_name: 'Alpha', stat_cost: 5, time_attr_convert_cnt: 0 }),
    campaign({ campaign_id: '8000000000002', campaign_name: 'beta', primary_status: 'not_delivery', campaign_status: 'balance_not_enough', stat_cost: 9, time_attr_convert_cnt: 3, show_cnt: 100, click_cnt: 10 }),
    campaign({ campaign_id: '8000000000003', campaign_name: 'Gamma', opt_status: 2, primary_status: 'disable', stat_cost: 1, time_attr_convert_cnt: 1, show_cnt: 0, click_cnt: 0 })
  ]);
  assert.deepEqual(filterRows(rows, { status: 'issue' }).map((r) => r.name), ['beta']);
  assert.deepEqual(filterRows(rows, { q: 'GAM' }).map((r) => r.name), ['Gamma']);
  assert.deepEqual(filterRows(rows, { q: '8000000000002' }).map((r) => r.name), ['beta']);
  assert.deepEqual(sortRows(rows, 'problems').map((r) => r.name), ['beta', 'Alpha', 'Gamma']);
  assert.deepEqual(sortRows(rows, 'spend').map((r) => r.name), ['beta', 'Alpha', 'Gamma']);
  assert.deepEqual(sortRows(rows, 'cpa').map((r) => r.name), ['Gamma', 'beta', 'Alpha'], 'CPA ↑, без конверсий — в конец');
  assert.deepEqual(sortRows(rows, 'ctr').map((r) => r.name), ['beta', 'Alpha', 'Gamma'], 'CTR ↓, без показов — в конец');
  assert.deepEqual(sortRows(rows, 'name').map((r) => r.name), ['Alpha', 'beta', 'Gamma']);
  assert.deepEqual(rows.map((r) => r.name), ['Alpha', 'beta', 'Gamma'], 'исходный массив не изменяется');
  assert.ok(LEVELS.length === 3 && ROW_KEYS.includes('stat_cost'));
});

test('periodRange: presets by local calendar days', () => {
  const now = new Date(2026, 9, 25, 13, 0, 0);
  assert.deepEqual(periodRange('today', now), { st: '2026-10-25', et: '2026-10-25' });
  assert.deepEqual(periodRange('yesterday', now), { st: '2026-10-24', et: '2026-10-24' });
  assert.deepEqual(periodRange('7d', now), { st: '2026-10-19', et: '2026-10-25' });
  assert.deepEqual(periodRange('30d', now), { st: '2026-09-26', et: '2026-10-25' });
  assert.deepEqual(periodRange('bogus', now), { st: '2026-10-19', et: '2026-10-25' });
  assert.deepEqual(periodRange('7d', new Date(2026, 0, 3)), { st: '2025-12-28', et: '2026-01-03' }, 'переход через год');
});

test('CSV: quoting, BOM, CRLF and formula-injection guard', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1'), `'+1`);
  assert.equal(csvCell('@cmd'), `'@cmd`);
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell('-5.5'), '-5.5', 'обычные отрицательные числа без префикса');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(NaN), '');
  const rows = normalizeRows('campaign', [campaign({ campaign_name: '=cmd|x' })]);
  const csv = toCsv(rows, ROW_COLUMNS);
  assert.ok(csv.startsWith('\ufeffID;Название;Статус'));
  assert.ok(csv.includes(`'=cmd|x`));
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.split('\r\n').length, 3);
});
