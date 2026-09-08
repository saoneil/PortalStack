/**
 * Dummy umpires for event 20 (umpire assignment testing).
 * Usage: node scripts/seed-event-20-umpire-test.js
 *
 * Replaces all umpires on event 20 with 10 sample names. Does not change the schedule.
 */
require('dotenv').config();

const mysql = require('mysql2/promise');

const EVENT_ID = 20;
const EMAIL_SUFFIX = '@event20.umpire.test';

const SAMPLE_UMPIRES = [
  { first: 'Rafael', last: 'Morales', role: 'jury_president', cls: 'Class A', rank: '6th dan', gender: 'M', country: 'Spain' },
  { first: 'Helena', last: 'Novak', role: 'jury_member', cls: 'Class A', rank: '5th dan', gender: 'F', country: 'Czech Republic' },
  { first: 'Min-jun', last: 'Park', role: 'it_umpire', cls: 'Class B', rank: '4th dan', gender: 'M', country: 'South Korea' },
  { first: 'Sofia', last: 'Rossi', role: 'center_referee', cls: 'Class B', rank: '4th dan', gender: 'F', country: 'Italy' },
  { first: 'Omar', last: 'Hassan', role: 'referee', cls: 'Class C', rank: '3rd dan', gender: 'M', country: 'Egypt' },
  { first: 'Ingrid', last: 'Berg', role: 'referee', cls: 'Class C', rank: '3rd dan', gender: 'F', country: 'Sweden' },
  { first: 'Luis', last: 'Fernandez', role: 'center_referee', cls: 'Class B', rank: '5th dan', gender: 'M', country: 'Argentina' },
  { first: 'Amina', last: 'Diallo', role: 'equipment_verifier', cls: 'Class D', rank: '2nd dan', gender: 'F', country: 'Senegal' },
  { first: 'Tomas', last: 'Kowalski', role: 'referee', cls: 'Class C', rank: '2nd dan', gender: 'M', country: 'Poland' },
  { first: 'Mei', last: 'Wong', role: 'it_umpire', cls: 'Class B', rank: '1st dan', gender: 'F', country: 'Australia' }
];

function buildDbConfig() {
  let host = String(process.env.DB_HOST || '').trim();
  if (host === 'localhost') host = '127.0.0.1';
  const port = Number(process.env.DB_PORT) || 3306;
  const sslEnv = String(process.env.DB_SSL || '').trim().toLowerCase();
  const useSsl = sslEnv === '1' || sslEnv === 'true' || sslEnv === 'required'
    || (sslEnv !== '0' && sslEnv !== 'false' && host.includes('aivencloud.com'));

  const config = {
    host,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 15000
  };

  if (useSsl) {
    config.ssl = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
    };
  }

  return config;
}

function yearsAgoDate(years, dayOffset) {
  const date = new Date(Date.UTC(2026, 8, 28));
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - (dayOffset % 28));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  const conn = await mysql.createConnection(buildDbConfig());
  try {
    const [events] = await conn.query(
      'SELECT id, client_id, event_name FROM events WHERE id = ? LIMIT 1',
      [EVENT_ID]
    );
    if (!events.length) {
      throw new Error(`Event ${EVENT_ID} was not found.`);
    }
    const event = events[0];
    console.log(`Seeding umpires for ${event.event_name} (event ${event.id}, client ${event.client_id})`);

    const [deleted] = await conn.query(
      `DELETE FROM registration
       WHERE event_id = ? AND LOWER(role) = 'umpire'`,
      [EVENT_ID]
    );
    console.log(`Removed ${deleted.affectedRows} existing umpires.`);

    await conn.query(
      'DELETE FROM umpire_assignments WHERE event_id = ? AND client_id = ?',
      [String(EVENT_ID), String(event.client_id)]
    );

    const now = new Date();
    const values = SAMPLE_UMPIRES.map((u, i) => [
      EVENT_ID,
      '1',
      'umpire',
      `umpire.${String(i + 1).padStart(2, '0')}${EMAIL_SUFFIX}`,
      u.first,
      u.last,
      yearsAgoDate(28 + (i % 22), i),
      u.rank,
      u.gender,
      u.country,
      1,
      now,
      u.role,
      u.cls
    ]);

    await conn.query(
      `INSERT INTO registration (
         event_id, active, role, contact_email, first_name, last_name, dob, \`rank\`,
         gender, team_name_or_country, waiver_accepted, waiver_accepted_at,
         umpire_preferred_role, umpire_class
       ) VALUES ?`,
      [values]
    );
    console.log(`Inserted ${SAMPLE_UMPIRES.length} sample umpires.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
