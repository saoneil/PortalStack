/**
 * Fill missing contact_email values for King of PMA V registrations (all roles).
 * Usage: node scripts/seed-king-of-pma-v-emails.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

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

function slugPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'user';
}

async function main() {
  const conn = await mysql.createConnection(buildDbConfig());
  try {
    const [events] = await conn.query(
      `SELECT id, event_name
       FROM events
       WHERE event_name LIKE ?
       ORDER BY event_date_start DESC
       LIMIT 1`,
      ['%King of PMA%V%']
    );
    if (!events.length) {
      throw new Error('Could not find King of PMA V event.');
    }
    const event = events[0];

    const [rows] = await conn.query(
      `SELECT id, role, first_name, last_name, contact_email
       FROM registration
       WHERE event_id = ?
       ORDER BY role, last_name, first_name, id`,
      [event.id]
    );

    const counters = Object.create(null);
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const existing = String(row.contact_email || '').trim();
      if (existing) {
        skipped += 1;
        continue;
      }

      const role = slugPart(row.role || 'registrant');
      counters[role] = (counters[role] || 0) + 1;
      const first = slugPart(row.first_name);
      const last = slugPart(row.last_name);
      const email = `${role}.${first}.${last}.${counters[role]}@example.test`;

      await conn.query(
        `UPDATE registration SET contact_email = ? WHERE id = ? AND event_id = ?`,
        [email, row.id, event.id]
      );
      updated += 1;
    }

    console.log(`Event: ${event.event_name} (${event.id})`);
    console.log(`Updated ${updated} registrations with sample emails.`);
    console.log(`Left ${skipped} registrations that already had emails.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
