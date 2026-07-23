const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const PORT = 3000;
const BCRYPT_ROUNDS = 10;
const MAX_BODY_SIZE = 50 * 1024;
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW = 15 * 60 * 1000;
const SUPPORT_RATE_LIMIT = 5;
const SUPPORT_RATE_WINDOW = 60 * 1000; // 1 minute

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes idle
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const sessions = new Map();
const loginAttempts = new Map();
const supportAttempts = new Map();

function cleanOldSessions() {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    const age = now - sess.createdAt;
    const idle = now - sess.lastActivity;
    if (age > SESSION_MAX_AGE || idle > SESSION_IDLE_TIMEOUT) {
      sessions.delete(token);
    }
  }
}
setInterval(cleanOldSessions, 15 * 60 * 1000);

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        action VARCHAR(255) NOT NULL,
        detail TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(150) NOT NULL,
        tag VARCHAR(50) NOT NULL,
        image VARCHAR(500) DEFAULT '',
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150),
        category VARCHAR(50) DEFAULT 'General',
        subject VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const teamCheck = await client.query('SELECT COUNT(*) FROM team_members');
    if (parseInt(teamCheck.rows[0].count) === 0) {
      const seeds = [
        ['Ms 1397', 'Offensive Security & Exploit Research', 'Red Team', 'assets/Ms1397.png', 1],
        ['Ms 3000', 'Secure Engineering & Threat Intelligence', 'Blue Team', 'assets/Ms3000.png', 2],
        ['Ms XDROID', 'Reverse Engineer & EvilZero', 'RE / Malware', 'assets/MsXDROID.png', 3],
        ['Ms Onion', 'Web Security & Penetration Testing', 'WebSec', 'assets/MsOnion.png', 4],
        ['MsCOR1l', 'Anti-Scam Intelligence & Victim Support', 'OSINT', 'assets/MsCOR1l.png', 5],
      ];
      for (const s of seeds) {
        await client.query('INSERT INTO team_members (name, role, tag, image, sort_order) VALUES ($1,$2,$3,$4,$5)', s);
      }
      console.log('Team members default berhasil dibuat.');
    }

    const adminUser = process.env.ADMIN_USERNAME;
    const adminPass = process.env.ADMIN_PASSWORD;
    const adminRole = process.env.ADMIN_ROLE || 'komandan';

    if (!adminUser || !adminPass) {
      console.warn('ADMIN_USERNAME / ADMIN_PASSWORD tidak di-set di .env. Skipping admin seed.');
    } else {
      const check = await client.query('SELECT id, password FROM users WHERE username = $1', [adminUser]);
      if (check.rows.length === 0) {
        const hashed = await bcrypt.hash(adminPass, BCRYPT_ROUNDS);
        await client.query(
          'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
          [adminUser, hashed, adminRole]
        );
        console.log(`User ${adminRole} ${adminUser} berhasil dibuat.`);
      } else {
        const pw = check.rows[0].password;
        if (!pw.startsWith('$2b$') && !pw.startsWith('$2a$')) {
          const hashed = await bcrypt.hash(pw, BCRYPT_ROUNDS);
          await client.query('UPDATE users SET password = $1, role = $2 WHERE username = $3', [hashed, adminRole, adminUser]);
          console.log(`Password ${adminUser} berhasil di-hash.`);
        } else {
          await client.query(`UPDATE users SET role = $1 WHERE username = $2`, [adminRole, adminUser]);
        }
      }
    }
  } finally {
    client.release();
  }
}

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.jpg':  'image/jpeg',
  '.json': 'application/json',
};

const BLOCKED_FILES = ['server.js', 'package.json', 'package-lock.json', '.env', '.env.local', '.git'];

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) { resolve(null); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(null); }
    });
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function getParam(pathname, pattern) {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  return pathname.match(re)?.groups || null;
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/session=([a-f0-9]+)/);
  if (!match) return null;
  const session = sessions.get(match[1]);
  if (!session) return null;
  session.lastActivity = Date.now();
  return session;
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJSON(res, 401, { error: 'Silakan login terlebih dahulu.' });
    return null;
  }
  return session;
}

function requireRole(req, res, roles) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (!roles.includes(session.role)) {
    sendJSON(res, 403, { error: 'Anda tidak memiliki akses.' });
    return null;
  }
  return session;
}

