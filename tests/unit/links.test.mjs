import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LINKS, GROUPS, LINK_BY_ID, DEFAULT_FAVORITES, isSafeHttpUrl, resolveUrl, resolveLink, parseContext, searchLinks, normalizeText,
  normalizeLinksSettings, allLinks, fromCurrentUrl, switchAccountUrl, omniboxSuggestions, parseOmniboxInput, escapeXml, newCustomId, hostOf, isTikTokUrl
} from '../../extension/background/links/catalog.js';

const ALLOWED_HOSTS = new Set(['ads.tiktok.com', 'business.tiktok.com', 'library.tiktok.com', 'business-api.tiktok.com', 'chromewebstore.google.com']);

test('catalog integrity: unique ids, known groups, safe https urls on allowed hosts, valid placeholders', () => {
  const ids = new Set();
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const link of LINKS) {
    assert.ok(!ids.has(link.id), `дубликат id ${link.id}`);
    ids.add(link.id);
    assert.ok(groups.has(link.group) && link.group !== 'custom', `${link.id}: группа`);
    assert.ok(link.title && link.desc, `${link.id}: нет названия или описания`);
    assert.ok(['verified', 'official', 'pattern'].includes(link.conf), `${link.id}: conf`);
    assert.ok(isSafeHttpUrl(link.url, { allowPlaceholders: true }), `${link.id}: небезопасный url`);
    assert.equal(new URL(link.url.replace(/\{(aadvid|bcid)\}/g, '1234567')).protocol, 'https:', `${link.id}: только https`);
    assert.ok(ALLOWED_HOSTS.has(hostOf(link.url)), `${link.id}: неожиданный хост ${hostOf(link.url)}`);
    assert.deepEqual([...link.url.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]).filter((n) => !['aadvid', 'bcid'].includes(n)), [], `${link.id}: чужой плейсхолдер`);
    if (link.fallback) assert.ok(isSafeHttpUrl(link.fallback), `${link.id}: fallback`);
    if (link.url.includes('{bcid}')) assert.ok(link.fallback, `${link.id}: ссылке с BC нужен fallback`);
    assert.ok(Array.isArray(link.kw) && link.kw.length, `${link.id}: нет ключевых слов`);
    assert.ok((link.hint ?? '').length <= 200);
  }
  for (const id of ['bc-create', 'adaccount-create', 'billing', 'campaigns', 'events', 'account-settings', ...DEFAULT_FAVORITES]) assert.ok(LINK_BY_ID.has(id), `нет обязательной ссылки ${id}`);
  assert.ok(LINKS.length >= 40);
});

test('verified account routes match the live Ads Manager routes from the research docs', () => {
  const expected = {
    campaigns: '/i18n/manage/campaign', billing: '/i18n/account/payment', 'account-settings': '/i18n/verification-center/setting',
    events: '/i18n/events_manager/home', catalogs: '/catalogs/insights', 'creative-library': '/i18n/creative-library/dashboard', leads: '/lead_center/leads',
    reports: '/i18n/reporting/list', rules: '/i18n/automated-rules-v2/management/manage', audiences: '/i18n/sas/audience/adver/main',
    comments: '/i18n/material/comment/list', experiments: '/i18n/experiment-manager', attribution: '/i18n/attribution-manager/insight/comparison',
    recommendations: '/i18n/recommendation-center', adgroups: '/i18n/manage/adgroup', ads: '/i18n/manage/creative'
  };
  for (const [id, path] of Object.entries(expected)) assert.equal(LINK_BY_ID.get(id).url, `https://ads.tiktok.com${path}?aadvid={aadvid}`, id);
});

test('resolveUrl substitutes ids, drops params with unknown values, and uses fallbacks', () => {
  const t = 'https://ads.tiktok.com/i18n/account/payment?aadvid={aadvid}&x=1';
  assert.deepEqual(resolveUrl(t, { aadvid: '7412345678901234567' }), { ok: true, url: 'https://ads.tiktok.com/i18n/account/payment?aadvid=7412345678901234567&x=1', missing: [], usedFallback: false });
  assert.equal(resolveUrl(t, {}).url, 'https://ads.tiktok.com/i18n/account/payment?x=1');
  assert.deepEqual(resolveUrl(t, {}).missing, ['aadvid']);
  assert.equal(resolveUrl('https://ads.tiktok.com/p?aadvid={aadvid}', { aadvid: 'not-a-number' }).url, 'https://ads.tiktok.com/p', 'нечисловой ID игнорируется');
  const bc = 'https://business.tiktok.com/manage/overview?org_id={bcid}';
  assert.equal(resolveUrl(bc, { bcid: '7700000000000000001' }).url, bc.replace('{bcid}', '7700000000000000001'));
  assert.deepEqual(resolveUrl(bc, {}, 'https://business.tiktok.com/'), { ok: true, url: 'https://business.tiktok.com/', missing: ['bcid'], usedFallback: true });
  assert.equal(resolveUrl('https://example.com/{aadvid}/x', {}).ok, false, 'плейсхолдер в пути без значения');
  assert.equal(resolveUrl('https://example.com/{aadvid}/x', { aadvid: '1234567' }).url, 'https://example.com/1234567/x');
  assert.equal(resolveUrl('https://ads.tiktok.com/p?a={aadvid}#top', { aadvid: '1234567' }).url, 'https://ads.tiktok.com/p?a=1234567#top');
});

