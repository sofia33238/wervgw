import { h, clear, toast, download } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { APPEAL_REASONS, DEFAULT_LABELS, DEFAULT_AUTOMATION_FIELDS, VERSION } from '../../background/lib/constants.js';

export function openSettings(ctx) {
  const host = document.getElementById('sheet-host');
  clear(host);
  const draft = structuredClone(ctx.settings ?? { manual: {}, appeals: { templates: [] }, s2s: {}, ui: {} });
  draft.manual ??= {}; draft.appeals ??= { templates: [] }; draft.ui ??= {};
  const close = () => clear(host);

  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);

  const theme = h('select', { class: 'select' }, [['auto', 'Как в системе'], ['dark', 'Тёмная'], ['light', 'Светлая']].map(([v, l]) => h('option', { value: v, selected: draft.ui.theme === v }, l)));
  theme.addEventListener('change', () => { draft.ui.theme = theme.value; document.documentElement.dataset.theme = theme.value === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme.value; });

  const labels = h('textarea', { class: 'textarea mono', rows: '6', spellcheck: 'false' });
  labels.value = (draft.manual.labels ?? DEFAULT_LABELS).join('\n');
  const fields = h('textarea', { class: 'textarea mono', rows: '5', spellcheck: 'false' });
  fields.value = (draft.manual.fields ?? DEFAULT_AUTOMATION_FIELDS).join('\n');

  const concurrency = h('input', { class: 'input', type: 'number', min: '1', max: '6', value: draft.appeals.concurrency ?? 3 });
  const reason = h('select', { class: 'select' }, APPEAL_REASONS.map((r) => h('option', { value: r.value, selected: r.value === (draft.appeals.reason ?? 1) }, r.ru)));

  const templatesBox = h('div', { class: 'stack' });
  function renderTemplates() {
    clear(templatesBox);
    draft.appeals.templates.forEach((tpl, index) => {
      const name = h('input', { class: 'input', value: tpl.name, maxlength: '60', 'aria-label': 'Название шаблона' });
      const text = h('textarea', { class: 'textarea', rows: '3', maxlength: '2000', 'aria-label': 'Текст шаблона' });
      text.value = tpl.text;
      name.addEventListener('input', () => { tpl.name = name.value; });
      text.addEventListener('input', () => { tpl.text = text.value; });
      templatesBox.append(h('div', { class: 'card', style: { padding: '10px' } },
        h('div', { class: 'row', style: { marginBottom: '6px' } }, name,
          tpl.id === 'default' ? h('span', { class: 'pill' }, 'основной') : h('button', { class: 'icon-btn', type: 'button', title: 'Удалить', onclick: () => { draft.appeals.templates.splice(index, 1); renderTemplates(); } }, icon('trash', 15))),
        text));
    });
    templatesBox.append(h('button', { class: 'btn sm', type: 'button', onclick: () => {
      if (draft.appeals.templates.length >= 30) return toast('Не больше 30 шаблонов', 'error');
      draft.appeals.templates.push({ id: `t${Date.now().toString(36)}`, name: 'Новый шаблон', text: '' });
      renderTemplates();
    } }, icon('plus', 14), 'Добавить шаблон'));
  }
  renderTemplates();

  const importInput = h('input', { type: 'file', accept: 'application/json', hidden: true });
  importInput.addEventListener('change', async () => {
    try {
      const imported = JSON.parse(await importInput.files[0].text());
      await bus.settings.save(imported);
      ctx.toast('Настройки импортированы', 'ok');
      await ctx.saveSettings({});
      close();
    } catch { ctx.toast('Не удалось импортировать файл настроек', 'error'); }
  });

  const body = h('div', { class: 'sheet-body' },
    h('div', { class: 'section-label' }, 'Внешний вид'), field('Тема', theme),
    h('div', { class: 'section-label' }, 'Manual / MNL'),
    field('Метки для автоклика (по одной в строке)', labels, 'Совпадение по части текста, без учёта регистра.'),
    h('button', { class: 'btn sm ghost', type: 'button', style: { justifySelf: 'start' }, onclick: () => { labels.value = DEFAULT_LABELS.join('\n'); } }, 'Метки по умолчанию'),
    field('Поля автоматизации для перехвата (по одному в строке)', fields, 'Значения 1/true у этих ключей заменяются на 0/false. Применяется при следующем включении MNL.'),
    h('button', { class: 'btn sm ghost', type: 'button', style: { justifySelf: 'start' }, onclick: () => { fields.value = DEFAULT_AUTOMATION_FIELDS.join('\n'); } }, 'Поля по умолчанию'),
    h('div', { class: 'section-label' }, 'Апелляции'),
    h('div', { class: 'grid2' }, field('Параллельных запросов', concurrency, '1–6'), field('Причина по умолчанию', reason)),
    h('div', { class: 'section-label' }, 'Шаблоны текста'), templatesBox,
    h('div', { class: 'section-label' }, 'Данные'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => download('ttads-hub-settings.json', JSON.stringify(ctx.settings, null, 2), 'application/json') }, icon('download', 13), 'Экспорт'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => importInput.click() }, icon('plus', 13), 'Импорт'), importInput),
    h('div', { class: 'section-label' }, 'О расширении'),
    h('div', { class: 'card', style: { fontSize: '12px' } },
      h('p', null, h('b', null, `TTAds Hub ${VERSION}`), ' — Manual-кампании, массовые апелляции, S2S и пиксели в одном расширении.'),
      h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Основано на Plusone 3.0.10, MNL Campaign Control, Appeal Desk 0.29 и S2S_TTAds. Расширение работает только на ads.tiktok.com и business-api.tiktok.com, ничего не отправляет третьим лицам, данные хранит локально.'),
      h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Используйте на свой риск: TikTok может менять внутренние запросы и ограничивать автоматизацию.')));

  const save = h('button', { class: 'btn primary', type: 'button' }, 'Сохранить');
  save.addEventListener('click', async () => {
    const payload = {
      ...draft,
      manual: { ...draft.manual, labels: labels.value.split('\n'), fields: fields.value.split('\n') },
      appeals: { ...draft.appeals, concurrency: Number(concurrency.value), reason: Number(reason.value) }
    };
    try {
      const saved = await bus.settings.save(payload);
      await ctx.saveSettings({ ui: saved.ui });
      ctx.toast('Настройки сохранены', 'ok');
      close();
    } catch (e) { ctx.toast(e.message, 'error'); }
  });

  host.append(h('div', null,
    h('div', { class: 'backdrop', onclick: close }),
    h('section', { class: 'sheet', role: 'dialog', 'aria-label': 'Настройки' },
      h('div', { class: 'sheet-head' }, h('h2', null, 'Настройки'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onclick: close }, icon('x', 17))),
      body, h('div', { class: 'sheet-foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Отмена'), save))));
}
