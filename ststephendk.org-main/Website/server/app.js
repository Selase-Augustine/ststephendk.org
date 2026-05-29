const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  return res.send('St. Stephen Catholic Church CMS Backend Running');
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

function nowIso() {
  return new Date().toISOString();
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

function signToken(user) {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function parseAuthHeader(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return null;
  return token;
}

async function requireAuth(req, res, next) {
  try {
    const token = parseAuthHeader(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing Bearer token' });
    }

    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret);

    const userResult = await query(
      `select id, full_name, email, role, profile_image, phone_number, status, last_login, created_at, updated_at
       from users
       where id = $1`,
      [payload.sub]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid user' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'User is not active' });
    }

    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireRoles(roles) {
  const allowed = new Set(roles);
  return function(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!allowed.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}

async function logAudit(userId, action, moduleName, recordId) {
  await query(
    `insert into audit_logs (user_id, action, module, record_id)
     values ($1, $2, $3, $4)`,
    [userId, action, moduleName, recordId || null]
  );
}

function parsePagination(req) {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
  return { limit, offset };
}

app.get('/api/health', async (req, res) => {
  try {
    const result = await query('select 1 as ok');
    return res.json({ ok: true, db: result.rows[0].ok === 1, time: nowIso() });
  } catch (e) {
    return res.status(500).json({ ok: false, time: nowIso() });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const result = await query(
    `select id, full_name, email, password_hash, role, status
     from users
     where email = $1`,
    [email]
  );

  const user = result.rows[0];
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await query(`update users set last_login = now() where id = $1`, [user.id]);
  await logAudit(user.id, 'login', 'auth', user.id);

  const token = signToken(user);
  return res.json({
    token,
    user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role }
  });
});

app.post('/api/auth/bootstrap', async (req, res) => {
  const token = req.headers['x-bootstrap-token'];
  const expected = process.env.BOOTSTRAP_TOKEN;
  if (!expected || token !== expected) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { full_name, email, password } = req.body || {};
  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'full_name, email, password are required' });
  }

  const countResult = await query('select count(*)::int as count from users');
  if ((countResult.rows[0] && countResult.rows[0].count) > 0) {
    return res.status(409).json({ error: 'Bootstrap already completed' });
  }

  const password_hash = await bcrypt.hash(password, 12);
  const created = await query(
    `insert into users (full_name, email, password_hash, role, status)
     values ($1, $2, $3, 'super_admin', 'active')
     returning id, full_name, email, role, status, created_at`,
    [full_name, email, password_hash]
  );

  const user = created.rows[0];
  await logAudit(user.id, 'bootstrap', 'auth', user.id);
  const jwtToken = signToken(user);
  return res.status(201).json({ token: jwtToken, user });
});

app.get('/api/me', requireAuth, async (req, res) => {
  return res.json({ user: req.user });
});

app.get('/api/users', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const result = await query(
    `select id, full_name, email, role, profile_image, phone_number, status, last_login, created_at, updated_at
     from users
     order by created_at desc
     limit $1 offset $2`,
    [limit, offset]
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/users', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const { full_name, email, password, role, profile_image, phone_number, status } = req.body || {};
  if (!full_name || !email || !password || !role) {
    return res.status(400).json({ error: 'full_name, email, password, role are required' });
  }

  const password_hash = await bcrypt.hash(password, 12);
  const created = await query(
    `insert into users (full_name, email, password_hash, role, profile_image, phone_number, status)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, full_name, email, role, profile_image, phone_number, status, created_at, updated_at`,
    [full_name, email, password_hash, role, profile_image || null, phone_number || null, status || 'active']
  );

  await logAudit(req.user.id, 'create', 'users', created.rows[0].id);
  return res.status(201).json({ user: created.rows[0] });
});

app.patch('/api/users/:id', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const { id } = req.params;
  const allowed = ['full_name', 'email', 'role', 'profile_image', 'phone_number', 'status'];
  const keys = Object.keys(req.body || {}).filter((k) => allowed.includes(k));
  if (keys.length === 0) return res.status(400).json({ error: 'No valid fields' });

  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => req.body[k]);
  const updated = await query(
    `update users set ${sets}, updated_at = now() where id = $1
     returning id, full_name, email, role, profile_image, phone_number, status, last_login, created_at, updated_at`,
    [id, ...values]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'update', 'users', id);
  return res.json({ user: updated.rows[0] });
});

