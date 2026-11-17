import { HELP, parse, validate } from './commands.mjs';
import { addDays, clock, DAYS, parseTime, weekStart, weekday } from './time.mjs';
import { describe, recommendation, TYPES, weekPlan } from './training.mjs';
import { activityLine } from './activities.mjs';
import { powerReport } from './power.mjs';

const INVALID = '请检查日期和数值。可用时间 0–360 分钟，FTP 50–600 W，RPE 与腿部疲劳 0–10，睡眠 0–24 小时。发送「帮助」看示例。';
const excludedDays = (state, day) => state.plans[weekStart(day)] ?? [];
const availability = (profile) => Object.entries(profile.days).sort(([a], [b]) => Number(a) - Number(b))
  .map(([index, minutes]) => `周${DAYS[index]} ${minutes} 分钟${profile.preferences[index] ? ' ' + profile.preferences[index] : ''}`)
  .join('、') || '未设置';
const ftpText = (profile) => profile.ftp == null ? '按 RPE' : `${profile.ftp} W（${profile.ftpSource}）`;
function planText(sessions, state, today) {
  const completed = new Map((state?.rides ?? []).filter((ride) => ride.completed).map((ride) => [ride.day, ride]));
  return sessions.map(({ day, minutes, type }) => {
    const label = `${day.slice(5)} 周${DAYS[weekday(day)]} ${TYPES[type]}${type === 'rest' ? '' : `（可用 ${minutes} 分钟）`}`;
    const ride = completed.get(day);
    if (ride) {
      const outcome = ride.outcome === 'partial' ? '部分完成'
        : type === 'rest' || !ride.plannedType ? '已记录骑行' : '已完成';
      const record = [outcome,
        ...(ride.minutes == null ? [] : [`实际 ${ride.minutes} 分钟`]),
        ...(ride.rpe == null ? [] : [`RPE ${ride.rpe}`])];
      return label + ' · ' + record.join('，');
    }
    if (state?.readiness[day]?.forceRest) return label + ' · 已调整为休息';
    if (state?.activities?.some((activity) => activity.day === day)) return label + ' · 已导入骑行';
    if (day === today && state?.readiness[day]) {
      const adjusted = courseFor(state, day);
      if (adjusted.changes.length) {
        return label + ` · 今调为 ${TYPES[adjusted.type]}${adjusted.minutes ? ` ${adjusted.minutes} 分钟` : ''}`;
      }
    }
    if (today && day < today && type !== 'rest') return label + ' · 未记录完成';
    return label;
  }).join('\n');
}

function recentSummary(state, today) {
  const start = addDays(today, -6);
  const rides = state.rides.filter((ride) => ride.day >= start && ride.day <= today);
  if (!rides.length) return '近七天未记录骑行。完成后发「骑完了，RPE 4」或手动记录实际时长。';
  const measured = rides.filter((ride) => ride.minutes != null);
  const header = `近七天记录 ${rides.length} 个骑行日。${measured.length
    ? `其中 ${measured.length} 天填写时长，共 ${measured.reduce((sum, ride) => sum + ride.minutes, 0)} 分钟。`
    : '还未填写实际时长。'}`;
  const rows = rides.map((ride) => {
    const duration = ride.minutes == null ? '未填时长' : `${ride.minutes} 分钟`;
    const rpe = ride.rpe == null ? '未填 RPE' : `RPE ${ride.rpe}`;
    return `${ride.day} ${ride.source} · ${duration} · ${rpe}`;
  });
  return [header, ...rows].join('\n');
}

export function courseFor(state, day) {
  const readiness = state.readiness[day] ?? {};
  const hasSchedule = Object.keys(state.profile.days).length > 0;
  const planned = !hasSchedule && readiness.minutes >= 10
    ? { type: 'endurance', minutes: readiness.minutes }
    : weekPlan(state.profile, weekStart(day), excludedDays(state, day))[weekday(day)];
  const imported = (state.activities ?? []).filter(({ day: date }) => date);
  const history = [...state.rides, ...imported].sort((a, b) => b.day.localeCompare(a.day));
  return recommendation(state.profile, planned, readiness, history, day);
}

export function rememberCourse(state, day, course) {
  (state.courses ??= {})[day] = course;
  return course;
}

function showCourse(state, day) {
  return describe(rememberCourse(state, day, courseFor(state, day)));
}

function propose(state, day, now, profile, excluded, heading) {
  const start = weekStart(day);
  const proposed = weekPlan(profile, start, excluded);
  state.pending = { start, profile, excluded, expires: +now + 30 * 60_000 };
  const old = weekPlan(state.profile, start, excludedDays(state, day));
  return `${heading}\n当前安排\n${planText(old)}\n拟调整为\n${planText(proposed)}\n回复「确认」保存，或回复「取消」。`;
}

