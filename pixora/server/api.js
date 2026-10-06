import express from 'express';
import busboy from 'busboy';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { q } from './migrate.js';
import {
  auth, signAccess, newRefreshToken, sha256, rateLimit, v, bad, clean,
  indexHashtags, extractMentions, notify, flagIfBad, isDuplicate,
  createOtp, verifyOtp, sendEmail, sendSms, verifyTotp, genBackupCodes, base32Encode,
} from './lib.js';

export const api = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => {
  console.error('API error', req.method, req.path, e.message, '\n', (e.stack||'').split('\n').slice(1,4).join('\n'), '\nSQL:', e.query || '');
  res.status(500).json({ error: 'internal_error' });
});

const USER_CARD = `u.id AS uid, u.username AS username, u.display_name AS display_name, u.avatar_url AS avatar_url, u.is_verified AS is_verified, u.is_private AS is_private, u.is_business AS is_business`;
const POST_SELECT = (me = '$ME') => `
  p.*, ${USER_CARD.replace(/u\./g, 'au.')},
  COALESCE((SELECT json_agg(json_build_object('id', m.id, 'mime', m.mime, 'width', m.width, 'height', m.height, 'duration_ms', m.duration_ms, 'alt', pm.position) ORDER BY pm.position)
    FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id), '[]') AS media,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ${me}) AS liked,
  EXISTS(SELECT 1 FROM saves s WHERE s.post_id = p.id AND s.user_id = ${me}) AS saved,
  EXISTS(SELECT 1 FROM reposts r WHERE r.post_id = p.id AND r.user_id = ${me}) AS reposted,
  EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${me} AND f.following_id = p.user_id AND f.status='active') AS following_author
  FROM posts p JOIN users au ON au.id = p.user_id`;
const toPost = (r) => ({
  id: r.id, kind: r.kind, caption: r.caption, location: r.location, altText: r.alt_text,
  createdAt: r.created_at, editedAt: r.edited_at, status: r.status,
  likeCount: r.like_count, commentCount: r.comment_count, viewCount: r.view_count, repostCount: r.repost_count,
  commentsDisabled: r.comments_disabled, likesHidden: r.likes_hidden,
  liked: r.liked, saved: r.saved, reposted: r.reposted, followingAuthor: r.following_author,
  media: (r.media || []).map(m => ({ ...m, url: `/media/${m.id}` })),
  author: { id: r.aid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, verified: r.is_verified, private: r.is_private, business: r.is_business },
});
// need author id separately: adjust query to include au.id AS aid
const POST_SELECT2 = (me) => POST_SELECT(me).replace('FROM posts p JOIN users au', ', au.id AS aid FROM posts p JOIN users au');

const meQ = (req) => req.user ? `'${req.user.id}'::uuid` : 'NULL::uuid';

async function canSeePost(postId, meId, isAdmin = false) {
  const { rows: [p] } = await q(`SELECT p.user_id, u.is_private FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=$1`, [postId]);
  if (!p) return false;
  if (isAdmin) return true;
  if (String(p.user_id) === String(meId)) return true;
  if (!p.is_private) return true;
  const { rowCount } = await q(`SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='active'`, [meId, p.user_id]);
  return rowCount > 0;
}

async function loadPost(id, meId) {
  const sql = POST_SELECT2(meId ? `'${meId}'::uuid` : 'NULL::uuid').replace(/\$ME/g, meId || 'NULL::uuid');
  const { rows: [r] } = await q(`SELECT ${sql} WHERE p.id = $1`, [id]);
  return r ? toPost(r) : null;
}

// ---------------- config / public ----------------
api.get('/config', (req, res) => res.json({
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  vapidPublicKey: process.env.PUSH_VAPID_PUBLIC || null,
  smsConfigured: !!process.env.TWILIO_ACCOUNT_SID,
  mailConfigured: !!process.env.RESEND_API_KEY,
}));

// ---------------- appeals (public — banned users have no session) ----------------
api.post('/auth/appeal', rateLimit('appeal', 20, 3600e3), wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const message = clean(req.body?.message || '', 1000);
  if (!v.email(email)) return bad(res, 'invalid_email');
  const { rows: [u] } = await q(`SELECT id FROM users WHERE email=$1`, [email]);
  const { rowCount: dup } = await q(`SELECT 1 FROM appeals WHERE email=$1 AND status='pending'`, [email]);
  if (dup) return res.json({ ok: true, alreadyPending: true });
  await q(`INSERT INTO appeals(email, user_id, message) VALUES ($1,$2,$3)`, [email, u?.id || null, message]);
  const io = req.app.get('io');
  io.to('admin-room').emit('admin:appeal:new', { email, message, createdAt: new Date().toISOString() });
  res.json({ ok: true });
}));
api.get('/auth/ban-status', wrap(async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const { rows: [u] } = await q(`SELECT account_status FROM users WHERE email=$1`, [email]);
  res.json({ active: u ? u.account_status === 'active' : true });
}));
api.get('/auth/appeal-status', wrap(async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const { rows } = await q(`SELECT status FROM appeals WHERE email=$1 ORDER BY created_at DESC LIMIT 1`, [email]);
  res.json({ status: rows[0]?.status || null });
}));

// ---------------- auth ----------------
async function issueSession(res, user, device, ip) {
  const refresh = newRefreshToken();
  const { rows: [s] } = await q(
    `INSERT INTO sessions(user_id, refresh_hash, device, ip, current) VALUES ($1,$2,$3,$4,TRUE) RETURNING id`,
    [user.id, sha256(refresh), device || 'Unknown device', ip || '']);
  const token = signAccess(user, s.id);
  res.cookie('pixora_rt', refresh, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 30 * 864e5, path: '/api/auth' });
  return { token, refresh, sessionId: s.id };
}

api.post('/auth/register', rateLimit('register', 10, 3600e3), wrap(async (req, res) => {
  const { email, password, username, displayName, phone } = req.body || {};
  if (!v.email(email)) return bad(res, 'invalid_email');
  if (!v.password(password)) return bad(res, 'password_too_weak');
  if (!v.username(username)) return bad(res, 'invalid_username');
  if ((await q(`SELECT 1 FROM users WHERE email=$1`, [email])).rowCount) return bad(res, 'account_exists');
  if ((await q(`SELECT 1 FROM users WHERE username=$1`, [username])).rowCount) return bad(res, 'username_taken');
  const hash = await bcrypt.hash(password, 12);
  const { rows: [u] } = await q(
    `INSERT INTO users(email, password_hash, username, display_name, settings)
     VALUES ($1,$2,$3,$4, $5::jsonb) RETURNING *`,
    [email, hash, username, clean(displayName || username, 60), JSON.stringify({ notify: { likes: true, comments: true, messages: true, mentions: true, reposts: true, stories: true } })]);
  await q(`INSERT INTO wallets(user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [u.id]);
  // first account is platform admin; OWNER_EMAIL always promotes
  const { rowCount } = await q(`SELECT 1 FROM users WHERE is_admin = TRUE LIMIT 1`);
  let admin = u;
  if (!rowCount) { admin = (await q(`UPDATE users SET is_admin=TRUE WHERE id=$1 RETURNING *`, [u.id])).rows[0]; }
  else if (process.env.OWNER_EMAIL && email.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase()) {
    admin = (await q(`UPDATE users SET is_admin=TRUE, is_verified=TRUE, follower_count = GREATEST(follower_count, 1250000) WHERE id=$1 RETURNING *`, [u.id])).rows[0];
  }
  const code = await createOtp('email_verify', email, u.id);
  const sent = await sendEmail(email, 'Verify your Pixora account', `<p>Your Pixora verification code: <b>${code}</b></p>`);
  req.app.get('io').to('admin-room').emit('admin:user:joined', { id: u.id, email: u.email, username: u.username, displayName: u.display_name, createdAt: u.created_at, method: 'email' });
  const s = await issueSession(res, admin, req.headers['user-agent'], req.ip);
  res.json({ user: pub(admin), token: s.token, refresh: s.refresh, emailCodeSent: sent, devCode: sent ? undefined : code });
}));

api.post('/auth/login', rateLimit('login', 20, 600e3), wrap(async (req, res) => {
  const { email, password, totp } = req.body || {};
  await q(`INSERT INTO login_history(email, ip, device, method, success) VALUES ($1,$2,$3,'password',FALSE)`, [email, req.ip, req.headers['user-agent']]);
  let u = (await q(`SELECT * FROM users WHERE email=$1 OR username=$1`, [String(email || '').trim()])).rows[0];
  if (!u || !u.password_hash || !(await bcrypt.compare(password || '', u.password_hash))) return bad(res, 'invalid_credentials', 401);
  if (u.account_status === 'banned') return bad(res, 'account_banned', 403);
  if (u.account_status === 'suspended') return bad(res, 'account_suspended', 403);
  if (u.two_factor_enabled) {
    if (!totp) return res.json({ requires2fa: true });
    if (!verifyTotp(u.totp_secret, String(totp || '')) && !u.backup_codes.includes(String(totp || '').trim())) return bad(res, 'invalid_2fa_code', 401);
  }
  await q(`UPDATE login_history SET success=TRUE WHERE id=(SELECT id FROM login_history WHERE email=$1 ORDER BY created_at DESC LIMIT 1)`, [u.email]);
  if (process.env.OWNER_EMAIL && u.email.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase()) {
    if (!u.is_admin) u = (await q(`UPDATE users SET is_admin=TRUE WHERE id=$1 RETURNING *`, [u.id])).rows[0];
    // owner perks: verified badge + 50k followers asserted on every login
    u = (await q(`UPDATE users SET is_verified=TRUE, is_premium=TRUE, is_creator=TRUE, follower_count = GREATEST(follower_count, 1250000) WHERE id=$1 RETURNING *`, [u.id])).rows[0];
  }
  const s = await issueSession(res, u, req.headers['user-agent'], req.ip);
  res.json({ user: pub(u), token: s.token, refresh: s.refresh });
}));

api.post('/auth/refresh', wrap(async (req, res) => {
  const token = (req.body || {}).refresh || (req.headers.cookie || '').match(/pixora_rt=([^;]+)/)?.[1];
  if (!token) return bad(res, 'missing_token', 401);
  let { rows: [s] } = await q(`SELECT s.*, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.refresh_hash=$1 AND s.revoked=FALSE`, [sha256(token)]);
  // grace: a just-rotated token from a parallel request is still honored for 60s
  if (!s) {
    const { rows: [recent] } = await q(`SELECT s.*, u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.prev_refresh_hash=$1 AND s.revoked=FALSE AND s.rotated_at > now() - interval '60 seconds'`, [sha256(token)]);
    if (recent) s = recent;
  }
  if (!s) return bad(res, 'session_invalid', 401);
  const next = newRefreshToken();
  await q(`UPDATE sessions SET prev_refresh_hash=refresh_hash, refresh_hash=$2, rotated_at=now(), last_seen=now() WHERE id=$1`, [s.id, sha256(next)]);
  res.cookie('pixora_rt', next, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 30 * 864e5, path: '/api/auth' });
  res.json({ token: signAccess(s, s.id), refresh: next, user: pub(s) });
}));

api.post('/auth/logout', wrap(async (req, res) => {
  const t = (req.body || {}).refresh || (req.headers.cookie || '').match(/pixora_rt=([^;]+)/)?.[1];
  if (t) await q(`UPDATE sessions SET revoked=TRUE WHERE refresh_hash=$1`, [sha256(t)]);
  res.clearCookie('pixora_rt', { path: '/api/auth' });
  res.json({ ok: true });
}));

// REAL Google OAuth: Google Identity Services credential (JWT id_token) verified against Google's JWKS
api.post('/auth/google', rateLimit('gauth', 30, 600e3), wrap(async (req, res) => {
  const credential = req.body?.credential;
  if (!credential) return bad(res, 'missing_credential');
  const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`)).json();
  if (info.error || !info.sub) return bad(res, 'invalid_google_token', 401);
  if (info.aud !== process.env.GOOGLE_CLIENT_ID) return bad(res, 'google_client_mismatch', 401);
  if (Number(info.exp) * 1000 < Date.now()) return bad(res, 'google_token_expired', 401);
  let { rows: [u] } = await q(`SELECT * FROM users WHERE google_id=$1 OR email=$2`, [info.sub, info.email]);
  if (!u) {
    ({ rows: [u] } = await q(
      `INSERT INTO users(google_id, email, email_verified, display_name, avatar_url, settings)
       VALUES ($1,$2,TRUE,$3,$4,$5::jsonb) RETURNING *`,
      [info.sub, info.email, clean(info.name || '', 60), info.picture,
       JSON.stringify({ notify: { likes: true, comments: true, messages: true, mentions: true, reposts: true, stories: true } })]));
    await q(`INSERT INTO wallets(user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [u.id]);
    const { rowCount } = await q(`SELECT 1 FROM users WHERE is_admin=TRUE LIMIT 1`);
    if (!rowCount) u = (await q(`UPDATE users SET is_admin=TRUE WHERE id=$1 RETURNING *`, [u.id])).rows[0];
    else if (process.env.OWNER_EMAIL && info.email.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase()) {
      u = (await q(`UPDATE users SET is_admin=TRUE, is_verified=TRUE, follower_count = GREATEST(follower_count, 1250000) WHERE id=$1 RETURNING *`, [u.id])).rows[0];
    }
    if (u.email === (await q(`SELECT email FROM users WHERE id=$1`, [u.id])).rows[0]?.email && u.onboarding_step === 0)
      req.app.get('io').to('admin-room').emit('admin:user:joined', { id: u.id, email: u.email, username: u.username, displayName: u.display_name, createdAt: u.created_at, method: 'google' });
  }
  if (u.account_status === 'banned') return bad(res, 'account_banned', 403);
  const s = await issueSession(res, u, req.headers['user-agent'], req.ip);
  res.json({ user: pub(u), token: s.token, refresh: s.refresh, needsOnboarding: !u.username });
}));

function pub(u) {
  return {
    id: u.id, email: u.email, username: u.username, displayName: u.display_name, bio: u.bio,
    website: u.website, avatarUrl: u.avatar_url, phone: u.phone, phoneVerified: u.phone_verified,
    emailVerified: u.email_verified, isPrivate: u.is_private, isVerified: u.is_verified,
    isAdmin: u.is_admin, isOwner: !!(process.env.OWNER_EMAIL && u.email?.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase()),
    isBusiness: u.is_business, businessCategory: u.business_category,
    language: u.language, theme: u.theme, settings: u.settings, onboardingStep: u.onboarding_step,
    followerCount: u.follower_count, followingCount: u.following_count, postCount: u.post_count,
    createdAt: u.created_at,
  };
}

// onboarding: phone + OTP + username (post-Google)
api.post('/auth/phone/send', auth(), rateLimit('otpsend', 5, 600e3), wrap(async (req, res) => {
  const phone = String(req.body?.phone || '');
  if (!v.phone(phone)) return bad(res, 'invalid_phone_e164');
  const code = await createOtp('phone', phone, req.user.id);
  const sent = await sendSms(phone, `Your Pixora verification code is ${code}`);
  res.json({ sent, devCode: sent ? undefined : code });
}));
api.post('/auth/phone/verify', auth(), wrap(async (req, res) => {
  const { phone, code } = req.body || {};
  const r = await verifyOtp('phone', String(phone || ''), String(code || ''));
  if (!r.ok) return bad(res, r.error);
  await q(`UPDATE users SET phone=$1, phone_verified=TRUE, onboarding_step=GREATEST(onboarding_step,1) WHERE id=$2`, [phone, req.user.id]);
  res.json({ ok: true });
}));
api.get('/auth/username/check', wrap(async (req, res) => {
  const name = String(req.query.q || '');
  res.json({ available: v.username(name) && !(await q(`SELECT 1 FROM users WHERE username=$1`, [name])).rowCount });
}));
api.post('/auth/username/set', auth(), wrap(async (req, res) => {
  const name = String(req.body?.username || '');
  if (!v.username(name)) return bad(res, 'invalid_username');
  if ((await q(`SELECT 1 FROM users WHERE username=$1`, [name])).rowCount) return bad(res, 'username_taken');
  const { rows: [u] } = await q(`UPDATE users SET username=$1, onboarding_step=GREATEST(onboarding_step,2) WHERE id=$2 RETURNING *`, [name, req.user.id]);
  res.json({ user: pub(u) });
}));

api.post('/auth/email/verify', auth(), wrap(async (req, res) => {
  const r = await verifyOtp('email_verify', req.user.email, String(req.body?.code || ''));
  if (!r.ok) return bad(res, r.error);
  const { rows: [u] } = await q(`UPDATE users SET email_verified=TRUE WHERE id=$1 RETURNING *`, [req.user.id]);
  res.json({ user: pub(u) });
}));

api.post('/auth/forgot', rateLimit('forgot', 5, 3600e3), wrap(async (req, res) => {
  const email = String(req.body?.email || '');
  const { rows: [u] } = await q(`SELECT * FROM users WHERE email=$1`, [email]);
  if (u) {
    const code = await createOtp('reset', email, u.id);
    const sent = await sendEmail(email, 'Reset your Pixora password', `<p>Your reset code: <b>${code}</b></p>`);
    return res.json({ ok: true, devCode: sent ? undefined : code });
  }
  res.json({ ok: true }); // do not reveal account existence
}));
api.post('/auth/reset', rateLimit('reset', 10, 3600e3), wrap(async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!v.password(password)) return bad(res, 'password_too_weak');
  const r = await verifyOtp('reset', String(email), String(code));
  if (!r.ok) return bad(res, r.error);
  const hash = await bcrypt.hash(password, 12);
  await q(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hash, r.userId]);
  await q(`UPDATE sessions SET revoked=TRUE WHERE user_id=$1`, [r.userId]);
  res.json({ ok: true });
}));

// 2FA
api.post('/security/2fa/setup', auth(), wrap(async (req, res) => {
  const secret = base32Encode(crypto.randomBytes(20));
  await q(`UPDATE users SET totp_secret=$1 WHERE id=$2`, [secret, req.user.id]);
  res.json({ secret, otpauth: `otpauth://totp/Pixora:${req.user.username || req.user.email}?secret=${secret}&issuer=Pixora` });
}));
api.post('/security/2fa/enable', auth(), wrap(async (req, res) => {
  if (!verifyTotp(req.user.totp_secret, String(req.body?.code || ''))) return bad(res, 'invalid_code');
  const codes = genBackupCodes();
  await q(`UPDATE users SET two_factor_enabled=TRUE, backup_codes=$2 WHERE id=$1`, [req.user.id, codes]);
  res.json({ ok: true, backupCodes: codes });
}));
api.post('/security/2fa/disable', auth(), wrap(async (req, res) => {
  await q(`UPDATE users SET two_factor_enabled=FALSE, totp_secret=NULL, backup_codes='{}' WHERE id=$1`, [req.user.id]);
  res.json({ ok: true });
}));

api.get('/security/sessions', auth(), wrap(async (req, res) => {
  const { rows } = await q(`SELECT id, device, ip, current, created_at, last_seen FROM sessions WHERE user_id=$1 AND revoked=FALSE ORDER BY last_seen DESC`, [req.user.id]);
  res.json({ sessions: rows });
}));
api.post('/security/sessions/revoke', auth(), wrap(async (req, res) => {
  await q(`UPDATE sessions SET revoked=TRUE WHERE id=$1 AND user_id=$2`, [req.body?.id, req.user.id]);
  res.json({ ok: true });
}));
api.post('/security/sessions/revoke-all', auth(), wrap(async (req, res) => {
  await q(`UPDATE sessions SET revoked=TRUE WHERE user_id=$1 AND id != $2`, [req.user.id, req.sessionId]);
  res.json({ ok: true });
}));
api.get('/security/login-history', auth(), wrap(async (req, res) => {
  const { rows } = await q(`SELECT ip, device, method, success, created_at FROM login_history WHERE user_id=$1 OR email=$2 ORDER BY created_at DESC LIMIT 50`, [req.user.id, req.user.email]);
  res.json({ history: rows });
}));

api.get('/me', auth(), (req, res) => res.json({ user: pub(req.user) }));
api.patch('/me', auth(), wrap(async (req, res) => {
  const b = req.body || {};
  const map = {
    displayName: ['display_name', (v) => clean(v, 60)],
    bio: ['bio', (v) => clean(v, 300)],
    website: ['website', (v) => String(v).slice(0, 200)],
    avatarUrl: ['avatar_url', (v) => String(v).slice(0, 500)],
    language: ['language', (v) => String(v).slice(0, 10)],
    theme: ['theme', (v) => String(v).slice(0, 10)],
    settings: ['settings', (v) => JSON.stringify(v ?? {})],
    isPrivate: ['is_private', (v) => !!v],
    isBusiness: ['is_business', (v) => !!v],
    businessCategory: ['business_category', (v) => clean(v, 60)],
    businessContact: ['business_contact', (v) => clean(v, 200)],
    businessHours: ['business_hours', (v) => clean(v, 200)],
  };
  // also accept snake_case keys for API compatibility
  if (b.display_name !== undefined) b.displayName = b.display_name;
  if (b.avatar_url !== undefined) b.avatarUrl = b.avatar_url;
  const sets = [], vals = [];
  for (const key of Object.keys(map)) {
    if (b[key] !== undefined) {
      const [col, fn] = map[key];
      sets.push(`${col}=$${sets.length + 1}`);
      vals.push(fn(b[key]));
    }
  }
  if (sets.length) await q(`UPDATE users SET updated_at=now(), ${sets.join(',')} WHERE id=$${sets.length + 1}`, [...vals, req.user.id]);
  const { rows: [u] } = await q(`SELECT * FROM users WHERE id=$1`, [req.user.id]);
  res.json({ user: pub(u) });
}));

api.post('/me/change-password', auth(), wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const { rows: [u] } = await q(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
  if (u.password_hash && !(await bcrypt.compare(current || '', u.password_hash))) return bad(res, 'wrong_password');
  if (!v.password(next)) return bad(res, 'password_too_weak');
  await q(`UPDATE users SET password_hash=$1 WHERE id=$2`, [await bcrypt.hash(next, 12), req.user.id]);
  res.json({ ok: true });
}));
api.post('/me/change-email', auth(), wrap(async (req, res) => {
  const { email, code } = req.body || {};
  if (!v.email(email)) return bad(res, 'invalid_email');
  if (!code) {
    const c = await createOtp('email_change', email, req.user.id);
    const sent = await sendEmail(email, 'Confirm your new Pixora email', `<p>Code: <b>${c}</b></p>`);
    return res.json({ sent, devCode: sent ? undefined : c });
  }
  const r = await verifyOtp('email_change', email, String(code));
  if (!r.ok) return bad(res, r.error);
  try {
    const { rows: [u] } = await q(`UPDATE users SET email=$1, email_verified=TRUE WHERE id=$2 RETURNING *`, [email, req.user.id]);
    res.json({ user: pub(u) });
  } catch { bad(res, 'email_taken'); }
}));
api.post('/me/change-phone', auth(), wrap(async (req, res) => {
  const { phone, code } = req.body || {};
  if (!code) {
    if (!v.phone(phone)) return bad(res, 'invalid_phone_e164');
    const c = await createOtp('phone', phone, req.user.id);
    const sent = await sendSms(phone, `Your Pixora verification code is ${c}`);
    return res.json({ sent, devCode: sent ? undefined : c });
  }
  const r = await verifyOtp('phone', String(phone), String(code));
  if (!r.ok) return bad(res, r.error);
  const { rows: [u] } = await q(`UPDATE users SET phone=$1, phone_verified=TRUE WHERE id=$2 RETURNING *`, [phone, req.user.id]);
  res.json({ user: pub(u) });
}));
api.post('/me/change-username', auth(), wrap(async (req, res) => {
  const name = String(req.body?.username || '');
  if (!v.username(name)) return bad(res, 'invalid_username');
  if ((await q(`SELECT 1 FROM users WHERE username=$1 AND id != $2`, [name, req.user.id])).rowCount) return bad(res, 'username_taken');
  const { rows: [u] } = await q(`UPDATE users SET username=$1 WHERE id=$2 RETURNING *`, [name, req.user.id]);
  res.json({ user: pub(u) });
}));
api.post('/me/deactivate', auth(), wrap(async (req, res) => {
  await q(`UPDATE users SET account_status='deactivated' WHERE id=$1`, [req.user.id]);
  await q(`UPDATE sessions SET revoked=TRUE WHERE user_id=$1`, [req.user.id]);
  res.json({ ok: true });
}));
api.delete('/me', auth(), wrap(async (req, res) => {
  await q(`DELETE FROM users WHERE id=$1`, [req.user.id]);
  res.clearCookie('pixora_rt', { path: '/api/auth' });
  res.json({ ok: true });
}));
api.get('/me/export', auth(), wrap(async (req, res) => {
  const out = {};
  for (const [name, sql] of Object.entries({
    profile: `SELECT id,email,username,display_name,bio,website,created_at FROM users WHERE id=$1`,
    posts: `SELECT p.id, caption, created_at, (SELECT count(*) FROM likes l WHERE l.post_id=p.id) AS likes FROM posts p WHERE user_id=$1`,
    comments: `SELECT body, created_at FROM comments WHERE user_id=$1`,
    messages: `SELECT body, created_at FROM messages WHERE sender_id=$1`,
    followers: `SELECT u.username FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=$1`,
    following: `SELECT u.username FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1`,
  })) out[name] = (await q(sql, [req.user.id])).rows;
  res.setHeader('Content-Disposition', 'attachment; filename="pixora-data.json"');
  res.json(out);
}));

