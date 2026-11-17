import { createInterface } from 'node:readline/promises';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { openStore } from './store.mjs';
import { createCoach, courseFor, rememberCourse } from './coach.mjs';
import { createScheduler, jobList } from './reminders.mjs';
import { mockChannel, MOCK_RIDER, routeKey } from './channels.mjs';
import { modelFromEnv } from './model.mjs';
import { clock } from './time.mjs';
import { exportZwo } from './zwo.mjs';
import { readFit } from './fit.mjs';
import { addActivities } from './activities.mjs';
import { readPowerCsv, savePower } from './power.mjs';
import { loadIntervals, readIntervalsCsv } from './intervals.mjs';

const mode = process.argv[2] ?? 'chat';
const path = process.env.COACH_DB || 'data/coach.sqlite';
const timezone = process.env.COACH_TZ || 'Asia/Shanghai';
const status = ({ id, status }) => console.log(`[任务 #${id}] ${status}`);

async function demo() {
  const data = JSON.parse(readFileSync(new URL('../examples/demo.json', import.meta.url), 'utf8'));
  const store = openStore();
  let date;
  const now = () => date;
  const receive = createCoach({ store, timezone: data.timezone, now });
  const scheduler = createScheduler({
    store, rider: data.rider, timezone: data.timezone, now, channel: mockChannel(), report: status,
  });
  try {
    for (const [index, step] of data.steps.entries()) {
      date = new Date(step.at);
      if (step.say) {
        console.log(`\n${step.at} 骑手 · ${step.say}`);
        const reply = await receive({ rider: data.rider, id: String(index), text: step.say });
        console.log(reply.text);
      }
      await scheduler.tick();
    }
  } finally {
    store.close();
  }
}

async function chat(store) {
  const receive = createCoach({ store, timezone, model: modelFromEnv() });
  const scheduler = createScheduler({
    store, rider: MOCK_RIDER, timezone, channel: mockChannel(), report: status,
  });
  let scan;
  const timer = setInterval(() => {
    if (!scan) scan = scheduler.tick().catch(() => console.error('提醒扫描失败')).finally(() => { scan = null; });
  }, 1000);
  const lines = createInterface({ input: stdin, output: stdout });
  console.log('公路车教练（模拟微信） · 输入「帮助」，Ctrl+C 退出。');
  try {
    for await (const text of lines) {
      if (text.trim()) {
        const result = await receive({ rider: MOCK_RIDER, text: text.slice(0, 1000) });
        console.log(result.text);
      }
    }
  } finally {
    clearInterval(timer);
    await scan;
    lines.close();
  }
}

function inputFile(path, extension, limit) {
  if (!path?.toLowerCase().endsWith(extension)) throw new Error(`请指定以 ${extension} 结尾的文件。`);
  const info = statSync(path);
  if (!info.isFile() || info.size > limit) throw new Error('文件类型或大小超出导入范围。');
  const data = readFileSync(path);
  if (data.length > limit) throw new Error('文件大小超出导入范围。');
  return data;
}

async function main() {
  if (mode === 'demo') return demo();
  if (!['chat', 'jobs', 'zwo', 'import-fit', 'import-power', 'import-intervals-csv', 'sync-intervals'].includes(mode)) {
    throw new Error('命令：chat | demo | jobs | zwo | import-fit | import-power | import-intervals-csv | sync-intervals');
  }
  const args = process.argv.slice(3);
  const realRoute = mode !== 'chat' && args.at(-1) === 'weixin';
  if (realRoute) args.pop();
  const [file, ...options] = args;
  const account = process.env.COACH_WEIXIN_ACCOUNT?.trim();
  const peer = process.env.COACH_WEIXIN_PEER?.trim();
  if (realRoute && (!account || !peer)) throw new Error('set COACH_WEIXIN_ACCOUNT and COACH_WEIXIN_PEER');
  const rider = realRoute ? routeKey(account, peer) : MOCK_RIDER;
  const store = openStore(path);
  try {
    if (mode === 'chat') await chat(store);
    if (mode === 'jobs') console.table(jobList(store, rider));
    if (mode === 'zwo') {
      if (!file?.toLowerCase().endsWith('.zwo')) throw new Error('请指定以 .zwo 结尾的输出文件。');
      const { day } = clock(timezone)();
      const xml = store.transaction(() => {
        const state = store.get(rider);
        const course = rememberCourse(state, day, courseFor(state, day));
        const text = exportZwo(course);
        store.put(rider, state);
        return text;
      });
      writeFileSync(file, xml, { flag: 'wx', mode: 0o600 });
      console.log(`今日课表已导出到 ${file}`);
    }
    if (mode === 'import-power') {
      if (options.some((arg) => arg !== '--ftp-test' && !arg.startsWith('--date='))) {
        throw new Error('参数只支持 --date=YYYY-MM-DD、--ftp-test 和末尾的 weixin。');
      }
      const curve = readPowerCsv(inputFile(file, '.csv', 2 * 1024 ** 2).toString('utf8'), {
        day: options.find((arg) => arg.startsWith('--date='))?.slice(7),
        ftpTest: options.includes('--ftp-test'), today: clock(timezone)().day,
      });
      console.log(savePower(store, rider, curve) ? '功率曲线已保存。' : '功率曲线已存在。');
    }
    if (['import-fit', 'import-intervals-csv', 'sync-intervals'].includes(mode)) {
      const rows = mode === 'import-fit' ? readFit(inputFile(file, '.fit', 25 * 1024 ** 2))
        : mode === 'import-intervals-csv' ? readIntervalsCsv(inputFile(file, '.csv', 10 * 1024 ** 2).toString('utf8'))
          : await loadIntervals({ key: process.env.COACH_INTERVALS_API_KEY, days: file === undefined ? 30 : Number(file), timezone });
      const { added, duplicates } = addActivities(store, rider, rows, timezone);
      console.log(`新增 ${added} 条骑行，跳过 ${duplicates} 条重复记录。`);
    }
  } finally {
    store.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
