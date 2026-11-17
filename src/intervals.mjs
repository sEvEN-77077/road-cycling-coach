import { addDays, clock, validDay } from './time.mjs';

const rides = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'Cycling']);
const number = (value) => Number.isFinite(value) && value >= 0 ? value : null;

function activity(row, fileImport = false) {
  if (!rides.has(row?.type) || (typeof row.id !== 'string' && !Number.isSafeInteger(row.id))) return null;
  if (!fileImport && (/strava/i.test(String(row.source ?? '')) || Number(row.strava_id) > 0 || /^\d+$/.test(String(row.id)))) return null;
  const stamp = typeof row.start_date === 'string' ? Date.parse(
    /(?:Z|[+-]\d\d:?\d\d)$/i.test(row.start_date) ? row.start_date : row.start_date + 'Z',
  ) : NaN;
  const startAt = Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
  const localDay = row.start_date_local?.slice?.(0, 10);
  const moving = number(row.moving_time);
  const elapsed = number(row.elapsed_time);
  return {
    id: `intervals:${row.id}`,
    source: fileImport ? 'Intervals.icu 自有导出 CSV' : 'Intervals.icu',
    startAt,
    sourceDay: typeof localDay === 'string' && validDay(localDay) ? localDay : null,
    durationSeconds: moving ?? elapsed,
    durationKind: moving != null ? '移动时间' : elapsed != null ? '经过时间' : null,
    distanceMeters: number(row.distance),
    ascentMeters: number(row.total_elevation_gain),
    averageWatts: number(row.icu_average_watts ?? row.average_watts),
    maxWatts: number(row.icu_max_watts ?? row.max_watts),
    ...(fileImport && { normalizedWatts: number(row.normalized_power), trainingLoad: number(row.training_load) }),
    averageHeartRate: number(row.average_heartrate),
    maxHeartRate: number(row.max_heartrate),
    powerKind: row.device_watts === true ? '来源标记为设备实测'
      : row.device_watts === false ? '来源标记为非设备功率' : '来源报告，测量方式未知',
  };
}

export async function loadIntervals({ key, days = 30, timezone, now = new Date(), fetcher = fetch }) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('请先设置 COACH_INTERVALS_API_KEY。');
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('同步范围应为 1–90 天。');
  const { day } = clock(timezone)(now);
  const oldest = addDays(day, 1 - days);
  const url = new URL('https://intervals.icu/api/v1/athlete/0/activities');
  url.search = new URLSearchParams({ oldest, newest: day }).toString();
  const response = await fetcher(url, {
    headers: { authorization: `Basic ${Buffer.from('API_KEY:' + key.trim()).toString('base64')}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Intervals.icu 同步失败（HTTP ${response.status}）。`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Intervals.icu 返回格式无效。');
  return rows.map((row) => activity(row)).filter(Boolean);
}

function csvRecords(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; };
  const finishRow = () => { finishCell(); if (row.some(Boolean)) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const c = text[index];
    if (quoted) {
      if (c === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',') finishCell();
    else if (c === '\r' || c === '\n') {
      finishRow();
      if (c === '\r' && text[index + 1] === '\n') index++;
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else if (!closed && c !== '"') cell += c;
    else throw new Error('活动 CSV 的引号格式无效。');
  }
  if (quoted) throw new Error('活动 CSV 的引号未闭合。');
  if (cell || row.length || closed) finishRow();
  return rows;
}

export function readIntervalsCsv(text) {
  const [head = [], ...records] = csvRecords(text.replace(/^\uFEFF/, ''));
  const labels = new Map([
    ['种类', 'type'], ['日期', 'start_date_local'], ['距离', 'distance'], ['移动时间', 'moving_time'],
    ['经过时间', 'elapsed_time'], ['爬升', 'total_elevation_gain'], ['平均心率', 'average_heartrate'],
    ['最高心率', 'max_heartrate'], ['平均功率', 'average_watts'], ['标准化功率', 'normalized_power'], ['负荷', 'training_load'],
    ['icu_weighted_avg_watts', 'normalized_power'], ['icu_training_load', 'training_load'],
  ]);
  const columns = head.map((name) => labels.get(name.trim()) ?? name.trim().toLowerCase());
  if (!['id', 'type'].every((name) => columns.includes(name)) ||
      !['start_date', 'start_date_local'].some((name) => columns.includes(name)) ||
      new Set(columns).size !== columns.length) {
    throw new Error('请选择从 Intervals.icu 活动列表导出的 CSV。');
  }
  const numeric = ['moving_time', 'elapsed_time', 'distance', 'total_elevation_gain', 'icu_average_watts',
    'average_watts', 'icu_max_watts', 'max_watts', 'average_heartrate', 'max_heartrate', 'normalized_power', 'training_load'];
  const fields = ['id', 'type', 'start_date', 'start_date_local', 'device_watts', ...numeric];
  const indexes = fields.map((name) => [name, columns.indexOf(name)]);
  return records.flatMap((cells) => {
    if (cells.length !== columns.length) throw new Error('活动 CSV 的列数不一致。');
    const row = Object.fromEntries(indexes.map(([name, index]) => [name, cells[index]?.trim() || null]));
    if (!row.id || row.id.length > 120) return [];
    for (const name of numeric) row[name] = row[name] == null ? null : Number(row[name]);
    row.device_watts = row.device_watts === 'true' ? true : row.device_watts === 'false' ? false : null;
    const ride = activity(row, true);
    return ride && (ride.startAt || ride.sourceDay) ? [ride] : [];
  });
}
