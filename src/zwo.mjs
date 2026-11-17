import { TYPES } from './training.mjs';

const decimal = (value) => value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

export function exportZwo(course) {
  if (!course.minutes || !Object.hasOwn(TYPES, course.type)) throw new Error('今天是休息日。');
  if (course.steps.some((step) => step.ftpRatio == null)) throw new Error('先设置并确认 FTP，再导出功率课表。');
  if (course.steps.reduce((sum, step) => sum + step.minutes, 0) !== course.minutes) {
    throw new Error('课表时长校验失败。');
  }
  const steps = course.steps.map(({ label, minutes, ftpRatio: [low, high] }) => {
    const duration = minutes * 60;
    if (label === '热身') return `    <Warmup Duration="${duration}" PowerLow="${decimal(low)}" PowerHigh="${decimal(high)}"/>`;
    if (label === '冷身') return `    <Cooldown Duration="${duration}" PowerLow="${decimal(high)}" PowerHigh="${decimal(low)}"/>`;
    return `    <SteadyState Duration="${duration}" Power="${decimal((low + high) / 2)}"/>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<workout_file>',
    '  <author>Road Cycling Coach</author>',
    `  <name>${TYPES[course.type]} ${course.minutes} 分钟</name>`,
    '  <sportType>bike</sportType>',
    '  <workout>',
    ...steps,
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}
