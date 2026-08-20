require('dotenv').config();

if (!process.env.SESSION_SECRET || !process.env.SESSION_SECRET.trim()) {
  console.error('FATAL: SESSION_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const dns = require('dns');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const MySQLStore = require('express-mysql-session')(session);
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const multer = require('multer');

// Prefer IPv4 first — dual-stack DNS lookups often delay remote DB connects on Windows.
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const app = express();
app.set('trust proxy', 1); // trust first proxy
app.disable('x-powered-by');

// Force HTTPS in production (needed for Heroku proxy deployments)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:', "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        // Same-origin iframe for the Draw Creation modal on /landing.
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'no-referrer' }
  })
);

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use('/css', express.static(path.join(__dirname, 'css'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  }
}));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/js', express.static(path.join(__dirname, 'js'), {
  setHeaders(res) {
    // Avoid stale module graphs after tool updates (esp. embed iframe).
    res.setHeader('Cache-Control', 'no-store');
  }
}));

// multer configuration for file uploads (memory storage, PNG only, 5MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG images are allowed'));
    }
  }
});





// mysql DB connection pool (auto-reconnects, survives deadlocks)
function buildDbPoolConfig() {
  let host = String(process.env.DB_HOST || '').trim();
  if (host === 'localhost' || host === '::1') host = '127.0.0.1';

  const port = Number(process.env.DB_PORT) || 3306;
  const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000;
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT) || 50;
  const isLocalHost = host === '127.0.0.1';
  const sslEnv = String(process.env.DB_SSL || '').trim().toLowerCase();
  const sslEnabled = sslEnv
    ? !['0', 'false', 'off', 'disable', 'disabled'].includes(sslEnv)
    : !isLocalHost; // cloud hosts (e.g. Aiven) almost always require TLS

  const config = {
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port,
    waitForConnections: true,
    connectionLimit,
    queueLimit: 0,
    connectTimeout,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };

  if (sslEnabled) {
    if (process.env.DB_SSL_CA) {
      // Prefer verifying with the provider CA (e.g. Aiven console → ca.pem).
      config.ssl = {
        ca: fs.readFileSync(path.resolve(process.env.DB_SSL_CA)),
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
      };
    } else {
      // Without a CA file, Aiven and similar hosts often fail with
      // "self-signed certificate in certificate chain" under system CAs.
      // Still use TLS; set DB_SSL_CA (or DB_SSL_REJECT_UNAUTHORIZED=true) to verify.
      config.ssl = {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
      };
    }
  }

  return config;
}

const db = mysql.createPool(buildDbPoolConfig());

// verify pool connectivity at startup (non-fatal)
const dbConnectStartedAt = Date.now();
db.getConnection((err, connection) => {
  const elapsedMs = Date.now() - dbConnectStartedAt;
  if (err) {
    console.error(`MySQL initial connection error after ${elapsedMs}ms (will retry on next request):`, err.code || err.message);
  } else {
    console.log(`Connected to MySQL in ${elapsedMs}ms`);
    connection.release();
  }
});

// Helper to insert a log record
function insertLog(userId, interactionLog, ipAddress) {
  const sql = 'INSERT INTO app_log (user_id, log_datetime, interaction_log, ip_address) VALUES (?, NOW(), ?, ?)';
  const logJson = typeof interactionLog === 'string' ? interactionLog : JSON.stringify(interactionLog);
  db.query(sql, [userId || null, logJson, ipAddress || null], (err) => {
    if (err) console.error('Logging error:', err);
  });
}

// mysql session store (reuse the shared pool)
const sessionStore = new MySQLStore({
  expiration: 1000 * 60 * 60 * 24,
  createDatabaseTable: process.env.DB_SESSION_CREATE_TABLE !== 'false',
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  schema: {
    tableName: 'sessions'
  }
}, db);

// session config
app.use(session({
  name: 'portal.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

// CSRF: for authenticated mutating requests, require Origin or Referer to match the request host.
// Public routes (registration, login, signup) are excluded since they don't require a session.
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_PUBLIC_PREFIXES = ['/register', '/submit-registration', '/index', '/signup', '/public'];
app.use((req, res, next) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();
  if (!req.session || !req.session.loggedIn) return next();
  const isPublic = CSRF_PUBLIC_PREFIXES.some((prefix) => req.path.startsWith(prefix));
  if (isPublic) return next();

  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  const host = req.headers['host'];

  let sourceHost = null;
  try {
    if (origin && origin !== 'null') sourceHost = new URL(origin).host;
    else if (referer) sourceHost = new URL(referer).host;
  } catch (_) { /* malformed header */ }

  if (!sourceHost || sourceHost !== host) {
    return res.status(403).json({ error: 'Request origin not permitted.' });
  }
  next();
});

// login rate limiter
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  message: 'Too many login attempts. Please try again in 10 minutes',
  skipSuccessfulRequests: true
});

// signup rate limiter
const signupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  message: 'Too many registration attempts. Please try again in 10 minutes',
  skipSuccessfulRequests: true
});

// public interaction log rate limiter
const publicLogLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: 'Too many public log requests. Please try again shortly.'
});

// public event registration API rate limiter
const registrationApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: 'Too many registration requests. Please try again shortly.'
});

const registrationSubmitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  message: 'Too many registration submissions. Please try again in 10 minutes.'
});

const liveScheduleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many live schedule requests. Please try again shortly.'
});

function toNullableString(value, maxLength) {
  if (value == null) return null;
  const trimmed = String(value)
    .replace(/\0/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>'"`;\\]/g, '')
    .trim();
  if (!trimmed) return null;
  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const ALLOWED_ROLES = ['athlete', 'team', 'coach', 'umpire', 'vip', 'medical', 'volunteer'];

const ATHLETE_EVENT_FIELDS = [
  'individualPatterns',
  'individualSparring',
  'individualSpecialTechnique',
  'individualPowerTest',
  'teamPatterns',
  'teamSparring',
  'teamSpecialTechnique',
  'teamPowerTest',
  'preArrangedSparring'
];

const ALLOWED_EVENT_TYPE_KEYS = [
  'individual_patterns',
  'individual_sparring',
  'individual_special_technique',
  'individual_power_test',
  'team_patterns',
  'team_sparring',
  'team_special_technique',
  'team_power_test',
  'pre_arranged_sparring'
];

function sanitizeEventTypeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 40);
}

function isValidEventTypeKey(key) {
  if (!key) return false;
  if (ALLOWED_EVENT_TYPE_KEYS.includes(key)) return true;
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(key);
}

function parseEventEventsValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const keys = value
      .map((item) => sanitizeEventTypeKey(item))
      .filter(Boolean);
    const uniqueKeys = [];
    keys.forEach((key) => {
      if (uniqueKeys.indexOf(key) === -1) uniqueKeys.push(key);
    });
    if (uniqueKeys.length === 0) return null;
    const invalid = uniqueKeys.filter((key) => !isValidEventTypeKey(key));
    if (invalid.length > 0) return { error: 'One or more selected events are invalid.' };
    const joined = uniqueKeys.join(';');
    if (joined.length > 1000) return { error: 'Too many events selected. Please remove some and try again.' };
    return joined;
  }

  const trimmed = toNullableString(value, 1000);
  if (!trimmed) return null;
  const keys = trimmed
    .split(';')
    .map((part) => sanitizeEventTypeKey(part))
    .filter(Boolean);
  const uniqueKeys = [];
  keys.forEach((key) => {
    if (uniqueKeys.indexOf(key) === -1) uniqueKeys.push(key);
  });
  if (uniqueKeys.length === 0) return null;
  const invalid = uniqueKeys.filter((key) => !isValidEventTypeKey(key));
  if (invalid.length > 0) return { error: 'One or more selected events are invalid.' };
  const joined = uniqueKeys.join(';');
  if (joined.length > 1000) return { error: 'Too many events selected. Please remove some and try again.' };
  return joined;
}

