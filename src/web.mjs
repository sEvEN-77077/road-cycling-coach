import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { addActivities } from './activities.mjs';
import { MOCK_RIDER, routeKey } from './channels.mjs';
import { courseFor, createCoach } from './coach.mjs';
import { readFit } from './fit.mjs';
import { loadIntervals, readIntervalsCsv } from './intervals.mjs';
import { modelFromEnv } from './model.mjs';
import { ftpEstimate, readPowerCsv, savePower } from './power.mjs';
import { openStore } from './store.mjs';
import { addDays, clock, weekStart } from './time.mjs';

const assets = new Map([
  ['/', ['text/html; charset=utf-8', 'index.html']],
  ['/site.css', ['text/css; charset=utf-8', 'site.css']],
  ['/site.js', ['text/javascript; charset=utf-8', 'site.js']],
]);
const digest = (key) => createHash('sha256').update(key).digest();
const safeNumber = (value) => Number.isFinite(value) ? value : null;

function dashboard(state, today) {
  const start = weekStart(today);
  const historyStart = addDays(today, -89);
  const activities = (state.activities ?? []).filter((item) => item.day >= historyStart && item.day <= today);
  const rides = state.rides.filter((item) => item.day >= historyStart && item.day <= today);
  const readiness = Object.entries(state.readiness).filter(([day]) => day >= historyStart && day <= today)
    .map(([day, row]) => ({ day, fatigue: safeNumber(row.fatigue), sleep: safeNumber(row.sleepHours) }));
  const training = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(start, i);
    const course = courseFor(state, day);
    return { day, course, completion: rides.find((ride) => ride.day === day)?.outcome ??
      (activities.some((ride) => ride.day === day) ? 'imported' : null) };
  });
  const curves = state.powerCurves ?? [];
  return { today, activities, rides, readiness, training, profile: state.profile,
    powerCurves: curves.slice(-100), ftpEstimate: ftpEstimate(curves, today) };
}

class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function body(req, max) {
  if (Number(req.headers['content-length']) > max) throw new ClientError('文件超出大小限制。', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new ClientError('内容超出大小限制。', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createWebApp({ store, rider, timezone, password, demo = false, mirrorToWeixin = false,
  intervalsKey, model, now = () => new Date(), fetcher = fetch }) {
  if (!demo && (typeof password !== 'string' || password.length < 24)) {
    throw new Error('Set a unique COACH_WEB_PASSWORD of at least 24 characters.');
  }
  const expected = digest('coach:' + (password ?? ''));
  const receive = createCoach({ store, timezone, model, now });
  const local = clock(timezone);
  const turns = store.db.prepare(`SELECT t.id, t.origin, t.sent, t.prompt, t.reply, j.status
    FROM chat_turns t LEFT JOIN jobs j ON j.rider=t.rider AND j.slot='web:' || t.id
    WHERE t.rider=? ORDER BY t.id DESC LIMIT 150`);
  const reminders = store.db.prepare(`SELECT j.id,j.kind,j.attempted,j.status,m.text
    FROM jobs j LEFT JOIN job_messages m ON m.job=j.id
    WHERE j.rider=? AND j.kind IN ('pre','post','probe') AND j.attempted IS NOT NULL ORDER BY j.id DESC LIMIT 12`);
  let syncing = false;

  async function post(url, req) {
    if (url.pathname === '/api/chat') {
      const data = JSON.parse(await body(req, 8192));
      if (typeof data?.text !== 'string' || !data.text.trim() || data.text.length > 1000 ||
          typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.id)) {
        throw new ClientError('请输入 1–1000 字的指令。');
      }
      await receive({ rider, id: 'web:' + data.id, text: data.text.trim(), origin: 'web', mirrorToWeixin });
      return { turns: turns.all(rider).reverse() };
    }
    if (url.pathname === '/api/import/fit') {
      return addActivities(store, rider, readFit(await body(req, 25 * 1024 ** 2)), timezone);
    }
    if (url.pathname === '/api/import/activities') {
      return addActivities(store, rider, readIntervalsCsv((await body(req, 10 * 1024 ** 2)).toString('utf8')), timezone);
    }
    if (url.pathname === '/api/import/power') {
      const curve = readPowerCsv((await body(req, 2 * 1024 ** 2)).toString('utf8'), {
        today: local(now()).day, day: url.searchParams.get('date') || null, ftpTest: url.searchParams.get('test') === '1',
      });
      return { added: Number(savePower(store, rider, curve)) };
    }
    if (url.pathname === '/api/import/intervals') {
      if (syncing) throw new ClientError('同步正在进行。', 409);
      if (!intervalsKey) throw new ClientError('请先在服务器配置 Intervals.icu 个人 API Key。');
      syncing = true;
      try {
        const rows = await loadIntervals({ key: intervalsKey, days: Number(url.searchParams.get('days') ?? 30),
          timezone, now: now(), fetcher });
        return addActivities(store, rider, rows, timezone);
      } catch {
        throw new ClientError('同步失败。请核对个人 API Key、天数和 Intervals.icu 连接。');
      } finally {
        syncing = false;
      }
    }
    throw new ClientError('页面不存在。', 404);
  }

  return createServer({ requestTimeout: 40_000, headersTimeout: 15_000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    const auth = req.headers.authorization ?? '';
    const matches = auth.startsWith('Basic ') && timingSafeEqual(digest(Buffer.from(auth.slice(6), 'base64')), expected);
    if (!demo && !matches) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Cycling Coach", charset="UTF-8"');
      return json({ error: '请登录。' }, 401);
    }
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new ClientError('无效路径。');
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST') {
        if (req.headers['x-coach-request'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') {
          throw new ClientError('请求来源无效。', 403);
        }
        return json(await post(url, req));
      }
      if (req.method !== 'GET') throw new ClientError('此方法不可用。', 405);
      if (url.pathname === '/api/dashboard') return json({
        ...dashboard(store.get(rider), local(now()).day),
        demo, timezone, mirrorToWeixin, intervals: !!intervalsKey,
      });
      if (url.pathname === '/api/chat') return json({ turns: turns.all(rider).reverse(), reminders: reminders.all(rider) });
      const asset = assets.get(url.pathname);
      if (!asset) throw new ClientError('页面不存在。', 404);
      res.writeHead(200, { 'Content-Type': asset[0] });
      res.end(readFileSync(new URL('../web/' + asset[1], import.meta.url)));
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof ClientError || error instanceof SyntaxError) {
        return json({ error: error instanceof SyntaxError ? '请求格式无效。' : error.message }, error.status ?? 400);
      }
      if (req.url?.startsWith('/api/import/') && !error.code) return json({ error: error.message }, 400);
      json({ error: '暂时无法处理，请稍后再试。' }, 500);
    }
  });
}