function handle(store, rider, state, command, today, now) {
  const { profile } = state;
  const { kind, minutes, rpe } = command;
  const start = weekStart(today);
  switch (kind) {
    case 'help': return HELP;
    case 'profile': return `目标：${profile.goal || '未设置'}\n可骑：${availability(profile)}\nFTP：${ftpText(profile)}\n偏好：${profile.preference || '未设置'}`;
    case 'week':
      return `本周计划 · ${profile.goal || '基础耐力'}\n${planText(weekPlan(profile, start, excludedDays(state, today)), state, today)}
${Object.keys(profile.days).length ? '每日课程会根据状态和可用时间调整。' : '先告诉我每周哪几天可骑。'}`;
    case 'today':
      if (!Object.keys(profile.days).length && !state.readiness[today]?.forceRest && state.readiness[today]?.minutes == null) {
        return '今天有多少分钟可以骑？发「今天只能骑 45 分钟」，我按可用时间安排。';
      }
      return showCourse(state, today);
    case 'recent': return recentSummary(state, today);
    case 'power': return powerReport(state, today);
    case 'activities': {
      const rows = (state.activities ?? []).slice(0, 6);
      return rows.length ? ['最近导入的骑行', ...rows.map(activityLine)].join('\n')
        : '暂无导入活动。可以手动记录，或由部署者导入 FIT、同步 Intervals.icu。';
    }
    case 'restToday':
      state.readiness[today] = { ...state.readiness[today], forceRest: true };
      return showCourse(state, today);
    case 'adjust': {
      const changes = state.readiness[today] ?? {};
      for (const key of ['minutes', 'sleepHours', 'fatigue']) {
        if (command[key] != null) changes[key] = command[key];
      }
      if (command.sleepHours != null) changes.poorSleep = command.sleepHours < 6;
      if (command.poorSleep === true) changes.poorSleep = true;
      if (command.hard === true) changes.hard = true;
      if (minutes > 0) changes.forceRest = false;
      state.readiness[today] = changes;
      return showCourse(state, today);
    }
    case 'schedule':
    case 'defaultMinutes':
    case 'goal': {
      const changed = structuredClone(profile);
      if (kind === 'schedule') {
        if (command.replace) {
          changed.days = {};
          changed.preferences = {};
        }
        for (const index of command.days) {
          changed.days[index] = minutes ?? profile.days[index] ?? profile.defaultMinutes ?? 60;
          const preference = command.preference ?? profile.preferences[index];
          if (preference) changed.preferences[index] = preference;
        }
      }
      if (kind === 'defaultMinutes') {
        changed.defaultMinutes = minutes;
        for (const index of Object.keys(changed.days)) changed.days[index] = minutes;
      }
      if (command.goal) changed.goal = command.goal;
      const heading = `可骑：${availability(profile)} → ${availability(changed)}\n目标：${profile.goal || '未设置'} → ${changed.goal || '未设置'}`;
      if (!Object.keys(profile.days).length) {
        state.profile = changed;
        state.pending = null;
        return `已保存。\n${heading}\n发送「这周怎么练」查看课程安排。`;
      }
      return propose(state, today, now, changed, excludedDays(state, today), heading);
    }
    case 'preference':
      profile.preference = command.preference;
      // A pending full-profile snapshot must not overwrite a subsequent direct change.
      if (state.pending?.profile) state.pending.profile.preference = command.preference;
      return `已保存${profile.preference}偏好。`;
    case 'skip': {
      const days = command.days.map((index) => addDays(start, index)).filter((day) => day >= today);
      if (!days.length) return '这些日期已过。请发送本周尚未过去的日期。';
      return propose(state, today, now, profile,
        [...new Set([...excludedDays(state, today), ...days])], `本周 ${days.join('、')} 改为休息。`);
    }
    case 'ftp':
      state.pending = {
        ftp: command.ftp, source: command.ftp === null ? null : command.source, expires: +now + 30 * 60_000,
      };
      return `FTP：${ftpText(profile)} → ${ftpText({ ftp: command.ftp, ftpSource: command.source })}。回复「确认」保存，或回复「取消」。`;
    case 'confirm': {
      const pending = state.pending;
      state.pending = null;
      if (!pending || pending.expires <= +now || (pending.start && pending.start !== start)) {
        return '当前没有有效的待确认改动。';
      }
      if (pending.profile) {
        state.profile = pending.profile;
        state.plans[pending.start] = pending.excluded;
      } else {
        profile.ftp = pending.ftp;
        profile.ftpSource = pending.source;
      }
      return '改动已保存。';
    }
    case 'cancel':
      state.pending = null;
      return '已取消待确认改动。';
    case 'ride':
    case 'done': {
      const day = kind === 'done' || command.date === '今天' ? today
        : command.date === '昨天' ? addDays(today, -1) : command.date;
      if (day > today) return '骑行记录的日期还没到。';
      const course = state.courses?.[day] ?? courseFor(state, day);
      const existing = state.rides.find((ride) => ride.day === day && ride.completed);
      const record = {
        day, at: +now, source: '手动录入', completed: true,
        outcome: kind === 'ride' ? 'logged' : command.partial || existing?.outcome === 'partial' ? 'partial' : 'done',
        plannedType: kind === 'done' ? existing?.plannedType ?? course.type : null,
        minutes: minutes ?? (kind === 'done' ? existing?.minutes : null) ?? null,
        rpe: rpe ?? (kind === 'done' ? existing?.rpe : null) ?? null,
      };
      // One daily summary. A later completion can add RPE or duration.
      state.rides = [record, ...state.rides.filter((ride) => ride.day !== day)]
        .sort((a, b) => b.day.localeCompare(a.day));
      return `已记下 ${day} 的骑行${record.outcome === 'partial' ? '（部分完成）' : ''}${record.rpe == null ? '' : `，RPE ${record.rpe}`}。下次推荐会读取这条记录。需要补填时长或 RPE 可以再发一次。`;
    }
    case 'reminder': {
      const types = command.reminder === 'both' ? ['pre', 'post'] : [command.reminder];
      for (const type of types) {
        if ((state.reminders[type]?.time ?? null) === command.time) continue;
        store.db.prepare("DELETE FROM jobs WHERE rider = ? AND kind = ? AND status = 'pending'")
          .run(rider, type);
        state.reminders[type] = command.time === null ? null : {
          time: command.time, minute: parseTime(command.time), since: +now,
        };
      }
      return reminderStatus(state);
    }
    case 'reminderStatus': return reminderStatus(state);
    case 'probe': {
      const due = +now + minutes * 60_000;
      const job = store.db.prepare(`
        INSERT INTO jobs(rider, slot, kind, due, expires) VALUES(?, ?, 'probe', ?, ?)
        ON CONFLICT(rider, slot) DO NOTHING
      `).run(rider, `probe:${due}`, due, due + 10 * 60_000);
      return job.changes
        ? `测试提醒 #${job.lastInsertRowid} 已排定，${minutes} 分钟后触发。手机收到后回复「确认收到 ${job.lastInsertRowid}」。`
        : '同一时间的测试提醒已排定。';
    }
    case 'receipt': {
      const result = store.db.prepare(`
        UPDATE jobs SET confirmed = COALESCE(confirmed, ?)
        WHERE rider = ? AND id = ? AND status IN ('channel_ok', 'uncertain', 'running')
      `).run(+now, rider, command.id);
      return result.changes ? `已登记手机确认收到 #${command.id}。` : '找不到可确认的发送记录。';
    }
    default: return HELP;
  }
}

