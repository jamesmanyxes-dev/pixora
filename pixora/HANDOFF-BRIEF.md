# PIXORA HANDOFF BRIEF — for a new agent on a new account

You are taking over the PIXORA project from a previous agent. Read this fully, then continue.

## WHAT PIXORA IS
A real cross-platform social platform (like Instagram/TikTok). Live codebase on GitHub:
**https://github.com/jamesmanyxes-dev/pixora** (public). Clone it:
```bash
git clone https://github.com/jamesmanyxes-dev/pixora.git
cd pixora
```

## CURRENT STATE (as of handoff)
- **Backend**: Express + Socket.IO + PostgreSQL. All in `pixora/server/`. Fully working.
- **Frontend**: React 18 + TS + Tailwind SPA in `pixora/src/`, built with Vite → `pixora/dist/`.
- **Owner console**: separate app, `pixora/src-console/`, served at `/console`.
- **Android app**: Capacitor project `pixora/android/` (com.pixora.app), v1.1.0 signed APK exists at `pixora/releases/`.
- **Desktop**: Electron scaffold in `pixora/desktop/` (dist:win/mac/linux).
- **56-table DB schema**: `pixora/server/schema.sql` (idempotent).
- **i18n**: EN/FR/ES/AR/PT. **PWA**: manifest + service worker (v15).

## INFRASTRUCTURE THE USER ALREADY SET UP
1. **Neon Postgres (free, live)** — connection string stored by the previous agent as secret `NEON_DATABASE_URL`.
   - The FULL production database has ALREADY been migrated there: 358 posts, 14 users (owner = jamesmanyxes@gmail.com, username Me_hhahwh_q129, 1.25M followers, admin), 433 media, 302 messages, 56 tables.
   - If you need to re-migrate: `pixora/server/migrate-to-neon.mjs` (env: SRC_URL, DST_URL).
2. **GitHub**: connected as `jamesmanyxes-dev`. Push there on every change.
3. **Render**: user attempted deploy of the blueprint (render.yaml at repo root). Service `pixora-s3l3` failed — server/package.json was missing (FIXED, now in repo). If re-deploying: blueprint asks for DATABASE_URL (paste the Neon string), PUSH_VAPID_PUBLIC + PUSH_VAPID_PRIVATE (in secrets).

## VAPID KEYS (push notifications)
Stored as secrets PUSH_VAPID_PUBLIC / PUSH_VAPID_PRIVATE. Reuse these everywhere.

## EXTERNAL CONFIG STILL MISSING (activate with these)
- GOOGLE_CLIENT_ID → real Google Sign-In (create OAuth client in Google Cloud Console; authorized origin = your deployed URL)
- TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM → real SMS OTP
- RESEND_API_KEY + MAIL_FROM → real email delivery
- STRIPE_SECRET_KEY → real payments
- Without them: codes surface as devCode in-app, payments ledger-only. All flows still completable.

## HOW TO RUN LOCALLY / DEPLOY
```bash
git clone https://github.com/jamesmanyxes-dev/pixora.git && cd pixora
npm install                     # deps for frontend (also used by server)
cd server && npm install        # server deps
# set DATABASE_URL to the Neon string, then:
node index.js                   # serves API + console + static on :3001, auto-migrates schema
cd .. && npx vite build         # build frontend to dist/
```

## ANDROID BUILD (needs JDK 17 + Android SDK 34+)
```bash
cd pixora && npx cap sync android
sh patch-capacitor-java17.sh    # REQUIRED after cap sync (Capacitor 7 assumes Java 21)
cd android && ./gradlew assembleRelease bundleRelease -x lint -x lintVitalRelease
# sign:
BT=<android-sdk>/build-tools/34.0.0
$BT/zipalign -f 4 app/build/outputs/apk/release/app-release-unsigned.apk app/release/aligned.apk
$BT/apksigner sign --ks pixora-release.keystore --ks-pass pass:pixora2026 --key-pass pass:pixora2026 --out app/release/pixora-vX.apk app/release/aligned.apk
```
Keystore: `pixora/android/pixora-release.keystore` (pass: pixora2026). Change server URL in `capacitor.config.json` → `server.url`.

## KEY USER FACTS
- Owner: jamesmanyxes@gmail.com (username Me_hhahwh_q129). OWNER_EMAIL env must stay this.
- Test users: alice/bob/dave @pixora.test, password123.
- User speaks limited English; keep replies short and plain. They care about: the app never dying, followers/engagement on their posts, fast replies.
- Content on the platform: CC-licensed wildlife/sports/cars/cities/Japan/USA/AI-art photos + animal reels. Do NOT post sexualized real people content (owner has asked; declined — hold this line).

## WHERE THINGS LEFT OFF
- Backend verified booting against Neon locally (config endpoint serves).
- Render deploy failed on the OLD commit (missing server/package.json). The fix is pushed (commit d583e63). Fresh Render account + blueprint deploy should work first-try.
- APK in the repo points at the OLD skydive URL. After a successful Render deploy, update `capacitor.config.json` server.url to the Render URL, rebuild APK, ship it.
- Database on Neon has everything. Frontend at /api/config served fine in boot test.

## FIRST THINGS TO DO
1. Clone repo, boot backend against Neon locally to verify.
2. Get user to deploy Render blueprint (or deploy via their Render API key if they give one).
3. Update capacitor.config.json → rebuild APK → deliver.
4. Keep pushing every change to GitHub.
