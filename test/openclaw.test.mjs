import assert from 'node:assert/strict';
import test from 'node:test';
import plugin from '../src/openclaw.mjs';
import { routeKey } from '../src/channels.mjs';
import { createCoach } from '../src/coach.mjs';
import { createScheduler, jobList } from '../src/reminders.mjs';
import { openStore } from '../src/store.mjs';

test('OpenClaw hook claims only the configured rider and routes deterministic replies', async (t) => {
  const settings = {
    COACH_DB: ':memory:',
    COACH_WEIXIN_ACCOUNT: 'fictional-new-account',
    COACH_WEIXIN_PEER: 'fictional-rider@im.wechat',
    COACH_MODEL_KEY: '',
  };
  for (const [key, value] of Object.entries(settings)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
  let hook;
  let service;
  plugin.register({
    on(name, handler) {
      assert.equal(name, 'before_dispatch');
      hook = handler;
    },
    registerService(value) { service = value; },
    logger: { info() {}, warn() {}, error() {} },
  });
  service.start();
  t.after(service.stop);
  const ctx = {
    channelId: 'openclaw-weixin',
    accountId: settings.COACH_WEIXIN_ACCOUNT,
    senderId: settings.COACH_WEIXIN_PEER,
    messageId: 'fictional-message',
  };
  const event = { content: '帮助', isGroup: false };
  assert.equal(await hook(event, { ...ctx, channelId: 'other' }), undefined);
  assert.deepEqual(await hook(event, { ...ctx, accountId: 'fictional-other-account' }), { handled: true });
  assert.deepEqual(await hook(event, { ...ctx, senderId: 'unknown' }), { handled: true });
  assert.deepEqual(await hook({ ...event, isGroup: true }, ctx), { handled: true });
  const reply = await hook(event, ctx);
  assert.equal(reply.handled, true);
  assert.match(reply.text, /今天骑什么/);
  assert.deepEqual(await hook(event, ctx), { handled: true });
});

test('the same peer on a distinct Weixin binding has independent rider state and reminders', async (t) => {
  const store = openStore();
  t.after(store.close);
  const peer = 'fictional-rider@im.wechat';
  const coachRoute = routeKey('coach-binding', peer);
  const otherRoute = routeKey('other-binding', peer);
  let time = new Date('2026-11-17T09:00:00+08:00');
  const now = () => time;
  const receive = createCoach({ store, now });
  const say = (rider, id, text) => receive({ rider, id, text });

  await say(coachRoute, 'schedule', '周二、周四可骑，想提高爬坡能力');
  await say(coachRoute, 'ride', '骑完了，RPE 4');
  await say(coachRoute, 'reminder', '测试提醒 3 分钟');
  const profile = await say(otherRoute, 'schedule', '档案');
  assert.match(profile.text, /目标：未设置/);
  assert.deepEqual(store.get(otherRoute).rides, []);
  assert.deepEqual(jobList(store, otherRoute), []);

  time = new Date('2026-11-17T09:03:00+08:00');
  const sent = [];
  const channel = { send: async ({ text }) => { sent.push(text); } };
  const tick = (rider) => createScheduler({ store, rider, now, channel }).tick();
  assert.equal(await tick(otherRoute), null);
  assert.equal(sent.length, 0);
  assert.equal((await tick(coachRoute)).status, 'channel_ok');
  assert.equal(sent.length, 1);
});
