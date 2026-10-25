// e2e-проверка расширения в настоящем Chrome на моке TikTok Ads Manager (ядро: Manual, MNL, апелляции, S2S, журнал, настройки).
// Запуск: npm run test:e2e   (нужны Chrome/Chromium и openssl; путь к браузеру — CHROME_PATH)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT } from './mock-tiktok.mjs';
import { check, section, sleep, poll, createHarness, extensionPath, outDir, HOST } from './harness.mjs';

const h = await createHarness();
const { mock, context, sw, swErrors, uiErrors, tabIdOf, shot, journal, sendMessage, heroTitle, newTikTokPage, draftUrl, extensionSaves } = h;
const openUi = (tabId, options = {}) => h.openUi(tabId, { tab: 'manual', ...options });

try {
  /* ============ 0. Запуск ============ */
  section('Расширение загружается');
  const manifest = JSON.parse(readFileSync(join(extensionPath, 'manifest.json'), 'utf8'));
  check('сервис-воркер запущен', sw.url().endsWith('background/service-worker.js'));
  check('MV3, версия из манифеста', manifest.manifest_version === 3 && /^\d+\.\d+\.\d+$/.test(manifest.version), manifest.version);
  sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });

  /* ============ 1. Manual: окно создания → черновик → Manual ============ */
  section('Manual — создание кампании (Lead Generation)');
  let tiktok = await newTikTokPage(`/i18n/dashboard?aadvid=${ACCOUNT}`);
  let tabId = await tabIdOf(tiktok);
  let ui = await openUi(tabId);
  await poll(async () => (await heroTitle(ui)) === 'Цель: Lead Generation', { label: 'готовность Manual (Lead Generation)' });
  check('кнопка «Включить Manual» активна', await ui.locator('.hero .btn.primary').isEnabled());
  check('показан часовой пояс браузера', (await ui.getByText('Часовой пояс:').count()) === 1);
  await shot(ui, '01-manual-ready');
  await ui.locator('.hero .btn.primary').click();
  await poll(() => extensionSaves().length >= 1, { timeout: 40000, label: 'повторное сохранение черновика расширением' });
  const lead = extensionSaves()[0];
  const leadForm = lead.body.campaign_sketch_form_data;
  check('черновик переписан в Manual (флаги = 0)', leadForm.universal_type === 0 && leadForm.spc_automation_type === 0 && leadForm.auto_creation_product_type === 0 && leadForm.budget_optimize_switch === 0, JSON.stringify(leadForm));
  check('лишние ключи Smart+ удалены, universal_type_default_on=false', !('spc_upgrade_mode' in leadForm) && !('spc_multi_ad_mode' in leadForm) && leadForm.universal_type_default_on === false);
  check('флаги тела запроса: with_sketch / is_skip_check_fields / clear_lower_level_sketches', lead.body.with_sketch === true && lead.body.is_from_startup === false && lead.body.is_skip_check_fields === true && lead.body.clear_lower_level_sketches === false);
  check('повтор идёт в той же сессии (cookie + CSRF + req_src)', lead.cookieSession === 'sess-xyz' && lead.csrf === 'csrf-test-token-123' && lead.query.req_src === 'ad_creation' && lead.query.aadvid === ACCOUNT);
  check('на сервере черновик теперь Manual', mock.state.drafts.get('777').form.universal_type === 0);
  await poll(async () => (await heroTitle(ui)) === 'Manual активен', { timeout: 40000, label: 'итог «Manual активен»' });
  check('в редакторе показан Manual-вариант (клик по «Change» выполнен)', await tiktok.locator('[data-cs-name="LEAD_Manual"][data-cs-selected="true"]').count() === 1);
  check('вкладка осталась на том же черновике', tiktok.url().includes('campaign_draft_id=777'));
  await shot(ui, '02-manual-done');

  /* ============ 2. Manual: готовый черновик Sales ============ */
  section('Manual — открытый черновик (Sales, готовый перехват)');
  const salesUrl = await draftUrl(tiktok, 'SALES');
  await tiktok.goto(`${HOST}${salesUrl}`);
  await poll(async () => (await ui.locator('.hero .btn.primary').count()) && (await ui.locator('.hero-title').innerText()) === 'Цель: Sales', { timeout: 30000, label: 'Sales готов' });
  const before = extensionSaves().length;
  await ui.locator('.hero .btn.primary').click();
  await poll(() => extensionSaves().length > before, { timeout: 40000, label: 'повтор сохранения Sales' });
  const sales = extensionSaves().at(-1).body.campaign_sketch_form_data;
  check('Sales: web_all_in_one_catalog=0 и Manual-флаги', sales.web_all_in_one_catalog === 0 && sales.universal_type === 0 && sales.objective_type === 3);
  await poll(() => tiktok.url().includes('web_all_in_one_catalog=0'), { timeout: 30000, label: 'URL с параметром Manual для Sales' });
  check('URL черновика получил параметр web_all_in_one_catalog=0', tiktok.url().includes('web_all_in_one_catalog=0'));
  await poll(async () => (await heroTitle(ui)) === 'Manual активен', { timeout: 40000, label: 'Manual активен (Sales)' });

  section('Manual — повторное открытие уже ручного черновика');
  await tiktok.reload();
  await poll(async () => ['Manual уже в черновике', 'Manual активен'].includes(await heroTitle(ui)), { timeout: 30000, label: 'распознан Manual после перезагрузки' });
  if ((await heroTitle(ui)) === 'Manual уже в черновике') {
    await ui.locator('.hero .btn.primary').click();
    await poll(async () => (await heroTitle(ui)) === 'Manual активен', { timeout: 40000, label: 'показать Manual' });
  }
  check('повторный клик не создаёт лишних сохранений', extensionSaves().length === before + 1, `было ${before + 1}, стало ${extensionSaves().length}`);
  const guard = await sendMessage(ui, 'manual', 'activate', { tabId, account: '999' });
  check('защита от смены кабинета: команда для другого кабинета отклонена', guard.ok === false && /Кабинет на вкладке изменился/.test(guard.error), JSON.stringify(guard));

  /* ============ 3. MNL: перехват флагов ============ */
  section('MNL — перехват флагов автоматизации');
  const route = await newTikTokPage(`/i18n/perf_campaign/create?aadvid=${ACCOUNT}`);
  const routeTab = await tabIdOf(route);
  await ui.close();
  ui = await openUi(routeTab);
  const sw1 = ui.locator('label.switch', { hasText: 'Перехват флагов автоматизации' }).locator('input');
  await poll(async () => await sw1.isEnabled(), { label: 'переключатель MNL доступен' });
  check('MNL выключен по умолчанию', !(await sw1.isChecked()));
  await route.locator('#send').click();
  await poll(() => mock.state.echoes.length === 1, { label: 'эхо-запрос без MNL' });
  check('без MNL запрос уходит как есть', mock.state.echoes[0].universal_type === 1);
  await ui.locator('label.switch', { hasText: 'Перехват флагов автоматизации' }).click();
  await route.waitForLoadState('load');
  await poll(async () => (await route.locator('#send').count()) === 1 && (await route.evaluate(() => sessionStorage.getItem('__tth_mnl_boot'))) === '1', { label: 'страница перезагружена с MNL' });
  await route.locator('#send').click();
  await poll(() => mock.state.echoes.length === 2, { label: 'эхо-запрос с MNL' });
  check('MNL правит тело запроса (1 → 0)', mock.state.echoes[1].universal_type === 0 && mock.state.echoes[1].spc_automation_type === 0 && mock.state.echoes[1].keep === 'x', JSON.stringify(mock.state.echoes[1]));
  await poll(async () => (await route.locator('#out').innerText()).includes('flags'), { label: 'ответ отрисован на странице' });
  const reply = JSON.parse(await route.locator('#out').innerText());
  check('MNL правит ответ (true → false), чужие поля не трогает', reply.flags.universal_type === 0 && reply.flags.web_all_in_one_catalog === false && reply.flags.other === 7, JSON.stringify(reply.flags));
  await poll(async () => (await journal()).some((e) => e.src === 'mnl' && /perf|echo|universal_type/.test(e.msg)), { timeout: 8000, label: 'запись перехвата в журнале' });
  check('правки MNL попали в журнал', (await journal()).some((e) => e.src === 'mnl'));
  await ui.locator('.tab[data-tab="manual"]').click();
  await poll(async () => await ui.locator('label.switch', { hasText: 'Перехват флагов автоматизации' }).locator('input').isChecked(), { label: 'переключатель показывает «включён»' });
  await shot(ui, '03-manual-mnl');
  await ui.locator('label.switch', { hasText: 'Перехват флагов автоматизации' }).click();
  await route.waitForLoadState('load');
  await poll(async () => (await route.evaluate(() => sessionStorage.getItem('__tth_mnl_boot'))) === null, { label: 'страница перезагружена без MNL' });
  await route.locator('#send').click();
  await poll(() => mock.state.echoes.length === 3, { label: 'эхо-запрос после выключения' });
  check('после выключения MNL запрос снова не меняется', mock.state.echoes[2].universal_type === 1);

  section('Автоклик по меткам');
  await sendMessage(ui, 'settings', 'patch', { patch: { manual: { autoClick: true, labels: ['Select placement'] } } });
  await route.reload();
  await poll(async () => (await route.locator('#clicks').innerText()) !== '0', { timeout: 15000, label: 'автоклик выполнен' });
  await sleep(2500);
  check('метка нажата ровно один раз', (await route.locator('#clicks').innerText()) === '1', await route.locator('#clicks').innerText());
  await sendMessage(ui, 'settings', 'patch', { patch: { manual: { autoClick: false } } });
  await route.reload();
  await sleep(3000);
  check('при выключенном автоклике страница не трогается', (await route.locator('#clicks').innerText()) === '0');
  section('MNL + Manual-движок работают вместе');
  const mnlSwitch = ui.locator('label.switch', { hasText: 'Перехват флагов автоматизации' });
  await mnlSwitch.click();
  await route.waitForLoadState('load');
  await poll(async () => (await route.evaluate(() => sessionStorage.getItem('__tth_mnl_boot'))) === '1', { label: 'MNL снова включён' });
  const mnlDraft = await draftUrl(route, 'LEAD_GENERATION');
  const savesBefore = extensionSaves().length;
  await route.goto(`${HOST}${mnlDraft}`);
  await poll(async () => (await ui.locator('.hero-title').innerText()) === 'Цель: Lead Generation' && await ui.locator('.hero .btn.primary').isEnabled(), { timeout: 30000, label: 'MNL-черновик готов' });
  const pageSave = mock.state.saves.at(-1);
  check('при включённом MNL штатное сохранение TikTok уже уходит с Manual-флагами', pageSave.body.campaign_sketch_form_data.universal_type === 0 && !pageSave.fromExtension);
  await ui.locator('.hero .btn.primary').click();
  await poll(async () => (await heroTitle(ui)) === 'Manual активен', { timeout: 40000, label: 'Manual активен без повторного сохранения' });
  const combined = extensionSaves();
  check('движок дополняет рецепт поверх правок MNL: одно повторное сохранение без ключей Smart+', combined.length === savesBefore + 1 && !('spc_upgrade_mode' in combined.at(-1).body.campaign_sketch_form_data) && combined.at(-1).body.campaign_sketch_form_data.budget_optimize_switch === 0, `было ${savesBefore}, стало ${combined.length}`);
  check('на сервере черновик в Manual', mock.state.drafts.get(new URL(`${HOST}${mnlDraft}`).searchParams.get('campaign_draft_id')).form.universal_type === 0);
  check('в редакторе показан Manual-вариант', await route.locator('[data-cs-name="LEAD_Manual"][data-cs-selected="true"]').count() === 1);
  await mnlSwitch.click();
  await route.waitForLoadState('load');
  await poll(async () => (await route.evaluate(() => sessionStorage.getItem('__tth_mnl_boot'))) === null, { label: 'MNL выключен после сценария' });
  await route.close();

  /* ============ 4. Апелляции ============ */
  section('Апелляции — уровень адсетов');
  const groups = await newTikTokPage(`/i18n/manage/adgroup?aadvid=${ACCOUNT}`);
  const groupsTab = await tabIdOf(groups);
  await ui.close();
  ui = await openUi(groupsTab);
  await ui.locator('.tab[data-tab="appeals"]').click();
  await poll(async () => (await ui.locator('.item').count()) === 1, { label: 'найден 1 адсет с Review issue' });
  check('сканер нашёл адсет с проблемой и пропустил здоровый', (await ui.locator('.item .item-title').first().innerText()).includes('Ad group one'));
  await ui.locator('.item input').first().check();
  await ui.locator('.bar .btn.primary').click();
  await poll(async () => (await ui.locator('.sheet').count()) === 1, { label: 'окно апелляции открыто' });
  const info = await ui.locator('.sheet .alert.info').innerText();
  check('вложенные объявления адсета загружены (4 с проблемами)', /Выбрано объявлений:\s*4/.test(info), info);
  await ui.locator('.sheet-foot .btn', { hasText: 'Назад' }).click();

  section('Апелляции — уровень объявлений');
  const creatives = await newTikTokPage(`/i18n/manage/creative?aadvid=${ACCOUNT}`);
  await groups.close();
  const creativesTab = await tabIdOf(creatives);
  await ui.close();
  ui = await openUi(creativesTab);
  await ui.locator('.tab[data-tab="appeals"]').click();
  await poll(async () => (await ui.locator('.item').count()) === 4, { label: 'найдено 4 проблемных объявления' });
  check('здоровое объявление не попало в список', (await ui.locator('.item').allInnerTexts()).every((t) => !t.includes('healthy')));
  check('счётчик на вкладке', (await ui.locator('.tab[data-tab="appeals"] .badge').innerText()) === '4');
  await shot(ui, '04-appeals-list');
  await ui.locator('.bar .btn', { hasText: 'Выбрать все' }).click();
  check('«Выбрать все» выбрало 4', (await ui.locator('.bar .count b').innerText()) === '4');
  await shot(ui, '05-appeals-selected');
  await ui.locator('.bar .btn.primary').click();
  await ui.locator('.sheet').waitFor();
  await sleep(400);
  check('шаблон подставлен по умолчанию', (await ui.locator('.sheet textarea').inputValue()).startsWith('I believe my ad was rejected by mistake'));
  check('отправка заблокирована до подтверждения', await ui.locator('.sheet-foot .btn.primary').isDisabled());
  await ui.locator('.sheet label.radio-card', { hasText: 'Похожие объявления' }).click();
  await ui.locator('.sheet .check input').check();
  await shot(ui, '06-appeals-compose');
  await ui.locator('.sheet-foot .btn.primary').click();
  await poll(async () => (await ui.locator('.sheet .stats').count()) === 1, { timeout: 40000, label: 'итоги отправки' });
  const stat = async (label) => Number(await ui.locator('.stat', { hasText: label }).locator('b').innerText());
  check('успешно: 2 (подтверждено TikTok + проверено по статусу)', (await stat('Успешно')) === 2, String(await stat('Успешно')));
  check('лимит TikTok (90071): 1', (await stat('Лимит TikTok')) === 1);
  check('ошибка сервера: 1', (await stat('Ошибок')) === 1);
  check('сервер получил 4 запроса с верными полями', mock.state.appeals.length === 4 && mock.state.appeals.every((a) => a.body.appeal_reason_type === 4 && a.body.advertiser_id === ACCOUNT && a.body.adv_entry === 'ad review detail' && a.csrf === 'csrf-test-token-123' && a.cookie && typeof a.body.creative_id === 'number'));
  check('параллелизм ограничен тремя запросами (и используется)', mock.state.peakInflight === 3, `пик ${mock.state.peakInflight}`);
  check('причина 90071 сгруппирована в итогах', (await ui.locator('details.group').count()) >= 1);
  await shot(ui, '07-appeals-result');
  await ui.locator('.sheet-foot .btn', { hasText: 'Закрыть' }).click();
  await poll(async () => (await ui.locator('.item.disabled').count()) === 3, { timeout: 20000, label: 'отправленные заблокированы повтором' });
  check('повторная отправка заблокирована (3 из 4), ошибочная доступна', (await ui.locator('.item:not(.disabled)').count()) === 1);
  check('после отправки нет ложного предупреждения о неопределённых статусах', (await ui.locator('.alert.warn').count()) === 0);
  await ui.locator('.seg button', { hasText: 'История' }).click();
  await poll(async () => (await ui.locator('.card .pill', { hasText: 'Лимит TikTok' }).count()) >= 1, { label: 'история показывает лимит' });
  check('история содержит 4 записи', (await ui.locator('.bar .count b').innerText()) === '4');
  await shot(ui, '08-appeals-history');
  await ui.locator('.seg button', { hasText: 'Очередь' }).click();

  section('Апелляции — закрытие окна во время отправки');
  const batchState = () => sw.evaluate(async () => (await chrome.storage.session.get('tth:appeals:batch'))['tth:appeals:batch'] ?? null);
  const appealsBefore = mock.state.appeals.length;
  await ui.locator('.item:not(.disabled) input').check();
  await ui.locator('.bar .btn.primary').click();
  await ui.locator('.sheet').waitFor();
  await ui.locator('.sheet .check input').check();
  await ui.locator('.sheet-foot .btn.primary').click();
  await ui.close();
  await poll(async () => (await batchState())?.state === 'done', { timeout: 30000, label: 'пачка завершилась без открытого окна' });
  check('пачка дошла до конца в фоне после закрытия окна', mock.state.appeals.length === appealsBefore + 1);
  ui = await openUi(creativesTab, { tab: null }); // последняя открытая вкладка запоминается — окно открывается сразу на «Апелляциях»
  await poll(async () => (await ui.locator('.sheet-head h2', { hasText: 'Итоги отправки' }).count()) === 1, { label: 'итоги показаны при повторном открытии' });
  check('итоги отправки восстановлены при следующем открытии', (await ui.locator('.stat', { hasText: 'Ошибок' }).locator('b').innerText()) === '1');
  await ui.locator('.sheet-foot .btn', { hasText: 'Закрыть' }).click();
  await ui.close();
  ui = await openUi(creativesTab, { tab: null });
  await poll(async () => (await ui.locator('.item').count()) >= 1, { label: 'список апелляций открыт' });
  await sleep(1500);
  check('просмотренные итоги больше не всплывают', (await ui.locator('.sheet').count()) === 0);

  section('Апелляции — остановка пачки');
  for (let i = 1; i <= 6; i++) {
    mock.state.ads.push({ creative_id: `90000000001${String(i).padStart(2, '0')}`, ad_id: '7000000000003', campaign_id: '8000000000001', name: `Bulk ad ${i}`, pageStatus: 'Not delivered · Rejected', appealMode: 'ok', delayMs: 600 });
  }
  await sendMessage(ui, 'settings', 'patch', { patch: { appeals: { concurrency: 1 } } });
  await ui.close();
  await creatives.reload();
  ui = await openUi(creativesTab, { tab: null });
  await poll(async () => (await ui.locator('.item').count()) >= 7, { label: 'в списке появились 6 новых объявлений' });
  await ui.getByPlaceholder('Фильтр по названию или ID').fill('Bulk');
  await ui.locator('.bar .btn', { hasText: 'Выбрать все' }).click();
  check('выбраны только отфильтрованные 6', (await ui.locator('.bar .count b').innerText()) === '6');
  await ui.locator('.bar .btn.primary').click();
  await ui.locator('.sheet').waitFor();
  await ui.locator('.sheet .check input').check();
  const sentBefore = mock.state.appeals.length;
  await ui.locator('.sheet-foot .btn.primary').click();
  await poll(() => mock.state.appeals.length > sentBefore, { label: 'первая апелляция ушла' });
  await ui.locator('.sheet-foot .btn.danger').click();
  await poll(async () => (await ui.locator('.sheet .stats').count()) === 1, { timeout: 40000, label: 'итоги после остановки' });
  const sentInBatch = mock.state.appeals.length - sentBefore;
  const skipped = Number(await ui.locator('.stat', { hasText: 'Пропущено' }).locator('b').innerText());
  const okCount = Number(await ui.locator('.stat', { hasText: 'Успешно' }).locator('b').innerText());
  check('«Остановить» прекращает запуск оставшихся запросов', sentInBatch >= 1 && sentInBatch < 6 && skipped === 6 - sentInBatch && okCount === sentInBatch, `отправлено ${sentInBatch}, пропущено ${skipped}, успешно ${okCount}`);
  check('итоги сообщают об остановке', (await ui.locator('.sheet .alert.warn', { hasText: 'остановлена' }).count()) === 1);
  await ui.locator('.sheet-foot .btn', { hasText: 'Закрыть' }).click();
  await sendMessage(ui, 'settings', 'patch', { patch: { appeals: { concurrency: 3 } } });

  /* ============ 5. S2S ============ */
  section('S2S — постбэк, архив, тест события');
  await ui.locator('.tab[data-tab="s2s"]').click();
  await ui.getByPlaceholder('track.example.com').fill('https://Track.Example.com/');
  await poll(async () => (await ui.locator('.code').first().innerText()).includes('https://track.example.com/lander/tts2s/indexpix1.php?pix={px}&at={tk}'), { label: 'ссылка постбэка' });
  check('ссылка постбэка собрана по формату из канала', (await ui.locator('.code').first().innerText()).includes('&ttclid={ttclid}&event=Purchase&user_agent={useragent}&ip={ip}'));
  const [download] = await Promise.all([ui.waitForEvent('download'), ui.locator('.btn', { hasText: 'Скачать S2S_TTAds.zip' }).click()]);
  const zipPath = join(outDir, 'S2S_TTAds.zip');
  await download.saveAs(zipPath);
  const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
  check('архив S2S_TTAds.zip валиден и содержит оба файла', /index\.php/.test(listing) && /indexpix1\.php/.test(listing) && /No errors/.test(execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' })));
  check('скрипт в архиве совпадает с исходником', execFileSync('unzip', ['-p', zipPath, 'indexpix1.php'], { encoding: 'utf8' }) === readFileSync(join(extensionPath, 's2s/indexpix1.php'), 'utf8'));
  check('в тесте события есть предупреждение о настоящем событии', (await ui.locator('.alert.warn', { hasText: 'настоящее событие' }).count()) === 1);
  await ui.getByPlaceholder('Pixel Code', { exact: true }).fill('CTESTPIXEL000000001');
  await ui.getByPlaceholder('Access Token (Developer token)').fill('GOODTOKEN0123456789ABCDEFGH');
  await ui.locator('.btn', { hasText: 'Отправить тест' }).click();
  await poll(async () => (await ui.locator('.alert.ok', { hasText: 'TikTok принял событие' }).count()) === 1, { label: 'тест события принят' });
  const ev = mock.state.events.at(-1);
  check('тест (API 1.0) ушёл на /pixel/track/ с Access-Token', ev.path === '/open_api/v1.3/pixel/track/' && ev.token === 'GOODTOKEN0123456789ABCDEFGH' && ev.body.pixel_code === 'CTESTPIXEL000000001' && ev.body.event === 'Purchase');
  await ui.locator('select.select').first().selectOption('2');
  await ui.getByPlaceholder('Access Token (Developer token)').fill('BADTOKEN0123456789ABCDEFGHIJ');
  await ui.locator('.btn', { hasText: 'Отправить тест' }).click();
  await poll(async () => (await ui.locator('.alert.err', { hasText: 'не принял' }).count()) === 1, { label: 'ошибка токена показана' });
  check('API 2.0 использует /event/track/ и показывает ошибку TikTok', mock.state.events.at(-1).path === '/open_api/v1.3/event/track/' && (await ui.locator('.alert.err').innerText()).includes('40105'));
  check('на вкладке S2S есть переход на вкладку «Пиксель»', (await ui.getByRole('button', { name: 'Открыть «Пиксель»' }).count()) === 1);

  section('Пиксель — создание, токен, передача в «Тест события»');
  await ui.getByRole('button', { name: 'Открыть «Пиксель»' }).click();
  await poll(async () => (await ui.locator('.tab[data-tab="pixel"]').getAttribute('aria-selected')) === 'true', { label: 'вкладка «Пиксель»' });
  const createBtn = ui.locator('.btn', { hasText: 'Создать пиксель и получить токен' });
  await createBtn.click();
  await poll(async () => (await ui.locator('.alert.ok', { hasText: 'Пиксель создан' }).count()) === 1, { label: 'пиксель создан' });
  check('пиксель создан, правило и токен получены', mock.state.pixels.length === 2 && (await ui.locator('.kv').innerText()).includes('CTESTPIXEL000000001') && (await ui.locator('.kv').innerText()).includes('DEVTOK'));
  check('URL-правило отправлено с ключевыми словами', JSON.stringify(mock.state.pixels[1].trigger).includes('thank-you') && JSON.stringify(mock.state.pixels[1].trigger).includes('approved'));
  await shot(ui, '09-pixel');
  await ui.locator('.btn', { hasText: 'В «Тест события»' }).click();
  await poll(async () => (await ui.locator('.tab[data-tab="s2s"]').getAttribute('aria-selected')) === 'true', { label: 'возврат на вкладку S2S' });
  await poll(async () => (await ui.getByPlaceholder('Pixel Code', { exact: true }).inputValue()) === 'CTESTPIXEL000000001', { label: 'пиксель подставлен в тест' });
  check('пиксель и токен подставлены в «Тест события»', (await ui.getByPlaceholder('Access Token (Developer token)').inputValue()) === 'DEVTOKEN0123456789ABCDEFGHIJ');
  const sendBox = () => ui.getByRole('button', { name: 'Отправить тест' }).boundingBox();
  const testInView = await poll(async () => { const b = await sendBox(); return b && b.y + b.height <= ui.viewportSize().height; }, { label: 'тест события показан без ручной прокрутки' }).then(() => true, () => false);
  check('после перехода вкладка S2S прокручена к «Тест события»', testInView);
  await ui.locator('.tab[data-tab="pixel"]').click();
  mock.state.failToken = true;
  await createBtn.click();
  await poll(async () => (await ui.locator('.alert.warn', { hasText: 'Developer token не получен' }).count()) === 1, { label: 'предупреждение о токене' });
  check('при сбое токена пиксель не теряется: код показан, предупреждение выведено', (await ui.locator('.alert.ok', { hasText: 'Пиксель создан' }).count()) === 1 && (await ui.locator('.kv').innerText()).includes('CTESTPIXEL000000001'));
  mock.state.failToken = false;

  /* ============ 6. Журнал и настройки ============ */
  section('Журнал и настройки');
  await ui.locator('#btn-journal').click();
  await poll(async () => (await ui.locator('.log-item').count()) >= 4, { label: 'записи журнала' });
  const sources = await ui.locator('.log-item .pill').allInnerTexts();
  check('в журнале есть Manual, MNL, Апелляции и S2S', ['Manual', 'MNL', 'Апелляции', 'S2S'].every((s) => sources.includes(s)), sources.join(','));
  await shot(ui, '10-journal');
  await ui.locator('#btn-settings').click();
  await ui.locator('.sheet').waitFor();
  await sleep(500);
  await shot(ui, '11-settings');
  await ui.locator('.sheet select.select').first().selectOption('light');
  await ui.locator('.sheet-foot .btn.primary').click();
  await poll(async () => (await ui.evaluate(() => document.documentElement.dataset.theme)) === 'light', { label: 'светлая тема применена' });
  const reopened = await openUi(creativesTab);
  check('светлая тема сохраняется между открытиями', (await reopened.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await reopened.close();
  await ui.locator('.tab[data-tab="manual"]').click();
  await sleep(600);
  await shot(ui, '12-light-manual');
  await ui.locator('.tab[data-tab="appeals"]').click();
  await sleep(1200);
  await shot(ui, '13-light-appeals');

  section('Ошибки интерфейса и сервис-воркера');
  check('в консоли UI нет ошибок', uiErrors.length === 0, uiErrors.slice(0, 3).join(' | '));
  check('в консоли сервис-воркера нет ошибок', swErrors.length === 0, swErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('сценарий завершился без исключений', false, error.stack || String(error));
} finally {
  await h.finish();
}
