# PIXORA Deployment — Web, Android, iOS, Desktop

One codebase (React + TypeScript), one backend (this server), real-time sync everywhere.

## Web
Live at the agent URL. Deployable to any static host + the API server (`pixora/server`).
- `cd pixora && npx vite build` → `dist/`

## Android (Google Play)
Project: `pixora/android` (Capacitor; `com.pixora.app`).
```bash
cd pixora && npx cap sync android
cd android && ./gradlew assembleRelease   # APK
cd android && ./gradlew bundleRelease     # AAB for Play Store
```
Outputs: `android/app/build/outputs/apk/release/app-release.apk` and `/bundle/release/app-release.aab`
For Play Store signing, add a keystore to `android/gradle.properties` (see `PIXORA-RELEASE-SIGNING.md`).
Push: add `google-services.json` from Firebase Console → `android/app/` (FCM).
Permissions already declared: camera, mic, media read, notifications.

## iOS (App Store)
```bash
cd pixora && npx cap add ios && npx cap sync ios
cd ios && pod install && open App.xcworkspace   # build in Xcode with your Apple ID
```

## Desktop (Windows / macOS / Linux)
```bash
cd pixora/desktop && npm install
npm run dist:win     # Windows NSIS installer + portable exe
npm run dist:mac     # macOS dmg + zip
npm run dist:linux   # Linux AppImage + deb
```

## Play/App Store compliance (all live in the app)
- Privacy Policy: `/#/privacy`
- Terms of Service: `/#/terms`
- Account deletion: Settings → Data & privacy → Delete account
- Data export: Settings → Data & privacy → Download my data
- Reporting: long-press any message/post → Report; in-app report system
- Moderation: admin console with reports queue, auto-flags, appeals
