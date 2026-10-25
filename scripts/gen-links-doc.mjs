// Генерирует extension/docs/quick-links.md из каталога ссылок — документ не расходится с кодом.
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, LINKS, DEFAULT_FAVORITES, APP_TABS } from '../extension/background/links/catalog.js';

const CONF = { verified: '✅ наблюдался в живом Ads Manager', official: '📘 адрес из официальных материалов TikTok', pattern: '≈ собран по структуре BC, не проверен' };

export function renderLinksDoc() {
  const lines = [
    '# Быстрые ссылки TTAds Hub', '',
    'Файл создаётся автоматически из `extension/background/links/catalog.js` (`npm run docs:links`) — не редактируйте вручную.', '',
    '**Подстановки:** `{aadvid}` — ID рекламного кабинета, `{bcid}` — ID Business Center. Если кабинет неизвестен, параметр убирается из адреса и TikTok открывает последний использованный кабинет; если неизвестен BC, ссылки на Business Center ведут на его главную страницу.', '',
    '**Уровни достоверности адреса:**', '', ...Object.values(CONF).map((c) => `- ${c}`), '',
    `**Избранное по умолчанию:** ${DEFAULT_FAVORITES.map((id) => `\`${id}\``).join(', ')}.`, ''
  ];
  for (const group of GROUPS.filter((g) => g.id !== 'custom')) {
    const items = LINKS.filter((l) => l.group === group.id);
    lines.push(`## ${group.title}`, '', '| Ссылка | Адрес | Достоверность | Подсказка |', '| --- | --- | --- | --- |');
    for (const l of items) lines.push(`| **${l.title}**<br>${l.desc} | \`${l.url}\`${l.fallback ? `<br>без BC: \`${l.fallback}\`` : ''} | ${CONF[l.conf]} | ${[l.app ? `открывает вкладку «${APP_TABS[l.app]}» расширения` : '', l.hint ?? ''].filter(Boolean).join('. ')} |`);
    lines.push('');
  }
  lines.push('## Omnibox и клавиши', '', '- В адресной строке введите `tt`, пробел и запрос: `tt биллинг`, `tt создать bc`, `tt пиксель`. Enter открывает лучший результат, стрелки выбирают другой.',
    '- Горячая клавиша открытия панели по умолчанию — `Alt+Shift+K` (меняется в `chrome://extensions/shortcuts`).',
    '- В панели: клик — открыть (по настройке «в новой / в текущей вкладке»), `Ctrl`/`Shift`/средняя кнопка — открыть наоборот, `Enter` в поиске — открыть первый результат.', '');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = resolve(dirname(fileURLToPath(import.meta.url)), '../extension/docs/quick-links.md');
  await writeFile(target, renderLinksDoc());
  console.log(`extension/docs/quick-links.md — ${LINKS.length} ссылок`);
}