function parseOtherEventsValue(value) {
  let rawParts = [];
  if (Array.isArray(value)) {
    rawParts = value;
  } else if (value != null && value !== '') {
    rawParts = String(value).split(/[:;]/);
  } else {
    return null;
  }

  const keys = [];
  rawParts.forEach((part) => {
    const key = sanitizeEventTypeKey(part);
    if (!key) return;
    if (ALLOWED_EVENT_TYPE_KEYS.includes(key)) return;
    if (!isValidEventTypeKey(key)) return;
    if (keys.indexOf(key) === -1) keys.push(key);
  });

  if (keys.length === 0) return null;

  const joined = keys.join(':');
  if (joined.length > 1000) {
    return { error: 'Too many additional events selected. Please remove some and try again.' };
  }
  return joined;
}

function parseTeamMemberLastNames(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^\(+/, '')
    .replace(/\)+$/, '')
    .trim();
  const names = cleaned
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (names.length < 3 || names.length > 5) {
    return { error: 'Enter 3 to 5 team member last names, separated by commas.' };
  }
  const formatted = `(${names.join(', ')})`;
  if (formatted.length > 100) {
    return { error: 'Team member last names are too long. Please shorten them.' };
  }
  return { value: formatted, names };
}

function toNullableDate(value) {
  const trimmed = toNullableString(value);
  if (!trimmed) return null;
  if (!isValidCalendarDate(trimmed)) return null;
  return trimmed;
}

function isValidCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function toNullableDecimal(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function toTinyIntFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

const WAIVER_TEXT_MAX_LENGTH = 50000;

// Preserve newlines/tabs for waiver documents; strip other control chars and nulls.
function toWaiverText(value, maxLength) {
  if (value == null) return null;
  let text = String(value).replace(/\0/g, '');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  text = text.trim();
  if (!text) return null;
  const limit = maxLength == null ? WAIVER_TEXT_MAX_LENGTH : maxLength;
  return text.slice(0, limit);
}

function parseWaiverFields(body) {
  const waiverText = toWaiverText(body && body.waiverText);
  const waiverRequired = toTinyIntFlag(body && body.waiverRequired);
  if (waiverRequired && !waiverText) {
    return { error: 'Waiver text is required when requiring a waiver for registration.' };
  }
  return { waiverText, waiverRequired: waiverRequired && waiverText ? 1 : 0 };
}

function isEventOpenForRegistration(events, eventId) {
  return (events || []).some((eventRow) => String(eventRow.id) === String(eventId));
}

const PUBLIC_REGISTRATION_EVENTS_SQL = `
  SELECT
    id,
    client_id,
    event_name,
    event_name AS \`Event Name\`,
    event_date_start,
    event_date_start AS \`Start Date\`,
    event_date_end,
    event_date_end AS \`End Date\`,
    registration_open_date,
    registration_open_date AS \`Registration Open Date\`,
    registration_close_date,
    registration_close_date AS \`Registration Close Date\`,
    event_location,
    event_location AS Location,
    event_events,
    event_link,
    event_contact,
    LENGTH(event_poster) > 0 AS has_poster,
    CRC32(event_poster) AS poster_version,
    CASE
      WHEN waiver_required = 1 AND LENGTH(TRIM(COALESCE(waiver_text, ''))) > 0 THEN 1
      ELSE 0
    END AS waiver_required,
    LENGTH(TRIM(COALESCE(waiver_text, ''))) > 0 AS has_waiver
  FROM events
  WHERE active = 1
    AND COALESCE(event_date_end, event_date_start) >= CURDATE()
  ORDER BY event_date_start ASC, event_name ASC
`;

function fetchPublicRegistrationEvents(callback) {
  db.query(PUBLIC_REGISTRATION_EVENTS_SQL, (err, results) => {
    if (err) return callback(err);
    callback(null, results || []);
  });
}

function verifyEventEligibleForPublicRegistration(eventId, callback) {
  const sql = `
    SELECT id FROM events
    WHERE id = ?
      AND active = 1
      AND COALESCE(event_date_end, event_date_start) >= CURDATE()
  `;
  db.query(sql, [eventId], (err, results) => {
    if (err) return callback(err);
    callback(null, results && results.length > 0);
  });
}

// auth middleware
function requireLogin(req, res, next) {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
}

function normalizeUserFlag(value) {
  if (value === true || value === 1 || value === '1') return 1;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.length && value[0] === 1 ? 1 : 0;
  }
  return Number(value) === 1 ? 1 : 0;
}

function lookupUserFlags(username, clientId, callback) {
  const emptyFlags = { principleUser: 0, principleUserAdvanced: 0 };
  if (!username) {
    callback(emptyFlags);
    return;
  }

  // Admin accounts can log into any client; their users row may not share that client_id.
  // Prefer an exact client match, otherwise fall back to the admin/username account flag.
  const sql = `
    SELECT principle_user, principle_user_advanced, admin_flag, client_id
    FROM users
    WHERE username = ?
      AND (client_id = ? OR admin_flag = 1 OR client_id = '0' OR client_id = 0)
    ORDER BY
      CASE WHEN client_id = ? THEN 0 ELSE 1 END,
      admin_flag DESC,
      principle_user DESC,
      principle_user_advanced DESC
    LIMIT 1
  `;

  db.query(sql, [username, clientId, clientId], (err, rows) => {
    if (err) {
      console.error(err);
      callback(emptyFlags);
      return;
    }
    if (!rows[0]) {
      callback(emptyFlags);
      return;
    }
    callback({
      principleUser: normalizeUserFlag(rows[0].principle_user),
      principleUserAdvanced: normalizeUserFlag(rows[0].principle_user_advanced)
    });
  });
}

function lookupPrincipleUser(username, clientId, callback) {
  lookupUserFlags(username, clientId, (flags) => {
    callback(flags.principleUser);
  });
}

app.use('/html/pricing', express.static(path.join(__dirname, 'html', 'pricing')));
app.use('/html/payments', requireLogin, express.static(path.join(__dirname, 'html', 'payments')));
app.use('/html/release_notes', requireLogin, express.static(path.join(__dirname, 'html', 'release_notes')));





// basic routes
app.get('/', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  res.sendFile(path.join(__dirname, 'html', 'index.html'));
});

app.get('/login', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  if (req.session.loggedIn) {
    res.redirect('/landing');
  } else {
    res.sendFile(path.join(__dirname, 'html', 'login.html'));
  }
});

app.post('/index', loginLimiter, (req, res) => {
  const { client, username, password } = req.body;

  const sql = 'CALL sp_auth_login(?, ?)'; // only client, username

  db.query(sql, [client, username], async (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'A database error occurred. Please try again shortly.' });
    }

    if (!results[0].length) {
      return res.status(401).json({ error: 'Invalid credentials for this client' });
    }

    const user = results[0][0];

    const match = await bcrypt.compare(password, user.password_hash || user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials for this client' });
    }

    const finishLogin = (flags) => {
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error('session regenerate failed:', regenErr);
          return res.status(500).json({ error: 'Login failed. Please try again.' });
        }
        req.session.loggedIn = true;
        req.session.clientId = user.client_id;
        // Store the client name provided during login for display purposes
        req.session.clientName = client;
        req.session.username = username;
        req.session.principleUser = flags.principleUser;
        req.session.principleUserAdvanced = flags.principleUserAdvanced;

        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('session save failed:', saveErr);
            return res.status(500).json({ error: 'Login failed. Please try again.' });
          }
          insertLog(username, { action: 'login', client: client, username: username }, req.ip);
          res.json({ success: true, redirect: '/landing' });
        });
      });
    };

    // Always resolve user flags from the users table so admin accounts
    // (which can authenticate into any client) are evaluated correctly.
    lookupUserFlags(username, user.client_id, finishLogin);
  });
});

