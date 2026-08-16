require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const EVENT_ID = 4; // King of PMA V
const COUNTS = {
  athlete: 350,
  umpire: 50,
  vip: 10,
  coach: 50,
  team: 12, // stored as role=athlete with team events / team-style names
  medical: 8,
  volunteer: 15
};

const FIRST = [
  'Alex', 'Jordan', 'Sam', 'Chris', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery',
  'Quinn', 'Parker', 'Reese', 'Drew', 'Skyler', 'Cameron', 'Hayden', 'Logan', 'Noah', 'Emma',
  'Olivia', 'Liam', 'Sophia', 'Mason', 'Isabella', 'Ethan', 'Mia', 'Lucas', 'Charlotte', 'James',
  'Amelia', 'Benjamin', 'Harper', 'Elijah', 'Evelyn', 'William', 'Abigail', 'Henry', 'Emily', 'Sebastian'
];
const LAST = [
  'Kim', 'Lee', 'Patel', 'Nguyen', 'Singh', 'Chen', 'Garcia', 'Martinez', 'Brown', 'Wilson',
  'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker'
];
const RANKS = [
  '10th gup', '9th gup', '8th gup', '7th gup', '6th gup', '5th gup', '4th gup', '3rd gup', '2nd gup', '1st gup',
  '1st dan', '2nd dan', '3rd dan', '4th dan', '5th dan', '6th dan'
];

