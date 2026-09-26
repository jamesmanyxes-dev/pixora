import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import fs from 'fs';
import { migrate, q } from './migrate.js';
import { setupRealtime } from './realtime.js';
import { api } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 2e6 });
app.set('io', io);

app.use(express.json({ limit: '1mb' }));
// basic security headers (XSS/clickjacking hardening)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
  next();
});

app.use('/api', api);
app.use((err, req, res, next) => {
  console.error('ERR', err.message);
  res.status(err.status || 500).json({ error: err.message || 'internal_error' });
});

// media serving with Range support for video
app.get('/media/:id', async (req, res) => {
  try {
    const { rows: [m] } = await q(`SELECT mime, size, data FROM media WHERE id=$1`, [req.params.id]);
    if (!m) return res.status(404).end();
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', `"${req.params.id}"`);
    if (req.headers['if-none-match'] === `"${req.params.id}"`) return res.status(304).end();
    const range = req.headers.range;
    if (range && m.mime.startsWith('video')) {
      const mm = range.match(/bytes=(\d*)-(\d*)/);
      let start = mm && mm[1] ? parseInt(mm[1]) : 0;
      let end = mm && mm[2] ? parseInt(mm[2]) : m.size - 1;
      if (end >= m.size) end = m.size - 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${m.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      res.end(m.data.slice(start, end + 1));
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', m.size);
      res.end(m.data);
    }
  } catch (e) { console.error('media err', e.message); res.status(500).end(); }
});

// static SPA
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist, {
  maxAge: '1h',
  setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); },
}));
// release downloads (apk/aab) served from pixora/releases
app.use('/downloads', express.static(path.join(__dirname, '..', 'releases'), { maxAge: '1d' }));
app.get('/console', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(fs.readFileSync(path.join(dist, 'console.html')));
});
app.get(/^\/(?!api|media|socket\.io|console).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));

// scheduled posts publisher
setInterval(async () => {
  try {
    const { rows } = await q(`UPDATE posts SET status='published' WHERE id IN (
      SELECT j.payload->>'postId' FROM scheduled_jobs j WHERE j.kind='publish_post' AND j.done=FALSE AND j.run_at <= now()
      FOR UPDATE SKIP LOCKED RETURNING j.payload->>'postId' AS id) RETURNING id, user_id`).catch(() => ({ rows: [] }));
    void rows;
  } catch {}
}, 60_000).unref();

const PORT = process.env.PORT || 3001;
await migrate();
setupRealtime(io);
server.listen(PORT, () => console.log(`PIXORA listening on :${PORT}`));