app.post('/api/users/:id/reset-password', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const { id } = req.params;
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password is required' });
  const password_hash = await bcrypt.hash(password, 12);
  const updated = await query(
    `update users set password_hash = $2, updated_at = now() where id = $1
     returning id`,
    [id, password_hash]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'reset_password', 'users', id);
  return res.json({ ok: true });
});

app.get('/api/announcements', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const status = req.query.status;
  const where = status ? 'where a.status = $3' : '';
  const params = status ? [limit, offset, status] : [limit, offset];

  const result = await query(
    `select a.id, a.title, a.slug, a.content, a.featured_image, a.status, a.publish_date, a.created_at, a.updated_at,
            u.id as author_id, u.full_name as author_name
     from announcements a
     join users u on u.id = a.author_id
     ${where}
     order by coalesce(a.publish_date, a.created_at) desc
     limit $1 offset $2`,
    params
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/announcements', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { title, slug, content, featured_image, status, publish_date } = req.body || {};
  if (!title || !slug || !content) return res.status(400).json({ error: 'title, slug, content are required' });
  const created = await query(
    `insert into announcements (title, slug, content, featured_image, author_id, status, publish_date)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, title, slug, content, featured_image, author_id, status, publish_date, created_at, updated_at`,
    [title, slug, content, featured_image || null, req.user.id, status || 'draft', publish_date || null]
  );
  await logAudit(req.user.id, 'create', 'announcements', created.rows[0].id);
  return res.status(201).json({ announcement: created.rows[0] });
});

app.patch('/api/announcements/:id', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { id } = req.params;
  const allowed = ['title', 'slug', 'content', 'featured_image', 'status', 'publish_date'];
  const keys = Object.keys(req.body || {}).filter((k) => allowed.includes(k));
  if (keys.length === 0) return res.status(400).json({ error: 'No valid fields' });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => req.body[k]);
  const updated = await query(
    `update announcements set ${sets}, updated_at = now()
     where id = $1
     returning id, title, slug, content, featured_image, author_id, status, publish_date, created_at, updated_at`,
    [id, ...values]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'update', 'announcements', id);
  return res.json({ announcement: updated.rows[0] });
});

app.delete('/api/announcements/:id', requireAuth, requireRoles(['super_admin', 'parish_priest']), async (req, res) => {
  const { id } = req.params;
  const deleted = await query(`delete from announcements where id = $1 returning id`, [id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'delete', 'announcements', id);
  return res.json({ ok: true });
});

app.get('/api/events', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const status = req.query.status;
  const where = status ? 'where e.status = $3' : '';
  const params = status ? [limit, offset, status] : [limit, offset];
  const result = await query(
    `select e.*, u.full_name as created_by_name
     from events e
     join users u on u.id = e.created_by
     ${where}
     order by e.event_date desc, e.start_time asc
     limit $1 offset $2`,
    params
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/events', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const {
    title,
    slug,
    description,
    event_date,
    start_time,
    end_time,
    venue,
    poster_image,
    registration_link,
    status
  } = req.body || {};
  if (!title || !slug || !description || !event_date) {
    return res.status(400).json({ error: 'title, slug, description, event_date are required' });
  }
  const created = await query(
    `insert into events (title, slug, description, event_date, start_time, end_time, venue, poster_image, registration_link, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning *`,
    [
      title,
      slug,
      description,
      event_date,
      start_time || null,
      end_time || null,
      venue || null,
      poster_image || null,
      registration_link || null,
      status || 'draft',
      req.user.id
    ]
  );
  await logAudit(req.user.id, 'create', 'events', created.rows[0].id);
  return res.status(201).json({ event: created.rows[0] });
});

app.patch('/api/events/:id', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { id } = req.params;
  const allowed = ['title', 'slug', 'description', 'event_date', 'start_time', 'end_time', 'venue', 'poster_image', 'registration_link', 'status'];
  const keys = Object.keys(req.body || {}).filter((k) => allowed.includes(k));
  if (keys.length === 0) return res.status(400).json({ error: 'No valid fields' });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => req.body[k]);
  const updated = await query(
    `update events set ${sets}, updated_at = now() where id = $1 returning *`,
    [id, ...values]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'update', 'events', id);
  return res.json({ event: updated.rows[0] });
});