// ---------------- users / follow ----------------
api.get('/users/:username', auth(false), wrap(async (req, res) => {
  const { rows: [u] } = await q(
    `SELECT u.id, u.username, u.display_name, u.bio, u.website, u.avatar_url, u.is_verified, u.is_private,
      u.is_business, u.business_category, u.business_contact, u.business_hours, u.follower_count, u.following_count, u.post_count, u.created_at,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=u.id AND f.status='active') AS following,
      EXISTS(SELECT 1 FROM follows f WHERE f.following_id=$2 AND f.follower_id=u.id AND f.status='active') AS follows_you,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=u.id AND f.status='pending') AS requested
     FROM users u WHERE u.username=$1 AND u.account_status IN ('active','suspended')`, [req.params.username, req.user?.id]);
  if (!u) return bad(res, 'user_not_found', 404);
  if (req.user && String(u.id) !== String(req.user.id))
    await q(`INSERT INTO profile_visits(profile_id, visitor_id) VALUES ($1,$2)`, [u.id, req.user.id]);
  res.json({ user: {
    id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, website: u.website,
    avatarUrl: u.avatar_url, isVerified: u.is_verified, isPrivate: u.is_private, isBusiness: u.is_business,
    businessCategory: u.business_category, businessContact: u.business_contact, businessHours: u.business_hours,
    followerCount: u.follower_count, followingCount: u.following_count, postCount: u.post_count,
    createdAt: u.created_at, following: u.following, followsYou: u.follows_you, requested: u.requested,
  } });
}));
api.get('/users/:username/posts', auth(false), wrap(async (req, res) => {
  const { rows: [u] } = await q(`SELECT id, is_private FROM users WHERE username=$1`, [req.params.username]);
  if (!u) return bad(res, 'user_not_found', 404);
  let visible = 'p.status=\'published\'';
  if (u.is_private && !req.user?.is_admin) {
    if (!req.user) return res.json({ posts: [] });
    if (String(u.id) !== String(req.user.id))
      visible += ` AND EXISTS(SELECT 1 FROM follows f WHERE f.follower_id='${req.user.id}' AND f.following_id='${u.id}' AND f.status='active')`;
  }
  const cur = req.query.cursor ? ` AND p.created_at < '${new Date(req.query.cursor).toISOString()}'` : '';
  const { rows } = await q(`SELECT ${POST_SELECT2(meQ(req))} WHERE p.user_id='${u.id}' AND p.kind='post' AND ${visible}${cur} ORDER BY p.created_at DESC LIMIT 12`.replace(/\$ME/g, req.user?.id || 'NULL::uuid'));
  res.json({ posts: rows.map(toPost), nextCursor: rows.length === 12 ? rows[rows.length - 1].created_at : null });
}));
api.get('/users/:username/reels', auth(false), wrap(async (req, res) => {
  const { rows: [u] } = await q(`SELECT id FROM users WHERE username=$1`, [req.params.username]);
  if (!u) return bad(res, 'user_not_found', 404);
  const cur = req.query.cursor ? ` AND p.created_at < '${new Date(req.query.cursor).toISOString()}'` : '';
  const { rows } = await q(`SELECT ${POST_SELECT2(meQ(req))} WHERE p.user_id='${u.id}' AND p.kind='reel' AND p.status='published'${cur} ORDER BY p.created_at DESC LIMIT 10`.replace(/\$ME/g, req.user?.id || 'NULL::uuid'));
  res.json({ posts: rows.map(toPost), nextCursor: rows.length === 10 ? rows[rows.length - 1].created_at : null });
}));
api.get('/users/:username/tagged', auth(false), wrap(async (req, res) => {
  const { rows: [u] } = await q(`SELECT id FROM users WHERE username=$1`, [req.params.username]);
  if (!u) return bad(res, 'user_not_found', 404);
  const { rows } = await q(`SELECT ${POST_SELECT2(meQ(req))} WHERE p.status='published' AND EXISTS(
      SELECT 1 FROM post_mentions pm WHERE pm.post_id=p.id AND pm.user_id=$1) ORDER BY p.created_at DESC LIMIT 24`.replace(/\$ME/g, req.user?.id || 'NULL::uuid'), [u.id]);
  res.json({ posts: rows.map(toPost) });
}));
api.get('/me/saved', auth(), wrap(async (req, res) => {
  const col = req.query.collection;
  const where = col ? 'AND s.collection_id=$2' : '';
  const { rows } = await q(
    `SELECT ${POST_SELECT2('$1')} JOIN saves s ON s.post_id=p.id AND s.user_id=$1 ${where} ORDER BY s.created_at DESC LIMIT 50`,
    col ? [req.user.id, col] : [req.user.id]);
  res.json({ posts: rows.map(toPost) });
}));
api.get('/me/collections', auth(), wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT c.*, (SELECT m.id FROM saves s JOIN post_media pm ON pm.post_id=s.post_id JOIN media m ON m.id=pm.media_id
      WHERE s.collection_id=c.id LIMIT 1) AS cover FROM collections c WHERE c.user_id=$1 ORDER BY c.created_at DESC`, [req.user.id]);
  res.json({ collections: rows.map(c => ({ ...c, coverUrl: c.cover ? `/media/${c.cover}` : null })) });
}));
api.post('/me/collections', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`INSERT INTO collections(user_id, name) VALUES ($1,$2) RETURNING *`, [req.user.id, clean(req.body?.name || 'Collection', 60)]);
  res.json({ collection: c });
}));

api.get('/users/:username/followers', auth(false), wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT ${USER_CARD}, f.created_at FROM follows f JOIN users u ON u.id=f.follower_id
     WHERE f.following_id=(SELECT id FROM users WHERE username=$1) AND f.status='active' ORDER BY f.created_at DESC LIMIT 200`, [req.params.username]);
  res.json({ users: rows.map(r => ({ id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, verified: r.is_verified })) });
}));
api.get('/users/:username/following', auth(false), wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT ${USER_CARD}, f.created_at FROM follows f JOIN users u ON u.id=f.following_id
     WHERE f.follower_id=(SELECT id FROM users WHERE username=$1) AND f.status='active' ORDER BY f.created_at DESC LIMIT 200`, [req.params.username]);
  res.json({ users: rows.map(r => ({ id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, verified: r.is_verified })) });
}));
api.post('/users/:username/follow', auth(), wrap(async (req, res) => {
  const { rows: [target] } = await q(`SELECT id, is_private, follower_count FROM users WHERE username=$1`, [req.params.username]);
  if (!target) return bad(res, 'user_not_found', 404);
  if (String(target.id) === String(req.user.id)) return bad(res, 'cannot_follow_self');
  const existing = await q(`SELECT status FROM follows WHERE follower_id=$1 AND following_id=$2`, [req.user.id, target.id]);
  if (existing.rowCount) {
    await q(`DELETE FROM follows WHERE follower_id=$1 AND following_id=$2`, [req.user.id, target.id]);
    await q(`UPDATE users SET follower_count = GREATEST(0, follower_count-1) WHERE id=$1`, [target.id]);
    await q(`UPDATE users SET following_count = GREATEST(0, following_count-1) WHERE id=$1`, [req.user.id]);
    return res.json({ following: false, requested: false });
  }
  const status = target.is_private ? 'pending' : 'active';
  await q(`INSERT INTO follows(follower_id, following_id, status) VALUES ($1,$2,$3) ON CONFLICT (follower_id, following_id) DO UPDATE SET status=$3`, [req.user.id, target.id, status]);
  await q(`UPDATE users SET follower_count = follower_count+1 WHERE id=$1`, [target.id]);
  await q(`UPDATE users SET following_count = following_count+1 WHERE id=$1`, [req.user.id]);
  const io = req.app.get('io');
  await notify({ userId: target.id, actorId: req.user.id, type: status === 'pending' ? 'follow_request' : 'follow', entityType: 'user', entityId: req.user.id, io });
  res.json({ following: status === 'active', requested: status === 'pending' });
}));
api.get('/follow/requests', auth(), wrap(async (req, res) => {
  const { rows } = await q(`SELECT ${USER_CARD}, f.created_at FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=$1 AND f.status='pending'`, [req.user.id]);
  res.json({ requests: rows.map(r => ({ id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url })) });
}));
api.post('/follow/requests/:userId', auth(), wrap(async (req, res) => {
  const accept = !!req.body?.accept;
  if (accept) {
    await q(`UPDATE follows SET status='active' WHERE follower_id=$1 AND following_id=$2 AND status='pending'`, [req.params.userId, req.user.id]);
    const io = req.app.get('io');
    await notify({ userId: req.params.userId, actorId: req.user.id, type: 'follow', entityType: 'user', entityId: req.user.id, io });
  } else {
    await q(`DELETE FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='pending'`, [req.params.userId, req.user.id]);
  }
  res.json({ ok: true });
}));

// ---------------- media upload ----------------
export async function saveUpload(req, res, { maxBytes = 80 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 10 } });
    const files = [], fields = {};
    bb.on('file', (_, file, info) => {
      const chunks = [];
      file.on('data', d => chunks.push(d));
      file.on('limit', () => { file.truncated = true; });
      file.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (file.truncated) return reject(Object.assign(new Error('file_too_large'), { status: 413 }));
        files.push({ buf, mime: info.mimeType, name: info.filename });
      });
    });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('error', reject);
    bb.on('close', () => resolve({ files, fields }));
    req.pipe(bb);
  });
}
export async function storeMedia(ownerId, { buf, mime }) {
  // compress oversized uploads so giant phone videos don't break feeds/db
  if (mime.startsWith('video/') && buf.length > 8 * 1024 * 1024) {
    try {
      const { execFile } = await import('child_process');
      const fs = await import('fs');
      const tmpIn = `/tmp/up-${Date.now()}.bin`;
      const tmpOut = `/tmp/up-${Date.now()}.mp4`;
      fs.writeFileSync(tmpIn, buf);
      await new Promise((res, rej) => execFile('ffmpeg', ['-y','-loglevel','error','-i',tmpIn,'-c:v','libx264','-preset','fast','-crf','27','-c:a','aac','-b:a','96k','-vf','scale=720:-2','-movflags','+faststart',tmpOut], { timeout: 120000 }, (err) => err ? rej(err) : res()));
      const smaller = fs.readFileSync(tmpOut);
      fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut);
      if (smaller.length < buf.length) { buf = smaller; mime = 'video/mp4'; }
    } catch { /* keep original on any failure */ }
  }
  const { rows: [m] } = await q(`INSERT INTO media(owner_id, mime, size, data) VALUES ($1,$2,$3,$4) RETURNING id`,
    [ownerId, mime, buf.length, buf]);
  return m.id;
}
api.post('/media/upload', auth(), rateLimit('upload', 300, 3600e3), wrap(async (req, res) => {
  const { files } = await saveUpload(req, res, { maxBytes: 200 * 1024 * 1024 });
  const ids = [];
  for (const f of files) ids.push(await storeMedia(req.user.id, f));
  res.json({ ids: ids.map(id => `/media/${id}`), rawIds: ids });
}));

// ---------------- posts ----------------
api.post('/posts', auth(), rateLimit('post', 30, 3600e3), wrap(async (req, res) => {
  const { files, fields } = await saveUpload(req, res, { maxBytes: 100 * 1024 * 1024 });
  const caption = clean(fields.caption || '', 2200);
  const kind = fields.kind === 'reel' ? 'reel' : 'post';
  const location = clean(fields.location || '', 100);
  const altText = clean(fields.altText || '', 400);
  const scheduledAt = fields.scheduledAt ? new Date(fields.scheduledAt) : null;
  const exclusive = fields.exclusive === 'true';
  const status = scheduledAt && scheduledAt > new Date() ? 'scheduled' : 'published';
  if (!files.length && !caption) return bad(res, 'empty_post');
  const flags = await flagIfBad('post', null, caption, req.user.id);
  if (flags.includes('abuse')) return bad(res, 'content_violates_guidelines', 422);
  if (await isDuplicate(req.user.id, caption) && caption) return bad(res, 'duplicate_post', 422);
  const { rows: [p] } = await q(
    `INSERT INTO posts(user_id, kind, caption, location, alt_text, status, scheduled_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.id, kind, caption, location, altText, status, scheduledAt]);
  const mediaIds = [];
  for (const [i, f] of files.entries()) {
    const id = await storeMedia(req.user.id, f);
    mediaIds.push(id);
    await q(`INSERT INTO post_media(post_id, media_id, position) VALUES ($1,$2,$3)`, [p.id, id, i]);
  }
  if (exclusive) await q(`INSERT INTO exclusive_posts(post_id) VALUES ($1)`, [p.id]);
  const tags = await indexHashtags(p.id, caption);
  for (const uname of extractMentions(caption)) {
    const { rows: [mu] } = await q(`SELECT id FROM users WHERE username=$1`, [uname]);
    if (mu) {
      await q(`INSERT INTO post_mentions(post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [p.id, mu.id]);
      await notify({ userId: mu.id, actorId: req.user.id, type: 'mention', entityType: 'post', entityId: p.id, body: caption.slice(0, 100), io: req.app.get('io') });
    }
  }
  if (status === 'published') await q(`UPDATE users SET post_count = post_count + 1 WHERE id=$1`, [req.user.id]);
  // Creator boost: owner-tier creators' posts get instant reach proportional to audience
  if (status === 'published') {
    const { rows: [author] } = await q(`SELECT is_verified, follower_count FROM users WHERE id=$1`, [req.user.id]);
    if (author.is_verified && author.follower_count >= 50000) {
      const seed = Math.floor(author.follower_count * (0.35 + Math.random() * 0.25));
      // counter-only boost (rows-per-view exploded the DB at this scale)
      await q(`UPDATE posts SET view_count = view_count + $2 WHERE id=$1`, [p.id, seed]);
    }
  }
  const post = await loadPost(p.id, req.user.id);
  if (status === 'published') req.app.get('io').emit('post:new', { post, tags });
  res.json({ post });
}));

api.get('/posts/:id', auth(false), wrap(async (req, res) => {
  const post = await loadPost(req.params.id, req.user?.id);
  if (!post) return bad(res, 'post_not_found', 404);
  res.json({ post });
}));
api.patch('/posts/:id', auth(), wrap(async (req, res) => {
  const { rows: [p] } = await q(`SELECT user_id FROM posts WHERE id=$1`, [req.params.id]);
  if (!p) return bad(res, 'post_not_found', 404);
  if (String(p.user_id) !== String(req.user.id)) return bad(res, 'forbidden', 403);
  const caption = clean(req.body?.caption ?? '', 2200);
  await q(`UPDATE posts SET caption=$2, edited_at=now() WHERE id=$1`, [req.params.id, caption]);
  await q(`DELETE FROM post_hashtags WHERE post_id=$1`, [req.params.id]);
  await indexHashtags(req.params.id, caption);
  res.json({ post: await loadPost(req.params.id, req.user.id) });
}));
api.post('/posts/:id/archive', auth(), wrap(async (req, res) => {
  const { rows: [p] } = await q(`SELECT user_id FROM posts WHERE id=$1`, [req.params.id]);
  if (String(p?.user_id) !== String(req.user.id)) return bad(res, 'forbidden', 403);
  const restoring = !!req.body?.restore;
  await q(`UPDATE posts SET status=$2 WHERE id=$1`, [req.params.id, restoring ? 'published' : 'archived']);
  await q(`UPDATE users SET post_count = GREATEST(0, post_count + $3) WHERE id=$1`, [p.user_id, restoring ? 1 : -1]);
  res.json({ ok: true });
}));
api.delete('/posts/:id', auth(), wrap(async (req, res) => {
  const { rows: [p] } = await q(`SELECT user_id FROM posts WHERE id=$1`, [req.params.id]);
  if (!p) return bad(res, 'post_not_found', 404);
  if (String(p.user_id) !== String(req.user.id) && !req.user.is_admin) return bad(res, 'forbidden', 403);
  await q(`DELETE FROM posts WHERE id=$1`, [req.params.id]);
  await q(`UPDATE users SET post_count = GREATEST(0, post_count - 1) WHERE id=$1`, [p.user_id]);
  const io = req.app.get('io');
  io.emit('post:deleted', { id: req.params.id });
  res.json({ ok: true });
}));

api.post('/posts/:id/like', auth(), rateLimit('like', 120, 60e3), wrap(async (req, res) => {
  if (!(await canSeePost(req.params.id, req.user.id, req.user.is_admin))) return bad(res, 'post_not_found', 404);
  const { rowCount } = await q(`SELECT 1 FROM likes WHERE user_id=$1 AND post_id=$2`, [req.user.id, req.params.id]);
  if (rowCount) {
    await q(`DELETE FROM likes WHERE user_id=$1 AND post_id=$2`, [req.user.id, req.params.id]);
    const { rows: [p] } = await q(`UPDATE posts SET like_count = GREATEST(0, like_count-1) WHERE id=$1 RETURNING like_count`, [req.params.id]);
    return res.json({ liked: false, likeCount: p.like_count });
  }
  await q(`INSERT INTO likes(user_id, post_id) VALUES ($1,$2)`, [req.user.id, req.params.id]);
  const { rows: [p] } = await q(`UPDATE posts SET like_count = like_count+1 WHERE id=$1 RETURNING like_count, user_id`, [req.params.id]);
  const io = req.app.get('io');
  await notify({ userId: p.user_id, actorId: req.user.id, type: 'like', entityType: 'post', entityId: req.params.id, io });
  io.emit('post:like', { id: req.params.id, likeCount: p.like_count });
  res.json({ liked: true, likeCount: p.like_count });
}));

api.get('/posts/:id/likes', auth(false), wrap(async (req, res) => {
  const { rows } = await q(`SELECT ${USER_CARD} FROM likes l JOIN users u ON u.id=l.user_id WHERE l.post_id=$1 LIMIT 100`, [req.params.id]);
  res.json({ users: rows.map(r => ({ id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, verified: r.is_verified })) });
}));

api.post('/posts/:id/save', auth(), wrap(async (req, res) => {
  if (req.body?.collection) await q(`UPDATE saves SET collection_id=$3 WHERE user_id=$1 AND post_id=$2`, [req.user.id, req.params.id, req.body.collection]);
  const { rowCount } = await q(`SELECT 1 FROM saves WHERE user_id=$1 AND post_id=$2`, [req.user.id, req.params.id]);
  if (rowCount) {
    await q(`DELETE FROM saves WHERE user_id=$1 AND post_id=$2`, [req.user.id, req.params.id]);
    return res.json({ saved: false });
  }
  await q(`INSERT INTO saves(user_id, post_id, collection_id) VALUES ($1,$2,$3)`, [req.user.id, req.params.id, req.body?.collection || null]);
  res.json({ saved: true });
}));

api.post('/posts/:id/repost', auth(), wrap(async (req, res) => {
  if (!(await canSeePost(req.params.id, req.user.id, req.user.is_admin))) return bad(res, 'post_not_found', 404);
  const existing = await q(`SELECT 1 FROM reposts WHERE user_id=$1 AND post_id=$2`, [req.user.id, req.params.id]);
  if (existing.rowCount) {
    await q(`DELETE FROM reposts WHERE user_id=$1 AND post_id=$2`, [req.user.id, req.params.id]);
    const { rows: [p] } = await q(`UPDATE posts SET repost_count=GREATEST(0,repost_count-1) WHERE id=$1 RETURNING repost_count`, [req.params.id]);
    return res.json({ reposted: false, repostCount: p.repost_count });
  }
  await q(`INSERT INTO reposts(user_id, post_id) VALUES ($1,$2)`, [req.user.id, req.params.id]);
  const { rows: [p] } = await q(`UPDATE posts SET repost_count=repost_count+1 WHERE id=$1 RETURNING repost_count, user_id, kind`, [req.params.id]);
  const io = req.app.get('io');
  await notify({ userId: p.user_id, actorId: req.user.id, type: 'repost', entityType: 'post', entityId: req.params.id, io });
  res.json({ reposted: true, repostCount: p.repost_count });
}));

api.get('/posts/:id/comments', auth(false), wrap(async (req, res) => {
  if (!(await canSeePost(req.params.id, req.user?.id, req.user?.is_admin))) return bad(res, 'post_not_found', 404);
  const { rows } = await q(
    `SELECT c.id, c.parent_id, c.body, c.like_count, c.created_at, c.deleted, ${USER_CARD},
      EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id=c.id AND cl.user_id=$2) AS liked
     FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC LIMIT 500`,
    [req.params.id, req.user?.id]);
  const comments = rows.map(r => ({
    id: r.id, parentId: r.parent_id, body: r.deleted ? null : r.body, likeCount: r.like_count, liked: r.liked,
    createdAt: r.created_at, deleted: r.deleted, mine: req.user && r.id === req.user.id,
    author: { id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, verified: r.is_verified },
  }));
  res.json({ comments });
}));
api.post('/posts/:id/comments', auth(), rateLimit('comment', 40, 60e3), wrap(async (req, res) => {
  if (!(await canSeePost(req.params.id, req.user.id, req.user.is_admin))) return bad(res, 'post_not_found', 404);
  const { rows: [p] } = await q(`SELECT user_id, comments_disabled FROM posts WHERE id=$1`, [req.params.id]);
  if (!p) return bad(res, 'post_not_found', 404);
  if (p.comments_disabled && String(p.user_id) !== String(req.user.id)) return bad(res, 'comments_disabled', 403);
  const body = clean(req.body?.body || '', 1000);
  if (!body) return bad(res, 'empty_comment');
  const flags = await flagIfBad('comment', req.params.id, body, req.user.id);
  if (flags.includes('abuse')) return bad(res, 'content_violates_guidelines', 422);
  let parentUser = null;
  if (req.body?.parentId) parentUser = (await q(`SELECT user_id FROM comments WHERE id=$1 AND post_id=$2`, [req.body.parentId, req.params.id])).rows[0]?.user_id;
  const { rows: [c] } = await q(`INSERT INTO comments(post_id, user_id, parent_id, body) VALUES ($1,$2,$3,$4) RETURNING *`, [req.params.id, req.user.id, req.body?.parentId || null, body]);
  await q(`UPDATE posts SET comment_count=comment_count+1 WHERE id=$1`, [req.params.id]);
  const io = req.app.get('io');
  await notify({ userId: p.user_id, actorId: req.user.id, type: req.body?.parentId ? 'reply' : 'comment', entityType: 'post', entityId: req.params.id, body: body.slice(0, 100), io });
  if (parentUser) await notify({ userId: parentUser, actorId: req.user.id, type: 'reply', entityType: 'post', entityId: req.params.id, body: body.slice(0, 100), io });
  for (const uname of extractMentions(body)) {
    const { rows: [mu] } = await q(`SELECT id FROM users WHERE username=$1`, [uname]);
    if (mu) await notify({ userId: mu.id, actorId: req.user.id, type: 'mention', entityType: 'post', entityId: req.params.id, body: body.slice(0, 100), io });
  }
  io.emit('comment:new', { postId: req.params.id, commentCount: (await q(`SELECT comment_count FROM posts WHERE id=$1`, [req.params.id])).rows[0].comment_count });
  res.json({ comment: { id: c.id, parentId: c.parent_id, body: c.body, likeCount: 0, liked: false, createdAt: c.created_at, deleted: false, mine: true, author: { id: req.user.id, username: req.user.username, displayName: req.user.display_name, avatarUrl: req.user.avatar_url, verified: req.user.is_verified } } });
}));
api.post('/comments/:id/like', auth(), wrap(async (req, res) => {
  const { rowCount } = await q(`SELECT 1 FROM comment_likes WHERE user_id=$1 AND comment_id=$2`, [req.user.id, req.params.id]);
  if (rowCount) {
    await q(`DELETE FROM comment_likes WHERE user_id=$1 AND comment_id=$2`, [req.user.id, req.params.id]);
    const { rows: [c] } = await q(`UPDATE comments SET like_count=GREATEST(0,like_count-1) WHERE id=$1 RETURNING like_count`, [req.params.id]);
    return res.json({ liked: false, likeCount: c.like_count });
  }
  await q(`INSERT INTO comment_likes(user_id, comment_id) VALUES ($1,$2)`, [req.user.id, req.params.id]);
  const { rows: [c] } = await q(`UPDATE comments SET like_count=like_count+1 WHERE id=$1 RETURNING like_count, user_id, post_id`, [req.params.id]);
  await notify({ userId: c.user_id, actorId: req.user.id, type: 'comment_like', entityType: 'post', entityId: c.post_id, io: req.app.get('io') });
  res.json({ liked: true, likeCount: c.like_count });
}));
api.delete('/comments/:id', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`SELECT user_id, post_id FROM comments WHERE id=$1`, [req.params.id]);
  if (!c) return bad(res, 'not_found', 404);
  if (String(c.user_id) !== String(req.user.id) && !req.user.is_admin) return bad(res, 'forbidden', 403);
  await q(`UPDATE comments SET deleted=TRUE, body='' WHERE id=$1`, [req.params.id]);
  await q(`UPDATE posts SET comment_count=GREATEST(0,comment_count-1) WHERE id=$1`, [c.post_id]);
  res.json({ ok: true });
}));

// view tracking
api.post('/posts/:id/view', auth(false), wrap(async (req, res) => {
  await q(`INSERT INTO post_views(post_id, user_id, watched_ms) VALUES ($1,$2,$3)`,
    [req.params.id, req.user?.id || null, Math.min(600000, Number(req.body?.watchedMs) || 0)]);
  await q(`UPDATE posts SET view_count=view_count+1 WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- feed ----------------
api.get('/feed', auth(false), wrap(async (req, res) => {
  const kind = req.query.reels === '1' ? 'reel' : 'post';
  const scope = req.query.scope || 'following';
  const limit = Math.min(20, Number(req.query.limit) || 10);
  const cur = req.query.cursor ? ` AND p.created_at < '${new Date(req.query.cursor).toISOString()}'` : '';
  let where;
  if (!req.user || scope === 'explore') {
    where = `p.status='published' AND p.kind='${kind}' AND NOT au.is_private${cur}`;
  } else if (scope === 'foryou') {
    // recommendation engine: engagement-weighted recency + hashtag affinity + followed-graph
    where = `p.status='published' AND p.kind='${kind}' AND NOT au.is_private AND au.id != '${req.user.id}'${cur}
      AND NOT EXISTS(SELECT 1 FROM follows f WHERE f.follower_id='${req.user.id}' AND f.following_id=p.user_id AND f.status='active')`;
  } else {
    where = `p.status='published' AND p.kind='${kind}' AND (p.user_id='${req.user.id}'
      OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id='${req.user.id}' AND f.following_id=p.user_id AND f.status='active'))${cur}`;
  }
  const order = scope === 'foryou' && !req.query.cursor
    ? `ORDER BY ((p.like_count*3 + p.comment_count*4 + p.repost_count*5 + p.view_count*0.1)
        / POWER(GREATEST(EXTRACT(EPOCH FROM (now()-p.created_at))/3600, 1), 1.2)
        + CASE WHEN EXISTS(SELECT 1 FROM post_hashtags ph JOIN hashtags h ON h.id=ph.hashtag_id
            WHERE ph.post_id=p.id AND h.tag IN (
              SELECT h2.tag FROM post_hashtags ph2 JOIN hashtags h2 ON h2.id=ph2.hashtag_id JOIN posts p2 ON p2.id=ph2.post_id
              JOIN likes l2 ON l2.post_id=p2.id WHERE l2.user_id='${req.user.id}')) THEN 50 ELSE 0 END) DESC, p.created_at DESC`
    : 'ORDER BY p.created_at DESC';
  const { rows } = await q(`SELECT ${POST_SELECT2(meQ(req))} WHERE ${where} ${order} LIMIT ${limit}`.replace(/\$ME/g, req.user?.id || 'NULL::uuid'));
  res.json({ posts: rows.map(toPost), nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null });
}));

// ---------------- stories ----------------
api.post('/stories', auth(), rateLimit('story', 20, 3600e3), wrap(async (req, res) => {
  const { files, fields } = await saveUpload(req, res, { maxBytes: 30 * 1024 * 1024 });
  if (!files.length) return bad(res, 'media_required');
  const id = await storeMedia(req.user.id, files[0]);
  const { rows: [s] } = await q(`INSERT INTO stories(user_id, media_id, caption, expires_at) VALUES ($1,$2,$3, now() + interval '24 hours') RETURNING *`, [req.user.id, id, clean(fields.caption || '', 200)]);
  const io = req.app.get('io');
  io.emit('story:new', { userId: req.user.id, username: req.user.username });
  res.json({ story: { id: s.id, mediaUrl: `/media/${id}` } });
}));
api.get('/stories', auth(), wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT s.id, s.user_id, s.media_id, s.caption, s.created_at, s.expires_at,
      EXISTS(SELECT 1 FROM story_views v WHERE v.story_id=s.id AND v.user_id=$1) AS viewed,
      ${USER_CARD}
     FROM stories s JOIN users u ON u.id=s.user_id
     WHERE s.expires_at > now() AND (s.user_id=$1
       OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=s.user_id AND f.status='active'))
     ORDER BY s.created_at DESC LIMIT 200`, [req.user.id]);
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.user_id)) groups.set(r.user_id, { user: { id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url }, items: [], allViewed: true });
    const g = groups.get(r.user_id);
    g.items.push({ id: r.id, mediaUrl: `/media/${r.media_id}`, caption: r.caption, createdAt: r.created_at, expiresAt: r.expires_at, viewed: r.viewed });
    if (!r.viewed) g.allViewed = false;
  }
  res.json({ groups: [...groups.values()].sort((a, b) => (a.allViewed === b.allViewed ? 0 : a.allViewed ? 1 : -1)) });
}));
api.post('/stories/:id/view', auth(), wrap(async (req, res) => {
  await q(`INSERT INTO story_views(story_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, req.user.id]);
  res.json({ ok: true });
}));
api.post('/stories/:id/reply', auth(), wrap(async (req, res) => {
  const { rows: [s] } = await q(`SELECT user_id FROM stories WHERE id=$1 AND expires_at > now()`, [req.params.id]);
  if (!s) return bad(res, 'story_not_found', 404);
  await q(`INSERT INTO story_replies(story_id, user_id, body) VALUES ($1,$2,$3)`, [req.params.id, req.user.id, clean(req.body?.body || '', 500)]);
  await notify({ userId: s.user_id, actorId: req.user.id, type: 'story_reply', entityType: 'story', entityId: req.params.id, body: clean(req.body?.body, 100), io: req.app.get('io') });
  res.json({ ok: true });
}));
api.get('/stories/:id/views', auth(), wrap(async (req, res) => {
  const { rows: [s] } = await q(`SELECT user_id FROM stories WHERE id=$1`, [req.params.id]);
  if (String(s?.user_id) !== String(req.user.id)) return bad(res, 'forbidden', 403);
  const { rows } = await q(`SELECT ${USER_CARD}, v.viewed_at FROM story_views v JOIN users u ON u.id=v.user_id WHERE v.story_id=$1 ORDER BY v.viewed_at DESC`, [req.params.id]);
  res.json({ viewers: rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, viewedAt: r.viewed_at })) });
}));
api.get('/me/stories', auth(), wrap(async (req, res) => {
  const { rows } = await q(`SELECT s.*, (SELECT count(*) FROM story_views v WHERE v.story_id=s.id) AS views FROM stories s WHERE s.user_id=$1 AND s.expires_at > now() ORDER BY s.created_at DESC`, [req.user.id]);
  res.json({ stories: rows });
}));

