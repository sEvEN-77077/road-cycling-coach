import { createHash } from 'node:crypto';
import { addDays, validDay } from './time.mjs';

const representative = new Map([[5, '5 秒'], [60, '1 分钟'], [300, '5 分钟'], [1200, '20 分钟'], [3600, '60 分钟']]);
const decimal = /^\d+(?:\.\d+)?$/;
const cell = (value) => value.trim().replace(/^"([^"]*)"$/, '$1');

export function readPowerCsv(text, { day = null, ftpTest = false, today }) {
  if (day != null && (!validDay(day) || day > today)) throw new Error('功率记录日期无效或晚于今天。');
  const [first, ...lines] = text.trim().split(/\r?\n/);
  const [time, power, ...extra] = first.toLowerCase().split(',').map(cell);
  if (!['duration_seconds', 'seconds'].includes(time) || !['power_watts', 'watts'].includes(power) || extra.length) {
    throw new Error('CSV 表头应为 duration_seconds,power_watts（秒、瓦）。');
  }
  const readings = {};
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const [seconds, watts, ...rest] = line.split(',').map(cell);
    const s = Number(seconds);
    const w = Number(watts);
    if (rest.length || !decimal.test(seconds ?? '') || !decimal.test(watts ?? '') ||
        !Number.isInteger(s) || s < 1 || s > 86400 || !Number.isFinite(w) || w < 0 || w > 3000) {
      throw new Error(`CSV 第 ${index + 2} 行需要有效的持续秒数和瓦数。`);
    }
    if (representative.has(s)) readings[s] = Math.max(readings[s] ?? 0, w);
  }
  if (!Object.keys(readings).length) throw new Error('CSV 缺少 5、60、300、1200、3600 秒的任一实测点。');
  if (ftpTest && (!day || !(readings[1200] > 0))) {
    throw new Error('标记 20 分钟极限测试时需要提供日期和 1200 秒实测功率。');
  }
  const hash = createHash('sha256').update(JSON.stringify({ readings, day })).digest('hex');
  return { id: hash, day, ftpTest, readings };
}

export function ftpEstimate(curves, today) {
  const tests = new Map();
  for (const curve of curves) {
    if (!curve.ftpTest || curve.day < addDays(today, -56) || curve.day > today) continue;
    const value = curve.readings[1200];
    tests.set(curve.day, Math.max(tests.get(curve.day) ?? 0, value));
  }
  const last = [...tests.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 2);
  if (last.length < 2) return null;
  const powers = last.map(([, watts]) => watts);
  if (Math.min(...powers) < 0.95 * Math.max(...powers)) return null;
  return Math.round(0.95 * (powers[0] + powers[1]) / 2);
}

export function savePower(store, rider, curve) {
  return store.transaction(() => {
    const state = store.get(rider);
    const curves = state.powerCurves ??= [];
    const existing = curves.find(({ id }) => id === curve.id);
    if (existing && (!curve.ftpTest || existing.ftpTest)) return false;
    if (existing) existing.ftpTest = true;
    else curves.push(curve);
    store.put(rider, state);
    return true;
  });
}

export function powerReport(state, today) {
  const curves = state.powerCurves ?? [];
  const { ftp, ftpSource } = state.profile;
  const summary = [`档案 FTP · ${ftp == null ? '未设定，按 RPE 开课' : `${ftp} W（${ftpSource}）`}`];
  const values = [];
  for (const [seconds, label] of representative) {
    const best = curves.filter((curve) => curve.readings[seconds] != null)
      .reduce((best, curve) => !best || curve.readings[seconds] > best.readings[seconds] ? curve : best, null);
    if (best) values.push(`${label} ${best.readings[seconds]} W${best.day ? `（${best.day}）` : ''}`);
  }
  summary.push(values.length ? `CSV 最佳实测 · ${values.join('、')}` : '暂无功率曲线实测点。');
  const ride = state.activities?.find((item) => item.averageWatts != null);
  if (ride) {
    summary.push(`最近含功率活动 · ${ride.source} 均功率 ${Math.round(ride.averageWatts)} W（${ride.powerKind}）`);
  }
  const estimate = ftpEstimate(curves, today);
  summary.push(estimate == null
    ? 'FTP 参考估算 · 需要近 56 天两个不同日期、差异不超过 5% 的 20 分钟极限测试。'
    : `FTP 参考估算 · ${estimate} W（最近两次有效测试的 20 分钟功率均值 × 0.95）。档案仍以你确认的 FTP 为准。`);
  return summary.join('\n');
}
