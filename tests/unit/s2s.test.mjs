import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanDomain, cleanPath, buildPostbackUrl, buildLegacyPayload, buildEventsV2Payload, sendTestEvent, validateTestInput } from '../../extension/background/s2s/events.js';
import { buildZip, crc32 } from '../../extension/background/s2s/zip.js';

test('cleanDomain / cleanPath normalise user input', () => {
  assert.equal(cleanDomain('  HTTPS://Track.Example.com/some/path?x=1 '), 'track.example.com');
  assert.equal(cleanDomain('track.example.com:8080'), 'track.example.com');
  assert.equal(cleanDomain('not a domain'), '');
  assert.equal(cleanDomain('localhost'), '');
  assert.equal(cleanPath('lander/tts2s/'), '/lander/tts2s');
  assert.equal(cleanPath('/lander/../etc//tts 2s'), '/lander/etc');
  assert.equal(cleanPath(''), '/lander/tts2s');
});

test('buildPostbackUrl keeps Keitaro macros literal and matches the documented format', () => {
  const url = buildPostbackUrl({ domain: 'track.example.com', path: '/lander/tts2s', event: 'Purchase' });
  assert.equal(url, 'https://track.example.com/lander/tts2s/indexpix1.php?pix={px}&at={tk}&ttclid={ttclid}&event=Purchase&user_agent={useragent}&ip={ip}');
  assert.match(buildPostbackUrl({ domain: 'a.io', path: '/x', event: 'Lead', api: '2', value: '{payout}', currency: 'eur', test: 'TEST1' }), /&value=\{payout\}&currency=EUR&api=2&test=TEST1$/);
  assert.throws(() => buildPostbackUrl({ domain: '', path: '/x', event: 'Lead' }), /домен/);
  assert.throws(() => buildPostbackUrl({ domain: 'a.io', path: '/x', event: 'bad event!' }), /событие/);
  assert.throws(() => buildPostbackUrl({ domain: 'a.io', path: '/x', event: 'Lead', value: 'abc' }), /Value/);
});

test('payload builders: Events API 1.0 and 2.0', () => {
  const now = new Date('2026-10-24T12:00:00.123Z');
  const legacy = buildLegacyPayload({ pixel: 'PIXEL123456', event: 'Purchase', ttclid: 'abc', ip: '1.2.3.4', userAgent: 'UA', value: '12.5', now });
  assert.deepEqual(legacy, { pixel_code: 'PIXEL123456', event: 'Purchase', timestamp: '2026-10-24T12:00:00Z', context: { ip: '1.2.3.4', user_agent: 'UA', ad: { callback: 'abc' } }, properties: { currency: 'USD', value: 12.5 } });
  const v2 = buildEventsV2Payload({ pixel: 'PIXEL123456', event: 'Purchase', ttclid: 'abc', ip: '1.2.3.4', userAgent: 'UA', testCode: 'T1', now: now.getTime() });
  assert.deepEqual(v2, { event_source: 'web', event_source_id: 'PIXEL123456', test_event_code: 'T1', data: [{ event: 'Purchase', event_time: 1792843200, user: { ttclid: 'abc', ip: '1.2.3.4', user_agent: 'UA' } }] });
  assert.equal('properties' in buildLegacyPayload({ pixel: 'PIXEL123456', event: 'Lead' }), false);
});

test('sendTestEvent: endpoint per API version, Access-Token header, response mapping, validation', async () => {
  const calls = [];
  const fake = (body, status = 200) => async (url, init) => { calls.push({ url, init }); return { status, ok: status < 400, text: async () => JSON.stringify(body) }; };
  const input = { pixel: 'PIXEL123456', token: 'x'.repeat(40), event: 'Purchase', api: '1' };
  const ok = await sendTestEvent(input, fake({ code: 0, message: 'OK', request_id: 'r1' }));
  assert.equal(ok.ok, true);
  assert.equal(calls[0].url, 'https://business-api.tiktok.com/open_api/v1.3/pixel/track/');
  assert.equal(calls[0].init.headers['Access-Token'], 'x'.repeat(40));
  assert.equal(JSON.parse(calls[0].init.body).pixel_code, 'PIXEL123456');
  const v2 = await sendTestEvent({ ...input, api: '2', testCode: 'TEST9' }, fake({ code: 40002, message: 'bad token' }));
  assert.equal(v2.ok, false);
  assert.equal(v2.code, 40002);
  assert.equal(calls[1].url, 'https://business-api.tiktok.com/open_api/v1.3/event/track/');
  assert.equal(JSON.parse(calls[1].init.body).test_event_code, 'TEST9');
  assert.equal('token' in v2.sent, false, 'токен не попадает в отображаемый запрос');
  assert.throws(() => validateTestInput({ pixel: '!', token: 'x'.repeat(30), event: 'Lead' }), /Pixel/);
  assert.throws(() => validateTestInput({ pixel: 'PIXEL123456', token: 'short', event: 'Lead' }), /Token/);
  await assert.rejects(() => sendTestEvent(input, async () => { throw new Error('net down'); }), /Не удалось связаться/);
});

