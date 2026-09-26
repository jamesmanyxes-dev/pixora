# PIXORA — Social Platform

A real, deployable social platform. Everything runs from live PostgreSQL — no demo data, no mocks.

**Live at:** this agent's webserver URL (port 3001).

## Stack
- **Backend:** Node.js + Express + Socket.IO (real-time), JWT access tokens + rotating refresh tokens
- **Database:** managed PostgreSQL (Neon) — 30+ tables, all content permanent
- **Frontend:** React 18 + TypeScript + Tailwind CSS + lucide icons, built with Vite
- **Media:** stored as bytea in Postgres, served with HTTP Range support (video seeking), immutable caching

## Running
`webserver.sh` runs `pixora/server/index.js` via `platform secrets run` (injects `DATABASE_URL`). Migrations run automatically on boot (`server/schema.sql`).

Rebuild frontend: `cd pixora && npx vite build`

## Feature map
- Auth: email/password, real Google OAuth (GIS), phone OTP, email verification, password reset, TOTP 2FA + backup codes, session/device management, login history, rate limiting
- Social: posts (multi-image/video), reels, stories (24h expiry, viewers, replies), follows (private accounts + requests), likes, nested comments, reposts, saves + collections, mentions, hashtags
- Feed: Following + For You (engagement-weighted + hashtag affinity recommendations), infinite scroll
- Discovery: search (users/posts/hashtags), explore (trending, suggested), hashtag pages
- Messaging: 1:1 + group DMs, real-time via Socket.IO, typing indicators, read receipts, voice notes, media, WebRTC voice/video calls with history
- Live: WebRTC broadcast with viewer counts, live chat + reactions
- Notifications: real-time push (socket) + web push (VAPID) + preferences
- Monetization: wallet ledger, tips, subscriptions, exclusive content, creator dashboard
- Business: business profiles, business insights dashboard
- Marketplace: products, orders, reviews
- Ads: campaigns, targeting, admin approve/reject, impressions/clicks, live ad serving
- Communities: groups, join/leave, pinned announcements, roles
- Analytics: profile visits, post/reel views, engagement rate, growth, active hours
- Moderation: spam/abuse/duplicate auto-flags, reports, admin review queue
- Admin panel: users, suspend/ban, verify, remove posts, reports, ads review
- i18n: EN/FR/ES/AR/PT (+ RTL), PWA (installable, offline shell, push)

## External configuration (optional, activates features)
Set via `platform secrets` (server reads `process.env`):
- `GOOGLE_CLIENT_ID` — enables the real Google Sign-In button (GIS). Create an OAuth client (Web) in Google Cloud Console with the site origin as authorized JavaScript origin.
- `RESEND_API_KEY`, `MAIL_FROM` — real email delivery (verification, password reset)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` — real SMS OTP delivery
- `STRIPE_SECRET_KEY` — real card charges for tips/subscriptions/orders
- `PUSH_VAPID_PUBLIC` / `PUSH_VAPID_PRIVATE` — web push notifications
- `JWT_SECRET` — set in production

Without a delivery provider, verification codes are surfaced in the API response (`devCode`) so flows stay completable.

First registered account becomes platform admin. Admin panel is at Settings → Admin (desktop top bar).