app.delete('/api/events/:id', requireAuth, requireRoles(['super_admin', 'parish_priest']), async (req, res) => {
  const { id } = req.params;
  const deleted = await query(`delete from events where id = $1 returning id`, [id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'delete', 'events', id);
  return res.json({ ok: true });
});

app.get('/api/bulletins', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  const month = req.query.month ? parseInt(req.query.month, 10) : null;

  const filters = [];
  const params = [limit, offset];
  if (year) {
    params.push(year);
    filters.push(`b.year = $${params.length}`);
  }
  if (month) {
    params.push(month);
    filters.push(`b.month = $${params.length}`);
  }
  const where = filters.length ? `where ${filters.join(' and ')}` : '';

  const result = await query(
    `select b.*, u.full_name as uploaded_by_name
     from bulletins b
     join users u on u.id = b.uploaded_by
     ${where}
     order by b.year desc, b.month desc, b.created_at desc
     limit $1 offset $2`,
    params
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/bulletins', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { title, pdf_url, thumbnail, month, year } = req.body || {};
  if (!title || !pdf_url || !month || !year) return res.status(400).json({ error: 'title, pdf_url, month, year are required' });
  const created = await query(
    `insert into bulletins (title, pdf_url, thumbnail, month, year, uploaded_by)
     values ($1,$2,$3,$4,$5,$6)
     returning *`,
    [title, pdf_url, thumbnail || null, month, year, req.user.id]
  );
  await logAudit(req.user.id, 'create', 'bulletins', created.rows[0].id);
  return res.status(201).json({ bulletin: created.rows[0] });
});

app.delete('/api/bulletins/:id', requireAuth, requireRoles(['super_admin', 'parish_priest']), async (req, res) => {
  const { id } = req.params;
  const deleted = await query(`delete from bulletins where id = $1 returning id`, [id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'delete', 'bulletins', id);
  return res.json({ ok: true });
});

app.get('/api/albums', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const result = await query(
    `select a.*, u.full_name as created_by_name
     from albums a
     join users u on u.id = a.created_by
     order by a.created_at desc
     limit $1 offset $2`,
    [limit, offset]
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/albums', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { title, description, cover_image } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const created = await query(
    `insert into albums (title, description, cover_image, created_by)
     values ($1,$2,$3,$4)
     returning *`,
    [title, description || null, cover_image || null, req.user.id]
  );
  await logAudit(req.user.id, 'create', 'albums', created.rows[0].id);
  return res.status(201).json({ album: created.rows[0] });
});

app.get('/api/albums/:albumId/images', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { albumId } = req.params;
  const { limit, offset } = parsePagination(req);
  const result = await query(
    `select * from gallery_images where album_id = $1 order by uploaded_at desc limit $2 offset $3`,
    [albumId, limit, offset]
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/albums/:albumId/images', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { albumId } = req.params;
  const { image_url, caption } = req.body || {};
  if (!image_url) return res.status(400).json({ error: 'image_url is required' });
  const created = await query(
    `insert into gallery_images (album_id, image_url, caption)
     values ($1,$2,$3)
     returning *`,
    [albumId, image_url, caption || null]
  );
  await logAudit(req.user.id, 'create', 'gallery_images', created.rows[0].id);
  return res.status(201).json({ image: created.rows[0] });
});

app.delete('/api/gallery-images/:id', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { id } = req.params;
  const deleted = await query(`delete from gallery_images where id = $1 returning id`, [id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'delete', 'gallery_images', id);
  return res.json({ ok: true });
});

app.get('/api/mass-schedules', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const result = await query(
    `select * from mass_schedules
     order by
       case day
         when 'Monday' then 1
         when 'Tuesday' then 2
         when 'Wednesday' then 3
         when 'Thursday' then 4
         when 'Friday' then 5
         when 'Saturday' then 6
         when 'Sunday' then 7
         else 99
       end asc,
       start_time asc`,
    []
  );
  return res.json({ items: result.rows });
});