test('zip: CRC-32 reference value and archive passes `unzip -t`', (t) => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = buildZip([{ name: 'index.php', data: '<?php\n' }, { name: 'indexpix1.php', data: '<?php echo "привет";\n' }], new Date(2026, 9, 24, 12, 30, 10));
  const dir = mkdtempSync(join(tmpdir(), 'tth-zip-'));
  const file = join(dir, 'a.zip');
  writeFileSync(file, zip);
  const probe = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (probe.error) return t.skip('unzip не установлен');
  const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
  assert.match(out, /No errors detected/);
  assert.equal(execFileSync('unzip', ['-p', file, 'indexpix1.php'], { encoding: 'utf8' }), '<?php echo "привет";\n');
});

test('bundled PHP relay passes `php -l` when PHP is installed', (t) => {
  const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
  if (probe.error) return t.skip('php не установлен');
  for (const f of ['indexpix1.php', 'index.php']) {
    const out = spawnSync('php', ['-l', new URL(`../../extension/s2s/${f}`, import.meta.url).pathname], { encoding: 'utf8' });
    assert.match(out.stdout, /No syntax errors/, out.stdout + out.stderr);
  }
  assert.ok(readFileSync(new URL('../../extension/s2s/indexpix1.php', import.meta.url), 'utf8').includes('Access-Token'));
});

// Запускает PHP-скрипт в CLI с заданным $_GET; режим dry=1 исключает любые сетевые запросы.
function runRelay(query) {
  const script = new URL('../../extension/s2s/indexpix1.php', import.meta.url).pathname;
  const out = spawnSync('php', ['-d', 'display_errors=0', '-r', '$_GET = json_decode(getenv("TTH_Q"), true); if (isset($_GET["__bad_ua"])) { $_GET["user_agent"] = "bad" . chr(255); unset($_GET["__bad_ua"]); } require getenv("TTH_SCRIPT");'], {
    encoding: 'utf8', env: { ...process.env, TTH_Q: JSON.stringify(query), TTH_SCRIPT: script }
  });
  return JSON.parse(out.stdout);
}
const base = { pix: 'PIXEL123456', at: 'T'.repeat(32), event: 'Purchase' };

test('PHP relay: validation errors', (t) => {
  if (spawnSync('php', ['-v']).error) return t.skip('php не установлен');
  assert.match(runRelay({ pix: 'PIXEL123456' }).error, /Missing required/);
  assert.match(runRelay({ ...base, pix: 'bad pix!' }).error, /Invalid pix/);
  assert.match(runRelay({ ...base, at: 'short' }).error, /Invalid at/);
  assert.match(runRelay({ ...base, event: 'Purchase now' }).error, /Invalid event/);
});

test('PHP relay (dry run): API 1.0/2.0 payloads, Keitaro macros, bad values never break JSON', (t) => {
  if (spawnSync('php', ['-v']).error) return t.skip('php не установлен');
  const v1 = runRelay({ ...base, dry: '1', ttclid: 'abc', ip: '1.2.3.4', user_agent: 'UA', value: '12.5' });
  assert.equal(v1.dry_run, true);
  assert.equal(v1.endpoint, 'https://business-api.tiktok.com/open_api/v1.3/pixel/track/');
  assert.deepEqual(v1.sent_payload.context, { ip: '1.2.3.4', user_agent: 'UA', ad: { callback: 'abc' } });
  assert.deepEqual(v1.sent_payload.properties, { currency: 'USD', value: 12.5 });
  const v2 = runRelay({ ...base, dry: '1', api: '2', test: 'TEST1', ttclid: 'abc', currency: 'eur', value: '3' });
  assert.equal(v2.endpoint, 'https://business-api.tiktok.com/open_api/v1.3/event/track/');
  assert.equal(v2.sent_payload.test_event_code, 'TEST1');
  assert.deepEqual(v2.sent_payload.data[0].properties, { currency: 'EUR', value: 3 });
  assert.deepEqual(v2.sent_payload.data[0].user, { ttclid: 'abc' });
  const macros = runRelay({ ...base, dry: '1', ttclid: '{ttclid}', ip: '{ip}', user_agent: '{useragent}', value: '{payout}' });
  assert.deepEqual(macros.sent_payload.context, {});
  assert.equal('properties' in macros.sent_payload, false);
  const huge = runRelay({ ...base, dry: '1', value: '1e999', __bad_ua: '1' });
  assert.equal(huge.dry_run, true, 'INF и невалидный UTF-8 не ломают JSON');
  assert.equal('properties' in huge.sent_payload, false);
});