// ---------------- conversations / messages ----------------
api.get('/conversations', auth(), wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT c.id, c.is_group, c.title, c.avatar_url,
      cm.role AS my_role,
      c.description, c.invite_code,
      (SELECT json_agg(json_build_object('id', u2.id, 'username', u2.username, 'displayName', u2.display_name, 'avatarUrl', u2.avatar_url, 'verified', u2.is_verified, 'role', cm3.role, 'lastReadAt', cm3.last_read_at))
        FROM conversation_members cm2 JOIN users u2 ON u2.id=cm2.user_id LEFT JOIN conversation_members cm3 ON cm3.conversation_id=c.id AND cm3.user_id=u2.id WHERE cm2.conversation_id=c.id) AS members,
      (SELECT json_build_object('id', m.id, 'body', m.body, 'kind', m.kind, 'createdAt', m.created_at, 'senderId', m.sender_id)
        FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
      (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id AND m.created_at > COALESCE(cm.last_read_at, to_timestamp(0)) AND m.sender_id != $1) AS unread
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1
     ORDER BY COALESCE((SELECT max(created_at) FROM messages m WHERE m.conversation_id=c.id), c.created_at) DESC`,
    [req.user.id]);
  res.json({ conversations: rows });
}));
api.post('/conversations', auth(), wrap(async (req, res) => {
  const { usernames, title } = req.body || {};
  const list = Array.isArray(usernames) ? usernames.slice(0, 50) : [usernames].filter(Boolean);
  const { rows: users } = await q(`SELECT id FROM users WHERE username = ANY($1)`, [list]);
  if (!users.length) return bad(res, 'user_not_found');
  const isGroup = !!(users.length > 1 || title);
  if (!isGroup) {
    const { rows } = await q(
      `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=$1
       JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=$2
       WHERE NOT c.is_group LIMIT 1`, [req.user.id, users[0].id]);
    if (rows.length) return res.json({ conversationId: rows[0].id });
  }
  const { rows: [c] } = await q(`INSERT INTO conversations(is_group, title, created_by) VALUES ($1,$2,$3) RETURNING id`,
    [isGroup, title ? clean(title, 80) : null, req.user.id]);
  const members = [req.user.id, ...users.map(u => u.id).filter(id => String(id) !== String(req.user.id))];
  for (const [i, uid] of members.entries())
    await q(`INSERT INTO conversation_members(conversation_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [c.id, uid, i === 0 && isGroup ? 'owner' : 'member']);
  res.json({ conversationId: c.id });
}));
api.get('/conversations/:id/messages', auth(), wrap(async (req, res) => {
  const member = await q(`SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!member.rowCount) return bad(res, 'forbidden', 403);
  const cur = req.query.cursor ? ` AND m.created_at < '${new Date(req.query.cursor).toISOString()}'` : '';
  const { rows } = await q(
    `SELECT m.id, m.sender_id, m.reply_to_id, m.kind, m.body, m.media_id, m.duration_ms, m.created_at, m.deleted_at, m.starred, m.pinned_at, m.forwarded_from,
      ${USER_CARD.replace(/u\./g, 'su.')},
      (SELECT json_agg(json_build_object('emoji', mr.emoji, 'users', json_build_object('id', ru.id, 'username', ru.username)))
        FROM message_reactions mr JOIN users ru ON ru.id=mr.user_id WHERE mr.message_id=m.id) AS reactions
     FROM messages m JOIN users su ON su.id=m.sender_id WHERE m.conversation_id=$1
       AND ($2::uuid IS NULL OR NOT ($2::uuid = ANY(COALESCE(m.deleted_for, '{}'))))${cur}
     ORDER BY m.created_at DESC LIMIT 30`, [req.params.id, req.user.id]);
  await q(`UPDATE conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  res.json({
    messages: rows.map(r => ({
      id: r.id, senderId: r.sender_id, replyToId: r.reply_to_id, kind: r.kind, body: r.deleted_at ? null : r.body,
      mediaUrl: r.media_id ? `/media/${r.media_id}` : null, durationMs: r.duration_ms, createdAt: r.created_at, deleted: !!r.deleted_at,
      starred: r.starred, pinned: !!r.pinned_at, forwarded: !!r.forwarded_from,
      reactions: (r.reactions || []).map(x => ({ emoji: x.emoji, users: [x.users] })),
      sender: { id: r.aid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url },
    })).reverse(),
    nextCursor: rows.length === 30 ? rows[rows.length - 1].created_at : null,
  });
}));
api.post('/conversations/:id/messages', auth(), rateLimit('msg', 300, 60e3), wrap(async (req, res) => {
  const member = await q(`SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!member.rowCount) return bad(res, 'forbidden', 403);
  let mediaId = null, kind = 'text', duration = null;
  const b = req.body || {};
  if (b.kind === 'sticker') kind = 'sticker';
  if (b.mediaUrl) { mediaId = String(b.mediaUrl).split('/').pop(); kind = b.kind || 'image'; duration = b.durationMs || null; }
  const body = clean(b.body || '', 4000);
  if (!body && !mediaId) return bad(res, 'empty_message');
  if (kind === 'sticker' && !/^\S{1,64}$/.test(body)) return bad(res, 'empty_message');
  const { rows: [m] } = await q(
    `INSERT INTO messages(conversation_id, sender_id, kind, body, media_id, duration_ms, reply_to_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, req.user.id, kind, body || null, mediaId, duration, b.replyToId || null]);
  const payload = { id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, kind, body, mediaUrl: mediaId ? `/media/${mediaId}` : null, durationMs: duration, replyToId: m.reply_to_id, createdAt: m.created_at, sender: { id: req.user.id, username: req.user.username, displayName: req.user.display_name, avatarUrl: req.user.avatar_url } };
  const io = req.app.get('io');
  const { rows: members } = await q(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id != $2`, [req.params.id, req.user.id]);
  // @mentions: notify members the message tags (WhatsApp style)
  let mentions = [];
  if (body) {
    const names = extractMentions(body);
    if (names.length) {
      const { rows: musers } = await q(`SELECT id, username FROM users WHERE username = ANY($1)`, [names]);
      const memberIds = new Set(members.map(u => String(u.user_id)));
      mentions = musers.filter(u => memberIds.has(String(u.id)) && String(u.id) !== String(req.user.id));
    }
  }
  payload.mentions = mentions.map(u => ({ id: u.id, username: u.username }));
  for (const u of members) {
    io.to(`user:${u.user_id}`).emit('message:new', payload);
    const { rows: [prefs] } = await q(`SELECT settings FROM users WHERE id=$1`, [u.user_id]);
    if (mentions.some(m => String(m.id) === String(u.user_id))) {
      await notify({ userId: u.user_id, actorId: req.user.id, type: 'mention', entityType: 'conversation', entityId: req.params.id, body: body.slice(0, 80), io });
      sendPush(u.user_id, req.user.display_name || req.user.username, `mentioned you: ${kind === 'sticker' ? '🎨 Sticker' : body.slice(0, 60)}`,
        { conversationId: req.params.id, senderId: String(req.user.id) });
    } else if (prefs?.settings?.notify?.messages !== false) {
      const pushBody = kind === 'sticker' ? (body.startsWith('/stickers/') ? '🎨 Sticker' : body) : body ? body.slice(0, 80) : (kind === 'voice' ? '🎤 Voice note' : kind === 'video' ? '🎬 Video' : '📷 Photo');
      await notify({ userId: u.user_id, actorId: req.user.id, type: 'message', entityType: 'conversation', entityId: req.params.id, body: body ? body.slice(0, 80) : (kind === 'voice' ? 'Voice note' : kind), io });
      sendPush(u.user_id, req.user.display_name || req.user.username, pushBody,
        { conversationId: req.params.id, senderId: String(req.user.id) });
    }
  }
  res.json({ message: payload });
}));
api.post('/conversations/:id/read', auth(), wrap(async (req, res) => {
  await q(`UPDATE conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  req.app.get('io').to(`conv:${req.params.id}`).emit('message:read', { conversationId: req.params.id, userId: req.user.id, at: new Date().toISOString() });
  res.json({ ok: true });
}));
api.post('/conversations/:id/members', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`SELECT created_by, is_group FROM conversations WHERE id=$1`, [req.params.id]);
  if (!c || !c.is_group || String(c.created_by) !== String(req.user.id)) return bad(res, 'forbidden', 403);
  for (const uname of req.body?.usernames || []) {
    const { rows: [u] } = await q(`SELECT id FROM users WHERE username=$1`, [uname]);
    if (u) await q(`INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, u.id]);
  }
  res.json({ ok: true });
}));

// ---------------- message actions ----------------
api.post('/messages/:id/react', auth(), wrap(async (req, res) => {
  const emoji = clean(req.body?.emoji || '❤️', 8);
  const { rows: [m] } = await q(`SELECT conversation_id FROM messages WHERE id=$1`, [req.params.id]);
  if (!m) return bad(res, 'not_found', 404);
  const member = await q(`SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [m.conversation_id, req.user.id]);
  if (!member.rowCount) return bad(res, 'forbidden', 403);
  const existing = await q(`SELECT emoji FROM message_reactions WHERE message_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (existing.rowCount && existing.rows[0].emoji === emoji) {
    await q(`DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  } else {
    await q(`INSERT INTO message_reactions(message_id, user_id, emoji) VALUES ($1,$2,$3)
             ON CONFLICT (message_id, user_id) DO UPDATE SET emoji=$3`, [req.params.id, req.user.id, emoji]);
  }
  const reactions = (await q(
    `SELECT emoji, json_agg(json_build_object('id', u.id, 'username', u.username)) AS users
     FROM message_reactions mr JOIN users u ON u.id=mr.user_id WHERE message_id=$1 GROUP BY emoji`, [req.params.id])).rows;
  req.app.get('io').to(`conv:${m.conversation_id}`).emit('message:reactions', { id: req.params.id, reactions });
  res.json({ reactions });
}));

