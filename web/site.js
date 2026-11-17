const $ = (selector) => document.querySelector(selector);
const types = {rest:'休息',recovery:'恢复骑',endurance:'有氧耐力',sweet:'甜区',threshold:'阈值',vo2:'VO₂max'};
const states = { pending:'待同步', running:'正在发送', channel_ok:'微信通道已发送', uncertain:'微信投递待核对',
  session_invalid:'微信会话待恢复', route_mismatch:'微信路由待核对', expired:'同步已过期', skipped:'未同步' };
const metrics = {
  minutes: ['骑行时长', '分钟'], distance: ['距离', 'km'], ascent: ['爬升', 'm'],
  fatigue: ['主观腿部疲劳', '/ 10'], sleep: ['睡眠', '小时'], rpe: ['骑行主观用力', '/ 10'],
};
const weekday = '一二三四五六日';
let data;
let metric = 'minutes';
let planWeek = 0;
let selectedDay;
let activeChart = [];
let lastThread = '';
let busy = false;
let polling = false;

function el(name, text, className) {
  const node = document.createElement(name);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const format = (value, unit = '') => Number.isFinite(value)
  ? new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 1}).format(value) + unit : '—';
const plusDay = (day, offset) => {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const total = (items, get) => {
  const values = items.map(get).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
};

async function api(path, options) {
  const response = await fetch(path, options && {
    method:'POST', headers:{ 'X-Coach-Request':'1', 'Content-Type':options.type || 'application/json' }, body:options.body,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败。');
  return result;
}

function trainingDays(count) {
  return Array.from({length:count}, (_, i) => {
    const day = plusDay(data.today, i + 1 - count);
    const imported = data.activities.filter((row) => row.day === day);
    const hand = data.rides.find((row) => row.day === day);
    const wellness = data.readiness.find((row) => row.day === day);
    const seconds = total(imported, (row) => row.durationSeconds);
    return { day, minutes: seconds == null ? hand?.minutes ?? null : seconds / 60,
      distance: total(imported, (row) => row.distanceMeters == null ? null : row.distanceMeters / 1000),
      ascent: total(imported, (row) => row.ascentMeters),
      fatigue: wellness?.fatigue ?? null, sleep: wellness?.sleep ?? null, rpe: hand?.rpe ?? null };
  });
}

function overview() {
  const week = trainingDays(7);
  const today = week.at(-1);
  const overview = [
    ['近 7 天骑行', total(week, (row) => row.minutes), '分钟'],
    ['近 7 天距离', total(week, (row) => row.distance), 'km'],
    ['今日腿部疲劳', today.fatigue, '/ 10'],
    ['昨晚睡眠', today.sleep, '小时'],
  ];
  $('#metrics').replaceChildren(...overview.map(([label, value, unit]) => {
    const card = el('article', null, 'metric');
    const number = el('div', format(value), 'number');
    if (Number.isFinite(value)) number.append(el('small', unit));
    card.append(el('div', label, 'label'), number);
    if (!Number.isFinite(value)) card.append(el('div', '暂无记录', 'muted'));
    return card;
  }));
  $('#today-date').textContent = data.today + ' · ' + data.timezone;
  $('#goal').textContent = [data.profile.goal || '设置本周骑行目标', data.profile.ftp == null ? '训练按 RPE' : 'FTP ' + data.profile.ftp + ' W'].join('  /  ');
  $('#mode').textContent = data.demo ? '虚构演示数据' : '自托管训练台';
  $('#channel').textContent = data.mirrorToWeixin ? '网页与教练微信会话同步' : '仅网页对话';
  $('#sync-form button').disabled = !data.intervals;
  $('#sync-note').textContent = data.intervals ? '点击后批量读取 API 可用的活动，无需上传这些活动的文件。' : '此训练台暂未连接 Intervals.icu API，可以使用下方文件入口。';
}

function drawChart() {
  if (!data) return;
  const chart = $('#trend');
  const width = Math.round(chart.getBoundingClientRect().width);
  const height = 236;
  if (width < 90) return;
  const dpr = window.devicePixelRatio || 1;
  chart.width = width * dpr;
  chart.height = height * dpr;
  const ctx = chart.getContext('2d');
  ctx.scale(dpr, dpr);
  const days = trainingDays(Number($('#range').value));
  const [label, unit] = metrics[metric];
  const max = ['fatigue','rpe'].includes(metric) ? 10 : Math.max(4, ...days.map((row) => row[metric] ?? 0));
  const ceiling = ['fatigue','rpe'].includes(metric) ? 10 : Math.ceil(max / 4) * 4;
  const left = 38, right = 9, top = 14, bottom = 31;
  const plotHeight = height - top - bottom;
  const cell = (width - left - right) / days.length;
  ctx.font = '11px system-ui';
  ctx.fillStyle = '#53637c';
  ctx.strokeStyle = '#e7edf6';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = top + i * plotHeight / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.fillText(format(ceiling * (4 - i) / 4), left - 6, y + 4);
  }
  const labelStep = Math.ceil(days.length / (width < 420 ? 4 : 7));
  activeChart = days.map((row, index) => {
    const value = row[metric];
    const x = left + cell * (index + .5);
    const y = top + plotHeight - (value ?? 0) * plotHeight / ceiling;
    if (value != null) {
      ctx.fillStyle = ['fatigue','sleep','rpe'].includes(metric) ? '#20957d' : '#4165ee';
      const bar = Math.min(25, cell * .62);
      ctx.fillRect(x - bar / 2, y, bar, Math.max(1, top + plotHeight - y));
    }
    if (index % labelStep === 0 || index === days.length - 1 && days.length < 15) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#53637c';
      ctx.fillText(row.day.slice(5).replace('-', '/'), x, height - 9);
    }
    return { from:left + cell * index, to:left + cell * (index + 1), ...row };
  });
  const measured = days.filter((row) => row[metric] != null);
  $('#trend-caption').textContent = label + ' · ' + unit + ' · ' + measured.length + ' 天有记录';
  $('#chart-value').textContent = measured.length ? '指向图表查看每日数值' : '这段时间暂无该指标记录';
  $('#chart-data').replaceChildren(...(measured.length
    ? measured.map((row) => el('span', row.day.slice(5) + '  ' + format(row[metric], ' ' + unit)))
    : [el('span', '暂无记录')]));
}

function calendar() {
  const days = data.training.slice(planWeek * 7, planWeek * 7 + 7);
  if (!days.some((row) => row.day === selectedDay)) selectedDay = days.find((row) => row.day === data.today)?.day ?? days[0].day;
  const completed = {done:'已完成',partial:'部分完成',logged:'已记录',imported:'已导入'};
  $('#calendar').replaceChildren(...days.map((row, index) => {
    const button = el('button', null, 'day');
    button.type = 'button';
    button.dataset.type = row.course.type;
    button.setAttribute('aria-pressed', String(row.day === selectedDay));
    button.append(el('strong', '周' + weekday[index] + ' ' + row.day.slice(5)),
      el('small', types[row.course.type] + (row.course.minutes ? ' ' + row.course.minutes + '′' : '')));
    if (row.completion) button.append(el('span', completed[row.completion], 'checkmark'));
    button.addEventListener('click', () => { selectedDay = row.day; calendar(); });
    return button;
  }));
  $('#week-toggle').textContent = planWeek ? '← 本周' : '下周 →';
  const row = days.find((item) => item.day === selectedDay);
  const course = row.course;
  const steps = course.steps.map((step) => [
    step.label, step.minutes + ' 分钟', step.watts ? step.watts.join('–') + ' W' : 'RPE ' + step.rpe,
  ].join(' · '));
  $('#day-course').textContent = [
    row.day + ' · ' + types[course.type] + (course.minutes ? ' · ' + course.minutes + ' 分钟' : ''),
    ...steps, course.reason,
  ].filter(Boolean).join('\n');
}

function activities() {
  const period = plusDay(data.today, 1 - Number($('#range').value));
  const active = data.activities.filter((row) => row.day >= period);
  const manual = data.rides.filter((row) => row.day >= period);
  const rows = active.map((row) => [row.day, row.source, format(row.durationSeconds == null ? null : row.durationSeconds / 60, ' 分钟'),
    format(row.distanceMeters == null ? null : row.distanceMeters / 1000, ' km'),
    format(row.averageWatts, ' W'), format(row.normalizedWatts, ' W'), format(row.averageHeartRate, ' bpm'), '—']);
  rows.push(...manual.map((row) => [row.day, row.source, format(row.minutes, ' 分钟'), '—', '—', '—', '—', format(row.rpe)]));
  rows.sort((a, b) => b[0].localeCompare(a[0]));
  $('#activity-rows').replaceChildren(...(rows.length ? rows.slice(0, 30).map((row) => {
    const tr = el('tr');
    tr.append(...row.map((item) => el('td', item)));
    return tr;
  }) : [el('tr')]));
  if (!rows.length) {
    const empty = el('td', '还没有骑行数据。到「同步与导入」连接 Intervals.icu 或上传 FIT。');
    empty.colSpan = 8;
    $('#activity-rows tr').append(empty);
  }
  const last = data.powerCurves.at(-1);
  const values = last ? Object.entries(last.readings).map(([seconds, watts]) => seconds + ' 秒 ' + format(watts, ' W')).join(' · ') : '';
  $('#power').textContent = ['实测最佳功率' + (last?.day ? ' · ' + last.day : ''), values || '暂无功率曲线。',
    data.ftpEstimate != null ? '参考 FTP 估计 ' + data.ftpEstimate + ' W' : ''].filter(Boolean).join('\n');
}

const chatTime = (when) => new Intl.DateTimeFormat('zh-CN', {
  timeZone:data.timezone, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
}).format(when);
function thread(result) {
  const offers = JSON.stringify(result);
  if (lastThread === offers) return;
  lastThread = offers;
  const container = $('#thread');
  const bottom = container.scrollHeight - container.scrollTop - container.clientHeight < 70;
  const makeBubble = (label, text, user) => {
    const bubble = el('div', null, 'bubble' + (user ? ' user' : ''));
    bubble.append(el('small', label), document.createTextNode(text));
    return bubble;
  };
  const items = result.turns.map((turn) => ({
    sent:turn.sent, nodes:[
      makeBubble('你 · ' + (turn.origin === 'weixin' ? '微信' : '网页') + ' · ' + chatTime(turn.sent), turn.prompt, true),
      makeBubble('教练' + (turn.status ? ' · ' + (states[turn.status] ?? turn.status) : ''), turn.reply),
    ],
  }));
  for (const job of result.reminders ?? []) {
    const labels = {pre:'课前提醒',post:'课后反馈询问',probe:'测试提醒'};
    items.push({sent:job.attempted, nodes:[
      makeBubble('微信提醒 · ' + chatTime(job.attempted) + ' · ' + (states[job.status] ?? job.status),
        job.text || labels[job.kind] + ' #' + job.id),
    ]});
  }
  items.sort((a, b) => a.sent - b.sent);
  container.replaceChildren(...(items.length ? items.flatMap((item) => item.nodes)
    : [makeBubble('教练', '哪几天能骑？告诉我你的可骑日和训练目标。')]));
  if (bottom) container.scrollTop = container.scrollHeight;
}

async function refresh() {
  data = await api('/api/dashboard');
  overview();
  drawChart();
  calendar();
  activities();
  thread(await api('/api/chat'));
}

function status(selector, message, error = false) {
  const node = $(selector);
  node.textContent = message;
  node.classList.toggle('error', error);
}

let pendingMessage;
async function say(text) {
  if (busy || !text.trim()) return false;
  busy = true;
  const button = $('#chat-form button');
  button.disabled = true;
  if (pendingMessage?.text !== text) pendingMessage = {text, id: crypto.randomUUID()};
  try {
    await api('/api/chat', {body:JSON.stringify(pendingMessage)});
    pendingMessage = null;
    return true;
  } finally {
    busy = false;
    button.disabled = false;
  }
}

$('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('#message');
  try {
    status('#chat-status', '发送中…');
    if (await say(message.value)) message.value = '';
    status('#chat-status', '');
    await refresh();
  } catch (error) {
    status('#chat-status', error.message, true);
  }
});
$('#quick').addEventListener('click', (event) => {
  if (event.target.tagName !== 'BUTTON') return;
  $('#message').value = event.target.textContent;
  $('#chat-form').requestSubmit();
});
$('#wellness-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const list = [];
  if (values.get('sleep') !== '') list.push('睡眠 ' + values.get('sleep') + ' 小时');
  if (values.get('fatigue') !== '') list.push('腿部疲劳 ' + values.get('fatigue'));
  if (!list.length) return status('#wellness-status', '请填至少一项。', true);
  try {
    if (!await say(list.join('，'))) return;
    status('#wellness-status', '恢复记录已更新。');
    await refresh();
  } catch (error) {
    status('#wellness-status', error.message, true);
  }
});
const isPowerHeader = (text) => /^\uFEFF?\s*"?(?:duration_seconds|seconds)"?\s*,/i.test(text);
const fileForm = $('#file-form');
const picker = fileForm.elements.file;
const powerButton = fileForm.querySelector('button');
let importing = false;
async function fileType(file) {
  if (/\.fit$/i.test(file.name)) return 'fit';
  if (!/\.csv$/i.test(file.name)) throw new Error('请选择 FIT 或 CSV 文件。');
  return isPowerHeader(await file.slice(0,256).text()) ? 'power' : 'activities';
}