app.get('/signup', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  res.sendFile(path.join(__dirname, 'html', 'signup.html'));
});

const RESERVED_USERNAMES = new Set(['admin', 'administrator']);

app.post('/signup', signupLimiter, async (req, res) => {
  const { client, username, password } = req.body;

  if (RESERVED_USERNAMES.has(String(username || '').trim().toLowerCase())) {
    return res.status(400).json({ error: 'That username is invalid. Please choose a different one.' });
  }

  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = 'CALL sp_admin_register_user(?, ?, ?)';
    db.query(sql, [client, username, hashedPassword], (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'A database error occurred. Please try again shortly.' });
      }
      insertLog(username, { action: 'signup', client: client, username: username }, req.ip);
      res.json({ success: true, redirect: '/html/registration_successful.html' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred during registration. Please try again shortly.' });
  }
});

// One-time admin password reset. Disabled unless ADMIN_RESET_TOKEN is set in .env.
// Usage: POST /admin-reset with JSON { "token": "<ADMIN_RESET_TOKEN>", "password": "<new password>" }
// Remove ADMIN_RESET_TOKEN from .env after use.
app.post('/admin-reset', async (req, res) => {
  const resetToken = process.env.ADMIN_RESET_TOKEN;
  if (!resetToken || !resetToken.trim()) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const { token, password } = req.body;
  if (!token || token !== resetToken) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  if (!password) {
    return res.status(400).json({ error: 'Password required.' });
  }
  try {
    const hash = await bcrypt.hash(String(password), 10);
    db.query(
      `INSERT INTO users (username, password, client_id, admin_flag, principle_user, principle_user_advanced, date_added)
       VALUES (?, ?, '1', 1, 1, 1, NOW())`,
      ['admin', hash],
      (err, result) => {
        if (err) {
          console.error('admin-reset db error:', err);
          return res.status(500).json({ error: 'Database error.' });
        }
        insertLog('admin', { action: 'admin-reset', note: 'admin user created via reset endpoint', insertId: result.insertId }, req.ip);
        res.json({ success: true, insertId: result.insertId, message: 'Admin user created. Update the id if needed, then remove ADMIN_RESET_TOKEN from .env.' });
      }
    );
  } catch (err) {
    console.error('admin-reset error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.get('/landing', requireLogin, (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.sendFile(path.join(__dirname, 'html', 'landing.html'));
});

app.get('/division-advanced', requireLogin, requireAdvancedPage, (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.sendFile(path.join(__dirname, 'html', 'division-advanced.html'));
});

app.get('/html/registration_successful.html', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.sendFile(path.join(__dirname, 'html', 'registration_successful.html'));
});

app.get('/registration', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.sendFile(path.join(__dirname, 'html', 'registration.html'));
});

app.get('/registration/:eventId', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.sendFile(path.join(__dirname, 'html', 'registration.html'));
});

app.get('/live-schedule', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.sendFile(path.join(__dirname, 'html', 'live-schedule.html'));
});

app.get('/live-schedule/:clientId/:eventId', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.sendFile(path.join(__dirname, 'html', 'live-schedule.html'));
});

app.get('/umpire-management', requireLogin, requireAdvancedPage, (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.sendFile(path.join(__dirname, 'html', 'umpire-management.html'));
});

app.get('/digital-id/:clientId/:eventId', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.sendFile(path.join(__dirname, 'html', 'digital-id.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'html', 'privacy.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'html', 'terms.html'));
});

app.get('/logout', (req, res) => {
  const username = req.session.username || null;
  const clientName = req.session.clientName || null;
  insertLog(username, { action: 'logout', client: clientName }, req.ip);
  req.session.destroy(() => {
    res.redirect('/');
  });
});





// api routes for grid data
app.get('/api/grid-data', requireLogin, (req, res) => {
  const clientId = req.session.clientId;

  const sql = 'CALL sp_pub_grid_appinstances(?)';
  db.query(sql, [clientId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results[0]); // assuming single result set
  });
});

// profile endpoint to return current client's profile info
app.get('/api/profile', requireLogin, (req, res) => {
  const username = req.session.username || null;
  const clientId = req.session.clientId;

  lookupUserFlags(username, clientId, (flags) => {
    req.session.principleUser = flags.principleUser;
    req.session.principleUserAdvanced = flags.principleUserAdvanced;
    res.json({
      clientName: req.session.clientName || null,
      clientId: clientId || null,
      username: username,
      principleUser: flags.principleUser,
      principleUserAdvanced: flags.principleUserAdvanced,
      timezone: req.session.timezone || null
    });
  });
});

function isValidIanaTimeZone(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (_) {
    return false;
  }
}

app.post('/api/profile/timezone', requireLogin, (req, res) => {
  const timezone = toNullableString(req.body && req.body.timezone, 64);
  if (!timezone || !isValidIanaTimeZone(timezone)) {
    return res.status(400).json({ error: 'A valid IANA timezone is required.' });
  }
  req.session.timezone = timezone;
  res.json({ ok: true, timezone });
});

function attachEventEventsToRows(rows, callback) {
  const events = rows || [];
  if (events.length === 0) {
    callback(null, events);
    return;
  }

  const eventIds = events
    .map((eventRow) => {
      if (eventRow.id != null) return eventRow.id;
      if (eventRow.ID != null) return eventRow.ID;
      if (eventRow.event_id != null) return eventRow.event_id;
      return eventRow['Event ID'] != null ? eventRow['Event ID'] : null;
    })
    .filter((eventId) => eventId != null);

  if (eventIds.length === 0) {
    callback(null, events);
    return;
  }

  const sql = 'SELECT id, event_events, event_link, LENGTH(event_poster) > 0 AS has_poster, event_date_start, event_date_end, registration_open_date, registration_close_date, event_location FROM events WHERE id IN (?)';
  db.query(sql, [eventIds], (err, eventRows) => {
    if (err) {
      callback(err);
      return;
    }

    const eventsById = Object.create(null);
    (eventRows || []).forEach((eventRow) => {
      eventsById[String(eventRow.id)] = {
        event_events: eventRow.event_events,
        event_link: eventRow.event_link,
        has_poster: eventRow.has_poster === 1,
        event_date_start: eventRow.event_date_start,
        event_date_end: eventRow.event_date_end,
        registration_open_date: eventRow.registration_open_date,
        registration_close_date: eventRow.registration_close_date,
        event_location: eventRow.event_location
      };
    });

    events.forEach((eventRow) => {
      const eventId = eventRow.id != null ? eventRow.id
        : eventRow.ID != null ? eventRow.ID
        : eventRow.event_id != null ? eventRow.event_id
        : eventRow['Event ID'];
      if (eventId == null) return;
      const eventData = eventsById[String(eventId)];
      if (eventData) {
        eventRow.event_events = eventData.event_events || null;
        eventRow.event_link = eventData.event_link || null;
        eventRow.has_poster = eventData.has_poster || false;
        if (eventData.event_date_start != null && eventData.event_date_start !== '') {
          eventRow.event_date_start = eventData.event_date_start;
        }
        if (eventData.event_date_end != null && eventData.event_date_end !== '') {
          eventRow.event_date_end = eventData.event_date_end;
        }
        if (eventData.registration_open_date != null && eventData.registration_open_date !== '') {
          eventRow.registration_open_date = eventData.registration_open_date;
        }
        if (eventData.registration_close_date != null && eventData.registration_close_date !== '') {
          eventRow.registration_close_date = eventData.registration_close_date;
        }
        if (eventData.event_location != null && eventData.event_location !== '') {
          eventRow.event_location = eventData.event_location;
        }
      }
    });

    callback(null, events);
  });
}

