export const DAYS = '一二三四五六日';
const iso = (date) => date.toISOString().slice(0, 10);

export function addDays(day, count) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return iso(date);
}

export function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(day + 'T00:00:00Z');
  return Number.isFinite(+date) && iso(date) === day;
}

export function weekday(day) {
  return (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

export function weekStart(day) {
  return addDays(day, -weekday(day));
}

export function clock(tz = 'Asia/Shanghai') {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return (date = new Date()) => {
    const { year, month, day, hour, minute } =
      Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));
    return {
      day: [year, month, day].join('-'),
      minute: Number(hour) * 60 + Number(minute),
    };
  };
}

export function parseTime(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