function reminderStatus(state) {
  const value = (kind) => state.reminders[kind]?.time ?? '暂停';
  return `课前提醒 ${value('pre')}\n课后提醒 ${value('post')}`;
}

export function createCoach({ store, timezone, model = null, now = () => new Date() }) {
  const local = clock(timezone);
  const find = store.db.prepare('SELECT 1 FROM inbound WHERE rider = ? AND id = ?');
  const save = store.db.prepare('INSERT INTO inbound(rider, id) VALUES (?, ?)');
  const log = store.db.prepare('INSERT INTO chat_turns(rider,origin,sent,prompt,reply) VALUES(?,?,?,?,?)');
  const updateReply = store.db.prepare('UPDATE chat_turns SET reply=? WHERE id=?');
  const mirror = store.db.prepare(`INSERT INTO jobs(rider,slot,kind,due,expires) VALUES(?,?,'web',?,?)`);
  return async ({ rider, id, text, origin, mirrorToWeixin = false }) => {
    if (id && find.get(rider, id)) return { duplicate: true, text: '' };
    let command = parse(text);
    if (!command && model) {
      try { command = await model.intent(text); } catch { /* rule-based help remains available */ }
    }
    const result = store.transaction(() => {
      if (id && find.get(rider, id)) return { duplicate: true, text: '' };
      const timestamp = now();
      const { day } = local(timestamp);
      const state = store.get(rider);
      // Fresh inbound reopens the route. Duplicate events cannot reopen it.
      if (origin !== 'web' && (!state.contact || state.contact.blocked)) {
        state.contact = { blocked: false, firstSeen: +timestamp };
      }
      const valid = command && validate(command);
      const reply = valid ? handle(store, rider, state, command, day, timestamp) : command ? INVALID : HELP;
      store.put(rider, state);
      if (id) save.run(rider, id);
      const turn = origin ? log.run(rider, origin, +timestamp, text, reply).lastInsertRowid : null;
      if (turn && origin === 'web' && mirrorToWeixin) {
        mirror.run(rider, `web:${turn}`, +timestamp, +timestamp + 10 * 60_000);
      }
      const course = valid && command.kind === 'adjust' ? courseFor(state, day) : null;
      return {
        text: reply, turn,
        explanation: origin !== 'web' && course?.changes.length ? course.changes[0] + '。' + course.reason.split('。')[0] : null,
      };
    });
    if (model && result.explanation) {
      try {
        const explanation = await model.explain(result.explanation);
        // Keep the canonical explanation and prescription intact even if the provider fails.
        if (explanation && explanation.length <= 100 && !/[\d\n]/.test(explanation)) {
          result.text += '\n教练补充 · ' + explanation;
          if (result.turn) updateReply.run(result.text, result.turn);
        }
      } catch { /* canonical reply is already available */ }
    }
    return result;
  };
}
