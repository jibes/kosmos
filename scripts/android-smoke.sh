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

# Wait for the map to report it has loaded (logged under the app's own tag by KosmosPlugin; the
# release build forwards nothing else from the WebView), at most 60 s, then a little longer for
# the first tiles to draw.
for _ in $(seq 1 30); do
  adb logcat -d | grep -q "kosmos:ready" && break
  sleep 2
done
sleep 8

adb exec-out screencap -p > "$OUT/screen.png"
adb logcat -d > "$OUT/logcat.txt"

fail=0
if ! adb shell pidof "$PKG" >/dev/null; then
  echo "::error::kOSMos is not running after launch"
  fail=1
fi
if grep -E "FATAL EXCEPTION|AndroidRuntime.*$PKG" "$OUT/logcat.txt"; then
  echo "::error::kOSMos crashed"
  fail=1
fi
# The app logs its web errors (uncaught errors, rejections, console.error) as error-level lines
# under its tag "kOSMos". Capacitor's own console forwarding is off in release builds; its lines
# are still checked in case that changes. Known noise: Capacitor's SystemBars injects the
# safe-area CSS before the page exists, fails, and succeeds once the page is visible.
if grep -E " E (kOSMos|Capacitor/Console)" "$OUT/logcat.txt" | grep -v "Error injecting safe area CSS"; then
  echo "::error::the web app logged errors"
  fail=1
fi
# The WebView's content is not in the accessibility tree without a screen reader, so the map's
# own "loaded" line is the proof that the interface came up.
if ! grep -q "kosmos:ready" "$OUT/logcat.txt"; then
  echo "::error::the map never reported it had loaded (no kosmos:ready in logcat)"
  fail=1
fi
exit "$fail"
