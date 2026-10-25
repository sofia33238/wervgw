import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers.mjs';

const api = () => loadScript('content/agent.js').__tthAgent;

const el = (text, { visible = true, attrs = {}, classes = [] } = {}) => {
  const node = {
    textContent: text, isConnected: true, clicks: 0,
    getAttribute: (name) => attrs[name] ?? null,
    classList: { contains: (c) => classes.includes(c) },
    getBoundingClientRect: () => (visible ? { width: 10, height: 10 } : { width: 0, height: 0 }),
    scrollIntoView() {}, click() { node.clicks++; }
  };
  return node;
};
const view = { getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) };

test('matchingControls: match by partial text, skip active/oversized', () => {
  const { matchingControls } = api();
  const items = [el('Switch to custom targeting'), el('  MANUAL CAMPAIGN  '), el('Unrelated'), el('Custom mode', { attrs: { 'aria-checked': 'true' } }),
    el('Select placement', { classes: ['selected'] }), el('x'.repeat(100) + ' custom mode')];
  const doc = { querySelectorAll: () => items };
  const found = matchingControls(doc, ['switch to custom targeting', 'manual campaign', 'custom mode', 'select placement']);
  assert.deepEqual(Array.from(found, (n) => n.textContent.trim()), ['Switch to custom targeting', 'MANUAL CAMPAIGN']);
});

test('matchingControls keeps only the innermost match (a child click bubbles to its parent)', () => {
  const { matchingControls } = api();
  const inner = el('Manual campaign'), outer = el('Manual campaign');
  inner.contains = (n) => n === inner;
  outer.contains = (n) => n === inner || n === outer;
  const found = matchingControls({ querySelectorAll: () => [outer, inner] }, ['manual campaign']);
  assert.equal(found.length, 1);
  assert.equal(found[0], inner);
});

test('selectManualControls clicks only visible controls and stops when none remain', async () => {
  const { selectManualControls } = api();
  const shown = el('Select placement'), hidden = el('Select placement', { visible: false });
  let pass = 0;
  const doc = { querySelectorAll: () => (pass++ === 0 ? [shown, hidden] : []) };
  const count = await selectManualControls(doc, view, ['select placement'], { passes: 4, interval: 1, afterClick: 1 });
  assert.equal(count, 1);
  assert.equal(shown.clicks, 1);
  assert.equal(hidden.clicks, 0);
});

test('selectManualControls never clicks the same element twice (toggles would flip back)', async () => {
  const { selectManualControls } = api();
  const sticky = el('Manual campaign');
  const doc = { querySelectorAll: () => [sticky] };
  const count = await selectManualControls(doc, view, ['manual campaign'], { passes: 4, interval: 1, afterClick: 1 });
  assert.equal(count, 1);
  assert.equal(sticky.clicks, 1);
});

test('route and timezone helpers', () => {
  const { isCreationRoute, timezoneInText } = api();
  assert.equal(isCreationRoute('/i18n/creation/1nn/x/create/campaign'), true);
  assert.equal(isCreationRoute('/i18n/perf_campaign/create'), true);
  assert.equal(isCreationRoute('/i18n/manage/campaign'), false);
  assert.equal(timezoneInText('Time zone: (UTC+02:00) Berlin\nx'), '(UTC+02:00) Berlin');
  assert.equal(timezoneInText('Showing GMT+3 data'), 'GMT+3');
  assert.equal(timezoneInText('nothing'), null);
});