test('resolveLink honours overrides only when they are safe', () => {
  const billing = LINK_BY_ID.get('billing');
  assert.equal(resolveLink(billing, { aadvid: '1234567' }, {}).overridden, false);
  const custom = resolveLink(billing, { aadvid: '1234567' }, { billing: 'https://ads.tiktok.com/pay?aadvid={aadvid}' });
  assert.equal(custom.url, 'https://ads.tiktok.com/pay?aadvid=1234567');
  assert.equal(custom.overridden, true);
  const evil = resolveLink(billing, { aadvid: '1234567' }, { billing: 'javascript:alert(1)' });
  assert.equal(evil.overridden, false);
  assert.match(evil.url, /^https:\/\/ads\.tiktok\.com\/i18n\/account\/payment/);
});

test('isSafeHttpUrl rejects dangerous schemes, whitespace and oversized input', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'chrome://settings', 'ftp://x.com', '//x.com', 'https://', '', 'https://a.com/ b', 'https://a.com/\n', 'x'.repeat(10), `https://a.com/${'a'.repeat(2100)}`, null, 42]) {
    assert.equal(isSafeHttpUrl(bad), false, String(bad).slice(0, 30));
  }
  assert.equal(isSafeHttpUrl('http://localhost:8080/x'), true);
  assert.equal(isSafeHttpUrl('https://a.com/p?x={aadvid}', { allowPlaceholders: true }), true);
});

test('parseContext extracts account and BC ids from TikTok urls only', () => {
  assert.deepEqual(parseContext('https://ads.tiktok.com/i18n/manage/campaign?aadvid=7412345678901234567'), { aadvid: '7412345678901234567', bcid: '' });
  assert.deepEqual(parseContext('https://business.tiktok.com/manage/overview?org_id=7700000000000000001'), { aadvid: '', bcid: '7700000000000000001' });
  assert.deepEqual(parseContext('https://ads.tiktok.com/x?advertiser_id=1234567&bc_id=7654321'), { aadvid: '1234567', bcid: '7654321' });
  assert.deepEqual(parseContext('https://ads.tiktok.com/x?aadvid=abc'), { aadvid: '', bcid: '' });
  assert.equal(parseContext('https://evil.example/?aadvid=1234567'), null);
  assert.equal(parseContext('not a url'), null);
});

test('searchLinks: Russian and English queries find the essential links first', () => {
  const top = (q) => searchLinks(q, LINKS)[0]?.id;
  assert.equal(top('биллинг'), 'billing');
  assert.equal(top('billing'), 'billing');
  assert.equal(top('оплата'), 'billing');
  assert.equal(top('создать bc'), 'bc-create');
  assert.ok(['bc-create', 'bc-home'].includes(top('бизнес менеджер')));
  assert.equal(top('создать бизнес менеджер'), 'bc-create');
  assert.equal(top('новый бизнес центр'), 'bc-create');
  assert.equal(top('создать кабинет'), 'adaccount-create');
  assert.equal(top('новый рекламный кабинет'), 'adaccount-create');
  assert.equal(top('регистрация'), 'adaccount-signup');
  assert.equal(top('кампании'), 'campaigns');
  assert.equal(top('пиксель'), 'pixel-create');
  assert.ok(searchLinks('апелляции', LINKS).map((l) => l.id).includes('appeals-list'));
  assert.ok(searchLinks('справка bc', LINKS).length >= 3);
  assert.deepEqual(searchLinks('', LINKS), []);
  assert.deepEqual(searchLinks('zzzzzzqqq', LINKS), []);
  assert.deepEqual(searchLinks('billing qqqq', LINKS), [], 'все слова запроса обязательны');
});

test('searchLinks: favourites win ties; normalizeText folds ё and punctuation', () => {
  const twins = [{ id: 'a1', title: 'Отчёт', desc: 'x', kw: [] }, { id: 'a2', title: 'Отчёт', desc: 'x', kw: [] }];
  assert.equal(searchLinks('отчет', twins)[0].id, 'a1');
  assert.equal(searchLinks('отчет', twins, { favorites: ['a2'] })[0].id, 'a2');
  assert.equal(normalizeText('  Настройки — «Кабинета»!  '), 'настройки — кабинета');
  assert.equal(normalizeText('Ёлка'), 'елка');
});

