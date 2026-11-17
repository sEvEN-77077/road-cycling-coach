import { addDays, weekday } from './time.mjs';

export const TYPES = {
  rest: '休息', recovery: '恢复骑', endurance: '有氧耐力',
  sweet: '甜区', threshold: '阈值', vo2: 'VO₂max',
};

const easy = {
  recovery: { cap: 40, power: [0.45, 0.55], rpe: '2–3' },
  endurance: { cap: 360, power: [0.56, 0.70], rpe: '3–4' },
};
const intervals = {
  sweet: { reps: 3, min: 6, max: 12, gap: 3, power: [0.88, 0.92], rpe: '6–7' },
  threshold: { reps: 3, min: 5, max: 10, gap: 4, power: [0.95, 1.02], rpe: '7–8' },
  vo2: { reps: 5, min: 2, max: 4, gap: 3, power: [1.08, 1.18], rpe: '8–9' },
};

export function weekPlan(profile, start, excluded = []) {
  const quality = /短坡|摄氧|vo[₂2]/i.test(profile.goal) ? 'vo2'
    : /阈值|长坡|计时/.test(profile.goal) ? 'threshold' : 'sweet';
  const sessions = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(start, index);
    const minutes = excluded.includes(day) ? 0 : (profile.days[index] ?? 0);
    return { day, minutes, type: minutes >= 10 ? 'endurance' : 'rest' };
  });
  const riding = sessions.filter((session) => session.type !== 'rest');
  const slot = riding.slice(0, -1).findLast((session) => session.minutes >= 35);
  if (slot) slot.type = quality;
  return sessions;
}

export function chooseType(planned, readiness, recent, ftp) {
  if (readiness.forceRest) return { type: 'rest', reason: '按你今天的安排改为休息。' };
  if (planned === 'rest') return { type: 'rest', reason: '周计划安排休息。' };
  const latest = recent[0];
  const feedback = latest
    ? `最近记录（${latest.day}，${latest.source}）${latest.outcome === 'partial' ? '部分完成，' : ''}${latest.rpe == null ? '未填 RPE' : `RPE ${latest.rpe}`}。`
    : '近七天未记录骑行，按档案和已填写的当天状态安排。';
  if (readiness.hard || readiness.fatigue >= 7 || readiness.sleepHours < 5 ||
      recent.some((ride) => ride.age <= 1 && ride.rpe >= 8)) {
    return { type: 'recovery', reason: '近期用力偏高或恢复不足，今天压低强度。' + feedback };
  }
  if (readiness.poorSleep || readiness.sleepHours < 6 || readiness.fatigue >= 5) {
    const type = planned === 'endurance' || planned === 'recovery' ? 'recovery' : 'endurance';
    return { type, reason: `睡眠或腿部状态提示应降低强度，今天做${TYPES[type]}。` + feedback };
  }
  if (intervals[planned] && recent.some((ride) => ride.age <= 1 && ride.outcome === 'partial')) {
    return { type: 'endurance', reason: '昨天有未完成的间歇，今天用耐力骑留出恢复时间。' + feedback };
  }
  if (intervals[planned] && recent.some((ride) => ride.age <= 1 && ride.completed && intervals[ride.plannedType])) {
    return { type: 'endurance', reason: '昨天的高强度计划已标记完成，今天用耐力骑间隔开。' + feedback };
  }
  const hardDeviceRide = ftp != null && recent.some((ride) => ride.age <= 1 &&
    ['设备报告', '来源标记为设备实测'].includes(ride.powerKind) &&
    ['计时器', '移动时间'].includes(ride.durationKind) &&
    ride.durationSeconds >= 1800 && ride.averageWatts >= 0.85 * ftp);
  if (intervals[planned] && hardDeviceRide) {
    return { type: 'endurance', reason: '昨天有至少 30 分钟的骑行，设备报告的平均功率达到档案 FTP 的 85%，今天改为轻松耐力。' + feedback };
  }
  if (intervals[planned] && recent.filter((ride) => ride.age <= 3 && ride.rpe >= 7).length >= 2) {
    return { type: 'endurance', reason: '近三天有两次或以上骑行反馈 RPE 7 或更高，今天把重点课改为耐力。' + feedback };
  }
  return { type: planned, reason: '按本周计划安排。' + feedback };
}

