#!/bin/sh
# Pixora: install deps (root package.json) and build the SPA into pixora/dist
cd /home/user/.self
npm install --no-audit --no-fund || true
cd pixora && npx vite build || true
# Capacitor java-17 patch (must run after npm installs)
sh /home/user/.self/pixora/patch-capacitor-java17.sh || true
