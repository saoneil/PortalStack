require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const MySQLStore = require('express-mysql-session')(session);
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');


const app = express();
app.set('trust proxy', 1); // trust first proxy
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/html', express.static(path.join(__dirname, 'html')));





// mysql DB connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

db.connect(err => {
  if (err) {
    console.error('MySQL connection error:', err);
    process.exit(1);
  }
  console.log('Connected to MySQL');
});

// Helper to insert a log record
function insertLog(userId, interactionLog, ipAddress) {
  const sql = 'INSERT INTO app_log (user_id, log_datetime, interaction_log, ip_address) VALUES (?, NOW(), ?, ?)';
  const logJson = typeof interactionLog === 'string' ? interactionLog : JSON.stringify(interactionLog);
  db.query(sql, [userId || null, logJson, ipAddress || null], (err) => {
    if (err) console.error('Logging error:', err);
  });
}

// mysql session store
const sessionStore = new MySQLStore({
  expiration: 1000 * 60 * 60 * 24,
  createDatabaseTable: true
}, db);

// session config
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

// login rate limiter
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  message: 'Too many login attempts. Please try again in 10 minutes',
  skipSuccessfulRequests: true
});

// auth middleware
function requireLogin(req, res, next) {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect('/');
  }
}





// basic routes
app.get('/', (req, res) => {
  if (req.session.loggedIn) {
    res.redirect('/landing');
  } else {
    res.sendFile(path.join(__dirname, 'html', 'index.html'));
  }
});

app.post('/index', loginLimiter, (req, res) => {
  const { client, username, password } = req.body;

  const sql = 'CALL sp_auth_login(?, ?)'; // only client, username

  db.query(sql, [client, username], async (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Login failed. Try again.');
    }

    if (!results[0].length) {
      return res.status(401).send('Invalid credentials for this client');
    }

    const user = results[0][0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).send('Invalid credentials for this client');
    }

    req.session.loggedIn = true;
    req.session.clientId = user.client_id;
    // Store the client name provided during login for display purposes
    req.session.clientName = client;
    req.session.username = username;

    insertLog(username, { action: 'login', client: client, username: username }, req.ip);
    res.redirect('/landing');
  });
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'html', 'signup.html'));
});

app.post('/signup', async (req, res) => {
  const { client, username, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = 'CALL sp_admin_register_user(?, ?, ?)';
    db.query(sql, [client, username, hashedPassword], (err, result) => {
      if (err) {
        console.error(err);
        res.send('Registration failed.');
        return;
      }
      insertLog(username, { action: 'signup', client: client, username: username }, req.ip);
      res.sendFile(path.join(__dirname, 'html', 'registration_successful.html'));
    });
  } catch (err) {
    console.error(err);
    res.send('Error during registration.');
  }
});

app.get('/landing', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'html', 'landing.html'));
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
  res.json({
    clientName: req.session.clientName || null,
    clientId: req.session.clientId || null
  });
});

// API endpoint to log client-side interactions
app.post('/api/log', (req, res) => {
  const userId = (req.session && req.session.username) || req.body.userId || null;
  const interaction = req.body.interaction || {};
  insertLog(userId, interaction, req.ip);
  res.json({ ok: true });
});

// API endpoint to list release notes HTML files
app.get('/api/release-notes-list', (req, res) => {
  const notesDir = path.join(__dirname, 'html', 'release_notes');
  fs.readdir(notesDir, (err, files) => {
    if (err) {
      return res.json([]);
    }
    const htmlFiles = files.filter(f => f.endsWith('.html'));
    res.json(htmlFiles);
  });
});









const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));