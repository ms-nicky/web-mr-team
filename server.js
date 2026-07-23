const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const PORT = 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'member';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
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

    const check = await client.query('SELECT id FROM users WHERE username = $1', ['Mr3000']);
    if (check.rows.length === 0) {
      await client.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        ['Mr3000', 'Mr3000|0909', 'komandan']
      );
      console.log('User komandan Mr3000 berhasil dibuat.');
    } else {
      await client.query("UPDATE users SET role = 'komandan' WHERE username = 'Mr3000'");
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

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(null); }
    });
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getParam(pathname, pattern) {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  return pathname.match(re)?.groups || null;
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

/* ── API: Login ── */
async function handleLogin(req, res) {
  const data = await parseBody(req);
  if (!data || !data.username || !data.password) {
    return sendJSON(res, 400, { error: 'Username dan password harus diisi.' });
  }
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, username, role FROM users WHERE username = $1 AND password = $2',
      [data.username, data.password]
    );
    if (result.rows.length === 0) {
      return sendJSON(res, 401, { error: 'Username atau password salah.' });
    }
    const user = result.rows[0];
    await addLog(user.username, 'LOGIN', 'Berhasil login');
    sendJSON(res, 200, { message: 'Login berhasil.', user, redirect: '/dashboard.html' });
  } finally {
    client.release();
  }
}

/* ── API: Get members ── */
async function handleGetMembers(req, res) {
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
  const data = await parseBody(req);
  if (!data || !data.username || !data.password) {
    return sendJSON(res, 400, { error: 'Username dan password harus diisi.' });
  }
  const client = await pool.connect();
  try {
    const exists = await client.query('SELECT id FROM users WHERE username = $1', [data.username]);
    if (exists.rows.length > 0) {
      return sendJSON(res, 409, { error: 'Username sudah digunakan.' });
    }
    const role = data.role || 'member';
    await client.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      [data.username, data.password, role]
    );
    await addLog(data.username, 'CREATE', `Member baru ditambahkan (${role})`);
    sendJSON(res, 201, { message: 'Member berhasil ditambahkan.' });
  } finally {
    client.release();
  }
}

/* ── API: Edit member ── */
async function handleEditMember(req, res, id) {
  const data = await parseBody(req);
  if (!data || !data.username) {
    return sendJSON(res, 400, { error: 'Username harus diisi.' });
  }
  const client = await pool.connect();
  try {
    if (data.password) {
      await client.query(
        'UPDATE users SET username = $1, password = $2, role = $3 WHERE id = $4',
        [data.username, data.password, data.role || 'member', id]
      );
    } else {
      await client.query(
        'UPDATE users SET username = $1, role = $2 WHERE id = $3',
        [data.username, data.role || 'member', id]
      );
    }
    await addLog(data.username, 'UPDATE', `Data member diperbarui (ID: ${id})`);
    sendJSON(res, 200, { message: 'Member berhasil diperbarui.' });
  } catch (err) {
    sendJSON(res, 500, { error: 'Gagal memperbarui member.' });
  } finally {
    client.release();
  }
}

/* ── API: Delete member ── */
async function handleDeleteMember(req, res, id) {
  const client = await pool.connect();
  try {
    const check = await client.query('SELECT username FROM users WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return sendJSON(res, 404, { error: 'Member tidak ditemukan.' });
    }
    const username = check.rows[0].username;
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await addLog(username, 'DELETE', `Member dihapus (ID: ${id})`);
    sendJSON(res, 200, { message: 'Member berhasil dihapus.' });
  } finally {
    client.release();
  }
}

/* ── API: Get logs ── */
async function handleGetLogs(req, res) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100');
    sendJSON(res, 200, { logs: result.rows });
  } finally {
    client.release();
  }
}

/* ── API: Get team members ── */
async function handleGetTeam(req, res) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM team_members ORDER BY sort_order ASC, id ASC');
    sendJSON(res, 200, { team: result.rows });
  } finally {
    client.release();
  }
}

/* ── API: Add team member ── */
async function handleAddTeam(req, res) {
  const data = await parseBody(req);
  if (!data || !data.name || !data.role || !data.tag) {
    return sendJSON(res, 400, { error: 'Nama, role, dan tag harus diisi.' });
  }
  const client = await pool.connect();
  try {
    const maxOrder = await client.query('SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM team_members');
    await client.query(
      'INSERT INTO team_members (name, role, tag, image, sort_order) VALUES ($1,$2,$3,$4,$5)',
      [data.name, data.role, data.tag, data.image || '', maxOrder.rows[0].next]
    );
    await addLog('system', 'CREATE', `Team operator ditambahkan: ${data.name}`);
    sendJSON(res, 201, { message: 'Team operator berhasil ditambahkan.' });
  } finally {
    client.release();
  }
}

/* ── API: Edit team member ── */
async function handleEditTeam(req, res, id) {
  const data = await parseBody(req);
  if (!data || !data.name || !data.role || !data.tag) {
    return sendJSON(res, 400, { error: 'Nama, role, dan tag harus diisi.' });
  }
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE team_members SET name=$1, role=$2, tag=$3, image=$4 WHERE id=$5',
      [data.name, data.role, data.tag, data.image || '', id]
    );
    await addLog('system', 'UPDATE', `Team operator diperbarui: ${data.name} (ID: ${id})`);
    sendJSON(res, 200, { message: 'Team operator berhasil diperbarui.' });
  } catch (err) {
    sendJSON(res, 500, { error: 'Gagal memperbarui team operator.' });
  } finally {
    client.release();
  }
}

/* ── API: Delete team member ── */
async function handleDeleteTeam(req, res, id) {
  const client = await pool.connect();
  try {
    const check = await client.query('SELECT name FROM team_members WHERE id=$1', [id]);
    if (check.rows.length === 0) {
      return sendJSON(res, 404, { error: 'Team operator tidak ditemukan.' });
    }
    await client.query('DELETE FROM team_members WHERE id=$1', [id]);
    await addLog('system', 'DELETE', `Team operator dihapus: ${check.rows[0].name} (ID: ${id})`);
    sendJSON(res, 200, { message: 'Team operator berhasil dihapus.' });
  } finally {
    client.release();
  }
}

/* ── Server ── */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // API routes
  if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/members' && req.method === 'GET') return handleGetMembers(req, res);
  if (pathname === '/api/members' && req.method === 'POST') return handleAddMember(req, res);
  if (pathname === '/api/logs' && req.method === 'GET') return handleGetLogs(req, res);
  if (pathname === '/api/team' && req.method === 'GET') return handleGetTeam(req, res);
  if (pathname === '/api/team' && req.method === 'POST') return handleAddTeam(req, res);

  const memberEdit = getParam(pathname, '/api/members/:id');
  if (memberEdit && req.method === 'PUT') return handleEditMember(req, res, memberEdit.id);
  if (memberEdit && req.method === 'DELETE') return handleDeleteMember(req, res, memberEdit.id);

  const teamEdit = getParam(pathname, '/api/team/:id');
  if (teamEdit && req.method === 'PUT') return handleEditTeam(req, res, teamEdit.id);
  if (teamEdit && req.method === 'DELETE') return handleDeleteTeam(req, res, teamEdit.id);

  // Static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);

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