test('normalizeLinksSettings: defaults, caps, validation of custom links and overrides', () => {
  const d = normalizeLinksSettings({});
  assert.deepEqual(d.favorites, [...DEFAULT_FAVORITES]);
  assert.equal(d.openIn, 'new');
  assert.deepEqual(normalizeLinksSettings({ favorites: [] }).favorites, [], 'пустое избранное уважается');
  const s = normalizeLinksSettings({
    openIn: 'current',
    favorites: ['billing', 'billing', 'BAD ID!', 'campaigns'],
    recents: Array.from({ length: 20 }, (_, i) => `r${i}`),
    custom: [
      { id: 'c_one', title: '  Keitaro  ', url: 'https://track.example.com/admin?aadvid={aadvid}', hint: 'трекер' },
      { id: 'c_bad', title: 'x', url: 'javascript:alert(1)' },
      { id: 'billing', title: 'clash with builtin', url: 'https://a.com' },
      { id: 'c_one', title: 'dup', url: 'https://b.com' },
      null
    ],
    overrides: { billing: 'https://ads.tiktok.com/pay', nonexistent: 'https://a.com', campaigns: 'ftp://nope' }
  });
  assert.equal(s.openIn, 'current');
  assert.deepEqual(s.favorites, ['billing', 'campaigns']);
  assert.equal(s.recents.length, 8);
  assert.deepEqual(s.custom.map((c) => [c.id, c.title]), [['c_one', 'Keitaro']]);
  assert.deepEqual(s.overrides, { billing: 'https://ads.tiktok.com/pay' });
  const many = normalizeLinksSettings({ custom: Array.from({ length: 150 }, (_, i) => ({ id: `c_${i}`, title: 't', url: 'https://a.com' })) });
  assert.equal(many.custom.length, 100);
});

test('allLinks merges custom links and keeps them searchable', () => {
  const s = normalizeLinksSettings({ custom: [{ id: 'c_k', title: 'Keitaro трекер', url: 'https://track.example.com/admin', hint: 'мой трекер' }] });
  const links = allLinks(s);
  assert.equal(links.at(-1).group, 'custom');
  assert.equal(searchLinks('keitaro', links)[0].id, 'c_k');
  assert.equal(searchLinks('track.example', links)[0].id, 'c_k');
  assert.match(newCustomId(1700000000000, 0.5), /^c_[a-z0-9]+$/);
});

test('fromCurrentUrl templatizes ids and drops volatile params', () => {
  const r = fromCurrentUrl('https://ads.tiktok.com/i18n/manage/campaign?aadvid=7412345678901234567&st=2026-10-01&et=2026-10-07&keyword=test&campaign_draft_id=777');
  assert.equal(r.template, 'https://ads.tiktok.com/i18n/manage/campaign?aadvid={aadvid}&keyword=test');
  assert.equal(r.hasAccount, true);
  const bc = fromCurrentUrl('https://business.tiktok.com/manage/accounts/adAccount?org_id=7700000000000000001#x');
  assert.equal(bc.template, 'https://business.tiktok.com/manage/accounts/adAccount?org_id={bcid}#x');
  assert.equal(bc.hasBc, true);
  assert.equal(fromCurrentUrl('chrome://extensions'), null);
  assert.equal(fromCurrentUrl('nope'), null);
  assert.equal(fromCurrentUrl('https://example.com/a?b=1').template, 'https://example.com/a', 'параметры сторонних сайтов не сохраняются');
  assert.equal(fromCurrentUrl('https://example.com/a').trimmed, false);
});

test('switchAccountUrl keeps safe list pages and falls back to campaigns for everything else', () => {
  assert.deepEqual(switchAccountUrl('https://ads.tiktok.com/i18n/account/payment?aadvid=1111111&foo=1', '2222222'), { url: 'https://ads.tiktok.com/i18n/account/payment?aadvid=2222222', kept: true });
  assert.deepEqual(switchAccountUrl('https://ads.tiktok.com/i18n/manage/creative?aadvid=1111111&st=2026-10-01', '2222222'), { url: 'https://ads.tiktok.com/i18n/manage/creative?aadvid=2222222', kept: true });
  const draft = switchAccountUrl('https://ads.tiktok.com/i18n/creation/1nn/x/create/campaign?aadvid=1111111&campaign_draft_id=777', '2222222');
  assert.deepEqual(draft, { url: 'https://ads.tiktok.com/i18n/manage/campaign?aadvid=2222222', kept: false });
  assert.equal(switchAccountUrl('https://example.com/', '2222222').kept, false);
  assert.equal(switchAccountUrl('https://ads.tiktok.com/i18n/dashboard?aadvid=1', 'abc'), null);
});