// Public event registration — stateless; no session data stored per user
app.get('/api/registration/events', registrationApiLimiter, (req, res) => {
  fetchPublicRegistrationEvents((err, events) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to load events. Please try again shortly.' });
    }
    res.json(events);
  });
});

app.get('/api/registration/teams', registrationApiLimiter, (req, res) => {
  const sql = `
    SELECT category, name FROM (
      SELECT
        'country' AS category,
        COALESCE(NULLIF(TRIM(common_name), ''), name) AS name,
        sort_order
      FROM teams_country
      WHERE active = 1
      UNION ALL
      SELECT 'club' AS category, name, sort_order FROM teams_club WHERE active = 1
      UNION ALL
      SELECT 'province' AS category, name, sort_order FROM teams_province WHERE active = 1
    ) AS teams
    ORDER BY
      CASE category
        WHEN 'country' THEN 1
        WHEN 'club' THEN 2
        WHEN 'province' THEN 3
        ELSE 4
      END,
      sort_order,
      name
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to load teams. Please try again shortly.' });
    }

    const clubs = [];
    const provinces = [];
    const countries = [];
    (rows || []).forEach((row) => {
      const name = String(row.name || '').trim();
      if (!name) return;
      if (row.category === 'club') clubs.push(name);
      else if (row.category === 'province') provinces.push(name);
      else if (row.category === 'country') countries.push(name);
    });

    res.json({ clubs, provinces, countries });
  });
});

app.get('/api/registration/events/:id/poster', registrationApiLimiter, (req, res) => {
  const eventId = req.params.id;
  
  const sql = 'SELECT event_poster FROM events WHERE id = ?';
  db.query(sql, [eventId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error loading poster');
    }
    
    if (!results || results.length === 0 || !results[0].event_poster) {
      return res.status(404).send('Poster not found');
    }

    // Registration page appends ?v=CRC32 so poster updates bust browser cache.
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(results[0].event_poster);
  });
});

app.get('/api/registration/events/:id/waiver', registrationApiLimiter, (req, res) => {
  const eventId = toNullableString(req.params.id, 45);
  if (!eventId) {
    return res.status(400).json({ error: 'Event id is required.' });
  }

  verifyEventEligibleForPublicRegistration(eventId, (err, isEligible) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to load waiver. Please try again shortly.' });
    }
    if (!isEligible) {
      return res.status(404).json({ error: 'Waiver not found.' });
    }

    const sql = `
      SELECT
        waiver_text,
        CASE
          WHEN waiver_required = 1 AND LENGTH(TRIM(COALESCE(waiver_text, ''))) > 0 THEN 1
          ELSE 0
        END AS waiver_required
      FROM events
      WHERE id = ?
    `;
    db.query(sql, [eventId], (queryErr, results) => {
      if (queryErr) {
        console.error(queryErr);
        return res.status(500).json({ error: 'Unable to load waiver. Please try again shortly.' });
      }
      if (!results || !results.length) {
        return res.status(404).json({ error: 'Waiver not found.' });
      }

      const row = results[0];
      const waiverText = row.waiver_text || null;
      if (!waiverText || !String(waiverText).trim()) {
        return res.status(404).json({ error: 'Waiver not found.' });
      }

      res.json({
        waiverText: String(waiverText),
        waiverRequired: Number(row.waiver_required) === 1
      });
    });
  });
});

const { createStore: createDivisionStore } = require('./lib/division-tool/store');
const { buildPdfFilesFromState } = require('./lib/division-tool/draws-pdf');
const { ALL_DRAWS_PDF_FILENAME } = require('./lib/division-tool/constants');
const registrationDivisionStore = createDivisionStore(db);

function catalogHasDrawAthletes(drawsState) {
  return !!(drawsState && Array.isArray(drawsState.catalog)
    && drawsState.catalog.some((entry) => Number(entry.athlete_count || 0) > 0));
}

function loadPublicRegistrationEventMeta(eventId, callback) {
  const sql = `
    SELECT id, client_id, event_name
    FROM events
    WHERE id = ?
      AND active = 1
      AND COALESCE(event_date_end, event_date_start) >= CURDATE()
    LIMIT 1
  `;
  db.query(sql, [eventId], (err, results) => {
    if (err) return callback(err);
    if (!results || !results.length) return callback(null, null);
    const row = results[0];
    callback(null, {
      id: String(row.id),
      clientId: String(row.client_id || '').trim(),
      eventName: row.event_name || ''
    });
  });
}

app.get('/api/registration/events/:id/resources', registrationApiLimiter, async (req, res) => {
  const eventId = toNullableString(req.params.id, 45);
  if (!eventId) {
    return res.status(400).json({ error: 'Event id is required.' });
  }

  loadPublicRegistrationEventMeta(eventId, async (err, eventMeta) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to load event resources. Please try again shortly.' });
    }
    if (!eventMeta || !eventMeta.clientId) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    try {
      const loaded = await registrationDivisionStore.loadDraws(eventId, eventMeta.clientId);
      const hasDraws = catalogHasDrawAthletes(loaded && loaded.state);
      const schedule = await registrationDivisionStore.loadPublicSchedule(eventMeta.clientId, eventId);
      const hasSchedule = !!(schedule && schedule.state);

      res.json({
        eventId: eventMeta.id,
        clientId: eventMeta.clientId,
        hasDraws,
        hasSchedule,
        drawsPdfUrl: hasDraws
          ? `/api/registration/events/${encodeURIComponent(eventMeta.id)}/draws.pdf`
          : null,
        digitalIdUrl: hasDraws
          ? `/digital-id/${encodeURIComponent(eventMeta.clientId)}/${encodeURIComponent(eventMeta.id)}`
          : null,
        liveScheduleUrl: hasSchedule
          ? `/live-schedule/${encodeURIComponent(eventMeta.clientId)}/${encodeURIComponent(eventMeta.id)}`
          : null
      });
    } catch (loadErr) {
      console.error(loadErr);
      res.status(500).json({ error: 'Unable to load event resources. Please try again shortly.' });
    }
  });
});

app.get('/api/registration/events/:id/draws.pdf', registrationApiLimiter, (req, res) => {
  const eventId = toNullableString(req.params.id, 45);
  if (!eventId) {
    return res.status(400).json({ error: 'Event id is required.' });
  }

  loadPublicRegistrationEventMeta(eventId, async (err, eventMeta) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to load draws. Please try again shortly.' });
    }
    if (!eventMeta || !eventMeta.clientId) {
      return res.status(404).json({ error: 'Draws not found.' });
    }

    try {
      const loaded = await registrationDivisionStore.loadDraws(eventId, eventMeta.clientId);
      const drawsState = loaded && loaded.state;
      if (!catalogHasDrawAthletes(drawsState)) {
        return res.status(404).json({ error: 'Draws not found.' });
      }

      const pdfFiles = await buildPdfFilesFromState(drawsState, { eventName: eventMeta.eventName || '' });
      const pdfBuffer = pdfFiles && pdfFiles[ALL_DRAWS_PDF_FILENAME];
      if (!pdfBuffer || !pdfBuffer.length) {
        return res.status(404).json({ error: 'Draws not found.' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${ALL_DRAWS_PDF_FILENAME}"`);
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.send(pdfBuffer);
    } catch (pdfErr) {
      console.error(pdfErr);
      res.status(500).json({ error: 'Unable to build draws PDF. Please try again shortly.' });
    }
  });
});

