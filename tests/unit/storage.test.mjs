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
