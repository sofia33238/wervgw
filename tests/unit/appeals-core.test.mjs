import test from 'node:test';
import assert from 'node:assert/strict';
import {
  key, normalize, blocked, canRetry, latestJob, syncAppeals, verifySubmission,
  applyCurrentAppeal, expireStale, pruneJobs, summarize, runPool
} from '../../extension/background/appeals/core.js';

const row = { id: '1234567890123456789', level: 'ad', status: 'rejected' };
const account = '654321';
const rejectedRow = { id: '123456', level: 'ad', reason: 'Not deliveredAppeal rejected' };

test('normalize keeps IDs as strings and validates rows', () => {
  assert.equal(normalize([row])[0].id, row.id);
  assert.throws(() => normalize([{ ...row, id: 12345 }]));
  assert.throws(() => normalize([{ ...row, status: 'active' }]));
  assert.throws(() => normalize('nope'));
  assert.equal(normalize([{ ...row, thumbnail: 'https://p16.tiktokcdn.com/a.jpg' }])[0].thumbnail, 'https://p16.tiktokcdn.com/a.jpg');
  assert.equal(normalize([{ ...row, thumbnail: 'https://evil.example/a.jpg' }])[0].thumbnail, '');
});

test('blocked: in-flight / unknown / limited block; failed, cancelled, retry_allowed do not', () => {
  const state = (status) => ({ jobs: [{ key: key(account, row), status }] });
  for (const s of ['sending', 'unknown', 'limited', 'submitted', 'accepted']) assert.equal(blocked(state(s), account, row), true, s);
  for (const s of ['failed', 'cancelled', 'retry_allowed']) assert.equal(blocked(state(s), account, row), false, s);
  assert.equal(blocked({ jobs: [] }, account, row), false);
  assert.equal(blocked(state('sending'), '999', row), false, 'другой кабинет');
});

test('canRetry / syncAppeals: explicit appeal rejection unlocks, stale rejection does not', () => {
  const state = { jobs: [{ key: key(account, rejectedRow), status: 'submitted' }] };
  assert.equal(canRetry(state, account, rejectedRow), true);
  syncAppeals(state, account, [rejectedRow]);
  assert.equal(latestJob(state, account, rejectedRow).status, 'retry_allowed');
  assert.equal(canRetry({ jobs: [{ key: key(account, rejectedRow), status: 'unknown' }] }, account, rejectedRow), false);
  assert.equal(canRetry({ jobs: [{ key: key(account, rejectedRow), status: 'submitted' }] }, account, { ...rejectedRow, reason: 'Review issue' }), false);
  const fromRejected = { jobs: [{ key: key(account, rejectedRow), status: 'submitted', sentFromRejected: true }] };
  assert.equal(canRetry(fromRejected, account, rejectedRow), false);
  syncAppeals(fromRejected, account, [], [{ id: rejectedRow.id, status: 'Appeal in review' }]);
  assert.equal(canRetry(fromRejected, account, rejectedRow), true, 'после увиденного статуса «на рассмотрении» новый отказ разрешает повтор');
});

test('verification: code=0 needs a changed server record', () => {
  const job = { appealVersion: 100 };
  assert.equal(verifySubmission(job, { appealStatus: 4, appealVersion: 100 }).status, 'unknown');
  assert.equal(verifySubmission(job, { appealStatus: 4, appealVersion: 101 }).status, 'retry_allowed');
  assert.equal(verifySubmission(job, { appealStatus: 2, appealVersion: 101 }).status, 'submitted');
  assert.equal(verifySubmission(job, undefined).status, 'unknown');
});

test('applyCurrentAppeal: fresh rejection unlocks, but never in-flight or limited jobs', () => {
  for (const status of ['submitted', 'accepted', 'unknown']) {
    const job = { status, appealVersion: 100 };
    applyCurrentAppeal(job, { appealStatus: 4, appealVersion: 100 });
    assert.equal(job.status, 'retry_allowed');
  }
  for (const status of ['sending', 'limited']) {
    const job = { status };
    applyCurrentAppeal(job, { appealStatus: 4 });
    assert.equal(job.status, status);
  }
});

test('expireStale turns abandoned sends into unknown (still blocking); pruneJobs keeps the newest', () => {
  const now = Date.now();
  const state = { jobs: [{ key: 'a', status: 'sending', created: new Date(now - 11 * 60000).toISOString() }, { key: 'b', status: 'sending', created: new Date(now - 60000).toISOString() }] };
  assert.equal(expireStale(state, now), 1);
  assert.deepEqual(state.jobs.map((j) => j.status), ['unknown', 'sending']);
  const many = { jobs: Array.from({ length: 10 }, (_, i) => ({ key: String(i) })) };
  assert.deepEqual(pruneJobs(many, 3).jobs.map((j) => j.key), ['7', '8', '9']);
});

test('summarize groups problems by message and counts statuses', () => {
  const { counts, problems } = summarize([
    { id: '1', status: 'submitted', message: 'ok' }, { id: '2', status: 'limited', message: 'limit' }, { id: '3', status: 'limited', message: 'limit' },
    { id: '4', status: 'failed', message: 'boom' }, { id: '5', status: 'skipped', message: 'dup' }
  ]);
  assert.equal(counts.submitted, 1); assert.equal(counts.limited, 2); assert.equal(counts.failed, 1); assert.equal(counts.skipped, 1);
  assert.deepEqual(problems.map((p) => [p.message, p.ids.join(',')]), [['limit', '2,3'], ['boom', '4']]);
});

test('runPool: respects the concurrency limit, isolates failures and honours stop()', async () => {
  let active = 0, peak = 0;
  const worker = async (n) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; if (n === 3) throw new Error('offline'); return { status: 'submitted', n }; };
  const results = await runPool([1, 2, 3, 4, 5, 6, 7], 3, worker);
  assert.equal(peak, 3);
  assert.equal(results[2].status, 'unknown');
  assert.equal(results.filter((r) => r.status === 'submitted').length, 6);

  let started = 0;
  const stopped = await runPool([1, 2, 3, 4, 5, 6], 2, async () => { started++; await new Promise((r) => setTimeout(r, 5)); return { status: 'submitted' }; }, () => started >= 3);
  assert.equal(started, 3);
  assert.equal(stopped.filter(Boolean).length, 3);
  assert.equal(stopped.length, 6, 'длина массива равна числу элементов');
  assert.equal(Object.keys(stopped).length, 6, 'нестартовавшие — настоящие undefined, а не «дыры»');
  assert.equal(stopped.map((r) => (r ? 1 : 0)).join(''), '111000', 'map обходит все элементы');
  assert.deepEqual(await runPool([], 3, () => { throw new Error('unexpected'); }), []);
});
