import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCoach, courseFor } from '../src/coach.mjs';
import { DeliveryError, createScheduler, jobList } from '../src/reminders.mjs';
import { MOCK_RIDER, weixinChannel } from '../src/channels.mjs';
import { openStore } from '../src/store.mjs';
import { TYPES, workout } from '../src/training.mjs';
import { clock } from '../src/time.mjs';
import { exportZwo } from '../src/zwo.mjs';

const rider = MOCK_RIDER;
const timezone = 'Asia/Shanghai';

function harness(t, path = ':memory:') {
  const store = openStore(path);
  let time = new Date('2026-11-17T09:00:00+08:00');
  const now = () => time;
  const makeCoach = (model) => createCoach({ store, timezone, now, model });
  const receive = makeCoach();
  t.after(store.close);
  return {
    store, makeCoach, now,
    say: async (text, id) => (await receive({ rider, id, text })).text,
    go: (at) => { time = new Date(at); },
    scheduler: (send) => createScheduler({ store, rider, timezone, now, channel: { send } }),
    jobs: () => jobList(store, rider),
  };
}

test('all workout durations and six types are bounded with and without FTP', () => {
  for (const type of Object.keys(TYPES)) {
    for (const ftp of [null, 50, 240, 600]) {
      for (let limit = 0; limit <= 360; limit++) {
        const result = workout(type, limit, ftp);
        assert.equal(result.steps.reduce((sum, step) => sum + step.minutes, 0), result.minutes);
        assert.ok(result.minutes <= limit);
        for (const step of result.steps) {
          assert.ok(step.minutes > 0);
          if (ftp === null) assert.equal(step.watts, null);
          else assert.ok(step.watts[0] > 0 && step.watts[0] <= step.watts[1]);
        }
      }
    }
  }
  assert.deepEqual(workout('vo2', 45, 240).steps.find((s) => s.label === '组间恢复')?.minutes, 3);
});

test('full Thursday scenario with scheduled messages, no input at trigger time, and feedback for Saturday', async (t) => {
  const h = harness(t);
  const sent = [];
  const scheduler = h.scheduler(async ({ text }) => sent.push(text));
  assert.match(await h.say('周二、周四、周六可骑，目标是提高爬坡能力'), /已保存/);
  assert.match(await h.say('这周怎么练'), /周四 甜区/);
  await h.say('开启课前提醒 07:30');
  await h.say('开启课后提醒 20:30');
  h.go('2026-11-19T07:23:00+08:00');
  const reply = await h.say('昨晚没睡好，今天只有 45 分钟');
  assert.match(reply, /45 分钟有氧耐力/);
  assert.match(reply, /课型 甜区 → 有氧耐力/);
  assert.match(reply, /时长 60 → 45/);
  assert.match(reply, /睡眠/);
  assert.match(reply, /近七天未记录骑行/);
  assert.doesNotMatch(reply, / W/);
  h.go('2026-11-19T07:30:00+08:00');
  const { id } = await scheduler.tick();
  assert.equal(h.jobs()[0].status, 'channel_ok');
  assert.ok(h.jobs()[0].attempted);
  assert.equal(h.jobs()[0].confirmed, null);
  assert.match(sent[0], /45 分钟有氧耐力/);
  await scheduler.tick();
  assert.equal(sent.length, 1);
  assert.match(await h.say(`确认收到 ${id}`), /已登记/);
  assert.match(await h.say(`「确认收到提醒 #${id}。」`), /已登记/);
  assert.ok(h.jobs()[0].confirmed);
  h.go('2026-11-19T20:30:00+08:00');
  await scheduler.tick();
  assert.match(sent[1], /如果骑完了/);
  await h.say('骑完了，RPE 4', 'finish');
  assert.equal(await h.say('骑完了，RPE 4', 'finish'), '');
  assert.equal(h.store.get(rider).rides.length, 1);
  assert.equal(h.store.get(rider).rides[0].minutes, null);
  h.go('2026-11-21T07:00:00+08:00');
  assert.match(await h.say('今天骑什么'), /最近记录（2026-11-19，手动录入）RPE 4/);
});

