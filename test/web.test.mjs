import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCoach } from '../src/coach.mjs';
import { routeKey } from '../src/channels.mjs';
import { hermesReply } from '../src/hermes.mjs';
import { createScheduler } from '../src/reminders.mjs';
import { openStore } from '../src/store.mjs';
import { createWebApp } from '../src/web.mjs';

const timezone = 'Asia/Shanghai';
const password = 'test-only-different-installation-key';
const rider = routeKey('demo-bot', 'demo-peer');
const now = () => new Date('2026-11-17T00:00:00Z');
const id = '70234ef9-b29d-4c61-8a40-4ff88573497b';

test('private website serves data and mirrors coach turns in both directions, sharing rider state', async (t) => {
  const store = openStore();
  const server = createWebApp({ store, rider, timezone, password, now, mirrorToWeixin:true,
    intervalsKey:'test-only-intervals-key', fetcher: async (url) => {
      assert.equal(url.origin, 'https://intervals.icu');
      assert.equal(url.searchParams.get('oldest'), '2026-11-11');
      return Response.json([{ id:'i-web-demo', type:'Ride', start_date:'2026-11-17T02:00:00Z', moving_time:1200 }]);
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const auth = { authorization:'Basic ' + Buffer.from('coach:' + password).toString('base64') };
  const get = (path) => fetch(base + path, {headers:auth});
  const post = (path, body, headers = {}) => fetch(base + path, {
    method:'POST', headers:{...auth, 'X-Coach-Request':'1', ...headers}, body,
  });

  assert.equal((await fetch(base + '/api/dashboard')).status, 401);
  assert.equal((await fetch(base + '/api/chat', { headers:{ authorization:'Basic ' + Buffer.from('coach:someone-else').toString('base64') } })).status, 401);
  assert.equal((await post('/api/chat', '{}', {'Sec-Fetch-Site':'cross-site'})).status, 403);
  assert.equal((await fetch(base + '/api/chat', {method:'POST',headers:auth,body:'{}'})).status, 403);
  assert.equal((await get('/.env')).status, 404);
  assert.match(await (await get('/')).text(), /训练总览/);

  const receive = createCoach({ store, timezone, now });
  await receive({ rider:routeKey('separate-coach','demo-peer'), text:'另一个会话的私有文字', origin:'weixin' });
  const onWeixin = hermesReply({ receive, rider, peer:'demo-peer', archiveChat:true });
  await onWeixin({ peer:'demo-peer', id:'wx-test', text:'周二、周四、周六可骑，想提高爬坡能力' });
  let history = await (await get('/api/chat')).json();
  assert.equal(history.turns.length, 1);
  assert.equal(history.turns[0].origin, 'weixin');
  assert.match(history.turns[0].reply, /已保存/);
  const web = JSON.stringify({ id, text:'睡眠 5 小时，腿部疲劳 6' });
  assert.equal((await post('/api/chat', web)).status, 200);
  assert.equal((await post('/api/chat', web)).status, 200);
  const outgoing = [];
  const scheduler = createScheduler({store,rider,timezone,now,mirrorWeb:true,channel:{send: async ({text}) => outgoing.push(text)}});
  assert.equal((await scheduler.tick()).status,'channel_ok');
  assert.equal(await scheduler.tick(), null);
  assert.equal(outgoing.length, 1);
  assert.match(outgoing[0], /网页对话\n你：睡眠 5 小时/);
  assert.match(outgoing[0], /教练：今天骑/);
  history = await (await get('/api/chat')).json();
  assert.equal(history.turns.length, 2);
  assert.equal(history.turns[1].status, 'channel_ok');
  const board = await (await get('/api/dashboard')).json();
  assert.equal(board.readiness[0].fatigue, 6);
  assert.equal(board.readiness[0].sleep, 5);
  assert.equal(board.training.length, 14);
  assert.equal(board.profile.goal, '提高爬坡能力');
  assert.equal(JSON.stringify(board).includes('test-only-intervals-key'), false);

  const fit = readFileSync(new URL('../examples/demo-ride.fit', import.meta.url));
  assert.deepEqual(await (await post('/api/import/fit', fit)).json(), {added:1,duplicates:0});
  assert.deepEqual(await (await post('/api/import/fit', fit)).json(), {added:0,duplicates:1});
  const csv = 'duration_seconds,power_watts\n5,670\n1200,231';
  assert.equal((await (await post('/api/import/power?date=2026-11-17', csv)).json()).added, 1);
  assert.equal((await (await get('/api/dashboard')).json()).powerCurves[0].readings[5], 670);
  assert.deepEqual(await (await post('/api/import/intervals?days=7', '{}')).json(), {added:1,duplicates:0});
  assert.equal((await (await get('/api/dashboard')).json()).activities.some((row) => row.source === 'Intervals.icu'), true);
  const exported = '\uFEFFid,type,start_date_local,name,moving_time,distance,icu_average_watts\r\n' +
    '123456,Ride,2026-11-16T10:00:00,"虚构骑行, 含""引号""\n和换行",3600,23000,165\r\n' +
    '789,Run,2026-11-16T10:00:00,虚构跑步,1300,,\r\n';
  assert.deepEqual(await (await post('/api/import/activities', exported)).json(), {added:1,duplicates:0});
  assert.deepEqual(await (await post('/api/import/activities', exported)).json(), {added:0,duplicates:1});
  const fileRide = (await (await get('/api/dashboard')).json()).activities.find((row) => row.id === 'intervals:123456');
  assert.equal(fileRide.source, 'Intervals.icu 自有导出 CSV');
  assert.equal(fileRide.day, '2026-11-16');
  assert.equal(fileRide.averageWatts, 165);
  assert.equal(Object.hasOwn(fileRide, 'name'), false);
  const localized = '"id","种类","日期","距离","移动时间","名称","平均心率","标准化功率","负荷"\r\n' +
    '"abc-localized","Ride","2026-11-15T12:00:00",35000,4200,"虚构骑行",142,181,45\r\n';
  assert.deepEqual(await (await post('/api/import/activities', localized)).json(), {added:1,duplicates:0});
  const localizedRide = (await (await get('/api/dashboard')).json()).activities.find((row) => row.id === 'intervals:abc-localized');
  assert.equal(localizedRide.durationSeconds, 4200);
  assert.equal(localizedRide.distanceMeters, 35000);
  assert.equal(localizedRide.averageWatts, null);
  assert.equal(localizedRide.normalizedWatts, 181);
  assert.equal(localizedRide.trainingLoad, 45);
  await onWeixin({ peer:'demo-peer', id:'wx-reminder', text:'测试提醒 1 分钟' });
  const later = createScheduler({store,rider,timezone,mirrorWeb:true,now:() => new Date(+now()+60_000),
    channel:{send: async ({text}) => outgoing.push(text)}});
  assert.equal((await later.tick()).status,'channel_ok');
  assert.equal((await (await get('/api/chat')).json()).reminders[0].text, outgoing.at(-1));
});

test('web chat does not reopen a blocked Weixin route', async () => {
  const store = openStore();
  try {
    const state = store.get(rider);
    state.contact = { blocked:true, firstSeen:0 };
    store.put(rider, state);
    const receive = createCoach({ store, timezone, now });
    await receive({ rider, text:'今天骑什么', origin:'web', mirrorToWeixin:true });
    assert.equal(store.get(rider).contact.blocked, true);
    const scheduler = createScheduler({store,rider,timezone,now,mirrorWeb:true,channel:{
      send: async () => assert.fail('blocked route must not send'),
    }});
    assert.equal(await scheduler.tick(), null);
    const unblocked = store.get(rider);
    unblocked.contact.blocked = false;
    store.put(rider, unblocked);
    const syncOff = createScheduler({store,rider,timezone,now,channel:{
      send: async () => assert.fail('disabled web sync must not send queued turns'),
    }});
    assert.equal((await syncOff.tick()).status, 'skipped');
  } finally {
    store.close();
  }
});
