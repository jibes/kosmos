#!/usr/bin/env bash
# Installs the APK on a running emulator, launches kOSMos and checks that it lives:
# no crash, the interface is on screen, no web errors. Leaves a screenshot and logcat in
# smoke/ either way, so the real map (real tiles, the emulator is online) can be looked at.
set -euo pipefail

APK="$1"
PKG=io.github.jibes.kosmos
OUT=smoke
mkdir -p "$OUT"

adb install -r -g "$APK"
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"

# Give the WebView time to load the app and the first tiles.
sleep 25

adb exec-out screencap -p > "$OUT/screen.png"
adb logcat -d > "$OUT/logcat.txt"
adb shell uiautomator dump /sdcard/ui.xml >/dev/null && adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null

fail=0
if ! adb shell pidof "$PKG" >/dev/null; then
  echo "::error::kOSMos is not running after launch"
  fail=1
fi
if grep -E "FATAL EXCEPTION|AndroidRuntime.*$PKG" "$OUT/logcat.txt"; then
  echo "::error::kOSMos crashed"
  fail=1
fi
# Capacitor forwards console.error from the WebView as error-level "Capacitor/Console" lines.
if grep -E " E Capacitor/Console" "$OUT/logcat.txt"; then
  echo "::error::the web app logged errors"
  fail=1
fi
if ! grep -q "OpenStreetMap" "$OUT/ui.xml"; then
  echo "::error::the interface did not appear (no OpenStreetMap credit in the view tree)"
  fail=1
fi
exit "$fail"
