#!/bin/sh
# PIXORA — full social platform: API + Socket.IO + SPA on :3001
cd /home/user/.self/pixora
exec platform secrets run -- node server/index.js
