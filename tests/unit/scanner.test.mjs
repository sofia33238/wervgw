import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers.mjs';
import { normalize } from '../../extension/background/appeals/core.js';

const scan = (location, document) => loadScript('content/scanner.js', { location, document }).__tthScanAppeals();
const make = (text) => ({ innerText: text, getClientRects: () => [{}], closest: () => null, querySelectorAll: () => [] });
const isSlotQuery = (sel) => sel === 'span,div,p,a' || sel.startsWith('[slot');

test('scanner handles campaign, ad and unresolved rows', () => {
  const out = scan(
    { hostname: 'ads.tiktok.com', href: 'https://ads.tiktok.com/i18n/manage/campaign?aadvid=123456789' },
    { querySelectorAll: (sel) => (isSlotQuery(sel) ? [] : [make('Campaign ID: 1234567890123\nRejected'), make('Ad ID: 9999999999999\nDisapproved'), make('Rejected · unknown ID'), make('Ad ID: 5555555555555\nActive')]) });
  assert.equal(out.account, '123456789');
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].level, 'campaign');
  assert.equal(out.rows[1].level, 'ad');
  assert.equal(out.unresolved.length, 1);
  assert.equal(out.pageLevel, 'campaign');
});

test('«Review issue» is visible and not mislabelled as rejected', () => {
  const out = scan(
    { hostname: 'ads.tiktok.com', href: 'https://ads.tiktok.com/?aadvid=123456789' },
    { querySelectorAll: (sel) => (isSlotQuery(sel) ? [] : [make('Ad ID: 1234567890123\nNot delivered\nReview issue'), make('Creative 2\nNot delivered\nReview issue')]) });
  assert.equal(out.rows[0].status, 'review_issue');
  assert.equal(out.unresolved.length, 1);
  assert.equal(normalize(out.rows)[0].status, 'review_issue');
});

test('custom div table without row selectors still yields the review-issue label', () => {
  const row = { innerText: 'Creative 1\nNot delivered\nReview issue', getClientRects: () => [{}], closest: () => null, querySelector: () => ({}), querySelectorAll: () => [], parentElement: null };
  const label = { innerText: 'Review issue', children: [], getClientRects: () => [{}], closest: () => null, parentElement: row };
  const out = scan({ hostname: 'ads.tiktok.com', href: 'https://ads.tiktok.com/?aadvid=123456789' }, { querySelectorAll: (sel) => (sel === 'span,div,p,a' ? [label] : []) });
  assert.equal(out.unresolved.length, 1);
  assert.equal(out.diagnostics.labelsFound, 1);
});

test('TikTok projected slots yield three distinct ad IDs with creative level', () => {
  const fields = [];
  for (const id of ['12345678901', '12345678902', '12345678903']) {
    for (const [k, v] of Object.entries({ creative_id: id, creative_name: 'Smart+ campaign' + id, creative_status: 'Not deliveredReview issue', ad_id: '99999999999' })) {
      fields.push({ getAttribute: () => `cell-${id}_${k}`, textContent: v });
    }
  }
  const out = scan({ hostname: 'ads.tiktok.com', href: 'https://ads.tiktok.com/i18n/manage/creative?aadvid=123456789' }, { querySelectorAll: (sel) => (sel.startsWith('[slot') ? fields : []) });
  assert.deepEqual(Array.from(out.rows, (r) => r.id).sort(), ['12345678901', '12345678902', '12345678903']);
  assert.ok(out.rows.every((r) => r.level === 'ad' && r.adgroupId === '99999999999' && r.status === 'review_issue'));
  assert.equal(out.pageLevel, 'ad');
});

test('scanner refuses to run outside ads.tiktok.com', () => {
  assert.throws(() => scan({ hostname: 'example.com', href: 'https://example.com/?aadvid=1' }, { querySelectorAll: () => [] }), /ads\.tiktok\.com/);
});