picker.addEventListener('change', async () => {
  const file = picker.files[0];
  if (!file) return;
  try {
    const type = await fileType(file);
    if (picker.files[0] !== file) return;
    const isPower = type === 'power';
    $('#power-fields').hidden = powerButton.hidden = !isPower;
    if (!isPower) await importData(fileForm, () => requestForFile(file, type));
    else status('#import-status', '已识别为功率曲线 CSV。可设置日期，再导入。');
  } catch (error) {
    status('#import-status', error.message, true);
  }
});
async function importData(form, getRequest) {
  if (importing) return;
  importing = picker.disabled = true;
  const button = form.querySelector('button');
  button.disabled = true;
  status('#import-status', '正在处理…');
  try {
    const [url, options] = await getRequest(form);
    const result = await api(url, options);
    status('#import-status', '已新增 ' + result.added + ' 条' + (result.duplicates ? '，跳过重复 ' + result.duplicates + ' 条。' : '。'));
    if (form === fileForm) {
      fileForm.reset();
      $('#power-fields').hidden = powerButton.hidden = true;
    }
    await refresh();
  } catch (error) {
    status('#import-status', error.message, true);
  } finally {
    importing = picker.disabled = false;
    button.disabled = form.id === 'sync-form' && !data?.intervals;
  }
}
function requestForFile(file, type) {
  if (type === 'fit') {
    if (file.size > 25 * 1024 ** 2) throw new Error('FIT 上限为 25 MiB。');
    return ['/api/import/fit', {type:'application/octet-stream', body:file}];
  }
  if (type === 'activities') {
    if (file.size > 10 * 1024 ** 2) throw new Error('活动 CSV 上限为 10 MiB。');
    return ['/api/import/activities', {type:'text/csv', body:file}];
  }
  if (file.size > 2 * 1024 ** 2) throw new Error('CSV 上限为 2 MiB。');
  const fields = new FormData(fileForm);
  const params = new URLSearchParams({date:fields.get('date') || '', test:fields.get('test') ? '1' : '0'});
  return ['/api/import/power?' + params, {type:'text/csv', body:file}];
}
fileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const file = picker.files[0];
  if (file) return importData(fileForm, async () => requestForFile(file, await fileType(file)));
});
$('#sync-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  return importData(form, () => ['/api/import/intervals?days=' + new FormData(form).get('days'), {body:'{}'}]);
});
$('#week-toggle').addEventListener('click', () => { if (data) { planWeek = 1 - planWeek; calendar(); } });
$('#range').addEventListener('change', () => { if (data) { drawChart(); activities(); } });
$('#chart-tabs').addEventListener('click', (event) => {
  if (!event.target.dataset.metric) return;
  metric = event.target.dataset.metric;
  for (const button of $('#chart-tabs').children) button.setAttribute('aria-pressed', String(button === event.target));
  drawChart();
});
$('#trend').addEventListener('pointermove', (event) => {
  const row = activeChart.find(({from,to}) => event.offsetX >= from && event.offsetX < to);
  if (row) $('#chart-value').textContent = row.day + ' · ' + (row[metric] == null ? '暂无记录' : format(row[metric], ' ' + metrics[metric][1]));
});
new ResizeObserver(drawChart).observe($('.chart-wrap'));
refresh().catch((error) => status('#global-status', error.message, true));
let polls = 0;
setInterval(async () => {
  if (!data || polling || busy || document.hidden) return;
  polling = true;
  try {
    if (++polls % 3 === 0) await refresh();
    else thread(await api('/api/chat'));
  } catch {
    status('#chat-status', '暂时无法刷新对话。');
  } finally {
    polling = false;
  }
}, 4000);