app.post('/api/mass-schedules', requireAuth, requireRoles(['super_admin', 'parish_priest']), async (req, res) => {
  const { mass_type, day, start_time, venue } = req.body || {};
  if (!mass_type || !day || !start_time) return res.status(400).json({ error: 'mass_type, day, start_time are required' });
  const created = await query(
    `insert into mass_schedules (mass_type, day, start_time, venue)
     values ($1,$2,$3,$4)
     returning *`,
    [mass_type, day, start_time, venue || null]
  );
  await logAudit(req.user.id, 'create', 'mass_schedules', created.rows[0].id);
  return res.status(201).json({ schedule: created.rows[0] });
});

app.delete('/api/mass-schedules/:id', requireAuth, requireRoles(['super_admin', 'parish_priest']), async (req, res) => {
  const { id } = req.params;
  const deleted = await query(`delete from mass_schedules where id = $1 returning id`, [id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'delete', 'mass_schedules', id);
  return res.json({ ok: true });
});

app.get('/api/parish-groups', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const result = await query(
    `select * from parish_groups order by created_at desc limit $1 offset $2`,
    [limit, offset]
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/parish-groups', requireAuth, requireRoles(['super_admin', 'parish_priest']), async (req, res) => {
  const { group_name, description, patron, meeting_day, meeting_time, cover_image } = req.body || {};
  if (!group_name || !description) return res.status(400).json({ error: 'group_name, description are required' });
  const created = await query(
    `insert into parish_groups (group_name, description, patron, meeting_day, meeting_time, cover_image)
     values ($1,$2,$3,$4,$5,$6)
     returning *`,
    [group_name, description, patron || null, meeting_day || null, meeting_time || null, cover_image || null]
  );
  await logAudit(req.user.id, 'create', 'parish_groups', created.rows[0].id);
  return res.status(201).json({ group: created.rows[0] });
});

app.get('/api/parish-groups/:groupId/executives', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { groupId } = req.params;
  const result = await query(
    `select * from group_executives where group_id = $1 order by position asc, executive_name asc`,
    [groupId]
  );
  return res.json({ items: result.rows });
});

app.post('/api/parish-groups/:groupId/executives', requireAuth, requireRoles(['super_admin', 'parish_priest']), async (req, res) => {
  const { groupId } = req.params;
  const { executive_name, position, phone, image } = req.body || {};
  if (!executive_name || !position) return res.status(400).json({ error: 'executive_name, position are required' });
  const created = await query(
    `insert into group_executives (group_id, executive_name, position, phone, image)
     values ($1,$2,$3,$4,$5)
     returning *`,
    [groupId, executive_name, position, phone || null, image || null]
  );
  await logAudit(req.user.id, 'create', 'group_executives', created.rows[0].id);
  return res.status(201).json({ executive: created.rows[0] });
});

app.delete('/api/group-executives/:id', requireAuth, requireRoles(['super_admin', 'parish_priest']), async (req, res) => {
  const { id } = req.params;
  const deleted = await query(`delete from group_executives where id = $1 returning id`, [id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'delete', 'group_executives', id);
  return res.json({ ok: true });
});

app.get('/api/livestreams', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor', 'communications']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const result = await query(
    `select l.*, u.full_name as created_by_name
     from livestreams l
     join users u on u.id = l.created_by
     order by l.scheduled_date desc, l.created_at desc
     limit $1 offset $2`,
    [limit, offset]
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/livestreams', requireAuth, requireRoles(['super_admin', 'parish_priest', 'communications']), async (req, res) => {
  const { title, youtube_url, facebook_url, scheduled_date } = req.body || {};
  if (!title || !scheduled_date) return res.status(400).json({ error: 'title, scheduled_date are required' });
  const created = await query(
    `insert into livestreams (title, youtube_url, facebook_url, scheduled_date, created_by)
     values ($1,$2,$3,$4,$5)
     returning *`,
    [title, youtube_url || null, facebook_url || null, scheduled_date, req.user.id]
  );
  await logAudit(req.user.id, 'create', 'livestreams', created.rows[0].id);
  return res.status(201).json({ livestream: created.rows[0] });
});

