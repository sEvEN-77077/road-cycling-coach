import { createHash } from 'node:crypto';

const SESSION = 18;
const FIT_EPOCH = Date.UTC(1989, 11, 31);
const fieldsOfInterest = new Set([2, 5, 7, 8, 9, 16, 17, 20, 21, 22, 253]);

export function fitCrc(bytes) {
  let crc = 0;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xa001 : 0);
  }
  return crc;
}

function unsigned(buffer, field, offset, bigEndian) {
  const base = field.type & 31;
  if (field.size === 1 && (base === 0 || base === 2)) {
    const value = buffer[offset];
    return value === 0xff ? null : value;
  }
  if (field.size === 2 && base === 4) {
    const value = bigEndian ? buffer.readUInt16BE(offset) : buffer.readUInt16LE(offset);
    return value === 0xffff ? null : value;
  }
  if (field.size === 4 && base === 6) {
    const value = bigEndian ? buffer.readUInt32BE(offset) : buffer.readUInt32LE(offset);
    return value === 0xffffffff ? null : value;
  }
  return null;
}

function sessionRecord(fields, hash, index) {
  const start = fields.get(2);
  const startAt = start >= 0x10000000 ? new Date(FIT_EPOCH + start * 1000).toISOString() : null;
  const timer = fields.get(8);
  const elapsed = fields.get(7);
  const distance = fields.get(9);
  return {
    id: startAt ? `fit:${startAt}` : `fit:${hash}:${index}`,
    source: 'FIT',
    startAt,
    durationSeconds: timer != null ? timer / 1000 : elapsed != null ? elapsed / 1000 : null,
    durationKind: timer != null ? '计时器' : elapsed != null ? '经过时间' : null,
    distanceMeters: distance == null ? null : distance / 100,
    ascentMeters: fields.get(22) ?? null,
    averageWatts: fields.get(20) ?? null,
    maxWatts: fields.get(21) ?? null,
    averageHeartRate: fields.get(16) ?? null,
    maxHeartRate: fields.get(17) ?? null,
    powerKind: '设备报告',
  };
}

// Decode FIT activity session summaries. Other message types are skipped by
// their own definitions, including developer bytes and compressed time records.
export function readFit(buffer) {
  if (buffer.length < 14) throw new Error('FIT 文件过短。');
  const headerSize = buffer[0];
  if (![12, 14].includes(headerSize) || buffer.toString('ascii', 8, 12) !== '.FIT') {
    throw new Error('文件缺少有效的 FIT 文件头。');
  }
  const end = headerSize + buffer.readUInt32LE(4);
  if (end + 2 !== buffer.length) throw new Error('FIT 数据长度不匹配。');
  if (headerSize === 14 && buffer.readUInt16LE(12) !== 0 && fitCrc(buffer.subarray(0, 14)) !== 0) {
    throw new Error('FIT 文件头 CRC 校验失败。');
  }
  if (fitCrc(buffer) !== 0) throw new Error('FIT 文件 CRC 校验失败。');

  const definitions = new Map();
  const sessions = [];
  const hash = createHash('sha256').update(buffer).digest('hex');
  let offset = headerSize;
  function take(size) {
    if (offset + size > end) throw new Error('FIT 消息记录不完整。');
    const start = offset;
    offset += size;
    return start;
  }

  while (offset < end) {
    const header = buffer[take(1)];
    const compressed = Boolean(header & 0x80);
    const local = compressed ? (header >> 5) & 3 : header & 15;
    if (!compressed && header & 0x40) {
      const start = take(5);
      const architecture = buffer[start + 1];
      if (architecture > 1) throw new Error('FIT 定义的字节序无效。');
      const bigEndian = architecture === 1;
      const global = bigEndian ? buffer.readUInt16BE(start + 2) : buffer.readUInt16LE(start + 2);
      const fields = Array.from({ length: buffer[start + 4] }, () => {
        const index = take(3);
        return { number: buffer[index], size: buffer[index + 1], type: buffer[index + 2] };
      });
      let extra = 0;
      if (header & 0x20) {
        const fieldCount = buffer[take(1)];
        for (let n = 0; n < fieldCount; n++) extra += buffer[take(3) + 1];
      }
      definitions.set(local, { global, fields, bigEndian, extra });
      continue;
    }
    const definition = definitions.get(local);
    if (!definition) throw new Error('FIT 数据消息缺少对应定义。');
    const values = new Map();
    for (const field of definition.fields) {
      if (compressed && field.number === 253) continue;
      const position = take(field.size);
      if (definition.global === SESSION && fieldsOfInterest.has(field.number)) {
        values.set(field.number, unsigned(buffer, field, position, definition.bigEndian));
      }
    }
    take(definition.extra);
    if (definition.global === SESSION && values.get(5) === 2) {
      sessions.push(sessionRecord(values, hash, sessions.length));
    }
  }
  if (!sessions.length) throw new Error('文件里没有标记为自行车的 FIT 活动会话。');
  return sessions;
}
