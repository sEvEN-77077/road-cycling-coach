import { DAYS, parseTime, validDay } from './time.mjs';

export const HELP = `今天骑什么 / 这周怎么练 / 最近骑行 / 档案
目标是提高爬坡能力
周二、周四、周六可骑；周四 60 分钟 室内
每次 60 分钟 / 偏好 户外 / FTP 240 功率计测试 / 清除 FTP
昨晚没睡好，今天只有 45 分钟 / 睡眠 6.5 小时 / 腿部疲劳 6 / 昨天骑太狠
周六没空 / 确认 / 取消
骑完了，RPE 4 / 最后一组没完成 / 今天改休息
记录骑行 昨天 50 分钟 RPE 5 / 导入活动 / 功率曲线
开启课前提醒 07:30 / 开启课后提醒 20:30 / 暂停提醒 / 提醒状态
测试提醒 3 分钟 / 确认收到 123`;

export function expandDays(text) {
  return [...new Set([...text.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])/g)]
    .map(([, day]) => DAYS.indexOf(day === '天' ? '日' : day)))];
}

function numberField(text, pattern) {
  const value = text.match(pattern)?.[1];
  return value === undefined ? null : Number(value);
}

export function parse(text) {
  text = text.normalize('NFKC').trim().replace(/^「([^\r\n]+)」$/, '$1').trim();
  const rpe = numberField(text, /RPE\s*(-?\d+(?:\.\d+)?)/i);
  const minutes = numberField(text, /(-?\d+(?:\.\d+)?)\s*分钟/);
  const days = expandDays(text);
  const preference = text.match(/室内|户外|室外/)?.[0]?.replace('室外', '户外');
  const matchTime = text.match(/\d{1,2}:\d{2}/)?.[0];
  const receipt = text.match(/^确认收到(?:提醒)?\s*#?\s*(\d+)[。.!]?$/);
  if (receipt) return { kind: 'receipt', id: Number(receipt[1]) };
  if (/^(确认|取消)$/.test(text)) return { kind: text === '确认' ? 'confirm' : 'cancel' };
  if (/^测试提醒/.test(text)) return { kind: 'probe', minutes };
  if (/^提醒状态$/.test(text)) return { kind: 'reminderStatus' };
  if (/提醒/.test(text)) {
    const reminder = /课前|训练前/.test(text) ? 'pre' : /课后|训练后/.test(text) ? 'post' : 'both';
    if (/^暂停/.test(text)) return { kind: 'reminder', reminder, time: null };
    if (matchTime) return { kind: 'reminder', reminder, time: matchTime.padStart(5, '0') };
  }
  if (/^记录(?:骑行)?/.test(text)) {
    const date = text.match(/\d{4}-\d{2}-\d{2}|昨天|今天/)?.[0] ?? '今天';
    return { kind: 'ride', date, minutes, rpe };
  }
  if (/^(?:今天(?:就|改(?:为|成)?)?休息(?:吧|了)?|今天(?:我)?不骑了|改休息)[。!]?$/.test(text)) {
    return { kind: 'restToday' };
  }
  if (/没完成|未完成|没有完成|没骑完|少骑.*组/.test(text) && !text.includes('吗')) {
    return { kind: 'done', minutes, rpe, partial: true };
  }
  if (/骑完|训练完成|^RPE\s*\d/i.test(text)) return { kind: 'done', minutes, rpe };
  if (/清除\s*FTP/i.test(text)) return { kind: 'ftp', ftp: null, source: null };
  const ftp = text.match(/FTP\s*(?:是|设为|=)?\s*(-?\d+(?:\.\d+)?)\s*(?:W|瓦)?\s*(.*)$/i);
  if (ftp) return { kind: 'ftp', ftp: Number(ftp[1]), source: ftp[2].trim() || '手动填报（原始来源未注明）' };
  if (days.length && /没空|不能骑|不骑/.test(text)) return { kind: 'skip', days };
  const goal = (text.match(/目标\s*(?:是|为|:)?\s*([^，。；]+)/)?.[1] ??
    text.match(/想(?:要)?((?:提高|提升|改善|增强|准备|完成|挑战)[^，。；]*)/)?.[1])?.trim();
  if (days.length && (/可骑|能骑|可以骑/.test(text) || minutes !== null || preference || goal)) {
    return { kind: 'schedule', days, minutes, preference, goal, replace: /可骑|能骑|可以骑/.test(text) };
  }
  const sleepHours = numberField(text, /睡眠\s*(-?\d+(?:\.\d+)?)\s*小时/);
  const fatigue = numberField(text, /(?:腿部疲劳|腿疲劳)\s*(-?\d+(?:\.\d+)?)/);
  const poorSleep = /没睡好|睡得不好|睡眠差|睡不好|睡得很差/.test(text);
  const hard = /骑太狠|骑得太狠|骑太累|骑得太累/.test(text);
  if (poorSleep || hard || fatigue !== null || sleepHours !== null ||
      (minutes !== null && /今天|只能|只有/.test(text))) {
    return { kind: 'adjust', minutes, sleepHours, fatigue, poorSleep, hard };
  }
  if (/^每次/.test(text) && minutes !== null) return { kind: 'defaultMinutes', minutes };
  if (goal) return { kind: 'goal', goal };
  if (preference && /偏好/.test(text)) return { kind: 'preference', preference };
  if (/^(?:最近骑行|骑行记录|最近训练)$/.test(text)) return { kind: 'recent' };
  if (/^(?:导入活动|活动摘要|同步的骑行)$/.test(text)) return { kind: 'activities' };
  if (/^(?:功率曲线|功率摘要|FTP估算)$/i.test(text)) return { kind: 'power' };
  if (/这周|本周|周计划/.test(text)) return { kind: 'week' };
  if (/^(档案|我的档案)$/.test(text)) return { kind: 'profile' };
  if (/今天.*(?:骑|练|课)|^今日课程$/.test(text)) return { kind: 'today' };
  if (/^(帮助|菜单|你好|help)$/i.test(text)) return { kind: 'help' };
  return null;
}

const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const optional = (value, check) => value == null || check(value);

export function validate(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return false;
  const { kind, minutes, days, rpe, preference, goal } = command;
  const validMinutes = optional(minutes, (value) => inRange(value, 0, 360));
  const validRpe = optional(rpe, (value) => inRange(value, 0, 10));
  const validDays = Array.isArray(days) && days.length >= 1 && days.length <= 7 &&
    new Set(days).size === days.length && days.every((day) => inRange(day, 0, 6));
  const validPreference = optional(preference, (value) => ['室内', '户外'].includes(value));
  const validGoal = optional(goal, (value) => typeof value === 'string' && value.trim().length >= 1 &&
    value.length <= 100 && !/[\r\n]/.test(value));
  switch (kind) {
    case 'schedule':
      return validDays && validMinutes && validPreference && validGoal && typeof command.replace === 'boolean';
    case 'skip': return validDays;
    case 'goal': return goal != null && validGoal;
    case 'preference': return preference != null && validPreference;
    case 'defaultMinutes': return inRange(minutes, 10, 360);
    case 'adjust':
      return validMinutes && optional(command.fatigue, (value) => inRange(value, 0, 10)) &&
        optional(command.sleepHours, (value) => typeof value === 'number' && value >= 0 && value <= 24) &&
        optional(command.poorSleep, (value) => typeof value === 'boolean') &&
        optional(command.hard, (value) => typeof value === 'boolean') &&
        (minutes != null || command.fatigue != null || command.sleepHours != null ||
          command.poorSleep === true || command.hard === true);
    case 'ftp':
      return command.ftp === null || (inRange(command.ftp, 50, 600) && typeof command.source === 'string' &&
        command.source.trim().length > 0 && command.source.length <= 100 && !/[\r\n]/.test(command.source));
    case 'ride':
      return inRange(minutes, 1, 360) && validRpe && typeof command.date === 'string' &&
        (['今天', '昨天'].includes(command.date) || validDay(command.date));
    case 'done': return optional(minutes, (value) => inRange(value, 1, 360)) && validRpe &&
      optional(command.partial, (value) => typeof value === 'boolean');
    case 'reminder':
      return ['pre', 'post', 'both'].includes(command.reminder) &&
        (command.time === null || (command.reminder !== 'both' && typeof command.time === 'string' &&
          parseTime(command.time) !== null));
    case 'probe': return inRange(minutes, 1, 60);
    case 'receipt': return Number.isSafeInteger(command.id) && command.id > 0;
    default: return ['confirm', 'cancel', 'week', 'today', 'recent', 'profile', 'help', 'reminderStatus', 'restToday', 'activities', 'power'].includes(kind);
  }
}
