# PIXORA SURVIVAL GUIDE — keeping the app alive for free

Your app does NOT have to die if this agent's credits run out. Everything needed is in this repo.

## The architecture (why it survives)
- Code: fully on GitHub (this repo)
- Backend: plain Node.js — runs on any free host
- Database: PostgreSQL — free tiers exist everywhere
- Android app: talks to a backend URL — change one line to point it at any new host

## FREE hosting options (pick one)

### Option 1: Render (recommended — 1 click)
The repo contains `render.yaml` (a Render Blueprint). 
1. Go to https://render.com/deploy?repo=https://github.com/jamesmanyxes-dev/pixora
2. Sign up free (no card needed)
3. Render reads the blueprint: creates the web service + free Postgres + sets DATABASE_URL
4. Your app lives at `https://pixora-xxxx.onrender.com`
- Free tier: 750 hours/month (enough for 24/7), Postgres free for 30 days then needs re-create or $7/mo
- Alternative DB: keep using a free Neon Postgres (0.5GB, always free) — set DATABASE_URL manually

### Option 2: Railway / Fly.io — similar free/trial tiers
### Option 3: Oracle Cloud "Always Free" — a full VM, always free (most powerful free option, needs a card at signup but never charges the free tier)

## What to change when you move
1. Deploy the backend (Render etc.) → get URL like `https://pixora.onrender.com`
2. Update the Android app: in `capacitor.config.json` change `server.url` to the new URL
3. Rebuild the APK:
   ```bash
   cd pixora && npx cap sync android
   sh patch-capacitor-java17.sh
   cd android && ./gradlew assembleRelease
   ```
4. Ship the new APK (Play Store or direct download)
5. The web frontend: deploy `pixora/dist` to Vercel/Netlify/Cloudflare Pages (free), set the API URL

## Can I update the app myself?
YES. The whole pipeline is in this repo:
```bash
git clone https://github.com/jamesmanyxes-dev/pixora.git
cd pixora && npm install
npx vite build
cd android && ./gradlew assembleRelease
```
Anyone with a computer can rebuild and redistribute the APK. You never need this agent.

## Backups (do this NOW, it's free)
Your database is the one thing not in GitHub. Export it:
- From this platform: Settings → database → download dump
- Or ask the agent: "export the database" before credits run out
- Keep the dump file in cloud storage / your phone

## AFTER you deploy to Render (step-by-step)
1. Open https://render.com/deploy?repo=https://github.com/jamesmanyxes-dev/pixora
2. Sign up / log in → click "Apply" → wait for both services to go live (~5 min)
3. Note your URL: https://pixora-xxxx.onrender.com
4. Send that URL to the agent (or edit capacitor.config.json yourself: "server": {"url": "https://pixora-xxxx.onrender.com"})
5. Rebuild the APK:
   cd pixora && npx cap sync android
   sh patch-capacitor-java17.sh
   cd android && ./gradlew assembleRelease
6. Install the new APK — the app now runs on Render, independent of Skydive
7. Restore your database: if you exported a dump before, load it into the Render Postgres (agent can do this, or psql -f dump.sql)

NOTE: Render free tier spins down after 15 min idle — first load takes ~30s to wake. Keep-alive pings (e.g. cron-job.org every 10 min) make it feel instant.
