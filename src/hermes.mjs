import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv, promisify } from 'node:util';
import { createCoach } from './coach.mjs';
import { routeKey } from './channels.mjs';
import { modelFromEnv } from './model.mjs';
import { createScheduler, DeliveryError } from './reminders.mjs';
import { openStore } from './store.mjs';

const runFile = promisify(execFile);
const failReply = '教练暂时无法处理，请稍后再试。';

export function hermesChannel({ launch, account, peer, readBinding, execute = runFile }) {
  return {
    async send({ text, signal }) {
      try {
        const binding = readBinding();
        if (binding.WEIXIN_ACCOUNT_ID !== account || binding.WEIXIN_HOME_CHANNEL !== peer ||
            binding.WEIXIN_DM_POLICY !== 'allowlist' || binding.WEIXIN_ALLOWED_USERS !== peer ||
            binding.WEIXIN_GROUP_POLICY !== 'disabled') {
          throw new DeliveryError('route_mismatch');
        }
        // The profile's home channel supplies the verified peer directly to Hermes.
        const { stdout } = await execute('/bin/bash', [launch, 'send', '--to', 'weixin', '--json', '--', text], {
          signal, maxBuffer: 64 * 1024,
        });
        const response = JSON.parse(stdout);
        if (response.success !== true && response.ok !== true && !response.message_id) {
          throw Object.assign(new DeliveryError('uncertain'), { stderr: response.error });
        }
      } catch (error) {
        if (error instanceof DeliveryError && error.status === 'route_mismatch') throw error;
        const details = [error.message, error.stderr, error.stdout].filter(Boolean).join(' ');
        if (/session (?:not ready|expired|paused)|stale token|(?:errcode|ret)\s*[:=]\s*-14/i.test(details)) {
          throw new DeliveryError('session_invalid');
        }
        throw new DeliveryError('uncertain');
      }
    },
  };
}

export function hermesReply({ receive, rider, peer, archiveChat = false }) {
  return async (envelope) => {
    if (envelope?.peer !== peer) return { text: '' };
    if (typeof envelope.text !== 'string' || envelope.text.length > 1000) {
      return { text: '请发一条 1000 字以内的文字指令。' };
    }
    // The adapter prepends a quoted-message label above the rider's new text.
    const text = envelope.text.replace(/^\[引用(?:媒体)?(?:: [^\r\n]*?)?\]\r?\n/, '').trim();
    if (!text) return { text: '请发一条 1000 字以内的文字指令。' };
    try {
      return await receive({
        rider, text, id: typeof envelope.id === 'string' ? envelope.id.slice(0, 200) : undefined,
        ...(archiveChat ? { origin: 'weixin' } : {}),
      });
    } catch {
      return { text: failReply };
    }
  };
}

export async function runHermes(mode, env = process.env) {
  const peer = env.COACH_WEIXIN_PEER?.trim();
  const account = env.COACH_WEIXIN_ACCOUNT?.trim();
  const timezone = env.COACH_TZ || 'Asia/Shanghai';
  if (!peer || !account) throw new Error('Configure the coach binding and peer.');
  const rider = routeKey(account, peer);
  const store = openStore(env.COACH_DB || 'data/coach.sqlite');
  if (mode === 'reply') {
    try {
      const payload = readFileSync(0, 'utf8');
      const receive = createCoach({ store, timezone, model: modelFromEnv(env) });
      const reply = await hermesReply({ receive, rider, peer, archiveChat: env.COACH_WEB_WEIXIN === '1' })(JSON.parse(payload));
      process.stdout.write(JSON.stringify({ text: reply.text }));
    } finally { store.close(); }
    return;
  }
  if (mode !== 'schedule' || !env.COACH_HERMES_LAUNCHER || !env.HERMES_HOME) {
    store.close();
    throw new Error('Expected reply or schedule with a dedicated Hermes launcher.');
  }
  const scheduler = createScheduler({
    store, rider, timezone, mirrorWeb: env.COACH_WEB_WEIXIN === '1',
    channel: hermesChannel({
      launch: env.COACH_HERMES_LAUNCHER, account, peer,
      readBinding: () => parseEnv(readFileSync(join(env.HERMES_HOME, '.env'), 'utf8')),
    }),
    report: ({ id, status }) => console.log(`reminder #${id} ${status}`),
  });
  let pending;
  const timer = setInterval(() => {
    if (pending) return;
    pending = scheduler.tick().catch(() => console.error('reminder scan failed'))
      .finally(() => { pending = undefined; });
  }, 5000);
  await new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
  clearInterval(timer);
  await pending;
  store.close();
}