test('week edits and FTP require confirmation, and day preferences are persisted', async (t) => {
  const h = harness(t);
  await h.say('周二、周四、周六可骑');
  assert.match(await h.say('周六没空'), /拟调整为[\s\S]*周六 休息/);
  assert.match(await h.say('这周怎么练'), /周六 有氧耐力/);
  await h.say('确认');
  assert.match(await h.say('这周怎么练'), /周六 休息/);
  assert.equal(h.store.get(rider).profile.days[5], 60);
  await h.say('周四 45 分钟 室内');
  await h.say('确认');
  assert.match(await h.say('档案'), /周四 45 分钟 室内/);
  assert.match(await h.say('FTP 240 功率计测试'), /按 RPE → 240 W（功率计测试）/);
  assert.equal(h.store.get(rider).profile.ftp, null);
  await h.say('取消');
  assert.match(await h.say('确认'), /没有有效/);
  await h.say('FTP 240W 功率计测试');
  await h.say('确认');
  assert.equal(h.store.get(rider).profile.ftp, 240);
  assert.equal(h.store.get(rider).profile.ftpSource, '功率计测试');
  assert.match(await h.say('今天骑什么'), / W \/ RPE/);
});

test('hard ride, manual log validation, short availability and sleep/leg signals', async (t) => {
  const h = harness(t);
  await h.say('周二、周四、周六可骑');
  h.go('2026-11-19T06:50:00+08:00');
  assert.match(await h.say('记录骑行 2026-02-30 45 分钟 RPE 2'), /检查日期/);
  assert.match(await h.say('骑完了，RPE 12'), /检查日期/);
  await h.say('记录骑行 昨天 60 分钟 RPE 8');
  assert.match(await h.say('今天骑什么'), /恢复骑/);
  assert.match(await h.say('腿部疲劳 7'), /恢复骑/);
  assert.match(await h.say('今天只能骑 0 分钟'), /今天休息/);
  assert.equal(courseFor(h.store.get(rider), '2026-11-19').minutes, 0);
  assert.deepEqual(clock(timezone)(new Date('2026-11-18T16:00Z')), { day: '2026-11-19', minute: 0 });
});

test('model intent is validated and failures fall back to rules', async (t) => {
  const h = harness(t);
  await h.say('周二、周四、周六可骑');
  const receive = h.makeCoach({
    intent: async () => ({ kind: 'adjust', minutes: 35 }),
    explain: async () => '缩短时间可以配合今天的安排。',
  });
  assert.match((await receive({ rider, text: '帮我压缩一下' })).text, /35 分钟[\s\S]*教练补充/);
  const invalid = h.makeCoach({ intent: async () => ({ kind: 'adjust', minutes: 361 }) });
  assert.match((await invalid({ rider, text: '帮我压缩一下' })).text, /检查日期/);
  const down = h.makeCoach({ intent: async () => { throw Error('offline'); } });
  assert.match((await down({ rider, text: '这周怎么练' })).text, /本周计划/);
  assert.match((await down({ rider, text: '说说看' })).text, /档案/);
});

test('completed sessions skip pre reminders and post reminds only if feedback is missing', async (t) => {
  const h = harness(t);
  let count = 0;
  const scheduler = h.scheduler(async () => { count++; });
  await h.say('周二可骑');
  await h.say('开启课前提醒 09:30');
  await h.say('开启课后提醒 20:30');
  await h.say('骑完了');
  h.go('2026-11-17T09:30:00+08:00');
  assert.equal((await scheduler.tick()).status, 'skipped');
  h.go('2026-11-17T20:30:00+08:00');
  assert.equal((await scheduler.tick()).status, 'channel_ok');
  assert.equal(count, 1);
});

test('timeout is uncertain and never retried', async (t) => {
  const h = harness(t);
  await h.say('测试提醒 1 分钟');
  h.go('2026-11-17T09:01:00+08:00');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let delivered = 0;
  const first = h.scheduler(({ signal }) => {
    delivered++;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  }).tick();
  const retry = h.scheduler(async () => { delivered++; });
  assert.equal(await retry.tick(), null);
  t.mock.timers.tick(12_000);
  assert.equal((await first).status, 'uncertain');
  assert.equal(await retry.tick(), null);
  assert.equal(delivered, 1);
});

test('a failed session drops old slots and pending probes; fresh inbound enables future schedules', async (t) => {
  const h = harness(t);
  await h.say('周二可骑');
  await h.say('开启课前提醒 09:05');
  await h.say('开启课后提醒 20:30');
  await h.say('测试提醒 1 分钟');
  await h.say('测试提醒 8 分钟');
  h.go('2026-11-17T09:01:00+08:00');
  const failed = h.scheduler(async () => { throw new DeliveryError('session_invalid'); });
  assert.equal((await failed.tick()).status, 'session_invalid');
  h.go('2026-11-17T09:06:00+08:00');
  const restored = h.scheduler(async () => {});
  assert.equal(await restored.tick(), null);
  await h.say('你好', 'fresh');
  assert.equal(await restored.tick(), null);
  assert.ok(h.jobs().some(({ status, detail }) => status === 'expired' && detail === 'invalid_session'));
  h.go('2026-11-17T20:30:00+08:00');
  assert.equal((await restored.tick()).status, 'channel_ok');
});