test('omnibox: suggestions are XML-escaped; entered text resolves to a link', () => {
  assert.equal(escapeXml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  const evil = [{ id: 'c_evil', title: 'A <b>&</b>', desc: 'x"y', url: 'https://a.com', kw: [] }];
  const [s] = omniboxSuggestions('a', evil);
  assert.equal(s.content, 'link:c_evil');
  assert.ok(!/<b>/.test(s.description) && s.description.includes('&lt;b&gt;'));
  const billing = omniboxSuggestions('биллинг', LINKS);
  assert.equal(billing[0].content, 'link:billing');
  assert.ok(billing.length <= 6);
  assert.equal(omniboxSuggestions('', LINKS, { favorites: ['billing', 'campaigns'] }).length, 2);
  assert.equal(parseOmniboxInput('link:billing', LINKS).id, 'billing');
  assert.equal(parseOmniboxInput('создать bc', LINKS).id, 'bc-create');
  assert.equal(parseOmniboxInput('qqqqzzzz', LINKS), null);
  assert.equal(parseOmniboxInput('link:nope', LINKS), null);
});

test('security: no userinfo in urls; overrides of built-in links are limited to tiktok.com', () => {
  assert.equal(isSafeHttpUrl('https://user:pass@example.com/'), false);
  assert.equal(isSafeHttpUrl('https://user@example.com/'), false);
  assert.equal(isTikTokUrl('https://ads.tiktok.com/x?a={aadvid}', { allowPlaceholders: true }), true);
  assert.equal(isTikTokUrl('https://evil.tld/?host=ads.tiktok.com'), false);
  assert.equal(isTikTokUrl('https://nottiktok.com/'), false);
  assert.equal(isTikTokUrl('https://tiktok.com.evil.tld/'), false);
  const s = normalizeLinksSettings({ overrides: { billing: 'https://evil.tld/?a={aadvid}', campaigns: 'https://ads.tiktok.com/custom?aadvid={aadvid}' } });
  assert.deepEqual(s.overrides, { campaigns: 'https://ads.tiktok.com/custom?aadvid={aadvid}' }, 'чужой хост в подмене отбрасывается при нормализации (импорт настроек)');
  const link = LINK_BY_ID.get('billing');
  assert.equal(resolveLink(link, { aadvid: '1234567' }, { billing: 'https://evil.tld/' }).overridden, false, 'и при открытии тоже');
  assert.equal(normalizeLinksSettings({ custom: [{ id: 'c_x', title: 't', url: 'https://u:p@a.com/' }] }).custom.length, 0);
});

test('resolveUrl substitutes placeholders in the #fragment too', () => {
  assert.equal(resolveUrl('https://ads.tiktok.com/p#/acc/{aadvid}', { aadvid: '1234567' }).url, 'https://ads.tiktok.com/p#/acc/1234567');
  assert.equal(resolveUrl('https://ads.tiktok.com/p?x=1#/acc/{aadvid}', {}).url, 'https://ads.tiktok.com/p?x=1', 'без значения фрагмент с подстановкой отбрасывается');
  assert.equal(resolveUrl('https://ads.tiktok.com/p#top', {}).url, 'https://ads.tiktok.com/p#top');
});

test('fromCurrentUrl never keeps secrets or third-party params', () => {
  const ext = fromCurrentUrl('https://example.com/reset?token=abc&x=1#frag');
  assert.deepEqual([ext.template, ext.trimmed], ['https://example.com/reset', true]);
  const tt = fromCurrentUrl('https://ads.tiktok.com/i18n/x?aadvid=7412345678901234567&access_token=SECRET&csrf=1&keyword=ok&auth_code=9');
  assert.equal(tt.template, 'https://ads.tiktok.com/i18n/x?aadvid={aadvid}&keyword=ok');
  assert.equal(tt.trimmed, true);
  assert.equal(fromCurrentUrl('https://ads.tiktok.com/i18n/x?aadvid=7412345678901234567').trimmed, false);
  assert.equal(fromCurrentUrl('https://u:p@ads.tiktok.com/'), null);
});

test('searchLinks: plural/case endings and slang synonyms', () => {
  const ids = (q) => searchLinks(q, LINKS).map((l) => l.id);
  assert.ok(ids('кабинеты').includes('adaccount-create'));
  assert.ok(ids('апелляция').includes('appeals-list'));
  assert.ok(ids('аппилы').includes('appeals-list'));
  assert.ok(ids('бм').includes('bc-create') && ids('бм').includes('bc-home'));
  assert.equal(ids('биллинга')[0], 'billing');
  assert.equal(ids('кампаниям')[0], 'campaigns');
  assert.deepEqual(ids('zzzz'), []);
});
