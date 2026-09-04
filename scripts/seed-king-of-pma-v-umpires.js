/**
 * One-time seed: complete King of PMA V umpire registration fields.
 * Usage: node scripts/seed-king-of-pma-v-umpires.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PREFERRED_ROLES = [
  'jury_president',
  'jury_member',
  'it_umpire',
  'center_referee',
  'referee',
  'equipment_verifier'
];

const CLASSES = ['Class A', 'Class B', 'Class C', 'Class D'];

const PLACEHOLDER_RANKS = [
  '1st dan',
  '2nd dan',
  '3rd dan',
  '4th dan',
  '5th dan',
  '6th dan',
  '1st gup'
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
    if (process.env.DB_SSL_CA) {
      config.ssl = {
        ca: fs.readFileSync(path.resolve(process.env.DB_SSL_CA)),
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
      };
    } else {
      config.ssl = {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
      };
    }
  }

  return config;
}

function yearsAgoDate(years, dayOffset) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  date.setDate(date.getDate() - (dayOffset % 28));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function ensureColumns(conn) {
  const [columns] = await conn.query(
    `SELECT COLUMN_NAME AS name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'registration'
       AND COLUMN_NAME IN ('umpire_preferred_role', 'umpire_class')`
  );
  const existing = new Set(columns.map((row) => String(row.name)));
  if (!existing.has('umpire_preferred_role')) {
    await conn.query('ALTER TABLE registration ADD COLUMN umpire_preferred_role VARCHAR(64) NULL');
  }
  if (!existing.has('umpire_class')) {
    await conn.query('ALTER TABLE registration ADD COLUMN umpire_class VARCHAR(16) NULL');
  }
}

async function resolveEventId(conn) {
  const [rows] = await conn.query(
    `SELECT id, event_name
     FROM events
     WHERE event_name LIKE ?
        OR event_name LIKE ?
        OR event_name LIKE ?
     ORDER BY
       CASE
         WHEN event_name LIKE ? THEN 0
         WHEN event_name LIKE ? THEN 1
         ELSE 2
       END,
       event_date_start DESC
     LIMIT 5`,
    [
      '%King of PMA%V%',
      '%King of PMA V%',
      '%King of PMA%5%',
      '%King of PMA V%',
      '%King of PMA%V%'
    ]
  );
  if (!rows.length) {
    throw new Error('Could not find a King of PMA V event. Check events.event_name.');
  }
  console.log('Matched events:');
  rows.forEach((row) => console.log(`  ${row.id} — ${row.event_name}`));
  return rows[0];
}

async function loadCountries(conn) {
  const preferred = [
    'Canada',
    'United States',
    'Mexico',
    'Brazil',
    'Argentina',
    'Chile',
    'United Kingdom',
    'France',
    'Germany',
    'Italy',
    'Spain',
    'Poland',
    'Japan',
    'South Korea',
    'China',
    'India',
    'Philippines',
    'Thailand',
    'Australia',
    'New Zealand',
    'South Africa',
    'Egypt',
    'Nigeria',
    'Kenya'
  ];
  const [rows] = await conn.query(
    `SELECT COALESCE(NULLIF(TRIM(common_name), ''), name) AS name
     FROM teams_country
     WHERE active = 1
     ORDER BY sort_order, name`
  );
  const available = new Set(
    (rows || [])
      .map((row) => String(row.name || '').trim())
      .filter(Boolean)
  );
  const curated = preferred.filter((name) => available.has(name));
  if (curated.length >= 6) return curated;
  const fallback = Array.from(available);
  if (!fallback.length) {
    throw new Error('No countries found in teams_country table.');
  }
  return fallback;
}

async function main() {
  const conn = await mysql.createConnection(buildDbConfig());
  try {
    await ensureColumns(conn);
    const event = await resolveEventId(conn);
    const countries = await loadCountries(conn);

    const [umpires] = await conn.query(
      `SELECT id, first_name, last_name, dob, gender, \`rank\`, team_name_or_country,
              umpire_preferred_role, umpire_class
       FROM registration
       WHERE event_id = ? AND LOWER(role) = 'umpire'
       ORDER BY last_name, first_name, id`,
      [event.id]
    );

    if (!umpires.length) {
      console.log(`No umpires found for event ${event.id} (${event.event_name}).`);
      return;
    }

    console.log(`Updating ${umpires.length} umpires for ${event.event_name} (${event.id})...`);

    for (let i = 0; i < umpires.length; i += 1) {
      const row = umpires[i];
      const country = countries[i % countries.length];
      const preferredRole = PREFERRED_ROLES[i % PREFERRED_ROLES.length];
      const umpireClass = CLASSES[i % CLASSES.length];
      const gender = row.gender && String(row.gender).trim()
        ? String(row.gender).trim().toUpperCase().slice(0, 1)
        : (i % 2 === 0 ? 'M' : 'F');
      const rank = row.rank && String(row.rank).trim()
        ? String(row.rank).trim()
        : PLACEHOLDER_RANKS[i % PLACEHOLDER_RANKS.length];
      const dob = row.dob || yearsAgoDate(30 + (i % 25), i);

      await conn.query(
        `UPDATE registration
         SET team_name_or_country = ?,
             umpire_preferred_role = ?,
             umpire_class = ?,
             gender = ?,
             \`rank\` = ?,
             dob = ?
         WHERE id = ? AND event_id = ?`,
        [country, preferredRole, umpireClass, gender, rank, dob, row.id, event.id]
      );
    }

    console.log('Done.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
