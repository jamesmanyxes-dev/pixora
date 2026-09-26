import { q } from './migrate.js';
import { verifyAccess } from './lib.js';

export function setupRealtime(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    const p = token && verifyAccess(token);
    if (!p) return next(new Error('unauthorized'));
    const { rows: [u] } = await q(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.account_status FROM users u
       JOIN sessions s ON s.id=$2 AND s.revoked=FALSE WHERE u.id=$1 AND u.account_status='active'`, [p.uid, p.sid]);
    if (!u) return next(new Error('unauthorized'));
    socket.user = u;
    next();
  });

  const online = new Map(); // userId -> count of sockets

  io.on('connection', (socket) => {
    const uid = socket.user.id;
    socket.join(`user:${uid}`);
    if (socket.user.is_admin) socket.join('admin-room');
    online.set(uid, (online.get(uid) || 0) + 1);
    io.emit('presence', { userId: uid, online: true });

    socket.on('conversation:join', (convId) => socket.join(`conv:${convId}`));
    socket.on('conversation:leave', (convId) => socket.leave(`conv:${convId}`));

    socket.on('typing', async ({ conversationId }) => {
      if (!conversationId) return;
      const m = await q(`SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [conversationId, uid]);
      if (m.rowCount) socket.to(`conv:${conversationId}`).emit('typing', { conversationId, userId: uid, username: socket.user.username });
    });
    socket.on('typing:stop', ({ conversationId }) => {
      if (conversationId) socket.to(`conv:${conversationId}`).emit('typing:stop', { conversationId, userId: uid });
    });

    // live streams
    socket.on('live:join', async ({ streamId }) => {
      if (!streamId) return;
      socket.join(`live:${streamId}`);
      const { rows: [s] } = await q(`UPDATE live_streams SET viewer_count = viewer_count + 1,
        peak_viewers = GREATEST(peak_viewers, viewer_count + 1) WHERE id=$1 AND status='live' RETURNING viewer_count`, [streamId]);
      if (s) io.to(`live:${streamId}`).emit('live:viewers', { streamId, count: s.viewer_count });
    });
    socket.on('live:leave', async ({ streamId }) => {
      if (!streamId) return;
      socket.leave(`live:${streamId}`);
      const { rows: [s] } = await q(`UPDATE live_streams SET viewer_count = GREATEST(0, viewer_count-1) WHERE id=$1 RETURNING viewer_count`, [streamId]);
      if (s) io.to(`live:${streamId}`).emit('live:viewers', { streamId, count: s.viewer_count });
    });
    socket.on('live:comment', async ({ streamId, body, reaction }) => {
      if (!streamId || (!body && !reaction)) return;
      const { rows: [s] } = await q(`SELECT status FROM live_streams WHERE id=$1 AND status='live'`, [streamId]);
      if (!s) return;
      const clean = String(body || '').slice(0, 300);
      const { rows: [c] } = await q(`INSERT INTO live_comments(stream_id, user_id, body, reaction) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
        [streamId, uid, clean || null, reaction || null]);
      io.to(`live:${streamId}`).emit('live:comment', {
        id: c.id, streamId, body: clean, reaction, userId: uid,
        user: { username: socket.user.username, displayName: socket.user.display_name, avatarUrl: socket.user.avatar_url },
        createdAt: c.created_at,
      });
    });
    // WebRTC signaling for live broadcast + 1:1 calls
    socket.on('live:signal', ({ streamId, data }) => socket.to(`live:${streamId}`).emit('live:signal', { from: uid, data }));
    socket.on('call:signal', async ({ callId, to, data }) => {
      let target = to;
      if (!target && callId) {
        // route to the other party of the call (callee doesn't know the caller's id)
        const { rows: [c] } = await q(`SELECT caller_id, callee_id FROM calls WHERE id=$1`, [callId]);
        if (c) target = [c.caller_id, c.callee_id].find(i => String(i) !== String(uid));
      }
      if (target) io.to(`user:${target}`).emit('call:signal', { callId, from: uid, data });
    });
    socket.on('call:ping', ({ to, callId }) => { if (to) io.to(`user:${to}`).emit('call:ping', { callId, from: uid }); });
    socket.on('call:start', async ({ to, kind }) => {
      if (!to || String(to) === String(uid)) return;
      const { rows: [peer] } = await q(`SELECT account_status FROM users WHERE id=$1`, [to]);
      if (!peer || peer.account_status !== 'active') return socket.emit('call:failed', { reason: 'user_unavailable' });
      const { rows: [c] } = await q(`INSERT INTO calls(caller_id, callee_id, kind) VALUES ($1,$2,$3) RETURNING id, started_at`, [uid, to, kind === 'video' ? 'video' : 'audio']);
      socket.emit('call:started', { callId: c.id });
      io.to(`user:${to}`).emit('call:incoming', { callId: c.id, from: { id: uid, username: socket.user.username, displayName: socket.user.display_name, avatarUrl: socket.user.avatar_url }, kind });
    });
    socket.on('call:answer', async ({ callId, accept }) => {
      const { rows: [c] } = await q(`SELECT caller_id, callee_id FROM calls WHERE id=$1`, [callId]);
      if (!c) return;
      const other = String(c.caller_id) === String(uid) ? c.callee_id : c.caller_id;
      await q(`UPDATE calls SET status=$2, answered_at = CASE WHEN $2='accepted' THEN now() ELSE answered_at END WHERE id=$1`, [callId, accept ? 'accepted' : 'declined']);
      io.to(`user:${other}`).emit('call:answered', { callId, accept });
    });
    socket.on('call:end', async ({ callId }) => {
      const { rows: [c] } = await q(`SELECT caller_id, callee_id, status, answered_at FROM calls WHERE id=$1`, [callId]);
      if (!c) return;
      if (c.status === 'ended') { const other = [c.caller_id, c.callee_id].find(i => String(i) !== String(uid)); if (other) io.to(`user:${other}`).emit('call:ended', { callId }); return; }
      const missed = c.status === 'ringing' && String(c.callee_id) === String(uid);
      await q(`UPDATE calls SET status=$2, ended_at=now() WHERE id=$1`, [callId, missed ? 'missed' : 'ended']);
      const other = [c.caller_id, c.callee_id].find(i => String(i) !== String(uid));
      if (other) io.to(`user:${other}`).emit('call:ended', { callId });
    });

    socket.on('disconnect', () => {
      const n = (online.get(uid) || 1) - 1;
      if (n <= 0) { online.delete(uid); io.emit('presence', { userId: uid, online: false }); }
      else online.set(uid, n);
    });
  });

  io.engine.on('connection_error', (e) => console.log('socket err', e.message));
}