app.post('/api/registration/submit', registrationSubmitLimiter, (req, res) => {
  const body = req.body || {};
  const eventId = toNullableString(body.eventId, 45);
  const role = toNullableString(body.role, 45);
  const firstName = toNullableString(body.firstName, 100);
  let lastName = toNullableString(body.lastName, 100);

  if (!eventId) {
    return res.status(400).json({ error: 'Please select an event.' });
  }
  if (!role || !ALLOWED_ROLES.includes(role.toLowerCase())) {
    return res.status(400).json({ error: 'Please select a valid role.' });
  }
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First name and last name are required.' });
  }

  const roleKey = role.toLowerCase();
  const isAthlete = roleKey === 'athlete';
  const isTeam = roleKey === 'team';
  let contactEmail = null;
  let dob = null;
  let rank = null;
  let gender = null;
  let weightKg = null;
  let heightKg = null;
  let teamNameOrCountry = null;
  const eventFlags = {};
  let otherEvents = null;

  function yearsAgoDate(years) {
    const date = new Date();
    date.setFullYear(date.getFullYear() - Number(years));
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (isAthlete) {
    contactEmail = toNullableString(body.contactEmail, 100);
    if (!contactEmail || !isValidEmail(contactEmail)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    dob = toNullableDate(body.dob);
    if (!dob) {
      return res.status(400).json({ error: 'Please enter a valid date of birth. The day, month, or year is not correct.' });
    }

    rank = toNullableString(body.rank, 8);
    if (!rank) {
      return res.status(400).json({ error: 'Rank is required.' });
    }

    gender = toNullableString(body.gender, 1);
    if (!gender || !['M', 'F', 'm', 'f'].includes(gender)) {
      return res.status(400).json({ error: 'Gender is required.' });
    }
    gender = gender.toUpperCase();

    weightKg = toNullableDecimal(body.weightKg);
    heightKg = toNullableDecimal(body.heightKg);
    if (weightKg == null || heightKg == null) {
      return res.status(400).json({ error: 'Weight and height are required.' });
    }

    teamNameOrCountry = toNullableString(body.teamNameOrCountry, 100);
    if (!teamNameOrCountry) {
      return res.status(400).json({ error: 'Team name or country is required.' });
    }

    ATHLETE_EVENT_FIELDS.forEach((field) => {
      eventFlags[field] = toTinyIntFlag(body[field]);
    });
    // Team division events are registered via the team role only.
    ['teamPatterns', 'teamSparring', 'teamSpecialTechnique', 'teamPowerTest']
      .forEach((field) => { eventFlags[field] = 0; });

    const parsedOtherEvents = parseOtherEventsValue(body.otherEvents);
    if (parsedOtherEvents && parsedOtherEvents.error) {
      return res.status(400).json({ error: parsedOtherEvents.error });
    }
    otherEvents = parsedOtherEvents || null;

    const hasSelectedEvent = ATHLETE_EVENT_FIELDS.some((field) => eventFlags[field] === 1)
      || !!otherEvents;
    if (!hasSelectedEvent) {
      return res.status(400).json({ error: 'Please select at least one event.' });
    }
  } else if (isTeam) {
    contactEmail = toNullableString(body.contactEmail, 100);
    if (!contactEmail || !isValidEmail(contactEmail)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    gender = toNullableString(body.gender, 1);
    if (!gender || !['M', 'F', 'X', 'm', 'f', 'x'].includes(gender)) {
      return res.status(400).json({ error: 'Gender is required (m, f, or mixed).' });
    }
    gender = gender.toUpperCase();

    const ageRange = String(body.ageRange || '').trim().toLowerCase();
    const ageYears = { 'pre-junior': 13, junior: 16, adult: 25 }[ageRange];
    if (ageYears) {
      dob = yearsAgoDate(ageYears);
    } else {
      dob = toNullableDate(body.dob);
    }

    const rankBand = String(body.rankBand || '').trim().toLowerCase();
    if (rankBand === 'gup') rank = '1st gup';
    else if (rankBand === 'dan') rank = '1st dan';
    else rank = toNullableString(body.rank, 8);

    const membersParsed = parseTeamMemberLastNames(lastName);
    if (membersParsed.error) {
      return res.status(400).json({ error: membersParsed.error });
    }
    // first_name = team name; last_name = "(member, member, ...)"
    lastName = membersParsed.value;

    teamNameOrCountry = firstName;
    weightKg = null;
    heightKg = null;

    ATHLETE_EVENT_FIELDS.forEach((field) => {
      eventFlags[field] = toTinyIntFlag(body[field]);
    });
    ['individualPatterns', 'individualSparring', 'individualSpecialTechnique', 'individualPowerTest', 'preArrangedSparring']
      .forEach((field) => { eventFlags[field] = 0; });

    const parsedTeamOtherEvents = parseOtherEventsValue(body.otherEvents);
    if (parsedTeamOtherEvents && parsedTeamOtherEvents.error) {
      return res.status(400).json({ error: parsedTeamOtherEvents.error });
    }
    otherEvents = parsedTeamOtherEvents || null;

    const hasSelectedTeamEvent = ['teamPatterns', 'teamSparring', 'teamSpecialTechnique', 'teamPowerTest']
      .some((field) => eventFlags[field] === 1) || !!otherEvents;
    if (!hasSelectedTeamEvent) {
      return res.status(400).json({ error: 'Please select at least one event.' });
    }
  } else if (roleKey === 'coach' || roleKey === 'umpire') {
    dob = toNullableDate(body.dob);
    if (!dob) {
      return res.status(400).json({ error: 'Please enter a valid date of birth. The day, month, or year is not correct.' });
    }

    rank = toNullableString(body.rank, 8);
    if (!rank) {
      return res.status(400).json({ error: 'Rank is required.' });
    }

    gender = toNullableString(body.gender, 1);
    if (!gender || !['M', 'F', 'm', 'f'].includes(gender)) {
      return res.status(400).json({ error: 'Gender is required.' });
    }
    gender = gender.toUpperCase();

    teamNameOrCountry = toNullableString(body.teamNameOrCountry, 100);
    if (!teamNameOrCountry) {
      return res.status(400).json({ error: 'Team name or country is required.' });
    }

    ATHLETE_EVENT_FIELDS.forEach((field) => {
      eventFlags[field] = 0;
    });
  } else {
    ATHLETE_EVENT_FIELDS.forEach((field) => {
      eventFlags[field] = 0;
    });
  }

  verifyEventEligibleForPublicRegistration(eventId, (err, isEligible) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to verify event. Please try again shortly.' });
    }

    if (!isEligible) {
      return res.status(400).json({ error: 'Selected event is not open for registration.' });
    }

    const waiverSql = `
      SELECT
        waiver_text,
        CASE
          WHEN LENGTH(TRIM(COALESCE(waiver_text, ''))) > 0 THEN 1
          ELSE 0
        END AS waiver_required
      FROM events
      WHERE id = ?
    `;

    db.query(waiverSql, [eventId], (waiverErr, waiverRows) => {
      if (waiverErr) {
        console.error(waiverErr);
        return res.status(500).json({ error: 'Unable to verify event waiver. Please try again shortly.' });
      }

      const waiverRow = waiverRows && waiverRows[0];
      const waiverRequired = waiverRow && Number(waiverRow.waiver_required) === 1;
      const clientAccepted = toTinyIntFlag(body.waiverAccepted) === 1;

      if (waiverRequired && !clientAccepted) {
        return res.status(400).json({ error: 'You must accept the event waiver before registering.' });
      }

      const waiverAccepted = waiverRequired && clientAccepted ? 1 : 0;

      // Teams compete — store as athlete so they are included in competition tooling
      const storedRole = isTeam ? 'athlete' : roleKey;

      const sql = 'INSERT INTO registration (event_id, active, role, contact_email, first_name, last_name, dob, `rank`, gender, weight_kg, height_kg, team_name_or_country, individual_patterns, individual_sparring, individual_special_technique, individual_power_test, team_patterns, team_sparring, team_special_technique, team_power_test, pre_arranged_sparring, other_events, waiver_accepted, waiver_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

      const params = [
        eventId,
        '1',
        storedRole,
        contactEmail,
        firstName,
        lastName,
        dob,
        rank,
        gender,
        weightKg,
        heightKg,
        teamNameOrCountry,
        eventFlags.individualPatterns,
        eventFlags.individualSparring,
        eventFlags.individualSpecialTechnique,
        eventFlags.individualPowerTest,
        eventFlags.teamPatterns,
        eventFlags.teamSparring,
        eventFlags.teamSpecialTechnique,
        eventFlags.teamPowerTest,
        eventFlags.preArrangedSparring,
        otherEvents,
        waiverAccepted,
        waiverAccepted ? new Date() : null
      ];

      db.query(sql, params, (insertErr, insertResult) => {
        if (insertErr) {
          console.error(insertErr);
          const sqlMessage = String(insertErr.sqlMessage || '').toLowerCase();
          if (insertErr.code === 'ER_TRUNCATED_WRONG_VALUE' && sqlMessage.includes('dob')) {
            return res.status(400).json({ error: 'Please enter a valid date of birth. The day, month, or year is not correct.' });
          }
          return res.status(500).json({ error: 'Unable to save registration. Please try again shortly.' });
        }

        insertLog(null, {
          action: 'event_registration_submit',
          page: 'registration',
          eventId: eventId,
          role: storedRole,
          registrationSourceRole: roleKey,
          registrationId: insertResult.insertId || null,
          waiverAccepted: waiverAccepted
        }, req.ip);

        res.json({
          success: true,
          registrationId: insertResult.insertId || null
        });
      });
    });
  });
});

