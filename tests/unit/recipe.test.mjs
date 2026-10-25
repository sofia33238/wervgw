import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_RECIPE, campaignKind, recipePatch, safeUrlParams, unsupportedUnifiedSalesApp, exactProfile } from '../../extension/background/manual/recipe.js';

const draftBody = (form) => ({ campaign_sketch_form_data: { campaign_sketch_id: 777, campaign_snap_id: 5, ...form }, is_from_startup: true, with_sketch: false, clear_lower_level_sketches: true });
const smartForm = { universal_type: 1, spc_automation_type: 1, auto_creation_product_type: 1, budget_optimize_switch: 1, spc_upgrade_mode: 1, spc_multi_ad_mode: 1 };

test('campaignKind: objective types and hints', () => {
  assert.equal(campaignKind({ objective_type: 16 }), 'app');
  assert.equal(campaignKind({ objective_type: 15 }), 'sales');
  assert.equal(campaignKind({ objective_type: 8 }), 'lead');
  assert.equal(campaignKind({ objective_type: 3, sales_destination: 3 }), 'sales');
  assert.equal(campaignKind({ objective_type: 99 }), null);
  assert.equal(campaignKind({ objective_type: 99 }, LOCAL_RECIPE, 'app'), 'app');
  assert.equal(campaignKind({ objective_type: 99 }, LOCAL_RECIPE, 'bogus'), null);
  assert.equal(campaignKind({}), null);
  assert.equal(campaignKind({ objective_type: 42 }, LOCAL_RECIPE, null, new Map([['42', 'lead']])), 'lead');
});

test('recipePatch (lead): Manual flags, deleted keys and body flags', () => {
  const body = draftBody({ objective_type: 8, ...smartForm, universal_type_default_on: true });
  const patch = recipePatch(body, LOCAL_RECIPE, 'lead');
  const form = patch.body.campaign_sketch_form_data;
  assert.equal(patch.changed, true);
  assert.equal(patch.exact, true);
  assert.deepEqual([form.universal_type, form.spc_automation_type, form.auto_creation_product_type, form.budget_optimize_switch], [0, 0, 0, 0]);
  assert.equal(form.universal_type_default_on, false);
  assert.equal('spc_upgrade_mode' in form, false);
  assert.equal('spc_multi_ad_mode' in form, false);
  assert.equal(patch.body.is_from_startup, false);
  assert.equal(patch.body.with_sketch, true);
  assert.equal(patch.body.clear_lower_level_sketches, false);
  assert.equal(patch.body.is_skip_check_fields, true);
  assert.equal(body.campaign_sketch_form_data.universal_type, 1, 'исходное тело не мутируется');
});

test('recipePatch (sales exact / TikTok Shop / app)', () => {
  const sales = recipePatch(draftBody({ objective_type: 3, sales_destination: 3, ...smartForm }), LOCAL_RECIPE, 'sales');
  assert.equal(sales.exact, true);
  assert.equal(sales.body.campaign_sketch_form_data.web_all_in_one_catalog, 0);
  const shop = recipePatch(draftBody({ objective_type: 15, ...smartForm }), LOCAL_RECIPE, 'sales');
  assert.equal(shop.exact, false);
  assert.equal('web_all_in_one_catalog' in shop.body.campaign_sketch_form_data, false);
  const app = recipePatch(draftBody({ objective_type: 16, ...smartForm }), LOCAL_RECIPE, 'app');
  assert.equal(app.changed, true);
  assert.equal(app.body.campaign_sketch_form_data.universal_type, 0);
});

test('recipePatch: already Manual draft is reported as unchanged; mismatches throw', () => {
  const once = recipePatch(draftBody({ objective_type: 8, ...smartForm }), LOCAL_RECIPE, 'lead').body;
  assert.equal(recipePatch(once, LOCAL_RECIPE, 'lead').changed, false);
  assert.throws(() => recipePatch(draftBody({ objective_type: 8 }), LOCAL_RECIPE, 'sales'), /не соответствуют/);
  assert.throws(() => recipePatch({}, LOCAL_RECIPE, 'lead'), /нет данных черновика/);
});

test('recipePatch ignores unsafe recipe keys', () => {
  const evil = { ...LOCAL_RECIPE, form: { ...LOCAL_RECIPE.form, common: { ...LOCAL_RECIPE.form.common, advertiser_id: '1', budget: 1e9 } } };
  const patch = recipePatch(draftBody({ objective_type: 8 }), evil, 'lead').body.campaign_sketch_form_data;
  assert.equal('advertiser_id' in patch, false);
  assert.equal('budget' in patch, false);
});

test('safeUrlParams validates draft URL and applies only mode params', () => {
  const url = 'https://ads.tiktok.com/i18n/creation/1nn/x/create/campaign?aadvid=123&campaign_draft_id=777';
  assert.match(safeUrlParams(url, LOCAL_RECIPE, 'sales', true, '123', '777'), /web_all_in_one_catalog=0/);
  assert.equal(safeUrlParams(url, LOCAL_RECIPE, 'sales', false, '123', '777'), url);
  assert.throws(() => safeUrlParams(url, LOCAL_RECIPE, 'sales', true, '999', '777'), /изменился/);
  assert.throws(() => safeUrlParams('https://evil.example/create/campaign?aadvid=123&campaign_draft_id=777', LOCAL_RECIPE, 'sales', true, '123', '777'), /изменился/);
});

test('unsupportedUnifiedSalesApp blocks Sales → App in the unified editor only', () => {
  const ctx = { account: '123', draft: '777' };
  const url = 'https://ads.tiktok.com/i18n/creation/1nn/x/create/campaign?aadvid=123&campaign_draft_id=777';
  assert.equal(unsupportedUnifiedSalesApp(url, ctx, LOCAL_RECIPE, { campaign_sketch_id: 777, objective_type: 3, sales_destination: 4 }), true);
  assert.equal(unsupportedUnifiedSalesApp(url, ctx, LOCAL_RECIPE, { campaign_sketch_id: 777, objective_type: 3, sales_destination: 3 }), false);
  assert.equal(unsupportedUnifiedSalesApp(url + '&objective_type=3&sales_destination=4', ctx, LOCAL_RECIPE, null), true);
  assert.equal(unsupportedUnifiedSalesApp('https://ads.tiktok.com/i18n/perf/create/campaign?aadvid=123&campaign_draft_id=777', ctx, LOCAL_RECIPE, null), false);
  assert.equal(exactProfile({ objective_type: 8 }, LOCAL_RECIPE, 'lead'), true);
});