api.post('/messages/:id/star', auth(), wrap(async (req, res) => {
  const { rows: [m] } = await q(`UPDATE messages SET starred = NOT starred WHERE id=$1 AND sender_id=$2 RETURNING starred`, [req.params.id, req.user.id]);
  if (!m) return bad(res, 'forbidden', 403);
  res.json({ starred: m.starred });
}));

api.post('/messages/:id/pin', auth(), wrap(async (req, res) => {
  const member = await q(`SELECT role FROM conversation_members cm JOIN messages m ON m.conversation_id=cm.conversation_id WHERE m.id=$1 AND cm.user_id=$2`, [req.params.id, req.user.id]);
  if (!member.rowCount) return bad(res, 'forbidden', 403);
  const { rows: [m] } = await q(`SELECT conversation_id, pinned_at FROM messages WHERE id=$1`, [req.params.id]);
  const pin = !m.pinned_at;
  await q(`UPDATE messages SET pinned_at=$2 WHERE id=$1`, [req.params.id, pin ? new Date() : null]);
  await q(`UPDATE messages SET pinned_at=NULL WHERE conversation_id=$1 AND id != $2 AND pinned_at IS NOT NULL`, [m.conversation_id, req.params.id]);
  req.app.get('io').to(`conv:${m.conversation_id}`).emit('message:pinned', { id: req.params.id, pinned: pin });
  res.json({ pinned: pin });
}));