// Public interaction logs are limited to unauthenticated entry pages.
app.post('/api/public-log', publicLogLimiter, (req, res) => {
  const interaction = req.body.interaction || {};
  const publicPages = ['index', 'login', 'signup', 'registration_successful', 'registration', 'live-schedule'];

  if (!publicPages.includes(interaction.page)) {
    return res.status(403).json({ error: 'Public logging is not allowed for this page' });
  }

  insertLog(null, interaction, req.ip);
  res.json({ ok: true });
});

// API endpoint to log authenticated client-side interactions
app.post('/api/log', requireLogin, (req, res) => {
  const interaction = req.body.interaction || {};
  insertLog(req.session.username, interaction, req.ip);
  res.json({ ok: true });
});

// API endpoint to list release notes HTML files
app.get('/api/release-notes-list', requireLogin, (req, res) => {
  const notesDir = path.join(__dirname, 'html', 'release_notes');
  fs.readdir(notesDir, (err, files) => {
    if (err) {
      return res.json([]);
    }
    const htmlFiles = files.filter(f => f.endsWith('.html'));
    res.json(htmlFiles);
  });
});

// API endpoint to list events owned by the authenticated client
app.get('/api/client-events', requireLogin, (req, res) => {
  const clientId = req.session.clientId;
  const sql = 'SELECT id, active, event_name, event_date_start, event_date_end, registration_open_date, registration_close_date, event_location, event_events, event_link, event_contact, LENGTH(event_poster) > 0 AS has_poster, waiver_required, waiver_text FROM events WHERE client_id = ? ORDER BY event_date_start ASC, event_name ASC';

  db.query(sql, [clientId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to load events. Please try again shortly.' });
    }
    res.json(results || []);
  });
});

// API endpoint to update an event owned by the authenticated client
app.post('/api/client-events/:eventId', requireLogin, upload.single('eventPoster'), (req, res) => {
  const clientId = req.session.clientId;
  const eventId = req.params.eventId;
  const body = req.body || {};
  
  const eventName = toNullableString(body.eventName, 100);
  const eventDateStart = toNullableDate(body.eventDateStart);
  const eventDateEnd = toNullableDate(body.eventDateEnd);
  const registrationOpenDate = toNullableDate(body.registrationOpenDate);
  const registrationCloseDate = toNullableDate(body.registrationCloseDate);
  const eventLocation = toNullableString(body.eventLocation, 100);
  const eventLink = toNullableString(body.eventLink, 255);
  const eventContact = toNullableString(body.eventContact, 100);
  const parsedWaiver = parseWaiverFields(body);
  if (parsedWaiver.error) {
    return res.status(400).json({ error: parsedWaiver.error });
  }
  const waiverText = parsedWaiver.waiverText;
  const waiverRequired = parsedWaiver.waiverRequired;
  
  let parsedEventEvents;
  try {
    parsedEventEvents = parseEventEventsValue(body.eventEvents ? JSON.parse(body.eventEvents) : null);
  } catch (e) {
    parsedEventEvents = parseEventEventsValue(body.eventEvents);
  }
  if (parsedEventEvents && parsedEventEvents.error) {
    return res.status(400).json({ error: parsedEventEvents.error });
  }
  const eventEvents = parsedEventEvents;
  
  if (!eventName) {
    return res.status(400).json({ error: 'Event name is required.' });
  }
  if (!eventDateStart) {
    return res.status(400).json({ error: 'Event start date is required.' });
  }
  if (!eventDateEnd) {
    return res.status(400).json({ error: 'Event end date is required.' });
  }
  if (!registrationOpenDate) {
    return res.status(400).json({ error: 'Registration open date is required.' });
  }
  if (!registrationCloseDate) {
    return res.status(400).json({ error: 'Registration close date is required.' });
  }
  if (!eventLocation) {
    return res.status(400).json({ error: 'Event location is required.' });
  }
  
  const verifySQL = 'SELECT id FROM events WHERE id = ? AND client_id = ?';
  db.query(verifySQL, [eventId, clientId], (err, eventResults) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to verify event ownership. Please try again shortly.' });
    }
    
    if (!eventResults || eventResults.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to edit this event.' });
    }
    
    const eventPoster = req.file ? req.file.buffer : null;
    
    let sql, params;
    if (eventPoster) {
      sql = 'UPDATE events SET active = 0, event_name = ?, event_date_start = ?, event_date_end = ?, registration_open_date = ?, registration_close_date = ?, event_location = ?, event_events = ?, event_link = ?, event_contact = ?, event_poster = ?, waiver_required = ?, waiver_text = ? WHERE id = ? AND client_id = ?';
      params = [eventName, eventDateStart, eventDateEnd, registrationOpenDate, registrationCloseDate, eventLocation, eventEvents, eventLink, eventContact, eventPoster, waiverRequired, waiverText, eventId, clientId];
    } else {
      sql = 'UPDATE events SET active = 0, event_name = ?, event_date_start = ?, event_date_end = ?, registration_open_date = ?, registration_close_date = ?, event_location = ?, event_events = ?, event_link = ?, event_contact = ?, waiver_required = ?, waiver_text = ? WHERE id = ? AND client_id = ?';
      params = [eventName, eventDateStart, eventDateEnd, registrationOpenDate, registrationCloseDate, eventLocation, eventEvents, eventLink, eventContact, waiverRequired, waiverText, eventId, clientId];
    }
    
    db.query(sql, params, (updateErr) => {
      if (updateErr) {
        console.error(updateErr);
        return res.status(500).json({ error: 'Unable to update event. Please try again shortly.' });
      }
      
      insertLog(req.session.username, {
        action: 'event_update_request',
        page: 'landing',
        eventName: eventName,
        eventId: eventId
      }, req.ip);
      
      res.json({
        success: true,
        message: 'Event updated successfully. It will be reviewed and reactivated, usually within 24-48 hours.'
      });
    });
  });
});