app.delete('/api/livestreams/:id', requireAuth, requireRoles(['super_admin', 'parish_priest', 'communications']), async (req, res) => {
  const { id } = req.params;
  const deleted = await query(`delete from livestreams where id = $1 returning id`, [id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'delete', 'livestreams', id);
  return res.json({ ok: true });
});

app.get('/api/donations', requireAuth, requireRoles(['super_admin', 'finance_admin']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const result = await query(
    `select * from donations order by created_at desc limit $1 offset $2`,
    [limit, offset]
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/donations', async (req, res) => {
  const { donor_name, donor_email, amount, payment_method, transaction_reference, donation_type, payment_status } = req.body || {};
  if (!donor_name || !amount || !payment_method) {
    return res.status(400).json({ error: 'donor_name, amount, payment_method are required' });
  }
  const created = await query(
    `insert into donations (donor_name, donor_email, amount, payment_method, transaction_reference, donation_type, payment_status)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning *`,
    [
      donor_name,
      donor_email || null,
      amount,
      payment_method,
      transaction_reference || null,
      donation_type || null,
      payment_status || 'pending'
    ]
  );
  return res.status(201).json({ donation: created.rows[0] });
});

app.get('/api/registrations', requireAuth, requireRoles(['super_admin', 'parish_priest', 'editor']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const result = await query(
    `select * from registrations order by submitted_at desc limit $1 offset $2`,
    [limit, offset]
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/registrations', async (req, res) => {
  const { registration_type, first_name, last_name, email, phone, address, additional_data } = req.body || {};
  if (!registration_type || !first_name || !last_name) {
    return res.status(400).json({ error: 'registration_type, first_name, last_name are required' });
  }
  const created = await query(
    `insert into registrations (registration_type, first_name, last_name, email, phone, address, additional_data)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning *`,
    [registration_type, first_name, last_name, email || null, phone || null, address || null, additional_data || {}]
  );
  return res.status(201).json({ registration: created.rows[0] });
});

app.get('/api/contact-messages', requireAuth, requireRoles(['super_admin', 'parish_priest', 'communications']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const status = req.query.status;
  const where = status ? 'where status = $3' : '';
  const params = status ? [limit, offset, status] : [limit, offset];
  const result = await query(
    `select * from contact_messages ${where} order by submitted_at desc limit $1 offset $2`,
    params
  );
  return res.json({ items: result.rows, limit, offset });
});

app.post('/api/contact-messages', async (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'name, email, subject, message are required' });
  }
  const created = await query(
    `insert into contact_messages (name, email, subject, message)
     values ($1,$2,$3,$4)
     returning *`,
    [name, email, subject, message]
  );
  return res.status(201).json({ contact_message: created.rows[0] });
});

app.patch('/api/contact-messages/:id', requireAuth, requireRoles(['super_admin', 'parish_priest', 'communications']), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status is required' });
  const updated = await query(
    `update contact_messages set status = $2 where id = $1 returning *`,
    [id, status]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user.id, 'update', 'contact_messages', id);
  return res.json({ contact_message: updated.rows[0] });
});

app.get('/api/seo-settings', requireAuth, requireRoles(['super_admin', 'editor', 'communications']), async (req, res) => {
  const result = await query(`select * from seo_settings order by page_name asc`, []);
  return res.json({ items: result.rows });
});

app.put('/api/seo-settings/:page_name', requireAuth, requireRoles(['super_admin', 'editor', 'communications']), async (req, res) => {
  const { page_name } = req.params;
  const { meta_title, meta_description, keywords, og_image } = req.body || {};
  const upserted = await query(
    `insert into seo_settings (page_name, meta_title, meta_description, keywords, og_image)
     values ($1,$2,$3,$4,$5)
     on conflict (page_name)
     do update set meta_title = excluded.meta_title,
                   meta_description = excluded.meta_description,
                   keywords = excluded.keywords,
                   og_image = excluded.og_image,
                   updated_at = now()
     returning *`,
    [page_name, meta_title || null, meta_description || null, keywords || null, og_image || null]
  );
  await logAudit(req.user.id, 'upsert', 'seo_settings', upserted.rows[0].id);
  return res.json({ seo: upserted.rows[0] });
});

app.get('/api/audit-logs', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const result = await query(
    `select l.*, u.full_name as user_name
     from audit_logs l
     left join users u on u.id = l.user_id
     order by l.created_at desc
     limit $1 offset $2`,
    [limit, offset]
  );
  return res.json({ items: result.rows, limit, offset });
});

app.use('/api', (req, res) => {
  return res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  return res.status(500).json({ error: 'Server error' });
});

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3001', 10);
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
