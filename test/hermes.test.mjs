import assert from 'node:assert/strict';
import test from 'node:test';
import { hermesChannel, hermesReply } from '../src/hermes.mjs';

test('Hermes inbound can change the coach state only for the configured Weixin peer', async () => {
  const calls = [];
  const reply = hermesReply({
    peer: 'rider@im.wechat', rider: 'coach-route', archiveChat: true,
    receive: async (event) => { calls.push(event); return { text: '训练规则回复' }; },
  });
  assert.deepEqual(await reply({ peer: 'other@im.wechat', text: '今天骑什么' }), { text: '' });
  assert.deepEqual(calls, []);
  assert.deepEqual(await reply({ peer: 'rider@im.wechat', text: '今天骑什么', id: 'm-1' }), { text: '训练规则回复' });
  assert.deepEqual(calls, [{ rider: 'coach-route', text: '今天骑什么', id: 'm-1', origin: 'weixin' }]);
});

test('Hermes reminders explicitly use the dedicated launcher and interpret delivery status', async () => {
  const signal = new AbortController().signal;
  const peer = 'rider@im.wechat';
  const account = 'coach@im.bot';
  const binding = {
    WEIXIN_ACCOUNT_ID: account, WEIXIN_HOME_CHANNEL: peer, WEIXIN_ALLOWED_USERS: peer,
    WEIXIN_DM_POLICY: 'allowlist', WEIXIN_GROUP_POLICY: 'disabled',
  };
  let sends = 0;
  let result = { success: true, message_id: 'provider-id' };
  const channel = hermesChannel({
    launch: '/srv/coach/deploy/hermes.sh', account, peer, readBinding: () => binding,
    execute: async (command, args, options) => {
      sends += 1;
      assert.equal(command, '/bin/bash');
      assert.deepEqual(args, ['/srv/coach/deploy/hermes.sh', 'send', '--to', 'weixin', '--json', '--', '测试提醒']);
      assert.equal(options.signal, signal);
      return { stdout: JSON.stringify(result) };
    },
  });
  await channel.send({ text: '测试提醒', signal });
  result = { success: false, error: 'iLink sendmessage session not ready' };
  await assert.rejects(channel.send({ text: '测试提醒', signal }), { status: 'session_invalid' });
  result = { state: 'queued' };
  await assert.rejects(channel.send({ text: '测试提醒', signal }), { status: 'uncertain' });
  binding.WEIXIN_HOME_CHANNEL = 'other@im.wechat';
  await assert.rejects(channel.send({ text: '测试提醒', signal }), { status: 'route_mismatch' });
  assert.equal(sends, 3);
});

test('Hermes reads the new message beneath a Weixin quote without executing the quote', async () => {
  const peer = 'rider@im.wechat';
  const reply = hermesReply({ peer, rider: 'coach-route', receive: async ({ text }) => ({ text }) });
  const text = '[引用: 测试提醒 3 分钟]\n骑完了，RPE 4';
  assert.deepEqual(await reply({ peer, text }), { text: '骑完了，RPE 4' });
});
