import { openStore } from './store.mjs';
import { createCoach } from './coach.mjs';
import { createScheduler } from './reminders.mjs';
import { modelFromEnv } from './model.mjs';
import { WEIXIN, routeKey, weixinChannel } from './channels.mjs';

export default {
  id: 'road-cycling-coach',
  name: 'Road Cycling Coach',
  description: 'Rule-based road cycling coach for a dedicated Weixin account.',
  register(api) {
    const account = process.env.COACH_WEIXIN_ACCOUNT?.trim();
    const peer = process.env.COACH_WEIXIN_PEER?.trim();
    const timezone = process.env.COACH_TZ || 'Asia/Shanghai';
    const archiveChat = process.env.COACH_WEB_WEIXIN === '1';
    const path = process.env.COACH_DB || 'data/coach.sqlite';
    let store;
    let receive;
    let interval;
    let runningTick;
    let accepting = false;
    const pending = new Set();

    api.on('before_dispatch', async (event, ctx) => {
      if ((ctx.channelId ?? event.channel) !== WEIXIN) return;
      const sender = event.senderId ?? ctx.senderId ?? ctx.conversationId;
      if (event.isGroup || !account || !peer || ctx.accountId !== account || sender !== peer) {
        return { handled: true };
      }
      if (!accepting || !receive) return { handled: true, text: '教练正在启动，请稍后再发一次。' };
      if (typeof event.content !== 'string' || !event.content.trim() || event.content.length > 1000) {
        return { handled: true, text: '请发一条 1000 字以内的文字指令。' };
      }
      const task = receive({ rider: routeKey(account, peer), text: event.content,
        id: ctx.messageId ?? event.messageId, ...(archiveChat ? { origin: 'weixin' } : {}) });
      pending.add(task);
      try {
        const reply = await task;
        return reply.duplicate ? { handled: true } : { handled: true, text: reply.text };
      } catch {
        api.logger.error('road-cycling-coach: command failed');
        return { handled: true, text: '这条指令处理失败，请稍后再试。' };
      } finally {
        pending.delete(task);
      }
    });

    api.registerService({
      id: 'road-cycling-coach',
      start() {
        if (!account || !peer) {
          api.logger.warn('road-cycling-coach: configure the dedicated Weixin account and peer');
          return;
        }
        const model = modelFromEnv();
        store = openStore(path);
        receive = createCoach({ store, timezone, model });
        const scheduler = createScheduler({
          store, rider: routeKey(account, peer), timezone, channel: weixinChannel({ api, account, peer }),
          mirrorWeb: archiveChat,
          report: ({ id, status }) => api.logger.info(`road-cycling-coach: reminder #${id} ${status}`),
        });
        accepting = true;
        interval = setInterval(() => {
          if (runningTick) return;
          runningTick = scheduler.tick()
            .catch(() => api.logger.error('road-cycling-coach: reminder scan failed'))
            .finally(() => { runningTick = null; });
        }, 5000);
      },
      async stop() {
        accepting = false;
        clearInterval(interval);
        await Promise.allSettled([...pending, runningTick]);
        store?.close();
        store = null;
        receive = null;
      },
    });
  },
};