function sqlStr(v) {
  if (v == null) return 'NULL';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dobFromSeed(i, minAge, maxAge) {
  const age = minAge + (i % (maxAge - minAge + 1));
  const year = 2026 - age;
  const month = 1 + (i % 12);
  const day = 1 + (i % 28);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function pick(arr, i) {
  return arr[i % arr.length];
}

function weightFor(i, gender) {
  const base = gender === 'F' ? 52 : 68;
  return (base + (i % 35) + (i % 7) * 0.25).toFixed(2);
}

function heightFor(i, gender) {
  const base = gender === 'F' ? 155 : 168;
  return (base + (i % 30) + (i % 5) * 0.5).toFixed(2);
}

function athleteEvents(i) {
  // Event offers: individual_patterns; individual_sparring; team_sparring; special_training_event
  const patterns = i % 3 !== 2 ? 1 : 0;
  const sparring = i % 2 === 0 ? 1 : 0;
  const special = 0;
  const power = 0;
  const teamPat = 0;
  const teamSpar = 0;
  const teamSpec = 0;
  const teamPow = 0;
  const pre = 0;
  let other = null;
  if (!patterns && !sparring) {
    other = 'special_training_event';
  } else if (i % 7 === 0) {
    other = 'special_training_event';
  }
  return { patterns, sparring, special, power, teamPat, teamSpar, teamSpec, teamPow, pre, other };
}

function teamRoleEvents(i) {
  return {
    patterns: 0,
    sparring: 0,
    special: 0,
    power: 0,
    teamPat: i % 2 === 0 ? 1 : 0,
    teamSpar: 1,
    teamSpec: 0,
    teamPow: 0,
    pre: 0,
    other: null
  };
}

function emptyEvents() {
  return {
    patterns: 0, sparring: 0, special: 0, power: 0,
    teamPat: 0, teamSpar: 0, teamSpec: 0, teamPow: 0, pre: 0, other: null
  };
}

function rowValues({
  role, email, first, last, dob, rank, gender, weight, height, team, events, waiver = 1
}) {
  const e = events || emptyEvents();
  return [
    EVENT_ID,
    sqlStr('1'),
    sqlStr(role),
    email == null ? 'NULL' : sqlStr(email),
    sqlStr(first),
    sqlStr(last),
    dob == null ? 'NULL' : sqlStr(dob),
    rank == null ? 'NULL' : sqlStr(rank),
    gender == null ? 'NULL' : sqlStr(gender),
    weight == null ? 'NULL' : weight,
    height == null ? 'NULL' : height,
    team == null ? 'NULL' : sqlStr(team),
    e.patterns,
    e.sparring,
    e.special,
    e.power,
    e.teamPat,
    e.teamSpar,
    e.teamSpec,
    e.teamPow,
    e.pre,
    e.other == null ? 'NULL' : sqlStr(e.other),
    waiver,
    waiver ? sqlStr('2026-07-01 12:00:00') : 'NULL'
  ].join(', ');
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 3306,
    ssl: { rejectUnauthorized: false }
  });

  const [clubs] = await conn.query(
    'SELECT name FROM teams_club WHERE active = 1 ORDER BY sort_order, name'
  );
  const [countries] = await conn.query(
    'SELECT name FROM teams_country WHERE active = 1 ORDER BY sort_order, name'
  );
  const [provinces] = await conn.query(
    'SELECT name FROM teams_province WHERE active = 1 ORDER BY sort_order, name'
  );
  await conn.end();

  const clubNames = clubs.map((r) => r.name).filter(Boolean);
  const countryNames = countries.map((r) => r.name).filter(Boolean);
  const provinceNames = provinces.map((r) => r.name).filter(Boolean);

  if (!clubNames.length || !countryNames.length || !provinceNames.length) {
    throw new Error('Expected active rows in teams_club, teams_country, and teams_province');
  }

  // Mix: ~50% clubs, ~25% provinces, ~25% countries
  const mixedTeams = [];
  const maxLen = Math.max(clubNames.length, provinceNames.length, countryNames.length) * 4;
  for (let i = 0; i < maxLen; i++) {
    const bucket = i % 4;
    if (bucket === 0 || bucket === 1) mixedTeams.push(pick(clubNames, i));
    else if (bucket === 2) mixedTeams.push(pick(provinceNames, i));
    else mixedTeams.push(pick(countryNames, i));
  }

  const values = [];
  let n = 0;

  // Athletes
  for (let i = 0; i < COUNTS.athlete; i++, n++) {
    const gender = i % 2 === 0 ? 'M' : 'F';
    const events = athleteEvents(i);
    values.push(`(${rowValues({
      role: 'athlete',
      email: `athlete${i + 1}@example.test`,
      first: pick(FIRST, i),
      last: pick(LAST, i * 3 + 1),
      dob: dobFromSeed(i, 8, 55),
      rank: pick(RANKS, i),
      gender,
      weight: weightFor(i, gender),
      height: heightFor(i, gender),
      team: pick(mixedTeams, i),
      events
    })})`);
  }

  // Team-role entries (role=team; first_name = club/team name; last_name = members)
  for (let i = 0; i < COUNTS.team; i++, n++) {
    const gender = i % 3 === 0 ? 'X' : (i % 2 === 0 ? 'M' : 'F');
    const teamLabel = pick(clubNames, i + 7);
    const members = [
      pick(LAST, i),
      pick(LAST, i + 11),
      pick(LAST, i + 19),
      pick(LAST, i + 23)
    ].join(', ');
    values.push(`(${rowValues({
      role: 'team',
      email: `team${i + 1}@example.test`,
      first: teamLabel,
      last: `(${members})`,
      dob: dobFromSeed(i + 100, 13, 25),
      rank: i % 2 === 0 ? '1st gup' : '1st dan',
      gender,
      weight: null,
      height: null,
      team: teamLabel,
      events: teamRoleEvents(i)
    })})`);
  }

  // Coaches
  for (let i = 0; i < COUNTS.coach; i++, n++) {
    const gender = i % 2 === 0 ? 'M' : 'F';
    values.push(`(${rowValues({
      role: 'coach',
      email: null,
      first: pick(FIRST, i + 5),
      last: pick(LAST, i + 9),
      dob: dobFromSeed(i + 200, 22, 60),
      rank: pick(RANKS.slice(8), i),
      gender,
      weight: null,
      height: null,
      team: pick(mixedTeams, i + 17),
      events: emptyEvents()
    })})`);
  }

  // Umpires
  for (let i = 0; i < COUNTS.umpire; i++, n++) {
    const gender = i % 2 === 0 ? 'M' : 'F';
    values.push(`(${rowValues({
      role: 'umpire',
      email: null,
      first: pick(FIRST, i + 11),
      last: pick(LAST, i + 13),
      dob: dobFromSeed(i + 300, 20, 65),
      rank: pick(RANKS.slice(9), i),
      gender,
      weight: null,
      height: null,
      team: pick(mixedTeams, i + 41),
      events: emptyEvents()
    })})`);
  }

  // VIPs
  for (let i = 0; i < COUNTS.vip; i++, n++) {
    values.push(`(${rowValues({
      role: 'vip',
      email: null,
      first: pick(FIRST, i + 21),
      last: pick(LAST, i + 27),
      dob: null,
      rank: null,
      gender: null,
      weight: null,
      height: null,
      team: pick(countryNames, i),
      events: emptyEvents()
    })})`);
  }

  // Medical
  for (let i = 0; i < COUNTS.medical; i++, n++) {
    values.push(`(${rowValues({
      role: 'medical',
      email: null,
      first: pick(FIRST, i + 31),
      last: pick(LAST, i + 33),
      dob: null,
      rank: null,
      gender: null,
      weight: null,
      height: null,
      team: pick(provinceNames, i),
      events: emptyEvents()
    })})`);
  }

  // Volunteers
  for (let i = 0; i < COUNTS.volunteer; i++, n++) {
    values.push(`(${rowValues({
      role: 'volunteer',
      email: null,
      first: pick(FIRST, i + 37),
      last: pick(LAST, i + 39),
      dob: null,
      rank: null,
      gender: null,
      weight: null,
      height: null,
      team: pick(clubNames, i),
      events: emptyEvents()
    })})`);
  }

  const header = `-- Seed registrations for King of PMA V (event_id = ${EVENT_ID})
-- Generated ${new Date().toISOString()}
-- Counts: ${JSON.stringify(COUNTS)}
-- Teams sourced from teams_club (${clubNames.length}), teams_province (${provinceNames.length}), teams_country (${countryNames.length})
-- Assumes registration table has been truncated (or you delete event 4 rows first).
--
-- Optional cleanup for this event only:
-- DELETE FROM registration WHERE event_id = ${EVENT_ID};

INSERT INTO registration (
  event_id, active, role, contact_email, first_name, last_name, dob, \`rank\`, gender,
  weight_kg, height_kg, team_name_or_country,
  individual_patterns, individual_sparring, individual_special_technique, individual_power_test,
  team_patterns, team_sparring, team_special_technique, team_power_test, pre_arranged_sparring,
  other_events, waiver_accepted, waiver_accepted_at
) VALUES
`;

  const sql = `${header}${values.join(',\n')};\n`;
  const outPath = path.join(__dirname, 'seed_registrations_event4.sql');
  fs.writeFileSync(outPath, sql, 'utf8');

  const summary = {
    eventId: EVENT_ID,
    totalRows: values.length,
    counts: COUNTS,
    teamsUsed: {
      clubs: clubNames.length,
      provinces: provinceNames.length,
      countries: countryNames.length,
      sampleClubs: clubNames.slice(0, 8),
      sampleProvinces: provinceNames.slice(0, 8),
      sampleCountries: countryNames.slice(0, 8)
    },
    outPath
  };
  console.log(JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
