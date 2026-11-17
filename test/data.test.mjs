import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { openStore } from '../src/store.mjs';
import { createCoach } from '../src/coach.mjs';
import { addActivities } from '../src/activities.mjs';
import { fitCrc, readFit } from '../src/fit.mjs';
import { loadIntervals } from '../src/intervals.mjs';
import { ftpEstimate, powerReport, readPowerCsv } from '../src/power.mjs';

const rider = 'demo-rider';
const today = '2026-11-17';
const timezone = 'Asia/Shanghai';
const now = () => new Date('2026-11-17T09:00:00+08:00');
const fixture = readFileSync(new URL('../examples/demo-ride.fit', import.meta.url));

test('FIT metadata retains known and missing metrics and rejects corrupt CRC', async (t) => {
  assert.equal(fitCrc(Buffer.from('123456789')), 0xbb3d);
  const [activity] = readFit(fixture);
  assert.equal(activity.durationSeconds, 3000);
  assert.equal(activity.distanceMeters, 22300);
  assert.equal(activity.ascentMeters, 330);
  assert.equal(activity.averageWatts, 178);
  assert.equal(activity.maxWatts, null);
  assert.equal(activity.averageHeartRate, 129);
  assert.equal(activity.maxHeartRate, null);
  const bad = Buffer.from(fixture);
  bad[20] ^= 0x08;
  assert.throws(() => readFit(bad), /CRC/);
  assert.throws(() => readFit(fixture.subarray(0, -1)), /长度/);
  const store = openStore();
  t.after(store.close);
  assert.deepEqual(addActivities(store, rider, [activity], timezone), { added: 1, duplicates: 0 });
  assert.deepEqual(addActivities(store, rider, [activity], timezone), { added: 0, duplicates: 1 });
  const coach = createCoach({ store, timezone, now });
  assert.match((await coach({ rider, text: '导入活动' })).text, /FIT.*50 分钟.*22\.3 km.*爬升 330 m.*178 W.*129 bpm/);
  await coach({ rider, text: '周二和周四可骑' });
  assert.match((await coach({ rider, text: '今天骑什么' })).text, /最近记录（2026-11-16，FIT）未填 RPE/);
});

test('Intervals.icu HTTP contract filters out nonrides and Strava-derived records', async (t) => {
  const store = openStore();
  t.after(store.close);
  const [fit] = readFit(fixture);
  const fetched = await loadIntervals({
    key: 'fictional-key', days: 7, timezone, now: now(),
    fetcher: async (url, { headers, redirect }) => {
      assert.equal(url.origin, 'https://intervals.icu');
      assert.equal(url.pathname, '/api/v1/athlete/0/activities');
      assert.equal(url.search, '?oldest=2026-11-11&newest=2026-11-17');
      assert.equal(headers.authorization, 'Basic ' + Buffer.from('API_KEY:fictional-key').toString('base64'));
      assert.equal(redirect, 'error');
      return Response.json([
        { id: 'i-demo-1', type: 'Ride', source: 'UPLOAD', start_date: fit.startAt, moving_time: 3000 },
        { id: 'i-demo-2', type: 'VirtualRide', start_date: '2026-11-17T02:00:00Z', elapsed_time: 1200,
          icu_average_watts: 150, device_watts: false },
        { id: 'i-demo-3', type: 'Run', start_date: fit.startAt },
        { id: '1234', type: 'Ride', start_date: fit.startAt },
        { id: 'i-demo-4', type: 'Ride', source: 'STRAVA', start_date: fit.startAt },
      ]);
    },
  });
  assert.equal(fetched.length, 2);
  assert.equal(fetched[1].durationKind, '经过时间');
  assert.equal(fetched[1].distanceMeters, null);
  assert.equal(fetched[1].powerKind, '来源标记为非设备功率');
  addActivities(store, rider, [fit], timezone);
  assert.deepEqual(addActivities(store, rider, fetched, timezone), { added: 1, duplicates: 1 });
  assert.equal(store.get(rider).activities.find(({ id }) => id === fit.id).averageWatts, 178);
  await assert.rejects(loadIntervals({
    key: 'fictional-key', timezone, fetcher: async () => new Response(null, { status: 401 }),
  }), /HTTP 401/);
});

test('power curve exposes dated evidence separately from set FTP and requires repeated tests', () => {
  const csv = (power) => 'duration_seconds,power_watts\n5,750\n1200,' + power;
  const first = readPowerCsv(csv(240), { day: '2026-11-10', ftpTest: true, today });
  const second = readPowerCsv(csv(244), { day: '2026-11-16', ftpTest: true, today });
  assert.equal(ftpEstimate([first], today), null);
  assert.equal(ftpEstimate([first, { ...second, day: first.day }], today), null);
  assert.equal(ftpEstimate([first, second], today), 230);
  const profile = { ftp: 220, ftpSource: '手动测试' };
  const report = powerReport({ profile, powerCurves: [first, second] }, today);
  assert.match(report, /档案 FTP · 220 W/);
  assert.match(report, /CSV 最佳实测 · 5 秒 750 W.*20 分钟 244 W/);
  assert.match(report, /FTP 参考估算 · 230 W/);
  assert.equal(profile.ftp, 220);
  const sample = readPowerCsv('seconds,watts\n5,600\n5,610', { today });
  assert.equal(sample.readings[5], 610);
  assert.equal(ftpEstimate([sample], today), null);
  assert.throws(() => readPowerCsv('seconds,watts\n5,-3', { today }), /第 2 行/);
  assert.throws(() => readPowerCsv('seconds,watts\n5,600', { today, ftpTest: true }), /1200 秒/);
});

test('only known device power and confirmed FTP can adjust an upcoming quality session', async (t) => {
  const store = openStore();
  t.after(store.close);
  const coach = createCoach({ store, timezone, now });
  const say = async (text) => (await coach({ rider, text })).text;
  await say('周二、周六可骑，想提高爬坡能力');
  const [fit] = readFit(fixture);
  addActivities(store, rider, [fit], timezone);
  assert.match(await say('今天骑什么'), /甜区/);
  await say('FTP 200 功率计测试');
  await say('确认');
  assert.match(await say('今天骑什么'), /有氧耐力[\s\S]*达到档案 FTP 的 85%/);
});

test('partial completion informs the next course and rest applies only to the specified day', async (t) => {
  const store = openStore();
  t.after(store.close);
  let current = now();
  const coach = createCoach({ store, timezone, now: () => current });
  const say = async (text) => (await coach({ rider, text })).text;
  await say('周三、周四、周六可骑，想提高爬坡能力');
  current = new Date('2026-11-18T18:00:00+08:00');
  assert.match(await say('最后一组没完成，RPE 6'), /部分完成/);
  current = new Date('2026-11-19T08:00:00+08:00');
  assert.match(await say('今天骑什么'), /有氧耐力[\s\S]*昨天有未完成的间歇/);
  assert.match(await say('今天改休息'), /今天休息/);
  assert.match(await say('今天骑什么'), /按你今天的安排/);
  assert.equal(store.get(rider).courses['2026-11-19'].type, 'rest');
  current = new Date('2026-11-21T08:00:00+08:00');
  assert.match(await say('今天骑什么'), /有氧耐力/);
});