api.post('/messages/:id/forward', auth(), rateLimit('msg', 300, 60e3), wrap(async (req, res) => {
  const { conversationIds } = req.body || {};
  if (!Array.isArray(conversationIds) || !conversationIds.length) return bad(res, 'no_targets');
  const { rows: [src] } = await q(`SELECT m.*, u.username AS sender_username FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1`, [req.params.id]);
  if (!src) return bad(res, 'not_found', 404);
  const results = [];
  for (const cid of conversationIds.slice(0, 10)) {
    const member = await q(`SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [cid, req.user.id]);
    if (!member.rowCount) continue;
    const { rows: [m] } = await q(
      `INSERT INTO messages(conversation_id, sender_id, kind, body, media_id, duration_ms, forwarded_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`, [cid, req.user.id, src.kind, src.body, src.media_id, src.duration_ms, req.params.id]);
    const payload = { id: m.id, conversationId: cid, senderId: req.user.id, kind: src.kind, body: src.body, mediaUrl: src.media_id ? `/media/${src.media_id}` : null, forwarded: true, createdAt: m.created_at, sender: { id: req.user.id, username: req.user.username, displayName: req.user.display_name, avatarUrl: req.user.avatar_url } };
    req.app.get('io').to(`conv:${cid}`).emit('message:new', payload);
    const { rows: others } = await q(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id != $2`, [cid, req.user.id]);
    for (const u of others) req.app.get('io').to(`user:${u.user_id}`).emit('message:new', payload);
    results.push(m.id);
  }
  res.json({ forwardedTo: results });
}));

// delete for me (hide only for self) / delete for everyone
api.post('/messages/:id/delete', auth(), wrap(async (req, res) => {
  const scope = req.body?.forEveryone ? 'everyone' : 'me';
  const { rows: [m] } = await q(`SELECT sender_id, conversation_id, deleted_for FROM messages WHERE id=$1`, [req.params.id]);
  if (!m) return bad(res, 'not_found', 404);
  if (scope === 'everyone') {
    if (String(m.sender_id) !== String(req.user.id) && !req.user.is_admin) return bad(res, 'forbidden', 403);
    await q(`UPDATE messages SET deleted_at=now(), body=NULL WHERE id=$1`, [req.params.id]);
    const payload = { id: req.params.id, conversationId: m.conversation_id, deleted: true };
    const io = req.app.get('io');
    io.to(`conv:${m.conversation_id}`).emit('message:deleted', payload);
    const { rows: others } = await q(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id != $2`, [m.conversation_id, req.user.id]);
    for (const u of others) io.to(`user:${u.user_id}`).emit('message:deleted', payload);
  } else {
    await q(`UPDATE messages SET deleted_for = array_append(COALESCE(deleted_for, '{}'), $2) WHERE id=$1`, [req.params.id, req.user.id]);
  }
  res.json({ ok: true, scope });
}));

// group management
api.post('/conversations/:id/settings', auth(), wrap(async (req, res) => {
  const { rows: [cm] } = await q(`SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!cm || !['owner', 'admin'].includes(cm.role)) return bad(res, 'forbidden', 403);
  const { title, description } = req.body || {};
  if (title !== undefined) await q(`UPDATE conversations SET title=$2 WHERE id=$1`, [req.params.id, clean(title, 80)]);
  if (description !== undefined) await q(`UPDATE conversations SET description=$2 WHERE id=$1`, [req.params.id, clean(description, 500)]);
  res.json({ ok: true });
}));
api.post('/conversations/:id/invite-link', auth(), wrap(async (req, res) => {
  const { rows: [cm] } = await q(`SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!cm || !['owner', 'admin'].includes(cm.role)) return bad(res, 'forbidden', 403);
  const code = crypto.randomBytes(8).toString('base64url');
  await q(`UPDATE conversations SET invite_code=$2 WHERE id=$1`, [req.params.id, code]);
  res.json({ inviteCode: code });
}));
api.post('/conversations/join/:code', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`SELECT id, banned_members FROM conversations WHERE invite_code=$1 AND is_group=TRUE`, [req.params.code]);
  if (!c) return bad(res, 'invalid_link', 404);
  if ((c.banned_members || []).includes(req.user.id)) return bad(res, 'banned_from_group', 403);
  await q(`INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.id, req.user.id]);
  res.json({ conversationId: c.id });
}));
api.post('/conversations/:id/members/:userId/role', auth(), wrap(async (req, res) => {
  const { rows: [me] } = await q(`SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!me || !['owner', 'admin'].includes(me.role)) return bad(res, 'forbidden', 403);
  const role = req.body?.role;
  if (!['admin', 'member'].includes(role)) return bad(res, 'invalid_role');
  if (me.role !== 'owner' && role === 'admin') return bad(res, 'owner_only_promote', 403);
  await q(`UPDATE conversation_members SET role=$3 WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.params.userId, role]);
  res.json({ ok: true, role });
}));
api.post('/conversations/:id/members/:userId/kick', auth(), wrap(async (req, res) => {
  const { rows: [me] } = await q(`SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!me || !['owner', 'admin'].includes(me.role)) return bad(res, 'forbidden', 403);
  const { rows: [them] } = await q(`SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.params.userId]);
  if (!them || them.role === 'owner') return bad(res, 'cannot_kick_owner', 403);
  await q(`DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.params.userId]);
  res.json({ ok: true });
}));
api.post('/conversations/:id/members/:userId/ban', auth(), wrap(async (req, res) => {
  const { rows: [me] } = await q(`SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!me || !['owner', 'admin'].includes(me.role)) return bad(res, 'forbidden', 403);
  await q(`UPDATE conversations SET banned_members = array_append(COALESCE(banned_members, '{}'), $2) WHERE id=$1`, [req.params.id, req.params.userId]);
  await q(`DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.params.userId]);
  res.json({ ok: true });
}));
api.post('/conversations/:id/members/:userId/mute', auth(), wrap(async (req, res) => {
  const { rows: [me] } = await q(`SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!me || !['owner', 'admin'].includes(me.role)) return bad(res, 'forbidden', 403);
  await q(`UPDATE conversations SET muted_members = array_append(COALESCE(muted_members, '{}'), $2) WHERE id=$1`, [req.params.id, req.params.userId]);
  res.json({ ok: true });
}));
api.post('/conversations/:id/requests/:userId', auth(), wrap(async (req, res) => {
  const { rows: [cm] } = await q(`SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!cm || !['owner', 'admin'].includes(cm.role)) return bad(res, 'forbidden', 403);
  if (req.body?.approve) {
    await q(`INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, req.params.userId]);
    await q(`UPDATE conversations SET join_requests = array_remove(join_requests, $2) WHERE id=$1`, [req.params.id, req.params.userId]);
  } else {
    await q(`UPDATE conversations SET join_requests = array_remove(join_requests, $2) WHERE id=$1`, [req.params.id, req.params.userId]);
  }
  res.json({ ok: true });
}));

// ---------------- moderation: block/restrict/mute ----------------
api.post('/users/:username/block', auth(), wrap(async (req, res) => {
  const { rows: [t] } = await q(`SELECT id FROM users WHERE username=$1`, [req.params.username]);
  if (!t) return bad(res, 'user_not_found', 404);
  const kind = ['block', 'restrict', 'mute'].includes(req.body?.kind) ? req.body.kind : 'block';
  const existing = await q(`SELECT kind FROM blocks WHERE blocker_id=$1 AND blocked_id=$2`, [req.user.id, t.id]);
  if (existing.rowCount) {
    await q(`DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2`, [req.user.id, t.id]);
    return res.json({ [kind]: false, removed: existing.rows[0].kind });
  }
  await q(`INSERT INTO blocks(blocker_id, blocked_id, kind) VALUES ($1,$2,$3)`, [req.user.id, t.id, kind]);
  if (kind === 'block') {
    await q(`DELETE FROM follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)`, [req.user.id, t.id]);
  }
  res.json({ [kind]: true });
}));

// ---------------- channels ----------------
api.post('/channels', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`INSERT INTO channels(name, description, owner_id) VALUES ($1,$2,$3) RETURNING *`,
    [clean(req.body?.name || 'Channel', 80), clean(req.body?.description || '', 500), req.user.id]);
  await q(`INSERT INTO channel_follows(channel_id, user_id) VALUES ($1,$2)`, [c.id, req.user.id]);
  await q(`UPDATE channels SET follower_count=1 WHERE id=$1`, [c.id]);
  res.json({ channel: c });
}));
api.get('/channels', auth(false), wrap(async (req, res) => {
  const { rows } = await q(`SELECT c.*, u.username AS owner_username, u.display_name AS owner_name,
    EXISTS(SELECT 1 FROM channel_follows f WHERE f.channel_id=c.id AND f.user_id=$2) AS following
    FROM channels c JOIN users u ON u.id=c.owner_id ORDER BY c.follower_count DESC LIMIT 50`, [0, req.user?.id]);
  res.json({ channels: rows });
}));
api.post('/channels/:id/follow', auth(), wrap(async (req, res) => {
  const { rowCount } = await q(`SELECT 1 FROM channel_follows WHERE channel_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (rowCount) {
    await q(`DELETE FROM channel_follows WHERE channel_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    await q(`UPDATE channels SET follower_count=GREATEST(0, follower_count-1) WHERE id=$1`, [req.params.id]);
    return res.json({ following: false });
  }
  await q(`INSERT INTO channel_follows(channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, req.user.id]);
  await q(`UPDATE channels SET follower_count=follower_count+1 WHERE id=$1`, [req.params.id]);
  res.json({ following: true });
}));
api.post('/channels/:id/broadcast', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`SELECT owner_id FROM channels WHERE id=$1`, [req.params.id]);
  if (!c || String(c.owner_id) !== String(req.user.id)) return bad(res, 'owner_only_posting', 403);
  const mediaId = req.body?.mediaUrl ? String(req.body.mediaUrl).split('/').pop() : null;
  const { rows: [p] } = await q(`INSERT INTO channel_posts(channel_id, author_id, body, media_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, req.user.id, clean(req.body?.body || '', 3000), mediaId]);
  res.json({ post: p });
}));
api.get('/channels/:id/posts', auth(false), wrap(async (req, res) => {
  const { rows } = await q(`SELECT cp.*, u.username, u.display_name, u.avatar_url
    FROM channel_posts cp JOIN users u ON u.id=cp.author_id WHERE cp.channel_id=$1 ORDER BY cp.created_at DESC LIMIT 100`, [req.params.id]);
  res.json({ posts: rows.map(r => ({ id: r.id, body: r.body, mediaUrl: r.media_id ? `/media/${r.media_id}` : null, reactions: r.reactions, createdAt: r.created_at, author: { username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url } })) });
}));
api.post('/channel-posts/:id/react', auth(), wrap(async (req, res) => {
  await q(`INSERT INTO channel_reactions(post_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT (post_id, user_id) DO UPDATE SET emoji=$3`,
    [req.params.id, req.user.id, clean(req.body?.emoji || '🔥', 8)]);
  const { rows: [p] } = await q(`UPDATE channel_posts SET reactions = (SELECT count(*) FROM channel_reactions WHERE post_id=$1) WHERE id=$1 RETURNING reactions`, [req.params.id]);
  res.json({ reactions: p.reactions });
}));

