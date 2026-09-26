#!/bin/sh
# Capacitor 7 defaults to Java 21; Debian 12 ships JDK 17 → downgrade all compile targets
for f in node_modules/@capacitor/android/capacitor/build.gradle \
         android/app/capacitor.build.gradle \
         android/capacitor-cordova-android-plugins/build.gradle; do
  [ -f "$f" ] && sed -i 's/JavaVersion.VERSION_21/JavaVersion.VERSION_17/g' "$f"
done