// API endpoint to get registrations for a specific event owned by the authenticated client
app.get('/api/client-events/:eventId/registrations', requireLogin, (req, res) => {
  const clientId = req.session.clientId;
  const eventId = req.params.eventId;
  
  // First verify the event belongs to this client
  const verifySQL = 'SELECT id FROM events WHERE id = ? AND client_id = ?';
  db.query(verifySQL, [eventId, clientId], (err, eventResults) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to verify event ownership. Please try again shortly.' });
    }
    
    if (!eventResults || eventResults.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to view registrations for this event.' });
    }
    
    // Fetch registrations for this event, excluding internal IDs and active flag
    const sql = 'SELECT role, contact_email, first_name, last_name, dob, `rank`, gender, weight_kg, height_kg, team_name_or_country, individual_patterns, individual_sparring, individual_special_technique, individual_power_test, team_patterns, team_sparring, team_special_technique, team_power_test, pre_arranged_sparring, other_events, waiver_accepted, waiver_accepted_at FROM registration WHERE event_id = ? ORDER BY role, last_name, first_name';
    
    db.query(sql, [eventId], (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Unable to load registrations. Please try again shortly.' });
      }
      res.json(results || []);
    });
  });
});

// API endpoint to create a new event request
app.post('/api/client-events', requireLogin, upload.single('eventPoster'), (req, res) => {
  const clientId = req.session.clientId;
  const body = req.body || {};
  
  const eventName = toNullableString(body.eventName, 100);
  const eventDateStart = toNullableDate(body.eventDateStart);
  const eventDateEnd = toNullableDate(body.eventDateEnd);
  const registrationOpenDate = toNullableDate(body.registrationOpenDate);
  const registrationCloseDate = toNullableDate(body.registrationCloseDate);
  const eventLocation = toNullableString(body.eventLocation, 100);
  const eventLink = toNullableString(body.eventLink, 255);
  const eventContact = toNullableString(body.eventContact, 100);
  const parsedWaiver = parseWaiverFields(body);
  if (parsedWaiver.error) {
    return res.status(400).json({ error: parsedWaiver.error });
  }
  const waiverText = parsedWaiver.waiverText;
  const waiverRequired = parsedWaiver.waiverRequired;
  
  let parsedEventEvents;
  try {
    parsedEventEvents = parseEventEventsValue(body.eventEvents ? JSON.parse(body.eventEvents) : null);
  } catch (e) {
    parsedEventEvents = parseEventEventsValue(body.eventEvents);
  }
  if (parsedEventEvents && parsedEventEvents.error) {
    return res.status(400).json({ error: parsedEventEvents.error });
  }
  const eventEvents = parsedEventEvents;
  
  // Validate required fields
  if (!eventName) {
    return res.status(400).json({ error: 'Event name is required.' });
  }
  if (!eventDateStart) {
    return res.status(400).json({ error: 'Event start date is required.' });
  }
  if (!eventDateEnd) {
    return res.status(400).json({ error: 'Event end date is required.' });
  }
  if (!registrationOpenDate) {
    return res.status(400).json({ error: 'Registration open date is required.' });
  }
  if (!registrationCloseDate) {
    return res.status(400).json({ error: 'Registration close date is required.' });
  }
  if (!eventLocation) {
    return res.status(400).json({ error: 'Event location is required.' });
  }
  
  const eventPoster = req.file ? req.file.buffer : null;
  
  const sql = 'INSERT INTO events (active, client_id, event_name, event_date_start, event_date_end, registration_open_date, registration_close_date, event_location, event_events, event_link, event_contact, event_poster, waiver_required, waiver_text) VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  
  const params = [
    clientId,
    eventName,
    eventDateStart,
    eventDateEnd,
    registrationOpenDate,
    registrationCloseDate,
    eventLocation,
    eventEvents,
    eventLink,
    eventContact,
    eventPoster,
    waiverRequired,
    waiverText
  ];
  
  db.query(sql, params, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to create event. Please try again shortly.' });
    }
    
    insertLog(req.session.username, {
      action: 'event_creation_request',
      page: 'landing',
      eventName: eventName,
      eventId: result.insertId || null
    }, req.ip);
    
    res.json({
      success: true,
      eventId: result.insertId || null,
      message: 'Event created successfully. It will be reviewed and activated, usually within 24-48 hours.'
    });
  });
});









const {
  registerDivisionAdvancedRoutes,
  createRequirePrincipleUser,
  createRequirePrincipleUserAdvanced
} = require('./lib/division-tool/routes');
const { registerLiveScheduleRoutes } = require('./lib/division-tool/live-schedule-routes');
const { displayDurationMinutes } = require('./lib/division-tool/schedule');

const requirePrincipleUser = createRequirePrincipleUser(lookupUserFlags);
const requirePrincipleUserAdvanced = createRequirePrincipleUserAdvanced(lookupUserFlags);

// Page-level Advanced gate: redirects to /landing instead of returning JSON 403.
function requireAdvancedPage(req, res, next) {
  if (Number(req.session.principleUserAdvanced) === 1) return next();
  lookupUserFlags(req.session.username, req.session.clientId, (flags) => {
    req.session.principleUser = flags.principleUser;
    req.session.principleUserAdvanced = flags.principleUserAdvanced;
    if (Number(flags.principleUserAdvanced) === 1) return next();
    res.redirect('/landing');
  });
}

registerDivisionAdvancedRoutes(app, db, {
  requireLogin,
  requirePrincipleUser,
  requirePrincipleUserAdvanced,
  lookupUserFlags,
  lookupPrincipleUser
});

registerLiveScheduleRoutes(app, db, {
  requireLogin,
  requirePrincipleUserAdvanced,
  liveScheduleLimiter,
  lookupUserFlags
});

function parseScheduleRingCount(stateJson) {
  let state = stateJson;
  if (typeof state === 'string') {
    try {
      state = JSON.parse(state);
    } catch (err) {
      return 0;
    }
  }
  if (!state || typeof state !== 'object') return 0;
  const n = Number(state.ring_count);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.max(1, Math.min(32, Math.floor(n)));
}