test('reopened database resumes pending probes and does not replay interrupted or expired sends', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cycling-coach-'));
  try {
    const file = join(dir, 'coach.sqlite');
    const first = openStore(file);
    let now = new Date('2026-11-17T09:00:00+08:00');
    const receive = createCoach({ store: first, timezone, now: () => now });
    await receive({ rider, id: 'one', text: '测试提醒 1 分钟' });
    await receive({ rider, id: 'two', text: '测试提醒 15 分钟' });
    await receive({ rider, id: 'three', text: '测试提醒 16 分钟' });
    first.db.prepare("UPDATE jobs SET status='running', attempted=? WHERE id=2").run(+now);
    first.close();
    const reopened = openStore(file);
    try {
      now = new Date('2026-11-17T09:16:00+08:00');
      let sent = 0;
      const scheduler = createScheduler({
        store: reopened, rider, timezone, now: () => now, channel: { send: async () => { sent++; } },
      });
      await scheduler.tick();
      await scheduler.tick();
      assert.deepEqual(jobList(reopened, rider).map(({ status }) => status), ['channel_ok', 'uncertain', 'expired']);
      assert.equal(sent, 1);
    } finally { reopened.close(); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two hard days adjust an upcoming priority session and week lists actual feedback', async (t) => {
  const h = harness(t);
  await h.say('周二、周四、周六可骑，目标是提高爬坡能力');
  await h.say('骑完了，50 分钟，RPE 7');
  h.go('2026-11-19T07:30:00+08:00');
  await h.say('记录骑行 昨天 40 分钟 RPE 7');
  assert.match(await h.say('今天骑什么'), /有氧耐力[\s\S]*近三天有两次/);
  assert.match(await h.say('这周怎么练'), /周二[^\n]*已完成，实际 50 分钟，RPE 7/);
  assert.match(await h.say('这周怎么练'), /周三 休息 · 已记录骑行/);
  assert.match(await h.say('最近骑行'), /填写时长，共 90 分钟/);
});

test('pausing and rescheduling reminders changes future triggers', async (t) => {
  const h = harness(t);
  const scheduler = h.scheduler(async () => {});
  await h.say('周二可骑');
  await h.say('开启课前提醒 09:15');
  await h.say('暂停课前提醒');
  h.go('2026-11-17T09:15:00+08:00');
  assert.equal(await scheduler.tick(), null);
  await h.say('课前提醒改到 09:20');
  h.go('2026-11-17T09:20:00+08:00');
  assert.equal((await scheduler.tick()).status, 'channel_ok');
  await h.say('课前提醒改到 10:00');
  h.go('2026-11-17T10:00:00+08:00');
  assert.equal(await scheduler.tick(), null);
});

test('ZWO keeps checked seconds and FTP ratios, and rejects RPE-only or rest', () => {
  const zwo = exportZwo(workout('threshold', 45, 240));
  assert.match(zwo, /<sportType>bike<\/sportType>/);
  assert.match(zwo, /<Warmup Duration="600" PowerLow="0.4" PowerHigh="0.55"/);
  assert.match(zwo, /<Cooldown Duration="300" PowerLow="0.5" PowerHigh="0.4"/);
  assert.equal([...zwo.matchAll(/Duration="(\d+)"/g)].reduce((sum, [, amount]) => sum + Number(amount), 0), 2700);
  assert.throws(() => exportZwo(workout('endurance', 45, null)), /FTP/);
  assert.throws(() => exportZwo(workout('rest', 0, 240)), /休息/);
});

test('Weixin outbound forwards explicit account and peer and interprets plugin return or error', async () => {
  const cfg = { gateway: { mode: 'local' } };
  const signal = new AbortController().signal;
  let sendText = async (args) => {
    assert.deepEqual(args, { cfg, accountId: 'new', to: 'rider', text: 'hello', abortSignal: signal });
    return { messageId: 'synthetic', channel: 'openclaw-weixin' };
  };
  const api = { runtime: { config: { current: () => cfg }, channel: { outbound: {
    async loadAdapter(id) {
      assert.equal(id, 'openclaw-weixin');
      return { sendText };
    },
  } } } };
  const weixin = weixinChannel({ api, account: 'new', peer: 'rider' });
  await weixin.send({ text: 'hello', signal });
  sendText = async () => { throw new Error('sendMessage ret=-14'); };
  await assert.rejects(weixin.send({ text: 'hello', signal }), { status: 'session_invalid' });
  sendText = async () => ({ messageId: '', outcome: 'not_sent' });
  await assert.rejects(weixin.send({ text: 'hello', signal }), { status: 'failed' });
});
