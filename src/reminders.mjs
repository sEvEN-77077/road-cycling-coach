import { courseFor, rememberCourse } from './coach.mjs';
import { clock } from './time.mjs';
import { TYPES } from './training.mjs';

const GRACE = 10 * 60_000;
const STALE_ATTEMPT = 45_000;
const DELIVERY_TIMEOUT = 12_000;

export class DeliveryError extends Error {
  constructor(status) {
    super(status);
    this.status = status;
  }
}

export function createScheduler({ store, rider, channel, timezone, mirrorWeb = false, now = () => new Date(), report = () => {} }) {
  const local = clock(timezone);
  const { db } = store;
  let active = false;

  function claim(timestamp) {
    return store.transaction(() => {
      db.prepare(`
        UPDATE jobs SET status = 'uncertain', finished = ?, detail = 'interrupted'
        WHERE rider = ? AND status = 'running' AND attempted <= ?
      `).run(+timestamp, rider, +timestamp - STALE_ATTEMPT);
      db.prepare(`
        UPDATE jobs SET status = 'expired', finished = ?
        WHERE rider = ? AND status = 'pending' AND expires <= ?
      `).run(+timestamp, rider, +timestamp);

      const state = store.get(rider);
      if (!state.contact || state.contact.blocked) return null;
      const { day, minute } = local(timestamp);
      const course = courseFor(state, day);
      const done = state.rides.find((ride) => ride.day === day && ride.completed) ??
        state.activities?.find((activity) => activity.day === day);
      for (const kind of ['pre', 'post']) {
        const setting = state.reminders[kind];
        if (!setting || minute < setting.minute) continue;
        const due = +timestamp - (minute - setting.minute) * 60_000 - (+timestamp % 60_000);
        if (due + GRACE <= +timestamp || setting.since > due || state.contact.firstSeen > due) continue;
        db.prepare(`
          INSERT INTO jobs(rider, slot, kind, due, expires) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(rider, slot) DO NOTHING
        `).run(rider, `${day}:${kind}`, kind, due, due + GRACE);
      }

      const job = db.prepare(`
        SELECT * FROM jobs WHERE rider = ? AND status = 'pending' AND due <= ? AND expires > ?
        ORDER BY due, id LIMIT 1
      `).get(rider, +timestamp, +timestamp);
      if (!job) return null;
      const setting = state.reminders[job.kind];
      const webTurn = mirrorWeb && job.kind === 'web' && db.prepare('SELECT prompt, reply FROM chat_turns WHERE rider = ? AND id = ?')
        .get(rider, Number(job.slot.slice(4)));
      const eligible = webTurn || job.kind === 'probe' || (setting && local(new Date(job.due)).day === day &&
        local(new Date(job.due)).minute === setting.minute &&
        (job.kind === 'pre' ? course.minutes && !done : (course.minutes || done) && done?.rpe == null));
      db.prepare('UPDATE jobs SET status = ?, attempted = ?, finished = ? WHERE id = ?')
        .run(eligible ? 'running' : 'skipped', +timestamp, eligible ? null : +timestamp, job.id);
      if (!eligible) return { id: job.id, status: 'skipped' };
      if (webTurn) return { id: job.id, text: `网页对话\n你：${webTurn.prompt}\n\n教练：${webTurn.reply}` };
      if (job.kind === 'pre') {
        rememberCourse(state, day, course);
        store.put(rider, state);
      }
      const target = course.steps.find((step) => step.label.startsWith('主课'));
      const text = job.kind === 'probe' ? '定时测试提醒。'
        : job.kind === 'pre'
          ? `今天骑 ${course.minutes} 分钟${TYPES[course.type]}，主课 ${target.watts ? `${target.watts.join('–')} W / ` : ''}RPE ${target.rpe}。${course.reason}`
          : done ? '今天的骑行已记下。感觉有多用力？回复「骑完了，RPE 4」，数字按自己的感受填。'
            : `今天计划骑 ${course.minutes} 分钟${TYPES[course.type]}。如果骑完了，回复「骑完了，RPE 4」，数字按自己的感受填。`;
      const message = `${text}\n提醒 #${job.id}`;
      if (mirrorWeb) db.prepare('INSERT INTO job_messages(job,text) VALUES(?,?)').run(job.id, message);
      return { id: job.id, text: message };
    });
  }

  async function tick() {
    if (active) return null;
    active = true;
    try {
      const job = claim(now());
      if (!job) return null;
      report({ id: job.id, status: job.status ?? 'running' });
      if (job.status) return job;
      let status = 'channel_ok';
      let timeout;
      const controller = new AbortController();
      try {
        await Promise.race([
          channel.send({ text: job.text, signal: controller.signal }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              reject(new DeliveryError('uncertain'));
              controller.abort();
            }, DELIVERY_TIMEOUT);
          }),
        ]);
      } catch (error) {
        status = error instanceof DeliveryError ? error.status : 'uncertain';
      } finally {
        clearTimeout(timeout);
      }
      store.transaction(() => {
        const finished = +now();
        db.prepare('UPDATE jobs SET status = ?, finished = ? WHERE id = ? AND status = ?')
          .run(status, finished, job.id, 'running');
        if (status === 'session_invalid') {
          const state = store.get(rider);
          state.contact.blocked = true;
          store.put(rider, state);
          db.prepare(`
            UPDATE jobs SET status = 'expired', finished = ?, detail = 'invalid_session'
            WHERE rider = ? AND status = 'pending'
          `).run(finished, rider);
        }
      });
      const result = { id: job.id, status };
      report(result);
      return result;
    } finally {
      active = false;
    }
  }

  return { tick };
}

export function jobList(store, rider) {
  return store.db.prepare(`
    SELECT id, kind, due, status, attempted, finished, confirmed, detail
    FROM jobs WHERE rider = ? ORDER BY id DESC LIMIT 30
  `).all(rider);
}