function buildUmpireScheduleOverlay(stateJson) {
  const state = parseJsonObject(stateJson);
  if (!state || typeof state !== 'object') return null;
  const ringCount = parseScheduleRingCount(state);
  if (ringCount < 1) return null;
  const catalogById = {};
  (Array.isArray(state.catalog) ? state.catalog : []).forEach((entry) => {
    if (entry && entry.id != null) catalogById[String(entry.id)] = entry;
  });
  const days = Array.isArray(state.days) && state.days.length
    ? state.days
    : [{ name: 'Day 1', start_time: '08:00', end_time: '18:00' }];
  const rings = {};
  for (let ring = 1; ring <= ringCount; ring += 1) rings[String(ring)] = [];
  Object.entries(state.placements || {}).forEach(([id, placement]) => {
    if (!placement || typeof placement !== 'object') return;
    const entry = catalogById[String(id)];
    if (!entry) return;
    const ring = (Number(placement.ring_index) || 0) + 1;
    if (!rings[String(ring)]) return;
    const start = Math.max(0, Number(placement.start_offset_minutes) || 0);
    const duration = displayDurationMinutes(entry, state.match_durations || {}, state.buffer_durations || {});
    rings[String(ring)].push({
      name: String(entry.division_name || entry.id || 'Division'),
      start,
      end: start + Math.max(0, duration),
      dayIndex: Math.max(0, Number(placement.day_index) || 0)
    });
  });
  Object.keys(rings).forEach((key) => {
    rings[key].sort((a, b) => {
      if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
      return a.start - b.start;
    });
  });
  return {
    timezone: typeof state.timezone === 'string' ? state.timezone : null,
    activeDayIndex: Math.max(0, Number(state.active_day_index) || 0),
    days: days.map((day, index) => ({
      name: String((day && day.name) || ('Day ' + (index + 1))),
      start_time: String((day && day.start_time) || '08:00'),
      end_time: String((day && day.end_time) || '18:00')
    })),
    rings
  };
}

const UMPIRE_SLOT_KEYS = [
  'jury_president',
  'jury_member',
  'it_umpire',
  'umpire_1',
  'umpire_2',
  'umpire_3',
  'umpire_4',
  'umpire_5',
  'equipment_verifier_1',
  'equipment_verifier_2'
];

function queryAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params || [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

let umpireAssignmentsTablePromise = null;
function ensureUmpireAssignmentsTable() {
  if (!umpireAssignmentsTablePromise) {
    umpireAssignmentsTablePromise = queryAsync(`
      CREATE TABLE IF NOT EXISTS umpire_assignments (
        client_id VARCHAR(64) NOT NULL,
        event_id VARCHAR(64) NOT NULL,
        format_version INT NOT NULL DEFAULT 1,
        state_json JSON NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (client_id, event_id)
      )
    `).catch((err) => {
      umpireAssignmentsTablePromise = null;
      throw err;
    });
  }
  return umpireAssignmentsTablePromise;
}

function emptyUmpireRingAssignments() {
  const row = {};
  UMPIRE_SLOT_KEYS.forEach((key) => {
    row[key] = null;
  });
  return row;
}

function sanitizeUmpireAssignments(raw, ringCount, validUmpireIds) {
  const next = {};
  const used = new Set();
  const src = raw && typeof raw === 'object' ? raw : {};
  const n = Math.max(0, Number(ringCount) || 0);
  for (let ring = 1; ring <= n; ring += 1) {
    const key = String(ring);
    const rowSrc = src[key] && typeof src[key] === 'object' ? src[key] : {};
    const row = emptyUmpireRingAssignments();
    UMPIRE_SLOT_KEYS.forEach((slotKey) => {
      const id = rowSrc[slotKey] == null || rowSrc[slotKey] === '' ? '' : String(rowSrc[slotKey]);
      if (id && validUmpireIds.has(id) && !used.has(id)) {
        row[slotKey] = id;
        used.add(id);
      }
    });
    next[key] = row;
  }
  return next;
}

function parseJsonObject(value) {
  if (value == null || value === '') return {};
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    value = value.toString('utf8');
  }
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (err) {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

app.get('/api/umpire-management/events/:eventId', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
  const clientId = req.session.clientId;
  const eventId = req.params.eventId;
  try {
    const eventResults = await queryAsync(
      'SELECT id, event_name, event_date_start FROM events WHERE id = ? AND client_id = ?',
      [eventId, clientId]
    );
    if (!eventResults || eventResults.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to manage umpires for this event.' });
    }

    const eventRow = eventResults[0];
    const umpireRows = await queryAsync(
      `SELECT id, first_name, last_name, contact_email, \`rank\`, gender, team_name_or_country
       FROM registration
       WHERE event_id = ? AND LOWER(role) = 'umpire'
       ORDER BY last_name, first_name`,
      [eventId]
    );

    const schedRows = await queryAsync(
      'SELECT state_json FROM schedules WHERE client_id = ? AND event_id = ? LIMIT 1',
      [clientId, eventId]
    );
    const scheduleState = schedRows && schedRows[0] ? schedRows[0].state_json : null;
    const ringCount = parseScheduleRingCount(scheduleState);
    const scheduleOverlay = buildUmpireScheduleOverlay(scheduleState);

    const validIds = new Set((umpireRows || []).map((row) => String(row.id)));
    let assignments = sanitizeUmpireAssignments({}, ringCount, validIds);
    try {
      await ensureUmpireAssignmentsTable();
      const assignmentRows = await queryAsync(
        'SELECT state_json FROM umpire_assignments WHERE client_id = ? AND event_id = ? LIMIT 1',
        [clientId, eventId]
      );
      const stored = assignmentRows && assignmentRows[0]
        ? parseJsonObject(assignmentRows[0].state_json)
        : {};
      const rawAssignments = stored.assignments && typeof stored.assignments === 'object' && !Array.isArray(stored.assignments)
        ? stored.assignments
        : stored;
      assignments = sanitizeUmpireAssignments(rawAssignments, ringCount, validIds);
    } catch (assignErr) {
      console.error(assignErr);
    }

    res.json({
      event: {
        id: String(eventRow.id),
        name: eventRow.event_name || '',
        dateStart: eventRow.event_date_start || null
      },
      umpires: umpireRows || [],
      ringCount,
      assignments,
      scheduleOverlay
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load umpire management data. Please try again shortly.' });
  }
});

app.put('/api/umpire-management/events/:eventId/assignments', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
  const clientId = req.session.clientId;
  const eventId = req.params.eventId;
  try {
    const eventResults = await queryAsync(
      'SELECT id FROM events WHERE id = ? AND client_id = ?',
      [eventId, clientId]
    );
    if (!eventResults || eventResults.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to manage umpires for this event.' });
    }

    const umpireRows = await queryAsync(
      `SELECT id FROM registration WHERE event_id = ? AND LOWER(role) = 'umpire'`,
      [eventId]
    );
    const schedRows = await queryAsync(
      'SELECT state_json FROM schedules WHERE client_id = ? AND event_id = ? LIMIT 1',
      [clientId, eventId]
    );
    const ringCount = schedRows && schedRows[0]
      ? parseScheduleRingCount(schedRows[0].state_json)
      : 0;
    const validIds = new Set((umpireRows || []).map((row) => String(row.id)));
    const assignments = sanitizeUmpireAssignments(req.body && req.body.assignments, ringCount, validIds);

    await ensureUmpireAssignmentsTable();
    const json = JSON.stringify({ format_version: 1, assignments });
    await queryAsync(
      `INSERT INTO umpire_assignments (client_id, event_id, state_json)
       VALUES (?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         state_json = VALUES(state_json),
         updated_at = CURRENT_TIMESTAMP`,
      [String(clientId), String(eventId), json]
    );
    res.json({ ok: true, assignments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to save umpire assignments. Please try again shortly.' });
  }
});

// Global Express error handler — returns JSON instead of crashing
app.use((err, req, res, next) => {
  console.error('Unhandled Express error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred. Please try again shortly.' });
});

// Prevent process crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (process kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (process kept alive):', reason);
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other Node process (or change PORT) and try again.`);
    process.exit(1);
  }
  console.error('Server failed to start:', err);
  process.exit(1);
});