function seed(store, timezone, now) {
  const day = clock(timezone)(now).day;
  const state = store.get(MOCK_RIDER);
  state.profile = { ...state.profile, goal: '提高爬坡能力', ftp: 235, ftpSource: '虚构演示值', days: { 1: 60, 3: 65, 5: 95 } };
  for (const [index, offset] of [1, 3, 6, 8, 10, 13, 15, 18, 20, 23, 25, 27].entries()) {
    const date = addDays(day, -offset);
    const minutes = 34 + (index * 37) % 71;
    const rpe = 3 + index % 4;
    state.rides.push({ day: date, rpe, completed: true, source: '虚构演示', outcome: 'logged' });
    state.activities.push({ id: 'demo-' + index, day: date, source: '虚构演示', durationSeconds: minutes * 60,
      averageWatts: 139 + index * 5, averageHeartRate: 125 + index * 2,
      distanceMeters: minutes * 420, ascentMeters: minutes * (2 + index % 7) });
    state.readiness[date] = { fatigue: 2 + index % 5, sleepHours: 6 + index % 3 / 2 };
  }
  state.readiness[day] = { fatigue: 4, sleepHours: 7.5 };
  state.powerCurves = [{ day, readings: { 5: 695, 60: 368, 300: 284, 1200: 246, 3600: 202 } }];
  store.put(MOCK_RIDER, state);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const env = process.env;
  const demo = process.argv.includes('--demo');
  const timezone = env.COACH_TZ || 'Asia/Shanghai';
  const linked = !demo && env.COACH_WEB_WEIXIN === '1';
  const account = env.COACH_WEIXIN_ACCOUNT?.trim();
  const peer = env.COACH_WEIXIN_PEER?.trim();
  if (linked && (!account || !peer)) throw new Error('Configure this coach’s own Weixin binding first.');
  const port = Number(env.COACH_WEB_PORT || 18797);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid COACH_WEB_PORT.');
  const store = openStore(demo ? ':memory:' : env.COACH_DB || 'data/coach.sqlite');
  if (demo) seed(store, timezone, new Date());
  const server = createWebApp({ store, rider: linked ? routeKey(account, peer) : MOCK_RIDER, timezone,
    password: env.COACH_WEB_PASSWORD, demo, mirrorToWeixin: linked, intervalsKey: demo ? null : env.COACH_INTERVALS_API_KEY,
    model: demo ? null : modelFromEnv(env) });
  server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => server.close(() => store.close()));
}