function validateInput(data, rules) {
  for (const [field, rule] of Object.entries(rules)) {
    const val = data[field];
    if (rule.required && (!val || !val.toString().trim())) {
      return `${field} harus diisi.`;
    }
    if (val && rule.maxLength && val.length > rule.maxLength) {
      return `${field} maksimal ${rule.maxLength} karakter.`;
    }
    if (val && rule.pattern && !rule.pattern.test(val)) {
      return `${field} format tidak valid.`;
    }
  }
  return null;
}

function stripHTML(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/document\./gi, '')
    .replace(/window\./gi, '')
    .replace(/alert\s*\(/gi, '')
    .replace(/eval\s*\(/gi, '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || [];
  const recent = attempts.filter(t => now - t < LOGIN_RATE_WINDOW);
  loginAttempts.set(ip, recent);
  return recent.length < LOGIN_RATE_LIMIT;
}

function recordLoginAttempt(ip) {
  const attempts = loginAttempts.get(ip) || [];
  attempts.push(Date.now());
  loginAttempts.set(ip, attempts);
}

function checkSupportRateLimit(ip) {
  const now = Date.now();
  const attempts = supportAttempts.get(ip) || [];
  const recent = attempts.filter(t => now - t < SUPPORT_RATE_WINDOW);
  supportAttempts.set(ip, recent);
  return recent.length < SUPPORT_RATE_LIMIT;
}

function recordSupportAttempt(ip) {
  const attempts = supportAttempts.get(ip) || [];
  attempts.push(Date.now());
  supportAttempts.set(ip, attempts);
}

async function addLog(username, action, detail = '') {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO activity_logs (username, action, detail) VALUES ($1, $2, $3)',
      [username, action, detail]
    );
  } finally {
    client.release();
  }
}

function getClientIP(req) {
  return req.socket.remoteAddress || 'unknown';
}

