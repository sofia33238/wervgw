import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { renderLinksDoc } from '../../scripts/gen-links-doc.mjs';

const docs = new URL('../../extension/docs/', import.meta.url);

test('docs/quick-links.md is generated from the catalog (no drift)', () => {
  assert.equal(readFileSync(new URL('quick-links.md', docs), 'utf8'), renderLinksDoc(), 'запустите: npm run docs:links');
});

test('shipped docs carry no real account data', () => {
  assert.equal(existsSync(new URL('live-account-snapshot-2026-10-25.json', docs)), false, 'снимок живого кабинета нельзя включать в сборку');
  for (const name of readdirSync(docs)) {
    const text = readFileSync(new URL(name, docs), 'utf8').replace(/doc_id=\d+/g, '');
    assert.deepEqual(text.match(/\d{15,}/g) ?? [], [], `${name}: найдены длинные числовые ID`);
    assert.ok(!/Oreg|otkrovenno|onerk|Копия 1/i.test(text), `${name}: найдены названия реальных кабинетов`);
  }
});

test('the API catalog and capability registry stay valid JSON with the documented policy', () => {
  const catalog = JSON.parse(readFileSync(new URL('internal-api-catalog.json', docs), 'utf8'));
  assert.ok(Array.isArray(catalog.endpoints) && catalog.endpoints.length > 50);
  assert.ok(catalog.uiRoutes.some((r) => r.id === 'billing' && r.path.includes('/i18n/account/payment')));
  const caps = JSON.parse(readFileSync(new URL('tiktok-ads-capabilities.json', docs), 'utf8'));
  assert.ok(caps.policy.neverStore.includes('csrf-token') && caps.policy.confirmBefore.includes('payment-change'));
});