export function workout(type, limit, ftp) {
  if (!Object.hasOwn(TYPES, type) || !Number.isInteger(limit) || limit < 0 || limit > 360) {
    throw new RangeError('invalid workout input');
  }
  if (ftp != null && (!Number.isInteger(ftp) || ftp < 50 || ftp > 600)) {
    throw new RangeError('invalid FTP');
  }
  if (type === 'rest' || limit < 10) return { type: 'rest', minutes: 0, steps: [] };
  if (intervals[type] && limit < 35) type = 'endurance';
  const steps = [];
  const add = (label, minutes, power, rpe) => {
    steps.push({
      label, minutes, rpe,
      ftpRatio: ftp == null ? null : power,
      watts: ftp == null ? null : power.map((ratio) => Math.round(ftp * ratio)),
    });
  };
  const config = intervals[type] ?? easy[type];
  const minutes = Math.min(limit, config.cap ?? 85);
  const warmup = intervals[type] ? 10 : Math.min(8, Math.floor(minutes / 4));
  const cooldown = intervals[type] ? 5 : Math.min(5, Math.floor(minutes / 4));
  add('热身', warmup, [0.40, 0.55], '2–3');
  let main = minutes - warmup - cooldown;
  if (intervals[type]) {
    const { reps, min, max, gap, power, rpe } = config;
    const count = Math.min(reps, Math.floor((main + gap) / (min + gap)));
    const work = Math.min(max, Math.floor((main - (count - 1) * gap) / count));
    for (let index = 0; index < count; index++) {
      if (index) add('组间恢复', gap, [0.40, 0.55], '2');
      add(`主课第 ${index + 1} 组`, work, power, rpe);
    }
    main -= count * work + (count - 1) * gap;
    if (main > 0) add('轻松耐力', main, easy.endurance.power, easy.endurance.rpe);
  } else {
    add('主课', main, config.power, config.rpe);
  }
  add('冷身', cooldown, [0.40, 0.50], '1–2');
  const total = steps.reduce((sum, step) => sum + step.minutes, 0);
  if (total !== minutes || total > limit || steps.some((step) => step.minutes <= 0)) {
    throw new Error('workout duration invariant');
  }
  return { type, minutes: total, steps };
}

export function recommendation(profile, planned, readiness, rides, day) {
  const recent = rides
    .filter((ride) => ride.day < day && ride.day >= addDays(day, -7))
    .map((ride) => ({ ...ride, age: Math.round((Date.parse(day) - Date.parse(ride.day)) / 86400000) }));
  const { type, reason } = chooseType(planned.type, readiness, recent, profile.ftp);
  const limit = readiness.minutes ?? planned.minutes;
  const course = workout(type, limit, profile.ftp);
  const original = workout(planned.type, planned.minutes, profile.ftp);
  const changes = [];
  if (original.type !== course.type) changes.push(`课型 ${TYPES[original.type]} → ${TYPES[course.type]}`);
  if (original.minutes !== course.minutes) changes.push(`时长 ${original.minutes} → ${course.minutes} 分钟`);
  if (type !== course.type && course.type === 'rest') changes.push('可用时间不足 10 分钟');
  if (type !== course.type && course.type === 'endurance') changes.push('时间不足以完成高强度结构');
  return { ...course, reason, changes, preference: profile.preferences[weekday(day)] ?? profile.preference };
}

export function describe(course) {
  const ride = course.minutes
    ? [`今天骑 ${course.minutes} 分钟${TYPES[course.type]}${course.preference ? `（偏好${course.preference}）` : ''}。`,
      ...course.steps.map((step) =>
        `${step.label} ${step.minutes} 分钟 · ${step.watts ? `${step.watts.join('–')} W / ` : ''}RPE ${step.rpe}`)]
    : ['今天休息。'];
  return [...ride, ...(course.changes.length ? [`调整 · ${course.changes.join('，')}。`] : []), course.reason].join('\n');
}
