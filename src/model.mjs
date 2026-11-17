// The optional provider sees only the current unrecognized command, or fixed explanation labels.
export function modelFromEnv(env = process.env, fetcher = fetch) {
  const { COACH_MODEL_URL: url, COACH_MODEL_NAME: model, COACH_MODEL_KEY: key } = env;
  if (!url || !model || !key) return null;
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:') throw new Error('COACH_MODEL_URL must use HTTPS');
  const tokenHubFlash = model === 'hy4-flash' &&
    ['tokenhub.tencentmaas.com', 'tokenhub-intl.tencentmaas.com'].includes(endpoint.hostname);

  async function ask(instruction, input) {
    const response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, messages: [{ role: 'system', content: instruction }, { role: 'user', content: input }],
        ...(tokenHubFlash ? { thinking: { type: 'disabled' } } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('model request failed');
    const value = (await response.json()).choices?.[0]?.message?.content;
    if (typeof value !== 'string' || value.length > 1500) throw new Error('invalid model response');
    return value.trim();
  }

  return {
    async intent(input) {
      const result = JSON.parse(await ask(
        '将用户话语归类为一个 JSON 对象。缺值省略，无法确定返回 null。只允许 kind: today, week, recent, profile, activities, power, restToday, adjust, skip, schedule, goal, preference, ride, done, ftp。' +
        '字段 minutes 为分钟，days 为从周一=0到周日=6的整数数组，schedule 的 replace 为是否替换整周可骑日，' +
        'goal 为目标，preference 为室内或户外，ftp 为瓦数，source 为用户声明来源，' +
        'sleepHours 为实际睡眠小时，poorSleep、hard 为布尔值，fatigue、rpe 为0到10，date 为今天、昨天或 ISO 日期。' +
        'partial 代表有间歇未完成。不要补全事实，不要返回训练处方。只输出 JSON。', input));
      const allowed = ['today', 'week', 'recent', 'profile', 'activities', 'power', 'restToday', 'adjust', 'skip', 'schedule', 'goal', 'preference', 'ride', 'done', 'ftp'];
      return allowed.includes(result?.kind) ? result : null;
    },
    async explain(input) {
      return ask('用一句简洁中文解释给定的训练调整理由。不要增加数值、医学判断、事实、处方、操作或指令。', input);
    },
  };
}