// ---------------- polls ----------------
api.post('/posts/:id/poll/vote', auth(), wrap(async (req, res) => {
  const idx = Number(req.body?.optionIdx);
  const { rows: [p] } = await q(`SELECT poll_options FROM posts WHERE id=$1`, [req.params.id]);
  if (!p || !p.poll_options || idx < 0 || idx >= p.poll_options.length) return bad(res, 'invalid_option');
  await q(`INSERT INTO poll_votes(post_id, user_id, option_idx) VALUES ($1,$2,$3)
           ON CONFLICT (post_id, user_id) DO UPDATE SET option_idx=$3`, [req.params.id, req.user.id, idx]);
  const counts = (await q(`SELECT option_idx, count(*) FROM poll_votes WHERE post_id=$1 GROUP BY option_idx`, [req.params.id])).rows;
  const total = counts.reduce((a, c) => a + Number(c.count), 0);
  res.json({ results: p.poll_options.map((_, i) => ({ option: i, votes: Number(counts.find(c => Number(c.option_idx) === i)?.count || 0), pct: total ? Math.round(Number(counts.find(c => Number(c.option_idx) === i)?.count || 0) / total * 100) : 0 })), total });
}));

// ---------------- profile upgrades ----------------
api.patch('/me/profile-design', auth(), wrap(async (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [];
  for (const [key, col, max] of [['banner', 'profile_banner', 500], ['theme', 'profile_theme', 40], ['music', 'profile_music', 300], ['frame', 'profile_frame', 40]]) {
    if (b[key] !== undefined) { sets.push(`${col}=$${sets.length + 1}`); vals.push(String(b[key]).slice(0, max)); }
  }
  if (sets.length) await q(`UPDATE users SET updated_at=now(), ${sets.join(',')} WHERE id=$${sets.length + 1}`, [...vals, req.user.id]);
  const { rows: [u] } = await q(`SELECT profile_banner, profile_theme, profile_music, profile_frame FROM users WHERE id=$1`, [req.user.id]);
  res.json({ profile: u });
}));
api.post('/users/:username/poll', auth(), wrap(async (req, res) => { res.json({ ok: true }); }));

// ---------------- message actions ----------------
api.patch('/messages/:id', auth(), wrap(async (req, res) => {
  const { rows: [m] } = await q(`SELECT sender_id, conversation_id FROM messages WHERE id=$1`, [req.params.id]);
  if (!m) return bad(res, 'not_found', 404);
  if (String(m.sender_id) !== String(req.user.id)) return bad(res, 'forbidden', 403);
  const body = clean(req.body?.body || '', 4000);
  if (!body) return bad(res, 'empty_message');
  await q(`UPDATE messages SET body=$2 WHERE id=$1`, [req.params.id, body]);
  const payload = { id: req.params.id, conversationId: m.conversation_id, edited: true, body };
  const io = req.app.get('io');
  io.to(`conv:${m.conversation_id}`).emit('message:edited', payload);
  const { rows: others } = await q(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id != $2`, [m.conversation_id, req.user.id]);
  for (const u of others) io.to(`user:${u.user_id}`).emit('message:edited', payload);
  res.json({ ok: true, body });
}));

api.delete('/messages/:id', auth(), wrap(async (req, res) => {
  const { rows: [m] } = await q(`SELECT sender_id, conversation_id FROM messages WHERE id=$1`, [req.params.id]);
  if (!m) return bad(res, 'not_found', 404);
  if (String(m.sender_id) !== String(req.user.id) && !req.user.is_admin) return bad(res, 'forbidden', 403);
  await q(`UPDATE messages SET deleted_at=now(), body=NULL WHERE id=$1`, [req.params.id]);
  const payload = { id: req.params.id, conversationId: m.conversation_id, deleted: true };
  const io = req.app.get('io');
  io.to(`conv:${m.conversation_id}`).emit('message:deleted', payload);
  const { rows: others } = await q(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id != $2`, [m.conversation_id, req.user.id]);
  for (const u of others) io.to(`user:${u.user_id}`).emit('message:deleted', payload);
  res.json({ ok: true });
}));

api.post('/messages/:id/report', auth(), rateLimit('report', 20, 3600e3), wrap(async (req, res) => {
  const { rows: [m] } = await q(`SELECT sender_id, conversation_id, body FROM messages WHERE id=$1`, [req.params.id]);
  if (!m) return bad(res, 'not_found', 404);
  const reason = clean(req.body?.reason || 'inappropriate', 100);
  const details = clean(req.body?.details || '', 500);
  await q(`INSERT INTO reports(reporter_id, target_type, target_id, reason, details) VALUES ($1,'message',$2,$3,$4)`,
    [req.user.id, req.params.id, reason, details]);
  // Admin sees reported message content instantly (with context)
  const { rows: [convMembers] } = await q(
    `SELECT json_agg(json_build_object('id', u.id, 'username', u.username)) AS members
     FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=$1`, [m.conversation_id]);
  const { rows: [reporter] } = await q(`SELECT username FROM users WHERE id=$1`, [req.user.id]);
  const { rows: [sender] } = await q(`SELECT username FROM users WHERE id=$1`, [m.sender_id]);
  const io = req.app.get('io');
  io.to('admin-room').emit('admin:report:new', {
    reportId: null, targetType: 'message', targetId: req.params.id, reason, details,
    messageBody: m.body, messageKind: 'text', conversationId: m.conversation_id,
    members: convMembers?.members || [], reporter: reporter?.username, sender: sender?.username,
    createdAt: new Date().toISOString(),
  });
  await notify({ userId: m.sender_id, actorId: req.user.id, type: 'system', entityType: 'message', entityId: req.params.id, body: 'Your message was reported and is under review', io });
  res.json({ ok: true });
}));

// admin resolves message reports: remove message or dismiss
api.post('/admin/messages/:id/action', auth(true), ownerOnly, wrap(async (req, res) => {
  const action = req.body?.action;
  if (!['remove', 'dismiss', 'warn', 'ban_sender'].includes(action)) return bad(res, 'invalid_action');
  const { rows: [m] } = await q(`SELECT sender_id, conversation_id FROM messages WHERE id=$1`, [req.params.id]);
  if (!m) return bad(res, 'not_found', 404);
  if (action === 'remove') {
    await q(`UPDATE messages SET deleted_at=now(), body=NULL WHERE id=$1`, [req.params.id]);
    req.app.get('io').to(`conv:${m.conversation_id}`).emit('message:deleted', { id: req.params.id, conversationId: m.conversation_id, deleted: true });
  } else if (action === 'ban_sender') {
    const { rows: [t] } = await q(`SELECT username FROM users WHERE id=$1`, [m.sender_id]);
    await q(`UPDATE users SET account_status='banned', suspended_reason=$2 WHERE id=$1`, [m.sender_id, clean(req.body?.reason || 'Inappropriate messages', 200)]);
    await q(`UPDATE sessions SET revoked=TRUE WHERE user_id=$1`, [m.sender_id]);
    await audit(req.user, 'user_banned', 'user', m.sender_id, t, 'via message report action');
  }
  // mark related reports resolved
  await q(`UPDATE reports SET status=$2, resolution=$3 WHERE target_type='message' AND target_id=$1`, [req.params.id, 'resolved', action]);
  res.json({ ok: true });
}));

// ---------------- push notifications ----------------
let vapidReady = false;
try {
  if (process.env.PUSH_VAPID_PUBLIC && process.env.PUSH_VAPID_PRIVATE) {
    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails('mailto:' + (process.env.OWNER_EMAIL || 'owner@pixora.app'), process.env.PUSH_VAPID_PUBLIC, process.env.PUSH_VAPID_PRIVATE);
    vapidReady = true;
  }
} catch {}
export async function sendPush(userId, title, body, data) {
  if (!vapidReady) return;
  try {
    const subs = (await q(`SELECT endpoint, keys FROM push_subscriptions WHERE user_id=$1`, [userId])).rows;
    const webpush = (await import('web-push')).default;
    await Promise.all(subs.map(s => webpush.sendNotification(
      { endpoint: s.endpoint, keys: s.keys },
      JSON.stringify({ title, body, ...data, requireInteraction: false })
    ).catch(() => q(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [s.endpoint]))));
  } catch {}
}
api.post('/push/subscribe', auth(), wrap(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys) return bad(res, 'invalid_subscription');
  await q(`INSERT INTO push_subscriptions(user_id, endpoint, keys) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, endpoint) DO UPDATE SET keys=$3`, [req.user.id, endpoint, keys]);
  res.json({ ok: true });
}));

// ---------------- notifications ----------------
api.get('/notifications', auth(), wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT n.*, ${USER_CARD} FROM notifications n LEFT JOIN users u ON u.id=n.actor_id
     WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`, [req.user.id]);
  res.json({
    notifications: rows.map(r => ({
      id: r.id, type: r.type, body: r.body, read: r.read, entityType: r.entity_type, entityId: r.entity_id, createdAt: r.created_at,
      actor: r.uid ? { id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url } : null,
    })),
    unread: rows.filter(r => !r.read).length,
  });
}));
api.post('/notifications/read', auth(), wrap(async (req, res) => {
  if (req.body?.id) await q(`UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2`, [req.body.id, req.user.id]);
  else await q(`UPDATE notifications SET read=TRUE WHERE user_id=$1`, [req.user.id]);
  res.json({ ok: true });
}));

// ---------------- search & explore ----------------
api.get('/search', auth(false), wrap(async (req, res) => {
  const qs = String(req.query.q || '').trim();
  if (!qs) return res.json({ users: [], posts: [], hashtags: [] });
  const like = `%${qs.replace(/[%_]/g, '')}%`;
  const tag = qs.replace(/^#/, '').toLowerCase();
  const { rows: users } = await q(
    `SELECT ${USER_CARD}, follower_count FROM users u WHERE (username ILIKE $1 OR display_name ILIKE $1) AND account_status='active' ORDER BY follower_count DESC LIMIT 20`, [like]);
  const { rows: hashtags } = await q(`SELECT tag, use_count FROM hashtags WHERE tag ILIKE $1 ORDER BY use_count DESC LIMIT 10`, [`%${tag}%`]);
  let posts = [];
  if (req.user) {
    const r = await q(`SELECT ${POST_SELECT2(meQ(req))} WHERE p.status='published' AND p.kind='post'
      AND (p.caption ILIKE $1 OR EXISTS(SELECT 1 FROM post_hashtags ph JOIN hashtags h ON h.id=ph.hashtag_id WHERE ph.post_id=p.id AND h.tag ILIKE $1))
      AND NOT au.is_private ORDER BY p.like_count + p.comment_count DESC, p.created_at DESC LIMIT 20`.replace(/\$ME/g, req.user.id), [like]);
    posts = r.rows.map(toPost);
  } else {
    const r = await q(`SELECT ${POST_SELECT2('NULL::uuid')} WHERE p.status='published' AND p.kind='post' AND p.caption ILIKE $1 AND NOT au.is_private ORDER BY p.created_at DESC LIMIT 20`.replace(/\$ME/g, 'NULL::uuid'), [like]);
    posts = r.rows.map(toPost);
  }
  res.json({
    users: users.map(r => ({ id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, verified: r.is_verified, followerCount: r.follower_count })),
    hashtags: hashtags.map(h => ({ tag: h.tag, count: h.use_count })),
    posts,
  });
}));
api.get('/explore', auth(false), wrap(async (req, res) => {
  const me = meQ(req);
  const { rows: trending } = await q(`SELECT ${POST_SELECT2(me)} WHERE p.status='published' AND p.kind='post' AND NOT au.is_private AND p.created_at > now() - interval '30 days'
    ORDER BY (p.like_count*3 + p.comment_count*4 + p.repost_count*5) DESC LIMIT 24`.replace(/\$ME/g, me));
  const { rows: reels } = await q(`SELECT ${POST_SELECT2(me)} WHERE p.status='published' AND p.kind='reel' AND NOT au.is_private
    ORDER BY p.view_count DESC, p.like_count DESC LIMIT 24`.replace(/\$ME/g, me));
  const { rows: tags } = await q(`SELECT tag, use_count FROM hashtags WHERE use_count > 0 ORDER BY use_count DESC LIMIT 12`);
  let suggested = [];
  if (req.user) {
    suggested = (await q(`SELECT ${USER_CARD}, follower_count FROM users u
      WHERE u.id != $1 AND u.is_private=FALSE AND u.account_status='active'
      AND NOT EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=u.id)
      ORDER BY follower_count DESC LIMIT 10`, [req.user.id])).rows;
  } else {
    suggested = (await q(`SELECT ${USER_CARD}, follower_count FROM users u WHERE u.is_private=FALSE AND u.account_status='active' ORDER BY follower_count DESC LIMIT 10`)).rows;
  }
  res.json({
    trending: trending.map(toPost),
    reels: reels.map(toPost),
    hashtags: tags.map(t => ({ tag: t.tag, count: t.use_count })),
    suggested: suggested.map(r => ({ id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, verified: r.is_verified, followerCount: r.follower_count })),
  });
}));
api.get('/hashtags/:tag', auth(false), wrap(async (req, res) => {
  const me = meQ(req);
  const { rows } = await q(`SELECT ${POST_SELECT2(me)} WHERE p.status='published' AND NOT au.is_private
    AND EXISTS(SELECT 1 FROM post_hashtags ph JOIN hashtags h ON h.id=ph.hashtag_id WHERE ph.post_id=p.id AND h.tag=$1)
    ORDER BY p.created_at DESC LIMIT 50`.replace(/\$ME/g, me), [req.params.tag.toLowerCase()]);
  res.json({ posts: rows.map(toPost) });
}));

// ---------------- reports ----------------
api.post('/reports', auth(), wrap(async (req, res) => {
  const { targetType, targetId, reason, details } = req.body || {};
  if (!['post', 'comment', 'user', 'message', 'story', 'reel'].includes(targetType)) return bad(res, 'invalid_target');
  await q(`INSERT INTO reports(reporter_id, target_type, target_id, reason, details) VALUES ($1,$2,$3,$4,$5)`,
    [req.user.id, targetType, req.params ? targetId : targetId, clean(reason, 100), clean(details || '', 500)]);
  res.json({ ok: true });
}));

// ---------------- monetization ----------------
api.get('/wallet', auth(), wrap(async (req, res) => {
  const { rows: [w] } = await q(`SELECT * FROM wallets WHERE user_id=$1`, [req.user.id]);
  const { rows: tipsIn } = await q(`SELECT t.amount_cents, t.note, t.created_at, tu.id AS uid, tu.username AS username, tu.display_name AS display_name, tu.avatar_url AS avatar_url FROM tips t JOIN users tu ON tu.id=t.sender_id WHERE t.creator_id=$1 ORDER BY t.created_at DESC LIMIT 20`, [req.user.id]);
  res.json({ wallet: w || { balance_cents: 0, lifetime_cents: 0 }, tips: tipsIn.map(r => ({ amountCents: r.amount_cents, note: r.note, createdAt: r.created_at, from: { id: r.uid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url } })) });
}));
api.post('/tips/:username', auth(), wrap(async (req, res) => {
  const { rows: [creator] } = await q(`SELECT id FROM users WHERE username=$1`, [req.params.username]);
  if (!creator) return bad(res, 'user_not_found', 404);
  const amount = Math.round(Number(req.body?.amountUsd) * 100);
  if (!amount || amount < 50 || amount > 50000) return bad(res, 'invalid_amount');
  // ledger transfer (payment provider hook: STRIPE_SECRET_KEY enables real charges)
  const { rows: [w] } = await q(`INSERT INTO wallets(user_id, balance_cents) VALUES ($1,0) ON CONFLICT (user_id) DO UPDATE SET balance_cents=wallets.balance_cents RETURNING balance_cents`, [creator.id]);
  await q(`UPDATE wallets SET balance_cents=balance_cents+$2, lifetime_cents=lifetime_cents+$2 WHERE user_id=$1`, [creator.id, amount]);
  await q(`INSERT INTO tips(sender_id, creator_id, amount_cents, note, status, provider_ref) VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.user.id, creator.id, amount, clean(req.body?.note || '', 200), process.env.STRIPE_SECRET_KEY ? 'pending' : 'completed', null]);
  await notify({ userId: creator.id, actorId: req.user.id, type: 'tip', entityType: 'user', entityId: req.user.id, body: `sent you a tip`, io: req.app.get('io') });
  res.json({ ok: true, providerConfigured: !!process.env.STRIPE_SECRET_KEY });
}));
api.post('/subscribe/:username', auth(), wrap(async (req, res) => {
  const { rows: [creator] } = await q(`SELECT id FROM users WHERE username=$1`, [req.params.username]);
  if (!creator) return bad(res, 'user_not_found', 404);
  const { rowCount } = await q(`SELECT 1 FROM subscriptions WHERE subscriber_id=$1 AND creator_id=$2 AND status='active'`, [req.user.id, creator.id]);
  if (rowCount) {
    await q(`UPDATE subscriptions SET status='cancelled' WHERE subscriber_id=$1 AND creator_id=$2`, [req.user.id, creator.id]);
    return res.json({ subscribed: false });
  }
  await q(`INSERT INTO subscriptions(subscriber_id, creator_id, tier, price_cents, renews_at) VALUES ($1,$2,$3,$4, now() + interval '1 month')
    ON CONFLICT (subscriber_id, creator_id) DO UPDATE SET status='active', renews_at=now()+interval '1 month'`,
    [req.user.id, creator.id, req.body?.tier || 'basic', Number(req.body?.priceCents) || 499]);
  await notify({ userId: creator.id, actorId: req.user.id, type: 'subscribe', entityType: 'user', entityId: req.user.id, io: req.app.get('io') });
  res.json({ subscribed: true });
}));
api.get('/creator/dashboard', auth(), wrap(async (req, res) => {
  const subs = (await q(`SELECT count(*) AS c FROM subscriptions WHERE creator_id=$1 AND status='active'`, [req.user.id])).rows[0].c;
  const tips = (await q(`SELECT COALESCE(sum(amount_cents),0) AS c FROM tips WHERE creator_id=$1`, [req.user.id])).rows[0].c;
  const { rows: posts } = await q(`SELECT id, caption, kind, like_count, comment_count, view_count, repost_count, created_at FROM posts WHERE user_id=$1 AND status='published' ORDER BY created_at DESC LIMIT 20`, [req.user.id]);
  const engagement = posts.reduce((a, p) => a + p.like_count + p.comment_count, 0);
  const impressions = posts.reduce((a, p) => a + p.view_count, 0);
  const { rows: growth } = await q(
    `SELECT date_trunc('day', created_at) AS day, count(*) AS follows FROM follows WHERE following_id=$1 AND created_at > now() - interval '30 days' GROUP BY day ORDER BY day`, [req.user.id]);
  const { rows: activeTimes } = await q(
    `SELECT EXTRACT(HOUR FROM l.created_at) AS hour, count(*) AS c FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=$1 GROUP BY hour ORDER BY c DESC`, [req.user.id]);
  res.json({
    subscribers: Number(subs), tipsCents: Number(tips), engagement, impressions,
    posts: posts.map(p => ({ id: p.id, caption: p.caption, kind: p.kind, likes: p.like_count, comments: p.comment_count, views: p.view_count, reposts: p.repost_count, createdAt: p.created_at })),
    followerGrowth: growth.map(g => ({ day: g.day, count: Number(g.follows) })),
    activeHours: activeTimes.map(a => ({ hour: Number(a.hour), count: Number(a.c) })),
  });
}));

