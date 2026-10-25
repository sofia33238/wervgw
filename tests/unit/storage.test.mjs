import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULT_SETTINGS } from '../../extension/background/lib/storage.js';
import { DEFAULT_LABELS, DEFAULT_AUTOMATION_FIELDS } from '../../extension/background/lib/constants.js';

test('normalizeSettings: empty input yields defaults', () => {
  const s = normalizeSettings({});
  assert.equal(s.appeals.concurrency, 3);
  assert.equal(s.manual.autoClick, false);
  assert.deepEqual(s.manual.labels, [...DEFAULT_LABELS]);
  assert.deepEqual(s.manual.fields, [...DEFAULT_AUTOMATION_FIELDS]);
  assert.equal(s.appeals.templates[0].id, 'default');
  assert.equal(s.ui.theme, 'dark');
  assert.deepEqual(DEFAULT_SETTINGS.s2s.path, '/lander/tts2s');
});

test('normalizeSettings clamps values and drops unsafe data', () => {
  const s = normalizeSettings({
    appeals: { concurrency: 99, reason: 9, templateId: 'ghost', templates: [{ id: 'a', name: 'A', text: 'hello' }, { id: 'b', text: '   ' }, null] },
    manual: { autoClick: 'yes', labels: ['  x  ', '', 'y'], fields: ['good_one', 'bad key!', '<script>'] },
    s2s: { api: '2', event: 'bad event', currency: 'eur', domain: 'a.io' },
    ui: { theme: 'neon' },
    evil: { extra: true }
  });
  assert.equal(s.appeals.concurrency, 6);
  assert.equal(s.appeals.reason, 5);
  assert.equal(s.appeals.templateId, 'default');
  assert.deepEqual(s.appeals.templates.map((t) => t.id), ['default', 'a']);
  assert.equal(s.manual.autoClick, false, 'только строгое true включает автоклик');
  assert.deepEqual(s.manual.labels, ['x', 'y']);
  assert.deepEqual(s.manual.fields, ['good_one']);
  assert.equal(s.s2s.api, '2');
  assert.equal(s.s2s.event, 'Purchase');
  assert.equal(s.s2s.currency, 'EUR');
  assert.equal(s.ui.theme, 'dark');
  assert.equal('evil' in s, false);
  assert.equal(normalizeSettings({ appeals: { templateId: 'a', templates: [{ id: 'a', name: 'A', text: 't' }] } }).appeals.templateId, 'a');
});

test('normalizeSettings: links, monitor, overview and account meta sections', () => {
  const d = normalizeSettings({});
  assert.deepEqual(d.monitor, { enabled: false, intervalMin: 15, notify: false });
  assert.deepEqual(d.overview, { period: '7d', sort: 'problems', filter: 'all' });
  assert.deepEqual(d.accounts, { meta: {} });
  assert.equal(d.links.openIn, 'new');
  assert.ok(d.links.favorites.includes('billing'));

  const s = normalizeSettings({
    monitor: { enabled: true, intervalMin: 17, notify: true },
    overview: { period: 'forever', sort: 'spend', filter: 'issues' },
    links: { openIn: 'current', custom: [{ id: 'c_a', title: 'T', url: 'https://a.com' }] },
    accounts: { meta: {
      '7412345678901234567': { label: '  Прогрев-очень-длинная-метка-на-много-символов ', color: 'purple', note: 'x'.repeat(500), pinned: true },
      '7412345678901234568': { label: '', note: '', pinned: false },
      'abc': { label: 'bad id' },
      '7412345678901234569': { label: 'ok', color: 'neon' }
    } }
  });
  assert.deepEqual(s.monitor, { enabled: true, intervalMin: 15, notify: true });
  assert.deepEqual(s.overview, { period: '7d', sort: 'spend', filter: 'issues' });
  assert.equal(s.links.openIn, 'current');
  assert.equal(s.links.custom.length, 1);
  assert.deepEqual(Object.keys(s.accounts.meta), ['7412345678901234567', '7412345678901234569']);
  const meta = s.accounts.meta['7412345678901234567'];
  assert.equal(meta.label.length, 24);
  assert.equal(meta.note.length, 300);
  assert.equal(meta.color, 'purple');
  assert.equal(s.accounts.meta['7412345678901234569'].color, 'gray');
  assert.equal(normalizeSettings({ monitor: { intervalMin: 1000 } }).monitor.intervalMin, 60);
  assert.equal(normalizeSettings({ monitor: { intervalMin: 1 } }).monitor.intervalMin, 5);
});
