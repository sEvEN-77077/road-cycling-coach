import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA busy_timeout = 3000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS state (
      rider TEXT PRIMARY KEY, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inbound (
      rider TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(rider,id)
    );
    CREATE TABLE IF NOT EXISTS chat_turns (
      id INTEGER PRIMARY KEY, rider TEXT NOT NULL, origin TEXT NOT NULL,
      sent INTEGER NOT NULL, prompt TEXT NOT NULL, reply TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_turns_rider_id ON chat_turns(rider,id);
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY, rider TEXT NOT NULL, slot TEXT NOT NULL, kind TEXT NOT NULL,
      due INTEGER NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempted INTEGER, finished INTEGER, confirmed INTEGER, detail TEXT,
      UNIQUE(rider, slot)
    );
    CREATE TABLE IF NOT EXISTS job_messages (
      job INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, text TEXT NOT NULL
    );
  `);
  const get = (rider) => {
    const row = db.prepare('SELECT data FROM state WHERE rider = ?').get(rider);
    return row ? JSON.parse(row.data) : {
      profile: { goal: '', ftp: null, ftpSource: null, days: {}, preference: '', preferences: {} },
      plans: {}, readiness: {}, rides: [], activities: [], powerCurves: [], courses: {},
      pending: null, reminders: { pre: null, post: null },
      contact: null,
    };
  };
  const put = (rider, data) => db.prepare(`
    INSERT INTO state(rider,data) VALUES(?,?) ON CONFLICT(rider) DO UPDATE SET data = excluded.data
  `).run(rider, JSON.stringify(data));

  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return { db, get, put, transaction, close: () => db.close() };
}