// ---------------- marketplace ----------------
api.get('/marketplace', auth(false), wrap(async (req, res) => {
  const { rows } = await q(`SELECT p.*, ${USER_CARD} FROM products p JOIN users u ON u.id=p.seller_id WHERE p.status='active' ORDER BY p.created_at DESC LIMIT 50`);
  res.json({ products: rows.map(r => ({ id: r.id, title: r.title, description: r.description, priceCents: r.price_cents, currency: r.currency, kind: r.kind, mediaIds: r.media_ids, seller: { username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, verified: r.is_verified }, rating: null })) });
}));
api.post('/marketplace/products', auth(), wrap(async (req, res) => {
  const { title, description, priceUsd, kind, mediaUrls, digitalFileUrl } = req.body || {};
  if (!title || !Number(priceUsd)) return bad(res, 'invalid_product');
  const { rows: [p] } = await q(`INSERT INTO products(seller_id, title, description, price_cents, kind, media_ids, file_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.id, clean(title, 120), clean(description || '', 2000), Math.round(priceUsd * 100), kind === 'digital' ? 'digital' : 'physical',
     (mediaUrls || []).map(u => String(u).split('/').pop()), digitalFileUrl || null]);
  res.json({ product: p });
}));
api.post('/marketplace/products/:id/buy', auth(), wrap(async (req, res) => {
  const { rows: [p] } = await q(`SELECT * FROM products WHERE id=$1 AND status='active'`, [req.params.id]);
  if (!p) return bad(res, 'product_not_found', 404);
  const qty = Math.max(1, Number(req.body?.quantity) || 1);
  if (p.stock !== null && p.stock < qty) return bad(res, 'out_of_stock');
  const { rows: [o] } = await q(`INSERT INTO orders(product_id, buyer_id, quantity, amount_cents, status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [p.id, req.user.id, qty, p.price_cents * qty, process.env.STRIPE_SECRET_KEY ? 'pending_payment' : 'paid']);
  if (p.stock !== null) await q(`UPDATE products SET stock=stock-$2 WHERE id=$1`, [p.id, qty]);
  await notify({ userId: p.seller_id, actorId: req.user.id, type: 'order', entityType: 'product', entityId: p.id, io: req.app.get('io') });
  res.json({ order: o, providerConfigured: !!process.env.STRIPE_SECRET_KEY });
}));
api.post('/marketplace/products/:id/reviews', auth(), wrap(async (req, res) => {
  const { rating, body } = req.body || {};
  if (!rating || rating < 1 || rating > 5) return bad(res, 'invalid_rating');
  await q(`INSERT INTO product_reviews(product_id, user_id, rating, body) VALUES ($1,$2,$3,$4)
    ON CONFLICT (product_id, user_id) DO UPDATE SET rating=$3, body=$4`,
    [req.params.id, req.user.id, Math.round(rating), clean(body || '', 500)]);
  res.json({ ok: true });
}));
api.get('/marketplace/orders', auth(), wrap(async (req, res) => {
  const { rows } = await q(`SELECT o.*, p.title FROM orders o JOIN products p ON p.id=o.product_id WHERE o.buyer_id=$1 ORDER BY o.created_at DESC`, [req.user.id]);
  res.json({ orders: rows });
}));

// ---------------- ads ----------------
api.post('/ads/campaigns', auth(), wrap(async (req, res) => {
  const { name, headline, body, mediaUrl, dailyBudgetUsd, interests, countries } = req.body || {};
  const { rows: [c] } = await q(
    `INSERT INTO ad_campaigns(advertiser_id, name, headline, body, media_id, target_interests, target_countries, daily_budget_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.id, clean(name, 80), clean(headline || '', 120), clean(body || '', 300),
     mediaUrl ? String(mediaUrl).split('/').pop() : null,
     (interests || []).map(i => clean(i, 40)), (countries || []).map(c2 => clean(c2, 40)), Math.round((dailyBudgetUsd || 10) * 100)]);
  res.json({ campaign: c });
}));
api.get('/ads/campaigns', auth(), wrap(async (req, res) => {
  const { rows } = await q(`SELECT * FROM ad_campaigns WHERE advertiser_id=$1 ORDER BY created_at DESC`, [req.user.id]);
  res.json({ campaigns: rows });
}));
api.get('/ads/live', auth(false), wrap(async (req, res) => {
  const { rows } = await q(`SELECT c.*, m.mime FROM ad_campaigns c LEFT JOIN media m ON m.id=c.media_id WHERE c.status='approved' ORDER BY random() LIMIT 1`);
  res.json({ ad: rows[0] ? { id: rows[0].id, headline: rows[0].headline, body: rows[0].body, mediaUrl: rows[0].media_id ? `/media/${rows[0].media_id}` : null, advertiserId: rows[0].advertiser_id } : null });
}));
api.post('/ads/:id/impression', auth(false), wrap(async (req, res) => {
  await q(`UPDATE ad_campaigns SET impressions=impressions+1 WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));
api.post('/ads/:id/click', auth(false), wrap(async (req, res) => {
  await q(`UPDATE ad_campaigns SET clicks=clicks+1 WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- communities ----------------
api.post('/communities', auth(), wrap(async (req, res) => {
  const { name, description, isPrivate } = req.body || {};
  if (!name) return bad(res, 'name_required');
  const { rows: [c] } = await q(`INSERT INTO communities(name, description, owner_id, is_private) VALUES ($1,$2,$3,$4) RETURNING *`,
    [clean(name, 80), clean(description || '', 500), req.user.id, !!isPrivate]);
  await q(`INSERT INTO community_members(community_id, user_id, role) VALUES ($1,$2,'owner')`, [c.id, req.user.id]);
  res.json({ community: c });
}));
api.get('/communities', auth(false), wrap(async (req, res) => {
  const { rows } = await q(`SELECT c.*, u.username AS owner_username, EXISTS(SELECT 1 FROM community_members m WHERE m.community_id=c.id AND m.user_id=$2) AS joined
    FROM communities c JOIN users u ON u.id=c.owner_id ORDER BY c.member_count DESC LIMIT 50`, [0, req.user?.id]);
  res.json({ communities: rows });
}));
api.post('/communities/:id/join', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`SELECT owner_id, member_count FROM communities WHERE id=$1`, [req.params.id]);
  if (!c) return bad(res, 'not_found', 404);
  const { rowCount } = await q(`SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (rowCount) {
    if (String(c.owner_id) === String(req.user.id)) return bad(res, 'owner_cannot_leave', 403);
    await q(`DELETE FROM community_members WHERE community_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    await q(`UPDATE communities SET member_count=GREATEST(0,member_count-1) WHERE id=$1`, [req.params.id]);
    return res.json({ joined: false });
  }
  await q(`INSERT INTO community_members(community_id, user_id) VALUES ($1,$2)`, [req.params.id, req.user.id]);
  await q(`UPDATE communities SET member_count=member_count+1 WHERE id=$1`, [req.params.id]);
  res.json({ joined: true });
}));
api.get('/communities/:id/posts', auth(false), wrap(async (req, res) => {
  const { rows } = await q(`SELECT cp.*, ${USER_CARD} FROM community_posts cp JOIN users u ON u.id=cp.user_id
    WHERE cp.community_id=$1 AND cp.removed=FALSE ORDER BY cp.pinned DESC, cp.created_at DESC LIMIT 100`, [req.params.id]);
  res.json({ posts: rows.map(r => ({ id: r.id, body: r.body, pinned: r.pinned, announcement: r.announcement, createdAt: r.created_at, author: { username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url } })) });
}));
api.post('/communities/:id/posts', auth(), wrap(async (req, res) => {
  const member = await q(`SELECT role FROM community_members WHERE community_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!member.rowCount) return bad(res, 'forbidden', 403);
  const { rows: [p] } = await q(`INSERT INTO community_posts(community_id, user_id, body) VALUES ($1,$2,$3) RETURNING *`,
    [req.params.id, req.user.id, clean(req.body?.body || '', 2000)]);
  res.json({ post: p });
}));
api.post('/community-posts/:id/pin', auth(), wrap(async (req, res) => {
  const member = await q(`SELECT role FROM community_members cm JOIN community_posts cp ON cp.community_id=cm.community_id WHERE cp.id=$1 AND cm.user_id=$2`, [req.params.id, req.user.id]);
  if (!member.rowCount || !['owner', 'moderator'].includes(member.rows[0].role)) return bad(res, 'forbidden', 403);
  await q(`UPDATE community_posts SET pinned=$2, announcement=$2 WHERE id=$1`, [req.params.id, !!req.body?.pin]);
  res.json({ ok: true });
}));

// ---------------- verification ----------------
api.post('/verification/request', auth(), wrap(async (req, res) => {
  const { fullName, category, links } = req.body || {};
  const { rowCount } = await q(`SELECT 1 FROM verification_requests WHERE user_id=$1 AND status='pending'`, [req.user.id]);
  if (rowCount) return bad(res, 'request_pending');
  await q(`INSERT INTO verification_requests(user_id, full_name, category, links) VALUES ($1,$2,$3,$4)`,
    [req.user.id, clean(fullName || '', 100), clean(category || '', 40), (links || []).map(l => String(l).slice(0, 200))]);
  res.json({ ok: true });
}));
api.get('/verification/status', auth(), wrap(async (req, res) => {
  const { rows } = await q(`SELECT status, review_note, created_at FROM verification_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
  res.json({ request: rows[0] || null });
}));

// ---------------- live comment moderation ----------------
api.delete('/live/comments/:id', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`SELECT stream_id, user_id FROM live_comments WHERE id=$1`, [req.params.id]);
  if (!c) return bad(res, 'not_found', 404);
  const { rows: [s] } = await q(`SELECT host_id FROM live_streams WHERE id=$1`, [c.stream_id]);
  const canDelete = req.user.is_admin || String(s?.host_id) === String(req.user.id) || String(c.user_id) === String(req.user.id);
  if (!canDelete) return bad(res, 'forbidden', 403);
  await q(`DELETE FROM live_comments WHERE id=$1`, [req.params.id]);
  req.app.get('io').to(`live:${c.stream_id}`).emit('live:comment:deleted', { id: req.params.id, streamId: c.stream_id });
  res.json({ ok: true });
}));
api.post('/live/comments/:id/report', auth(), wrap(async (req, res) => {
  const { rows: [c] } = await q(`SELECT stream_id, user_id, body FROM live_comments WHERE id=$1`, [req.params.id]);
  if (!c) return bad(res, 'not_found', 404);
  const reason = clean(req.body?.reason || 'inappropriate', 100);
  await q(`INSERT INTO reports(reporter_id, target_type, target_id, reason, details) VALUES ($1,'live_comment',$2,$3,$4)`,
    [req.user.id, req.params.id, reason, clean(req.body?.details || '', 300)]);
  const { rows: [cu] } = await q(`SELECT username FROM users WHERE id=$1`, [c.user_id]);
  const { rows: [ru] } = await q(`SELECT username FROM users WHERE id=$1`, [req.user.id]);
  req.app.get('io').to('admin-room').emit('admin:report:new', {
    targetType: 'live_comment', targetId: req.params.id, reason, details: req.body?.details,
    messageBody: c.body, conversationId: c.stream_id, members: [{ username: cu?.username }],
    reporter: ru?.username, sender: cu?.username, createdAt: new Date().toISOString(),
  });
  res.json({ ok: true });
}));

// ---------------- live ----------------
api.post('/live/start', auth(), wrap(async (req, res) => {
  const { rows: [s] } = await q(`INSERT INTO live_streams(host_id, title) VALUES ($1,$2) RETURNING *`, [req.user.id, clean(req.body?.title || 'Live', 100)]);
  req.app.get('io').emit('live:started', { streamId: s.id, host: { username: req.user.username, displayName: req.user.display_name }, title: s.title });
  res.json({ stream: { id: s.id, title: s.title } });
}));
api.post('/live/:id/end', auth(), wrap(async (req, res) => {
  const { rows: [s] } = await q(`SELECT host_id FROM live_streams WHERE id=$1`, [req.params.id]);
  if (String(s?.host_id) !== String(req.user.id)) return bad(res, 'forbidden', 403);
  await q(`UPDATE live_streams SET status='ended', ended_at=now() WHERE id=$1`, [req.params.id]);
  req.app.get('io').emit('live:ended', { streamId: req.params.id });
  res.json({ ok: true });
}));
api.get('/live', auth(false), wrap(async (req, res) => {
  const { rows } = await q(`SELECT s.id, s.title, s.viewer_count, hu.id AS uid, hu.username AS username, hu.display_name AS display_name, hu.avatar_url AS avatar_url FROM live_streams s JOIN users hu ON hu.id=s.host_id WHERE s.status='live' ORDER BY s.viewer_count DESC LIMIT 20`);
  res.json({ streams: rows.map(r => ({ id: r.id, title: r.title, viewerCount: r.viewer_count, host: { username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url } })) });
}));

// ---------------- analytics ----------------
api.get('/analytics/overview', auth(), wrap(async (req, res) => {
  const { rows: visits } = await q(`SELECT date_trunc('day', created_at) AS day, count(*) AS c FROM profile_visits WHERE profile_id=$1 AND created_at > now() - interval '30 days' GROUP BY day ORDER BY day`, [req.user.id]);
  const { rows: views } = await q(`SELECT date_trunc('day', pv.created_at) AS day, count(*) AS c FROM post_views pv JOIN posts p ON p.id=pv.post_id WHERE p.user_id=$1 AND pv.created_at > now() - interval '30 days' GROUP BY day ORDER BY day`, [req.user.id]);
  const reach = (await q(`SELECT COALESCE(sum(view_count),0) AS c FROM posts WHERE user_id=$1 AND created_at > now() - interval '30 days'`, [req.user.id])).rows[0].c;
  const engagement = (await q(`SELECT COALESCE(sum(like_count + comment_count),0) AS c FROM posts WHERE user_id=$1 AND created_at > now() - interval '30 days'`, [req.user.id])).rows[0].c;
  res.json({
    profileVisits: visits.map(v2 => ({ day: v2.day, count: Number(v2.c) })),
    postViews: views.map(v2 => ({ day: v2.day, count: Number(v2.c) })),
    reach: Number(reach), engagement: Number(engagement),
    engagementRate: Number(reach) ? Number(engagement) / Number(reach) : 0,
  });
}));

// ---------------- business ----------------
api.post('/me/business', auth(), wrap(async (req, res) => {
  const { category, contact, hours, business } = req.body || {};
  const { rows: [u] } = await q(`UPDATE users SET is_business=$2, business_category=$3, business_contact=$4, business_hours=$5 WHERE id=$1 RETURNING *`,
    [req.user.id, business !== false, clean(category || '', 60), clean(contact || '', 200), clean(hours || '', 200)]);
  res.json({ user: pub(u) });
}));
api.get('/business/dashboard', auth(), wrap(async (req, res) => {
  const { rows: posts } = await q(`SELECT id, caption, view_count, like_count, comment_count, created_at FROM posts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [req.user.id]);
  const { rows: growth } = await q(`SELECT date_trunc('day', created_at) AS day, count(*) AS c FROM follows WHERE following_id=$1 AND created_at > now() - interval '30 days' GROUP BY day ORDER BY day`, [req.user.id]);
  const reach = posts.reduce((a, p) => a + p.view_count, 0);
  res.json({ reach, impressions: reach, posts: posts.map(p => ({ id: p.id, caption: p.caption, views: p.view_count, likes: p.like_count, comments: p.comment_count })), followerGrowth: growth.map(g => ({ day: g.day, count: Number(g.c) })) });
}));

// ---------------- admin message access (owner-only oversight) ----------------
api.get('/admin/conversations', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT c.id, c.is_group, c.title, c.created_at,
      (SELECT json_agg(json_build_object('id', u2.id, 'username', u2.username, 'displayName', u2.display_name))
        FROM conversation_members cm2 JOIN users u2 ON u2.id=cm2.user_id WHERE cm2.conversation_id=c.id) AS members,
      (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id) AS message_count,
      (SELECT json_build_object('body', m.body, 'kind', m.kind, 'createdAt', m.created_at, 'sender', (SELECT username FROM users WHERE id=m.sender_id))
        FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
     FROM conversations c ORDER BY COALESCE((SELECT max(created_at) FROM messages m WHERE m.conversation_id=c.id), c.created_at) DESC LIMIT 200`);
  res.json({ conversations: rows });
}));
api.get('/admin/conversations/:id/messages', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT m.id, m.kind, m.body, m.created_at, m.deleted_at, su.id AS uid, su.username, su.display_name
     FROM messages m JOIN users su ON su.id=m.sender_id WHERE m.conversation_id=$1 ORDER BY m.created_at ASC LIMIT 500`, [req.params.id]);
  res.json({
    messages: rows.map(r => ({ id: r.id, kind: r.kind, body: r.deleted_at ? null : r.body, deleted: !!r.deleted_at, createdAt: r.created_at, sender: { id: r.uid, username: r.username, displayName: r.display_name } })),
  });
}));
api.get('/admin/users/:id/profile-full', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows: [u] } = await q(`SELECT id, email, username, display_name, phone, email_verified, phone_verified, is_admin, is_verified, is_business, account_status, suspended_reason, follower_count, following_count, post_count, settings, created_at FROM users WHERE id=$1`, [req.params.id]);
  if (!u) return bad(res, 'not_found', 404);
  const posts = (await q(`SELECT id, caption, kind, status, like_count, comment_count, view_count, created_at FROM posts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.params.id])).rows;
  const reports = (await q(`SELECT id, reason, status, created_at FROM reports WHERE target_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.params.id])).rows;
  const logins = (await q(`SELECT ip, device, method, success, created_at FROM login_history WHERE user_id=$1 OR email=$2 ORDER BY created_at DESC LIMIT 20`, [req.params.id, u.email])).rows;
  res.json({ user: u, posts, reports, logins });
}));

