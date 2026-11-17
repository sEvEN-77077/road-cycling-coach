import { DeliveryError } from './reminders.mjs';

export const WEIXIN = 'openclaw-weixin';
export const MOCK_RIDER = 'demo-rider';
export const routeKey = (account, peer) => JSON.stringify([WEIXIN, account, peer]);

export function mockChannel(write = console.log) {
  return {
    async send({ text }) {
      write(`[模拟通道] ${text}`);
    },
  };
}

export function weixinChannel({ api, account, peer }) {
  return {
    async send({ text, signal }) {
      try {
        const adapter = await api.runtime.channel.outbound.loadAdapter(WEIXIN);
        if (!adapter?.sendText) throw new DeliveryError('failed');
        const cfg = api.runtime.config.current();
        signal.throwIfAborted();
        const result = await adapter.sendText({ cfg, to: peer, accountId: account, text, abortSignal: signal });
        if (!result?.messageId || ['not_sent', 'unknown', 'failed'].includes(result.outcome)) {
          throw new DeliveryError(result?.outcome === 'not_sent' ? 'failed' : 'uncertain');
        }
      } catch (error) {
        const message = String(error);
        if (/(?:errcode["'\s:=]+-14\b|\bret=-14\b|\bstale token\b|weixin not configured|\bsession (?:expired|paused)\b)/i.test(message)) {
          throw new DeliveryError('session_invalid');
        }
        if (/sendMessage ret=-?\d+/.test(message)) throw new DeliveryError('failed');
        throw error;
      }
    },
  };
}
