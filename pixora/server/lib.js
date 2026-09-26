import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { q } from './migrate.js';

const JWT_SECRET = process.env.JWT_SECRET || 'pixora-deploy-secret-change-me';

// ---------- tokens ----------
export function signAccess(user, sid) {
  return jwt.sign({ uid: user.id, sid, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
export function verifyAccess(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export function newRefreshToken() { return crypto.randomBytes(48).toString('base64url'); }

// ---------- auth middleware ----------
export function auth(required = true) {
  return async (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: 'authentication_required' });
      req.user = null; return next();
    }
    const payload = verifyAccess(token);
    if (!payload) {
      if (required) return res.status(401).json({ error: 'invalid_or_expired_token' });
      req.user = null; return next();
    }
    const { rows } = await q(
      `SELECT u.*, s.id AS session_id, s.revoked AS session_revoked
       FROM users u JOIN sessions s ON s.id = $2 WHERE u.id = $1`,
      [payload.uid, payload.sid]);
    const u = rows[0];
    if (!u || u.session_revoked) {
      if (required) return res.status(401).json({ error: 'session_invalid' });
      req.user = null; return next();
    }
    if (u.account_status === 'banned') {
      if (required) return res.status(401).json({ error: 'account_banned' });
      req.user = null; return next();
    }
    if (u.account_status === 'suspended' && !req.path.startsWith('/api/admin')) {
      return res.status(403).json({ error: 'account_suspended', reason: u.suspended_reason });
    }
    delete u.password_hash; delete u.totp_secret;
    req.user = u; req.sessionId = u.session_id;
    next();
  };
}

// ---------- rate limiting (token bucket per ip+key) ----------
const buckets = new Map();
export function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    if (req.user?.is_admin) return next(); // admins are exempt from rate limits
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
    const key = `${name}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count++;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - b.count));
    if (b.count > max) return res.status(429).json({ error: 'rate_limited', retry_after_ms: b.reset - now });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k); }, 60_000).unref();

// ---------- validation ----------
export const v = {
  username: (s) => typeof s === 'string' && /^[a-zA-Z0-9._]{3,30}$/.test(s) && !/^\.+$/.test(s) && !s.endsWith('.'),
  email: (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length < 200,
  phone: (s) => typeof s === 'string' && /^\+[1-9]\d{7,14}$/.test(s),
  password: (s) => typeof s === 'string' && s.length >= 8 && s.length <= 128,
  text: (s, max = 2200) => typeof s === 'string' && s.length <= max,
};
export function bad(res, msg, code = 400) { return res.status(code).json({ error: msg }); }

// strip control chars + html tags from user text (XSS hardening; React also escapes)
export const clean = (s, max = 2200) =>
  typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max) : '';

// ---------- hashtags + mentions ----------
export function extractHashtags(text) {
  return [...new Set((text.match(/#[\p{L}\p{N}_]{1,60}/gu) || []).map(t => t.slice(1).toLowerCase()))];
}
export function extractMentions(text) {
  return [...new Set((text.match(/@([a-zA-Z0-9._]{3,30})/g) || []).map(m => m.slice(1)))];
}

export async function indexHashtags(postId, text) {
  const tags = extractHashtags(text);
  for (const t of tags) {
    const { rows: [h] } = await q(`INSERT INTO hashtags(tag, use_count) VALUES ($1,1)
      ON CONFLICT(tag) DO UPDATE SET use_count = hashtags.use_count + 1 RETURNING id`, [t]);
    await q(`INSERT INTO post_hashtags(post_id, hashtag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [postId, h.id]);
  }
  return tags;
}

// ---------- notifications (fan-out via socket emit is wired in realtime.js) ----------
export async function notify({ userId, actorId, type, entityType, entityId, body, io }) {
  if (actorId && String(actorId) === String(userId)) return null;
  const { rows: [n] } = await q(
    `INSERT INTO notifications(user_id, actor_id, type, entity_type, entity_id, body)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userId, actorId, type, entityType, entityId, body]);
  if (io) io.to(`user:${userId}`).emit('notification:new', n);
  return n;
}

// ---------- simple content moderation ----------
const ABUSE = ['kill yourself', 'kys', 'hate you all', 'scam link', 'buy followers'];
export function moderateText(text) {
  const t = (text || '').toLowerCase();
  const flags = [];
  if (ABUSE.some(w => t.includes(w))) flags.push('abuse');
  if (/(https?:\/\/\S+){3,}/.test(t)) flags.push('spam');
  if (/(.)\1{20,}/.test(t)) flags.push('spam');
  return flags;
}
export async function flagIfBad(targetType, targetId, text, ownerId) {
  const flags = moderateText(text);
  for (const f of flags) {
    await q(`INSERT INTO moderation_flags(target_type, target_id, flag) VALUES ($1,$2,$3)`, [targetType, targetId, f]);
  }
  return flags;
}

// duplicate detection: same owner posted identical caption in last 10 min
export async function isDuplicate(ownerId, caption) {
  if (!caption) return false;
  const { rowCount } = await q(
    `SELECT 1 FROM posts WHERE user_id=$1 AND caption=$2 AND status='published' AND created_at > now() - interval '10 minutes' LIMIT 1`,
    [ownerId, caption]);
  return rowCount > 0;
}

// ---------- OTP codes ----------
export function genOtp() { return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); }
export async function createOtp(purpose, target, userId = null) {
  const code = genOtp();
  await q(`INSERT INTO otp_codes(purpose, target, code_hash, user_id, expires_at)
           VALUES ($1,$2,$3,$4, now() + interval '10 minutes')`,
    [purpose, target, sha256(code), userId]);
  return code;
}
export async function verifyOtp(purpose, target, code) {
  const { rows } = await q(
    `SELECT * FROM otp_codes WHERE purpose=$1 AND target=$2 AND consumed=FALSE AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`, [purpose, target]);
  const row = rows[0];
  if (!row) return { ok: false, error: 'code_expired' };
  if (row.attempts >= 5) return { ok: false, error: 'too_many_attempts' };
  if (row.code_hash !== sha256(String(code))) {
    await q(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1`, [row.id]);
    return { ok: false, error: 'invalid_code' };
  }
  await q(`UPDATE otp_codes SET consumed=TRUE WHERE id=$1`, [row.id]);
  return { ok: true, userId: row.user_id };
}

// ---------- TOTP (RFC 6238, no deps) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(c); if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpCode(secretBuf, timeStep = Math.floor(Date.now() / 30000)) {
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(timeStep / 2 ** 32), 0);
  buf.writeUInt32BE(timeStep >>> 0, 4);
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const o = hmac[19] & 0xf;
  const bin = ((hmac[o] & 0x7f) << 24) | (hmac[o + 1] << 16) | (hmac[o + 2] << 8) | hmac[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}
export function verifyTotp(secretB32, code) {
  const secret = base32Decode(secretB32);
  const step = Math.floor(Date.now() / 30000);
  for (const s of [step - 1, step, step + 1]) if (totpCode(secret, s) === String(code)) return true;
  return false;
}
export function genBackupCodes(n = 8) {
  return Array.from({ length: n }, () => crypto.randomBytes(5).toString('hex'));
}

// ---------- pluggable delivery providers ----------
export async function sendEmail(to, subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Pixora <noreply@pixora.app>', to, subject, html: body }),
    });
    return r.ok;
  }
  console.log(`[mail:not-configured] to=${to} subject=${subject}`);
  return false;
}
export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (sid && tok && from) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    return r.ok;
  }
  console.log(`[sms:not-configured] to=${to}`);
  return false;
}
