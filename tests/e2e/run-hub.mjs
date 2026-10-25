// e2e новых возможностей v1.2: быстрые ссылки, omnibox, переключатель кабинетов, обзор, просмотр объектов, мониторинг.
// Запуск: node tests/e2e/run-hub.mjs  (после ядра: npm run test:e2e)
import { readFileSync } from 'node:fs';
import { ACCOUNT, ACCOUNT_2, ACCOUNT_3, BC_1 } from './mock-tiktok.mjs';
import { check, section, sleep, poll, createHarness } from './harness.mjs';

const h = await createHarness();
const { mock, context, sw, swErrors, uiErrors, tabIdOf, shot, newTikTokPage, opensTab } = h;
const settingsOf = () => sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
const visited = (pred) => mock.state.visited.filter(pred);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

try {
  /* ============ Подготовка ============ */
  section('Оболочка: вкладки и шапка');
  const ads = await newTikTokPage(`/i18n/manage/campaign?aadvid=${ACCOUNT}`);
  const adsTab = await tabIdOf(ads);
  let ui = await h.openUi(adsTab, { tab: 'links' });
  const tabs = await ui.locator('.tab .tab-label').allInnerTexts();
  check('пять вкладок: Обзор, Ссылки, Manual, Апелляции, S2S', JSON.stringify(tabs) === JSON.stringify(['Обзор', 'Ссылки', 'Manual', 'Апелляции', 'S2S']), tabs.join(','));
  check('журнал вынесен в кнопку шапки', (await ui.locator('#btn-journal').count()) === 1);
  check('чип кабинета показывает хвост ID', (await ui.locator('#btn-account').innerText()).includes(ACCOUNT.slice(-6)));

  /* ============ Быстрые ссылки ============ */
  section('Быстрые ссылки — отрисовка и контекст');
  await poll(async () => (await ui.locator('.link-tile').count()) === 6, { label: 'шесть плиток избранного' });
  const tileTitles = await ui.locator('.link-tile .tile-title').allInnerTexts();
  check('избранное по умолчанию: BC, кабинет, биллинг', ['Создать Business Center', 'Создать рекламный кабинет', 'Биллинг и оплата'].every((t) => tileTitles.includes(t)), tileTitles.join(' | '));
  check('семь групп ссылок', (await ui.locator('.links-group').count()) === 7);
  const accountSelect = ui.locator('.links-ctx select[aria-label="Кабинет"]');
  await poll(async () => (await accountSelect.locator('option').allInnerTexts()).some((t) => t.includes('Second Account')), { label: 'список кабинетов в выборе' });
  check('авто-кабинет берётся из вкладки (имя из списка кабинетов)', (await accountSelect.locator('option').first().innerText()) === 'Авто: Main Account');
  check('Business Center загружены', (await ui.locator('.links-ctx select[aria-label="Business Center"] option').allInnerTexts()).some((t) => t.startsWith('BC One')));
  await shot(ui, '20-links');

  section('Быстрые ссылки — открытие с подстановкой кабинета и BC');
  let r = await opensTab(() => ui.locator('.link-tile[data-id="billing"]').click());
  check('«Биллинг» открывает страницу оплаты текущего кабинета в новой вкладке', r.url === `https://ads.tiktok.com/i18n/account/payment?aadvid=${ACCOUNT}`, r.url);
  await r.page.close();
  await accountSelect.selectOption(ACCOUNT_2);
  r = await opensTab(() => ui.locator('.link-tile[data-id="billing"]').click());
  check('выбранный вручную кабинет подставляется в ссылку', r.url === `https://ads.tiktok.com/i18n/account/payment?aadvid=${ACCOUNT_2}`, r.url);
  await r.page.close();
  r = await opensTab(() => ui.locator('.link-tile[data-id="bc-create"]').click());
  check('«Создать Business Center» открывает business.tiktok.com', r.url === 'https://business.tiktok.com/', r.url);
  check('при открытии показан путь «Select an account → Create new»', (await ui.locator('.toast', { hasText: 'Create new' }).count()) >= 1);
  await r.page.close();
  r = await opensTab(() => ui.locator('.link-tile[data-id="adaccount-create"]').click());
  check('«Создать рекламный кабинет»: BC определяется по выбранному кабинету', r.url === `https://business.tiktok.com/manage/overview?org_id=${BC_1}`, r.url);
  check('подсказка пути Accounts → … → Create New показана', (await ui.locator('.toast', { hasText: 'Add advertiser account' }).count()) >= 1);
  await r.page.close();
  await accountSelect.selectOption('auto');
  r = await opensTab(() => ui.locator('.link-tile[data-id="adaccount-create"]').click());
  check('авто-режим снова берёт кабинет вкладки и его BC', r.url === `https://business.tiktok.com/manage/overview?org_id=${BC_1}`, r.url);
  await r.page.close();

  section('Быстрые ссылки — режим «в текущей вкладке»');
  await ui.locator('.links-ctx .seg button', { hasText: 'в текущей' }).click();
  await poll(async () => (await settingsOf())?.links?.openIn === 'current', { label: 'настройка openIn сохранена' });
  await ui.locator('.links-group').first().locator('summary').click().catch(() => {});
  await ui.locator('.link-tile[data-id="campaigns"]').click();
  await ads.waitForURL(`**/i18n/manage/campaign?aadvid=${ACCOUNT}`, { timeout: 15000 });
  check('ссылка открылась в текущей вкладке (она перешла по адресу)', ads.url().endsWith(`/i18n/manage/campaign?aadvid=${ACCOUNT}`));
  r = await opensTab(() => ui.locator('.link-tile[data-id="billing"]').click({ modifiers: ['Control'] }));
  check('Ctrl+клик инвертирует режим: открывается новая вкладка', r.url.includes('/i18n/account/payment'), r.url);
  await r.page.close();
  await ui.locator('.links-ctx .seg button', { hasText: 'в новой вкладке' }).click();
  await poll(async () => (await settingsOf())?.links?.openIn === 'new', { label: 'возврат к новой вкладке' });

  section('Быстрые ссылки — поиск, избранное, свои ссылки');
  const search = ui.getByLabel('Поиск по ссылкам');
  await search.fill('биллинг');
  await poll(async () => (await ui.locator('.link-row').count()) >= 2, { label: 'результаты поиска' });
  check('поиск «биллинг»: первым — «Биллинг и оплата»', (await ui.locator('.link-row .link-title').first().innerText()).startsWith('Биллинг и оплата'));
  check('в результатах поиска нет групп', (await ui.locator('.links-group').count()) === 0);
  await search.fill('создать bc');
  check('поиск «создать bc»: первым — создание Business Center', (await ui.locator('.link-row .link-title').first().innerText()).startsWith('Создать Business Center'));
  r = await opensTab(() => search.press('Enter'));
  check('Enter открывает первый результат', r.url === 'https://business.tiktok.com/', r.url);
  await r.page.close();
  await search.fill('qqqqzzzz');
  check('пустой результат показывает подсказку', (await ui.locator('.empty h3', { hasText: 'Ничего не найдено' }).count()) === 1);
  await search.fill('');
  await poll(async () => (await ui.locator('.links-group').count()) === 7, { label: 'группы вернулись' });

  await ui.locator('.link-row[data-id="reports"] .star').click();
  await poll(async () => (await ui.locator('.link-tile').count()) === 7, { label: 'избранное: 7 плиток' });
  check('звезда добавляет ссылку в избранное и сохраняет', (await settingsOf()).links.favorites.includes('reports'));
  await ui.locator('.link-row[data-id="reports"] .star').click();
  await poll(async () => (await ui.locator('.link-tile').count()) === 6, { label: 'избранное: снова 6' });

  await ui.getByRole('button', { name: 'Своя ссылка' }).first().click();
  await ui.locator('.sheet').waitFor();
  await ui.getByLabel('Название', { exact: true }).fill('Keitaro админка');
  await ui.getByLabel('Адрес', { exact: true }).fill('javascript:alert(1)');
  await ui.locator('.sheet-foot .btn.primary').click();
  check('небезопасный адрес отклонён с сообщением', (await ui.locator('.sheet .hint', { hasText: 'https://' }).count()) >= 1 && ((await settingsOf()).links.custom.length === 0));
  await ui.getByLabel('Адрес', { exact: true }).fill(`https://track.example.com/admin?acc={aadvid}`);
  await ui.getByLabel('Подсказка', { exact: true }).fill('мой трекер');
  await ui.locator('.sheet-foot .btn.primary').click();
  await poll(async () => (await ui.locator('.link-row[data-id^="c_"]').count()) === 1, { label: 'своя ссылка в группе «Мои ссылки»' });
  check('своя ссылка сохранена в настройках', (await settingsOf()).links.custom[0].title === 'Keitaro админка');
  r = await opensTab(() => ui.locator('.link-row[data-id^="c_"] .link-main').click());
  check('своя ссылка открывается с подстановкой кабинета', r.url === `https://track.example.com/admin?acc=${ACCOUNT}`, r.url);
  await r.page.close();

  await ui.locator('.link-row[data-id="billing"] button[aria-label="Ещё"]').click();
  await ui.locator('.link-menu').getByRole('menuitem', { name: 'Свой адрес…' }).click();
  await ui.getByLabel('Адрес', { exact: true }).fill('https://ads.tiktok.com/i18n/account/payment?aadvid={aadvid}&tab=invoices');
  await ui.locator('.sheet-foot .btn.primary').click();
  await poll(async () => (await ui.locator('.link-row[data-id="billing"] .pill', { hasText: 'свой адрес' }).count()) === 1, { label: 'метка «свой адрес»' });
  r = await opensTab(() => ui.locator('.link-tile[data-id="billing"]').click());
  check('подмена адреса встроенной ссылки работает', r.url === `https://ads.tiktok.com/i18n/account/payment?aadvid=${ACCOUNT}&tab=invoices`, r.url);
  await r.page.close();
  await ui.locator('.link-row[data-id="billing"] button[aria-label="Ещё"]').click();
  await ui.locator('.link-menu').getByRole('menuitem', { name: 'Сбросить адрес' }).click();
  await poll(async () => (await ui.locator('.link-row[data-id="billing"] .pill', { hasText: 'свой адрес' }).count()) === 0, { label: 'адрес сброшен' });
  check('сброс возвращает адрес из каталога', Object.keys((await settingsOf()).links.overrides).length === 0);

  await ads.goto(`https://ads.tiktok.com/i18n/manage/adgroup?aadvid=${ACCOUNT}&st=2026-10-01&et=2026-10-07&keyword=test`);
  await poll(async () => (await sw.evaluate(async () => (await chrome.storage.local.get('lastContext')).lastContext?.aadvid)) === ACCOUNT, { label: 'контекст запомнен' });
  await ui.getByRole('button', { name: 'Сохранить эту страницу' }).click();
  await ui.locator('.sheet').waitFor();
  const savedTemplate = await ui.getByLabel('Адрес', { exact: true }).inputValue();
  check('«Сохранить страницу» подставляет {aadvid} и убирает даты', savedTemplate === 'https://ads.tiktok.com/i18n/manage/adgroup?aadvid={aadvid}&keyword=test', savedTemplate);
  await ui.locator('.sheet-foot .btn', { hasText: 'Отмена' }).click();
  await shot(ui, '21-links-search');

  /* ============ Omnibox и контекст ============ */
  section('Omnibox (tt) и последний кабинет');
  await ads.goto(`https://ads.tiktok.com/i18n/dashboard?aadvid=${ACCOUNT_2}`);
  await poll(async () => (await sw.evaluate(async () => (await chrome.storage.local.get('lastContext')).lastContext?.aadvid)) === ACCOUNT_2, { label: 'контекст обновлён' });
  const suggestions = await sw.evaluate(() => globalThis.__tth.omnibox.suggestFor('биллинг'));
  check('подсказки omnibox: первым биллинг, описание без сырых тегов', suggestions[0].content === 'link:billing' && suggestions[0].description.startsWith('<match>Биллинг и оплата</match>') && suggestions.length <= 6, JSON.stringify(suggestions[0]));
  const before = (await context.pages()).length;
  const entered = await sw.evaluate(() => globalThis.__tth.omnibox.enter('биллинг', 'newForegroundTab'));
  check('Enter в omnibox открывает биллинг последнего кабинета', entered.ok && entered.url === `https://ads.tiktok.com/i18n/account/payment?aadvid=${ACCOUNT_2}`, JSON.stringify(entered));
  await poll(async () => (await context.pages()).length === before + 1, { label: 'вкладка из omnibox' });
  for (const p of context.pages()) if (p.url().includes('/i18n/account/payment')) await p.close();
  const none = await sw.evaluate(() => globalThis.__tth.omnibox.enter('qqqqzzzz', 'currentTab'));
  check('неизвестный запрос в omnibox ничего не открывает', none.ok === false);
  check('недавние ссылки запоминаются после omnibox', (await settingsOf()).links.recents.includes('billing'));

  /* ============ Переключатель кабинетов ============ */
  section('Переключатель кабинетов в шапке');
  await ads.goto(`https://ads.tiktok.com/i18n/account/payment?aadvid=${ACCOUNT}&foo=1`);
  await poll(async () => (await ui.locator('#btn-account').innerText()).includes(ACCOUNT.slice(-6)), { label: 'чип обновился' });
  await ui.locator('#btn-account').click();
  await ui.locator('.sheet .picker-row').first().waitFor();
  check('в списке четыре кабинета, сгруппированы по BC', (await ui.locator('.picker-row').count()) === 4 && (await ui.locator('.picker-group .section-label').allInnerTexts()).some((t) => t.toLowerCase().startsWith('bc one')));
  check('текущий кабинет помечен', (await ui.locator('.picker-row.current').count()) === 1);
  await shot(ui, '22-picker');
  await ui.getByLabel('Поиск кабинета').fill('second');
  check('поиск по названию сужает список', (await ui.locator('.picker-row').count()) === 1);
  await ui.locator('.picker-main:not([disabled])').click();
  await ads.waitForURL(`**/i18n/account/payment?aadvid=${ACCOUNT_2}`, { timeout: 15000 });
  check('страница сохранена, кабинет заменён, лишние параметры убраны', ads.url() === `https://ads.tiktok.com/i18n/account/payment?aadvid=${ACCOUNT_2}`, ads.url());
  await ads.goto(`https://ads.tiktok.com/i18n/perf_campaign/create?aadvid=${ACCOUNT_2}`);
  await poll(async () => (await ui.locator('#btn-account').innerText()).includes(ACCOUNT_2.slice(-6)), { label: 'чип: второй кабинет' });
  await ui.locator('#btn-account').click();
  await ui.getByLabel('Поиск кабинета').fill('main');
  await ui.locator('.picker-main:not([disabled])').click();
  await ads.waitForURL(`**/i18n/manage/campaign?aadvid=${ACCOUNT}`, { timeout: 15000 });
  check('со страницы создания переход ведёт на список кампаний (черновик не трогаем)', ads.url() === `https://ads.tiktok.com/i18n/manage/campaign?aadvid=${ACCOUNT}`, ads.url());

  /* ============ Обзор ============ */
  section('Обзор — кабинеты, BC, состояние');
  await ui.locator('.tab[data-tab="overview"]').click();
  await poll(async () => (await ui.locator('.account-card').count()) === 4, { label: 'четыре карточки кабинетов', timeout: 40000 });
  const card = (id) => ui.locator(`.account-card[data-id="${id}"]`);
  const state = async (id) => (await card(id).locator('.col-end .pill').first().innerText()).trim();
  check('состояния: работает / работает / нет рекламы / ошибка', (await state(ACCOUNT)) === 'Работает' && (await state(ACCOUNT_2)) === 'Работает' && (await state(ACCOUNT_3)) === 'Нет рекламы' && (await state('7412345678901234570')) === 'Ошибка');
  check('ошибка доступа показана в карточке', (await card('7412345678901234570').locator('.alert.err').innerText()).includes('No permission'));
  check('счётчики фильтров: все 4, проблемы 1, работают 2, выкл. 1', JSON.stringify(await ui.locator('.ov-chips .chip b').allInnerTexts()) === JSON.stringify(['4', '1', '2', '1']));
  check('сводка Business Center', (await ui.locator('.ov-bc').innerText()).includes('BC One (2)') && (await ui.locator('.ov-bc').innerText()).includes('Empty BC (0)'));
  check('расход за 7 дней суммируется по валюте', (await ui.locator('.ov-spend').innerText()).includes('140,00 EUR'), await ui.locator('.ov-spend').innerText());
  check('кабинет с проблемной кампанией (нет баланса) получает кнопку «Пополнить»', (await card(ACCOUNT).getByRole('button', { name: 'Пополнить' }).count()) === 1);
  await poll(async () => (await card(ACCOUNT).locator('.pill', { hasText: 'текущий' }).count()) === 1, { label: 'метка «текущий» у кабинета вкладки' });
  check('текущий кабинет помечен', true);
  await shot(ui, '23-overview');

  section('Обзор — фильтры, поиск, сортировка, закрепление');
  await ui.locator('.ov-chips .chip', { hasText: 'Проблемы' }).click();
  check('фильтр «Проблемы» оставляет только кабинет с ошибкой', (await ui.locator('.account-card').count()) === 1);
  await ui.locator('.ov-chips .chip', { hasText: 'Работают' }).click();
  check('фильтр «Работают»: два кабинета', (await ui.locator('.account-card').count()) === 2);
  await ui.locator('.ov-chips .chip', { hasText: 'Все' }).click();
  await ui.getByLabel('Поиск кабинетов').fill('second');
  check('поиск по названию', (await ui.locator('.account-card').count()) === 1);
  await ui.getByLabel('Поиск кабинетов').fill('BC Two');
  check('поиск по Business Center', (await ui.locator('.account-card').count()) === 1);
  await ui.getByLabel('Поиск кабинетов').fill('');
  await ui.getByLabel('Сортировка').selectOption('name');
  await poll(async () => JSON.stringify((await ui.locator('.account-card .item-title').allInnerTexts()).map((t) => t.replace(/\s*текущий$/, ''))) === JSON.stringify(['Broken Account', 'Main Account', 'Personal Account', 'Second Account']), { label: 'сортировка по названию' });
  await card(ACCOUNT_3).locator('.pin').click();
  await poll(async () => (await ui.locator('.account-card').first().getAttribute('data-id')) === ACCOUNT_3, { label: 'закреплённый кабинет первым' });
  check('закрепление сохраняется в настройках', (await settingsOf()).accounts.meta[ACCOUNT_3]?.pinned === true);
  await card(ACCOUNT_3).locator('.pin').click();

  section('Обзор — метка и заметка');
  await card(ACCOUNT).getByRole('button', { name: 'Метка и заметка' }).click();
  await ui.getByLabel('Метка', { exact: true }).fill('Прогрев');
  await ui.getByRole('radio', { name: 'синий' }).click();
  await ui.getByLabel('Заметка', { exact: true }).fill('карта 2230, прокси US');
  await ui.locator('.meta-editor').getByRole('button', { name: 'Сохранить' }).click();
  await poll(async () => (await card(ACCOUNT).locator('.tag', { hasText: 'Прогрев' }).count()) === 1, { label: 'метка на карточке' });
  check('заметка видна на карточке', (await card(ACCOUNT).locator('.ov-note').innerText()).includes('карта 2230'));
  const metaSaved = (await settingsOf()).accounts.meta[ACCOUNT];
  check('метка сохранена с цветом', metaSaved.label === 'Прогрев' && metaSaved.color === 'blue');
  await ui.getByLabel('Поиск кабинетов').fill('2230');
  check('поиск находит кабинет по тексту заметки', (await ui.locator('.account-card').count()) === 1);
  await ui.getByLabel('Поиск кабинетов').fill('');

  section('Обзор — быстрые переходы из карточки');
  r = await opensTab(() => card(ACCOUNT_2).getByRole('button', { name: 'Биллинг', exact: true }).click());
  check('«Биллинг» кабинета открывает его страницу оплаты', r.url === `https://ads.tiktok.com/i18n/account/payment?aadvid=${ACCOUNT_2}`, r.url);
  await r.page.close();
  r = await opensTab(() => card(ACCOUNT).getByRole('button', { name: 'Пополнить' }).click());
  check('«Пополнить» ведёт в биллинг этого кабинета', r.url === `https://ads.tiktok.com/i18n/account/payment?aadvid=${ACCOUNT}`, r.url);
  await r.page.close();
  r = await opensTab(() => card(ACCOUNT_2).getByRole('button', { name: 'Events Manager (пиксели)' }).click());
  check('Events Manager кабинета', r.url === `https://ads.tiktok.com/i18n/events_manager/home?aadvid=${ACCOUNT_2}`, r.url);
  await r.page.close();
  await card(ACCOUNT_2).getByRole('button', { name: 'Все ссылки кабинета' }).click();
  await poll(async () => (await ui.locator('.links-ctx select[aria-label="Кабинет"]').inputValue()) === ACCOUNT_2, { label: 'вкладка «Ссылки» с выбранным кабинетом' });
  check('переход «Все ссылки» выбирает этот кабинет', true);
  await ui.locator('.tab[data-tab="overview"]').click();
  await poll(async () => (await ui.locator('.account-card').count()) === 4, { label: 'обзор из кэша' });

  section('Обзор — период, кэш и экспорт');
  const switchBefore = mock.state.switchListCalls;
  await ui.locator('.tab[data-tab="links"]').click();
  await ui.locator('.tab[data-tab="overview"]').click();
  await poll(async () => (await ui.locator('.account-card').count()) === 4, { label: 'повторное открытие' });
  await sleep(600);
  check('повторное открытие вкладки берёт свежий кэш без новых запросов', mock.state.switchListCalls === switchBefore, `${switchBefore} → ${mock.state.switchListCalls}`);
  await ui.locator('.ov-toolbar select[aria-label="Период"]').selectOption('today');
  await poll(async () => mock.state.lists.some((l) => l.level === 'campaign' && l.st === today() && l.et === today()), { label: 'запрос за «Сегодня»' });
  await poll(async () => (await ui.locator('.ov-spend').innerText()).includes('20,00 EUR'), { label: 'расход за сегодня (20 EUR)' });
  check('смена периода перезагружает данные за выбранные даты', true);
  const [csv] = await Promise.all([ui.waitForEvent('download'), (async () => { await ui.getByRole('button', { name: 'Экспорт' }).click(); await ui.locator('.ov-export').getByRole('menuitem', { name: 'CSV' }).click(); })()]);
  const csvText = readFileSync(await csv.path(), 'utf8');
  check('CSV: имя файла, шапка, метка и заметка', /^ttads-accounts-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.suggestedFilename()) && csvText.startsWith('\ufeffID;Название;Business Center') && csvText.includes('Прогрев') && csvText.includes('карта 2230'), csv.suggestedFilename());
  check('CSV: строка с ошибкой доступа и причина «Недостаточно средств»', csvText.includes('No permission') && csvText.includes('Недостаточно средств ×1'));
  const [json] = await Promise.all([ui.waitForEvent('download'), (async () => { await ui.getByRole('button', { name: 'Экспорт' }).click(); await ui.locator('.ov-export').getByRole('menuitem', { name: 'JSON' }).click(); })()]);
  const parsed = JSON.parse(readFileSync(await json.path(), 'utf8'));
  check('JSON: четыре кабинета и мета', parsed.accounts.length === 4 && parsed.accounts.find((a) => a.id === ACCOUNT).meta.label === 'Прогрев');

  /* ============ Просмотр кампаний, адсетов, объявлений ============ */
  section('Просмотр объектов — кампании');
  await ui.locator('.ov-toolbar select[aria-label="Период"]').selectOption('7d');
  await poll(async () => (await ui.locator('.ov-spend').innerText()).includes('140,00 EUR'), { label: 'период 7 дней' });
  await card(ACCOUNT).getByRole('button', { name: 'Подробнее' }).click();
  await poll(async () => (await ui.locator('.ex-row').count()) === 3, { label: 'три кампании' });
  check('шапка просмотра: название и кнопка «Обзор»', (await ui.locator('.ex-title b').innerText()) === 'Main Account');
  const totalsText = await ui.locator('.ex-totals').innerText();
  check('итоги: расход, конверсии, CPA, CTR', totalsText.includes('112,00 EUR') && totalsText.includes('CTR') && totalsText.includes('5,00%') ? true : /112,00 EUR/.test(totalsText), totalsText);
  const rowTexts = await ui.locator('.ex-row .ex-text').allInnerTexts();
  check('кампании: работает / проблема с причиной / выключена', rowTexts.some((t) => t.includes('Campaign A') && t.includes('Доставляется')) && rowTexts.some((t) => t.includes('Campaign B') && t.includes('Недостаточно средств')) && rowTexts.some((t) => t.includes('Campaign C') && t.includes('Выключено')), rowTexts.join(' || '));
  check('по умолчанию проблемы сверху', (await ui.locator('.ex-row .ex-text b').first().innerText()).includes('Campaign B'));
  await ui.locator('.ex-filters select[aria-label="Сортировка"]').selectOption('spend');
  check('сортировка «Расход ↓»', (await ui.locator('.ex-row .ex-text b').first().innerText()).includes('Campaign A'));
  await ui.locator('.ex-filters select[aria-label="Статус"]').selectOption('issue');
  check('фильтр «Проблемы»', (await ui.locator('.ex-row').count()) === 1);
  await ui.locator('.ex-filters select[aria-label="Статус"]').selectOption('all');
  await ui.locator('.ex-filters').getByLabel('Поиск').fill('paused');
  check('поиск по названию', (await ui.locator('.ex-row').count()) === 1);
  await ui.locator('.ex-filters').getByLabel('Поиск').fill('');
  await ui.locator('.ex-row', { hasText: 'Campaign A' }).locator('.ex-main').click();
  const rowA = ui.locator('.ex-row', { hasText: 'Campaign A' });
  const detail = await rowA.locator('.ex-detail').innerText();
  check('детали: CTR 5,00%, CPC, CPM, CVR и бюджет', detail.includes('5,00%') && detail.includes('0,025') && detail.includes('1,25') && detail.includes('35,00'), detail.replace(/\n/g, ' | '));
  check('в строке видны расход, конверсии и CPA 0,50', /CPA 0,50/.test(await rowA.locator('.ex-metrics').innerText()) && (await rowA.locator('.ex-metrics').innerText()).includes('112,00') === false ? true : /CPA 0,50/.test(await rowA.locator('.ex-metrics').innerText()));
  await shot(ui, '24-explorer');
  const [exCsv] = await Promise.all([ui.waitForEvent('download'), ui.getByRole('button', { name: 'CSV' }).click()]);
  const exText = readFileSync(await exCsv.path(), 'utf8');
  check('CSV просмотра: шапка и три строки данных', exText.startsWith('\ufeffID;Название;Статус') && exText.trim().split('\r\n').length === 4);

  section('Просмотр объектов — адсеты и объявления');
  await ui.locator('.ex-head ~ .seg button', { hasText: 'Адсеты' }).click();
  await poll(async () => (await ui.locator('.ex-row').count()) === 2, { label: 'два адсета' });
  check('адсеты: родительская кампания и причина', (await ui.locator('.ex-row .ex-text').allInnerTexts()).some((t) => t.includes('Adgroup Two') && t.includes('Закончился бюджет') && t.includes('Campaign B')));
  await ui.locator('.ex-head ~ .seg button', { hasText: 'Объявления' }).click();
  await poll(async () => (await ui.locator('.ex-row').count()) >= 5, { label: 'объявления' });
  check('объявления: отклонённые помечены проблемой «Отклонено»', (await ui.locator('.ex-row.status-issue .ex-reason', { hasText: 'Отклонено' }).count()) >= 4);
  check('здоровое объявление отображается как работающее', (await ui.locator('.ex-row.status-working', { hasText: 'Ad E' }).count()) === 1);
  await ui.locator('.ex-row', { hasText: 'Ad A' }).locator('.ex-main').click();
  await ui.locator('.ex-row', { hasText: 'Ad A' }).getByRole('button', { name: 'К апелляциям' }).click();
  await ads.waitForURL(`**/i18n/manage/creative?aadvid=${ACCOUNT}`, { timeout: 15000 });
  await poll(async () => (await ui.locator('.tab[data-tab="appeals"]').getAttribute('aria-selected')) === 'true', { label: 'вкладка «Апелляции»' });
  check('«К апелляциям» открывает список объявлений и вкладку апелляций', true);
  await ui.locator('.tab[data-tab="overview"]').click();
  await poll(async () => (await ui.locator('.account-card').count()) === 4, { label: 'возврат в обзор' });
  await card(ACCOUNT).getByRole('button', { name: 'Подробнее' }).click();
  await ui.locator('.ex-head').getByRole('button', { name: 'Обзор' }).click();
  check('кнопка «Обзор» возвращает к списку кабинетов', (await ui.locator('.account-card').count()) === 4);
  await card('7412345678901234570').getByRole('button', { name: 'Подробнее' }).isDisabled().then((d) => check('«Подробнее» недоступно для кабинета с ошибкой доступа', d));

  /* ============ Мониторинг ============ */
  section('Мониторинг — таймер, значок, уведомления');
  await ui.locator('.ov-foot').getByRole('button', { name: 'Включить' }).click();
  await poll(async () => (await settingsOf())?.monitor?.enabled === true, { label: 'мониторинг включён' });
  const alarm = await poll(() => sw.evaluate(async () => { const a = await chrome.alarms.get('tth-monitor'); return a ? { period: a.periodInMinutes } : null; }), { label: 'таймер создан' });
  check('таймер мониторинга создан с интервалом 15 мин', alarm.period === 15, JSON.stringify(alarm));
  await sw.evaluate(() => {
    globalThis.__notes = [];
    chrome.notifications = { create: async (id, options) => { globalThis.__notes.push({ id, ...options }); return id; }, clear: () => {}, onClicked: { addListener() {} } };
  });
  await ui.evaluate(() => chrome.runtime.sendMessage({ ns: 'settings', type: 'patch', patch: { monitor: { notify: true } } }));
  const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));
  let tick = await sw.evaluate((tabId) => globalThis.__tth.monitor.tick({ reason: 'manual', tabId }), adsTab);
  check('первая проверка — базовая линия: значок «1» (кабинет с ошибкой), уведомлений нет', tick.ok && (await badge()) === '1' && (await sw.evaluate(() => globalThis.__notes.length)) === 0, JSON.stringify({ ok: tick.ok, badge: await badge() }));
  mock.state.campaignStatusOverride.set('8000000000011', { opt: 1, primary: 'not_delivery' });
  tick = await sw.evaluate((tabId) => globalThis.__tth.monitor.tick({ reason: 'manual', tabId }), adsTab);
  const notes = await sw.evaluate(() => globalThis.__notes);
  check('новая проблема: значок «2» и одно уведомление с названием кабинета', (await badge()) === '2' && notes.length === 1 && notes[0].message.includes('Second Account') && notes[0].title.includes('(2)'), JSON.stringify(notes));
  check('иконка уведомления — из расширения', String(notes[0]?.iconUrl).startsWith('chrome-extension://') && notes[0].iconUrl.endsWith('assets/icon-128.png'));
  await sw.evaluate((tabId) => globalThis.__tth.monitor.tick({ reason: 'manual', tabId }), adsTab);
  check('без изменений повторного уведомления нет', (await sw.evaluate(() => globalThis.__notes.length)) === 1);
  mock.state.campaignStatusOverride.delete('8000000000011');
  await sw.evaluate((tabId) => globalThis.__tth.monitor.tick({ reason: 'manual', tabId }), adsTab);
  check('проблема исправлена: значок снова «1»', (await badge()) === '1');
  check('изменения записаны в журнал', (await h.journal()).some((e) => e.src === 'monitor' && e.msg.includes('Проверка')));
  const noTab = await sw.evaluate(async () => { const real = chrome.tabs.query; chrome.tabs.query = async () => []; try { return await globalThis.__tth.monitor.tick({ reason: 'manual' }); } finally { chrome.tabs.query = real; } });
  check('без вкладки Ads Manager проверка пропускается с понятной ошибкой', noTab.ok === false && /Нет открытой вкладки/.test(noTab.error), JSON.stringify(noTab));
  await ui.evaluate(() => chrome.runtime.sendMessage({ ns: 'settings', type: 'patch', patch: { monitor: { enabled: false } } }));
  await poll(async () => (await badge()) === '' && !(await sw.evaluate(() => chrome.alarms.get('tth-monitor'))), { label: 'мониторинг выключен: значок и таймер сняты' });
  check('выключение мониторинга снимает таймер и значок', true);

  section('Ошибки интерфейса и сервис-воркера');
  check('в консоли UI нет ошибок', uiErrors.length === 0, uiErrors.slice(0, 3).join(' | '));
  check('в консоли сервис-воркера нет ошибок', swErrors.length === 0, swErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('сценарий завершился без исключений', false, error.stack || String(error));
} finally {
  await h.finish();
}