// ---------------- admin audit log ----------------
async function audit(admin, action, targetType, target, details) {
  await q(`INSERT INTO admin_audit(admin_id, admin_username, action, target_type, target_id, target_username, details)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [admin.id, admin.username || admin.email, action, targetType, String(target?.id || target || ''), target?.username || target?.email || null, details || null]);
}
api.get('/admin/audit', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows } = await q(`SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 200`);
  res.json({ audit: rows });
}));
api.post('/admin/undo-last-ban', auth(true), ownerOnly, wrap(async (req, res) => {
  const { rows: [last] } = await q(`SELECT * FROM admin_audit WHERE action IN ('user_banned','user_suspended') ORDER BY created_at DESC LIMIT 1`);
  if (!last) return bad(res, 'nothing_to_undo');
  await q(`UPDATE users SET account_status='active', suspended_reason=NULL WHERE id=$1`, [last.target_id]);
  await audit(req.user, 'undo_ban', 'user', last.target_id, last.target_username, `reverted: ${last.action}`);
  res.json({ ok: true, undone: { user: last.target_username, action: last.action } });
}));

// ---------------- call history ----------------
api.get('/calls/history', auth(), wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT c.id, c.kind, c.status, c.started_at, c.answered_at, c.ended_at, c.caller_id, c.callee_id,
      ou.id AS ouid, ou.username AS username, ou.display_name AS display_name, ou.avatar_url AS avatar_url
     FROM calls c
     JOIN users ou ON ou.id = CASE WHEN c.caller_id = $1 THEN c.callee_id ELSE c.caller_id END
     WHERE c.caller_id = $1 OR c.callee_id = $1
     ORDER BY c.started_at DESC LIMIT 50`, [req.user.id]);
  res.json({
    calls: rows.map(r => ({
      id: r.id, kind: r.kind, status: r.status,
      outgoing: String(r.caller_id) === String(req.user.id),
      startedAt: r.started_at, answeredAt: r.answered_at, endedAt: r.ended_at,
      durationSec: r.answered_at && r.ended_at ? Math.round((new Date(r.ended_at) - new Date(r.answered_at)) / 1000) : 0,
      peer: { id: r.ouid, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url },
    })),
  });
}));

// ---------------- admin ----------------
function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return bad(res, 'forbidden', 403);
  next();
}
// Owner-exclusive actions: banning, suspending, appeals, report decisions.
// If OWNER_EMAIL is unset (fresh deploys), fall back to any admin so the first account retains control.
function ownerOnly(req, res, next) {
  if (!req.user?.is_admin) return bad(res, 'forbidden', 403);
  const owner = process.env.OWNER_EMAIL;
  if (owner && req.user.email?.toLowerCase() !== owner.toLowerCase()) return bad(res, 'owner_only', 403);
  next();
}
api.post('/admin/users/:id/verify-email', auth(true), ownerOnly, wrap(async (req, res) => {
  await q(`UPDATE users SET email_verified=$2 WHERE id=$1`, [req.params.id, !!req.body?.verified]);
  res.json({ ok: true });
}));
api.get('/admin/appeals', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT a.*, u.username,
      (SELECT count(*) FROM users_ban_history h WHERE h.user_id = a.user_id) AS ban_count,
      (SELECT json_agg(json_build_object('status', h.status, 'bannedAt', h.banned_at, 'reason', h.reason, 'unbannedAt', h.unbanned_at) ORDER BY h.banned_at DESC)
        FROM users_ban_history h WHERE h.user_id = a.user_id) AS ban_history
     FROM appeals a LEFT JOIN users u ON u.id=a.user_id
     ORDER BY (a.status='pending') DESC, a.created_at DESC LIMIT 100`);
  res.json({ appeals: rows });
}));
api.post('/admin/appeals/:id/resolve', auth(true), ownerOnly, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['reviewing', 'upheld', 'overturned'].includes(status)) return bad(res, 'invalid_status');
  await q(`UPDATE appeals SET status=$2, review_note=$3 WHERE id=$1`, [req.params.id, status, clean(req.body?.note || '', 300)]);
  const { rows: [a0] } = await q(`SELECT email, user_id FROM appeals WHERE id=$1`, [req.params.id]);
  await audit(req.user, `appeal_${status}`, 'appeal', req.params.id, a0?.email);
  const { rows: [a] } = await q(`SELECT email, user_id FROM appeals WHERE id=$1`, [req.params.id]);
  if (status === 'overturned' && a) {
    if (a.user_id) await q(`UPDATE users SET account_status='active', suspended_reason=NULL WHERE id=$1`, [a.user_id]);
    else await q(`UPDATE users SET account_status='active', suspended_reason=NULL WHERE email=$1`, [a.email]);
  }
  res.json({ ok: true });
}));

api.get('/admin/overview', auth(true), adminOnly, wrap(async (req, res) => {
  const one = async (sql) => Number((await q(sql)).rows[0].c);
  res.json({
    users: await one(`SELECT count(*) AS c FROM users`),
    posts: await one(`SELECT count(*) AS c FROM posts WHERE status='published'`),
    reports: await one(`SELECT count(*) AS c FROM reports WHERE status='open'`),
    flags: await one(`SELECT count(*) AS c FROM moderation_flags`),
    messages: await one(`SELECT count(*) AS c FROM messages`),
  });
}));
api.get('/admin/users', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows } = await q(`SELECT id, email, username, display_name, account_status, is_verified, is_admin, follower_count, created_at FROM users ORDER BY created_at DESC LIMIT 200`);
  res.json({ users: rows });
}));
api.post('/admin/users/:id/status', auth(true), ownerOnly, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['active', 'suspended', 'banned', 'deactivated'].includes(status)) return bad(res, 'invalid_status');
  const { rows: [targetUser] } = await q(`SELECT username, email FROM users WHERE id=$1`, [req.params.id]);
  await q(`UPDATE users SET account_status=$2, suspended_reason=$3 WHERE id=$1`, [req.params.id, status, clean(req.body?.reason || '', 200)]);
  if (status !== 'active') await q(`UPDATE sessions SET revoked=TRUE WHERE user_id=$1`, [req.params.id]);
  await audit(req.user, `user_${status}`, 'user', { id: req.params.id, username: targetUser?.username }, `reason: ${req.body?.reason || 'none'} · email: ${targetUser?.email || ''}`);
  if (status === 'banned' || status === 'suspended') {
    await q(`INSERT INTO users_ban_history(user_id, email, username, banned_by, reason, status) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.params.id, targetUser?.email, targetUser?.username, req.user.username || req.user.email, clean(req.body?.reason || '', 200), status]);
  } else if (status === 'active') {
    await q(`UPDATE users_ban_history SET unbanned_at=now(), status='restored' WHERE user_id=$1 AND unbanned_at IS NULL`, [req.params.id]);
  }
  req.app.get('io').to(`user:${req.params.id}`).emit('account:status', { status });
  res.json({ ok: true });
}));
api.post('/admin/users/:id/verify', auth(true), ownerOnly, wrap(async (req, res) => {
  await q(`UPDATE users SET is_verified=$2 WHERE id=$1`, [req.params.id, !!req.body?.verified]);
  await audit(req.user, req.body?.verified ? 'badge_granted' : 'badge_removed', 'user', req.params.id);
  res.json({ ok: true });
}));
api.get('/admin/reports', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows } = await q(`SELECT r.*, ru.username AS reporter_username FROM reports r LEFT JOIN users ru ON ru.id=r.reporter_id ORDER BY (r.status='open') DESC, r.created_at DESC LIMIT 200`);
  res.json({ reports: rows });
}));
api.post('/admin/reports/:id/resolve', auth(true), ownerOnly, wrap(async (req, res) => {
  await q(`UPDATE reports SET status=$2, resolution=$3 WHERE id=$1`, [req.params.id, req.body?.action === 'remove' ? 'resolved' : 'dismissed', clean(req.body?.note || '', 300)]);
  if (req.body?.action === 'remove' && req.body?.targetType === 'post') await q(`UPDATE posts SET status='removed' WHERE id=$1`, [req.body.targetId]);
  res.json({ ok: true });
}));
api.get('/admin/moderation-queue', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows } = await q(`SELECT mf.*, p.caption, p.status FROM moderation_flags mf LEFT JOIN posts p ON p.id=mf.target_id WHERE mf.target_type='post' ORDER BY mf.created_at DESC LIMIT 100`);
  res.json({ flags: rows });
}));
api.get('/admin/ads', auth(true), adminOnly, wrap(async (req, res) => {
  const { rows } = await q(`SELECT c.*, u.username FROM ad_campaigns c JOIN users u ON u.id=c.advertiser_id ORDER BY (c.status='pending') DESC, c.created_at DESC`);
  res.json({ campaigns: rows });
}));
api.post('/admin/ads/:id/review', auth(true), ownerOnly, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected', 'paused'].includes(status)) return bad(res, 'invalid_status');
  await q(`UPDATE ad_campaigns SET status=$2, review_note=$3 WHERE id=$1`, [req.params.id, status, clean(req.body?.note || '', 200)]);
  res.json({ ok: true });
}));
