import { clock } from './time.mjs';

export function addActivities(store, rider, rows, timezone) {
  const local = clock(timezone);
  return store.transaction(() => {
    const state = store.get(rider);
    const activities = state.activities ??= [];
    let added = 0;
    for (const row of rows) {
      const existing = activities.find((item) => item.id === row.id || item.aliases?.includes(row.id) ||
        (row.startAt && item.startAt === row.startAt));
      if (existing) {
        if (existing.id !== row.id && !existing.aliases?.includes(row.id)) (existing.aliases ??= []).push(row.id);
        continue;
      }
      const day = row.startAt ? local(new Date(row.startAt)).day : row.sourceDay ?? null;
      activities.push({ ...row, day });
      added++;
    }
    activities.sort((a, b) => (b.startAt ?? '').localeCompare(a.startAt ?? ''));
    store.put(rider, state);
    return { added, duplicates: rows.length - added };
  });
}

export function activityLine(activity) {
  const metrics = [];
  if (activity.durationSeconds != null) {
    metrics.push(`${Number((activity.durationSeconds / 60).toFixed(1))} 分钟${activity.durationKind ? `（${activity.durationKind}）` : ''}`);
  }
  if (activity.distanceMeters != null) metrics.push(`${(activity.distanceMeters / 1000).toFixed(1)} km`);
  if (activity.ascentMeters != null) metrics.push(`爬升 ${Math.round(activity.ascentMeters)} m`);
  if (activity.averageWatts != null) metrics.push(`均功率 ${Math.round(activity.averageWatts)} W${activity.powerKind ? `（${activity.powerKind}）` : ''}`);
  if (activity.maxWatts != null) metrics.push(`最大功率 ${Math.round(activity.maxWatts)} W`);
  if (activity.normalizedWatts != null) metrics.push(`标准化功率 ${Math.round(activity.normalizedWatts)} W`);
  if (activity.trainingLoad != null) metrics.push(`来源负荷 ${Math.round(activity.trainingLoad)}`);
  if (activity.averageHeartRate != null) metrics.push(`均心率 ${Math.round(activity.averageHeartRate)} bpm`);
  if (activity.maxHeartRate != null) metrics.push(`最高心率 ${Math.round(activity.maxHeartRate)} bpm`);
  return `${activity.day ?? '日期未记录'} ${activity.source} · ${metrics.join('，') || '活动指标未记录'}`;
}