/* ── API: Login ── */
async function handleLogin(req, res) {
  const ip = getClientIP(req);
  if (!checkRateLimit(ip)) {
    return sendJSON(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }

  const data = await parseBody(req);
  if (!data || !data.username || !data.password) {
    return sendJSON(res, 400, { error: 'Data tidak valid.' });
  }

  const err = validateInput(data, {
    username: { required: true, maxLength: 100, pattern: /^[a-zA-Z0-9_]+$/ },
    password: { required: true, maxLength: 255 },
  });
  if (err) return sendJSON(res, 400, { error: 'Input tidak valid.' });

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, username, password, role FROM users WHERE username = $1',
      [data.username]
    );

    if (result.rows.length === 0) {
      recordLoginAttempt(ip);
      return sendJSON(res, 401, { error: 'Autentikasi gagal.' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(data.password, user.password);
    if (!valid) {
      recordLoginAttempt(ip);
      return sendJSON(res, 401, { error: 'Autentikasi gagal.' });
    }

    loginAttempts.delete(ip);

    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    sessions.set(token, {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: now,
      lastActivity: now,
    });

    await addLog(user.username, 'LOGIN', 'Berhasil login');

    const maxAgeSec = Math.floor(SESSION_MAX_AGE / 1000);
    const cookieFlags = IS_PRODUCTION
      ? `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`
      : `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': cookieFlags,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify({
      message: 'Login berhasil.',
      user: { id: user.id, username: user.username, role: user.role },
      redirect: '/dashboard',
    }));
  } finally {
    client.release();
  }
}

/* ── API: Logout ── */
function handleLogout(req, res) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/session=([a-f0-9]+)/);
  if (match) sessions.delete(match[1]);

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
  });
  res.end(JSON.stringify({ message: 'Logout berhasil.' }));
}

/* ── API: Check session ── */
function handleCheckSession(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { error: 'Tidak terautentikasi.' });
  sendJSON(res, 200, { user: { id: session.id, username: session.username, role: session.role } });
}

/* ── API: Get members ── */
async function handleGetMembers(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const client = await pool.connect();
  try {
    const result = await client.query('SELECT id, username, role, created_at FROM users ORDER BY id ASC');
    sendJSON(res, 200, { members: result.rows });
  } finally {
    client.release();
  }
}

/* ── API: Add member ── */
async function handleAddMember(req, res) {
  const session = requireRole(req, res, ['komandan', 'admin', 'moderator']);
  if (!session) return;

  const data = await parseBody(req);
  if (!data || !data.username || !data.password) {
    return sendJSON(res, 400, { error: 'Data tidak lengkap.' });
  }

  const err = validateInput(data, {
    username: { required: true, maxLength: 100, pattern: /^[a-zA-Z0-9_]+$/ },
    password: { required: true, maxLength: 255 },
    role: { maxLength: 50 },
  });
  if (err) return sendJSON(res, 400, { error: 'Input tidak valid.' });

  const client = await pool.connect();
  try {
    const exists = await client.query('SELECT id FROM users WHERE username = $1', [data.username]);
    if (exists.rows.length > 0) {
      return sendJSON(res, 409, { error: 'Username sudah digunakan.' });
    }
    const role = data.role || 'member';
    const validRoles = ['member', 'komandan', 'admin', 'moderator'];
    if (!validRoles.includes(role)) {
      return sendJSON(res, 400, { error: 'Input tidak valid.' });
    }
    const hashed = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    await client.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      [stripHTML(data.username), hashed, role]
    );
    await addLog(session.username, 'CREATE', `Member baru ditambahkan: ${stripHTML(data.username)} (${role})`);
    sendJSON(res, 201, { message: 'Member berhasil ditambahkan.' });
  } finally {
    client.release();
  }
}

/* ── API: Edit member ── */
async function handleEditMember(req, res, id) {
  const session = requireRole(req, res, ['komandan', 'admin', 'moderator']);
  if (!session) return;

  const data = await parseBody(req);
  if (!data || !data.username) {
    return sendJSON(res, 400, { error: 'Username harus diisi.' });
  }

  const err = validateInput(data, {
    username: { required: true, maxLength: 100, pattern: /^[a-zA-Z0-9_]+$/ },
    password: { maxLength: 255 },
    role: { maxLength: 50 },
  });
  if (err) return sendJSON(res, 400, { error: 'Input tidak valid.' });

  const client = await pool.connect();
  try {
    if (data.password) {
      const hashed = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
      await client.query(
        'UPDATE users SET username = $1, password = $2, role = $3 WHERE id = $4',
        [stripHTML(data.username), hashed, data.role || 'member', id]
      );
    } else {
      await client.query(
        'UPDATE users SET username = $1, role = $2 WHERE id = $3',
        [stripHTML(data.username), data.role || 'member', id]
      );
    }
    await addLog(session.username, 'UPDATE', `Data member diperbarui (ID: ${id})`);
    sendJSON(res, 200, { message: 'Member berhasil diperbarui.' });
  } catch (err) {
    sendJSON(res, 500, { error: 'Gagal memperbarui member.' });
  } finally {
    client.release();
  }
}

/* ── API: Delete member ── */
async function handleDeleteMember(req, res, id) {
  const session = requireRole(req, res, ['komandan', 'admin', 'moderator']);
  if (!session) return;

  const client = await pool.connect();
  try {
    const check = await client.query('SELECT username FROM users WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return sendJSON(res, 404, { error: 'Member tidak ditemukan.' });
    }
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await addLog(session.username, 'DELETE', `Member dihapus: ${check.rows[0].username} (ID: ${id})`);
    sendJSON(res, 200, { message: 'Member berhasil dihapus.' });
  } finally {
    client.release();
  }
}

/* ── API: Get logs ── */
async function handleGetLogs(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100');
    sendJSON(res, 200, { logs: result.rows });
  } finally {
    client.release();
  }
}

/* ── API: Get team members (authenticated, full data) ── */
async function handleGetTeam(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM team_members ORDER BY sort_order ASC, id ASC');
    sendJSON(res, 200, { team: result.rows });
  } finally {
    client.release();
  }
}

/* ── API: Get team members (public, limited fields for homepage) ── */
async function handleGetTeamPublic(req, res) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT name, role, tag, image FROM team_members ORDER BY sort_order ASC, id ASC');
    sendJSON(res, 200, { team: result.rows });
  } finally {
    client.release();
  }
}

/* ── API: Add team member ── */
async function handleAddTeam(req, res) {
  const session = requireRole(req, res, ['komandan', 'admin', 'moderator']);
  if (!session) return;

  const data = await parseBody(req);
  if (!data || !data.name || !data.role || !data.tag) {
    return sendJSON(res, 400, { error: 'Data tidak lengkap.' });
  }

  const err = validateInput(data, {
    name: { required: true, maxLength: 100 },
    role: { required: true, maxLength: 150 },
    tag: { required: true, maxLength: 50 },
    image: { maxLength: 500 },
  });
  if (err) return sendJSON(res, 400, { error: 'Input tidak valid.' });

  if (data.image && !/^(https?:\/\/|assets\/|\.\.\/|[a-zA-Z0-9_\-\/]+\.(png|jpg|jpeg|gif|svg|webp))$/i.test(data.image)) {
    return sendJSON(res, 400, { error: 'Input tidak valid.' });
  }

  const client = await pool.connect();
  try {
    const maxOrder = await client.query('SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM team_members');
    await client.query(
      'INSERT INTO team_members (name, role, tag, image, sort_order) VALUES ($1,$2,$3,$4,$5)',
      [stripHTML(data.name), stripHTML(data.role), stripHTML(data.tag), stripHTML(data.image || ''), maxOrder.rows[0].next]
    );
    await addLog(session.username, 'CREATE', `Team operator ditambahkan: ${stripHTML(data.name)}`);
    sendJSON(res, 201, { message: 'Team operator berhasil ditambahkan.' });
  } finally {
    client.release();
  }
}

/* ── API: Edit team member ── */
async function handleEditTeam(req, res, id) {
  const session = requireRole(req, res, ['komandan', 'admin', 'moderator']);
  if (!session) return;

  const data = await parseBody(req);
  if (!data || !data.name || !data.role || !data.tag) {
    return sendJSON(res, 400, { error: 'Data tidak lengkap.' });
  }

  const err = validateInput(data, {
    name: { required: true, maxLength: 100 },
    role: { required: true, maxLength: 150 },
    tag: { required: true, maxLength: 50 },
    image: { maxLength: 500 },
  });
  if (err) return sendJSON(res, 400, { error: 'Input tidak valid.' });

  if (data.image && !/^(https?:\/\/|assets\/|\.\.\/|[a-zA-Z0-9_\-\/]+\.(png|jpg|jpeg|gif|svg|webp))$/i.test(data.image)) {
    return sendJSON(res, 400, { error: 'Input tidak valid.' });
  }

  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE team_members SET name=$1, role=$2, tag=$3, image=$4 WHERE id=$5',
      [stripHTML(data.name), stripHTML(data.role), stripHTML(data.tag), stripHTML(data.image || ''), id]
    );
    await addLog(session.username, 'UPDATE', `Team operator diperbarui: ${stripHTML(data.name)} (ID: ${id})`);
    sendJSON(res, 200, { message: 'Team operator berhasil diperbarui.' });
  } catch (err) {
    sendJSON(res, 500, { error: 'Gagal memperbarui team operator.' });
  } finally {
    client.release();
  }
}

/* ── API: Delete team member ── */
async function handleDeleteTeam(req, res, id) {
  const session = requireRole(req, res, ['komandan', 'admin', 'moderator']);
  if (!session) return;

  const client = await pool.connect();
  try {
    const check = await client.query('SELECT name FROM team_members WHERE id=$1', [id]);
    if (check.rows.length === 0) {
      return sendJSON(res, 404, { error: 'Team operator tidak ditemukan.' });
    }
    await client.query('DELETE FROM team_members WHERE id=$1', [id]);
    await addLog(session.username, 'DELETE', `Team operator dihapus: ${check.rows[0].name} (ID: ${id})`);
    sendJSON(res, 200, { message: 'Team operator berhasil dihapus.' });
  } finally {
    client.release();
  }
}

/* ── API: Submit support message ── */
async function handleSupportSubmit(req, res) {
  const ip = getClientIP(req);
  if (!checkSupportRateLimit(ip)) {
    return sendJSON(res, 429, { error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
  }

  const raw = await parseBody(req);
  if (!raw) {
    return sendJSON(res, 400, { error: 'Data tidak valid.' });
  }

  const data = {
    name: raw.name,
    email: raw.email,
    subject: raw.subject,
    message: raw.message,
    category: raw.category,
  };

  if (!data.name || !data.subject || !data.message) {
    return sendJSON(res, 400, { error: 'Data tidak lengkap.' });
  }

  const err = validateInput(data, {
    name: { required: true, maxLength: 100 },
    email: { maxLength: 150 },
    subject: { required: true, maxLength: 200 },
    message: { required: true, maxLength: 5000 },
    category: { maxLength: 50 },
  });
  if (err) return sendJSON(res, 400, { error: 'Input tidak valid.' });

  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return sendJSON(res, 400, { error: 'Input tidak valid.' });
  }

  const validCategories = ['General', 'Bug Report', 'Assistance', 'Complaint'];
  if (data.category && !validCategories.includes(data.category)) {
    data.category = 'General';
  }

  recordSupportAttempt(ip);

  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO support_messages (name, email, category, subject, message) VALUES ($1,$2,$3,$4,$5)',
      [stripHTML(data.name), stripHTML(data.email || ''), stripHTML(data.category || 'General'), stripHTML(data.subject), stripHTML(data.message)]
    );
    await addLog(stripHTML(data.name), 'SUPPORT', `Pesan support: ${stripHTML(data.subject)}`);
    sendJSON(res, 201, { message: 'Pesan berhasil dikirim.' });
  } finally {
    client.release();
  }
}

/* ── API: Get support messages ── */
async function handleGetSupport(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 100');
    sendJSON(res, 200, { messages: result.rows });
  } finally {
    client.release();
  }
}

/* ── API: Delete support message ── */
async function handleDeleteSupport(req, res, id) {
  const session = requireRole(req, res, ['komandan', 'admin', 'moderator']);
  if (!session) return;

  const client = await pool.connect();
  try {
    const check = await client.query('SELECT id FROM support_messages WHERE id=$1', [id]);
    if (check.rows.length === 0) {
      return sendJSON(res, 404, { error: 'Pesan tidak ditemukan.' });
    }
    await client.query('DELETE FROM support_messages WHERE id=$1', [id]);
    await addLog(session.username, 'DELETE', `Pesan support dihapus (ID: ${id})`);
    sendJSON(res, 200, { message: 'Pesan berhasil dihapus.' });
  } finally {
    client.release();
  }
}

/* ── Server ── */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';");

  if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
  if (pathname === '/api/session' && req.method === 'GET') return handleCheckSession(req, res);

  if (pathname === '/api/members' && req.method === 'GET') return handleGetMembers(req, res);
  if (pathname === '/api/members' && req.method === 'POST') return handleAddMember(req, res);
  if (pathname === '/api/logs' && req.method === 'GET') return handleGetLogs(req, res);
  if (pathname === '/api/team' && req.method === 'GET') return handleGetTeamPublic(req, res);
  if (pathname === '/api/team' && req.method === 'POST') return handleAddTeam(req, res);
  if (pathname === '/api/team/all' && req.method === 'GET') return handleGetTeam(req, res);
  if (pathname === '/api/support' && req.method === 'POST') return handleSupportSubmit(req, res);
  if (pathname === '/api/support' && req.method === 'GET') return handleGetSupport(req, res);

  const memberEdit = getParam(pathname, '/api/members/:id');
  if (memberEdit && req.method === 'PUT') return handleEditMember(req, res, memberEdit.id);
  if (memberEdit && req.method === 'DELETE') return handleDeleteMember(req, res, memberEdit.id);

  const teamEdit = getParam(pathname, '/api/team/:id');
  if (teamEdit && req.method === 'PUT') return handleEditTeam(req, res, teamEdit.id);
  if (teamEdit && req.method === 'DELETE') return handleDeleteTeam(req, res, teamEdit.id);

  const supportEdit = getParam(pathname, '/api/support/:id');
  if (supportEdit && req.method === 'DELETE') return handleDeleteSupport(req, res, supportEdit.id);

  if (pathname.startsWith('/api/')) {
    return sendJSON(res, 404, { error: 'Endpoint tidak ditemukan.' });
  }

  const PROTECTED_PAGES = ['/dashboard'];

  const session = getSession(req);
  if (PROTECTED_PAGES.includes(pathname) && !session) {
    res.writeHead(302, { 'Location': '/login' });
    return res.end();
  }

  const basename = path.basename(pathname);
  if (BLOCKED_FILES.some(f => basename === f || basename === f + '/')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const realPath = path.resolve(filePath);
  const rootDir = path.resolve(__dirname);
  if (!realPath.startsWith(rootDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  let ext = path.extname(filePath);
  if (!ext) {
    filePath += '.html';
    ext = '.html';
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Gagal koneksi database:', err);
  process.exit(1);
});
