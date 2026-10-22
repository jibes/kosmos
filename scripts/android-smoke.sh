#!/usr/bin/env bash
# Installs the APK on a running emulator, launches kOSMos and checks that it lives:
# no crash, the interface is on screen, no web errors. Then the location service guidance runs
# on: in the foreground, and delivering fixes once location is switched on after it started. Leaves a screenshot and logcat in smoke/ either way, so the real map
# (real tiles, the emulator is online) can be looked at.
set -euo pipefail

APK="$1"
PKG=io.github.jibes.kosmos
OUT=smoke
mkdir -p "$OUT"

# No permission granted up front: opening the app must not need any (it never asks then).
adb install -r "$APK"
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"

# Wait for the map to report it has loaded (logged under the app's own tag by KosmosPlugin; the
# release build forwards nothing else from the WebView), at most 60 s, then a little longer for
# the first tiles to draw.
for _ in $(seq 1 30); do
  # Not grep -q: quitting early breaks the pipe, and pipefail would never let the loop end.
  adb logcat -d | grep "kosmos:ready" > /dev/null && break
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
[ "$fail" = 0 ] || exit "$fail"

# A place handed over by another app, through the app's own intent filters: a geo: link, then
# a shared message. Both are taken (the app logs which kind, never the place), with no crash.
# `am start` may exit non-zero though the intent reached the running app (delivered to the
# top-most instance); what counts is that the app logged it, checked below, so its own exit
# status is only shown, never the end of the run.
deliver() {
  local out
  out=$(adb shell am start -W -p "$PKG" "$@" 2>&1) || echo "am start: $out"
}
adb logcat -c
deliver -a android.intent.action.VIEW -d "'geo:52.5163,13.3777?z=17'"
sleep 4
deliver -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.TEXT "'Brandenburger Tor, Pariser Platz, Berlin'"
sleep 4
adb logcat -d > "$OUT/logcat-shared.txt"
for kind in point words; do
  if ! grep -q "shared: $kind" "$OUT/logcat-shared.txt"; then
    echo "::error::a $kind handed over by another app never arrived (no 'shared: $kind' in logcat)"
    fail=1
  fi
done
if ! adb shell pidof "$PKG" >/dev/null || grep -E "FATAL EXCEPTION" "$OUT/logcat-shared.txt"; then
  echo "::error::kOSMos crashed on a place handed over by another app"
  fail=1
fi
[ "$fail" = 0 ] || exit "$fail"

# Guidance's location service, as Start leaves it once location is allowed. The service is not
# exported; root may start it. The app stays in front with the screen on, as at Start.
if ! adb root; then
  echo "::error::this emulator image does not allow root, which starting the service needs"
  exit 1
fi
adb wait-for-device
adb shell svc power stayon true
adb shell input keyevent KEYCODE_WAKEUP
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do
  adb shell pm grant "$PKG" "android.permission.$p"
done

# Starts the service with location on or off, switches it on, and waits for the service to log
# its first fix while the emulator's GPS reports a position.
guide() {
  local name="$1" location="$2"
  adb shell am stopservice -n "$PKG/.NavLocationService" >/dev/null 2>&1 || true
  adb shell cmd location set-location-enabled "$location"
  adb logcat -c
  adb shell am start-foreground-service -n "$PKG/.NavLocationService"
  adb shell am start -n "$PKG/.MainActivity" >/dev/null
  sleep 3
  adb shell dumpsys activity services "$PKG" > "$OUT/services-$name.txt"
  if ! grep -q "isForeground=true" "$OUT/services-$name.txt"; then
    echo "::error::$name: the location service is not running in the foreground"
    grep -iE "ServiceRecord|isForeground|foregroundServiceType|types" "$OUT/services-$name.txt" || true
    return 1
  fi
  adb shell cmd location set-location-enabled true
  for _ in $(seq 1 20); do
    adb emu geo fix 13.4050 52.5200 >/dev/null
    adb logcat -d | grep "navigation: first fix" > /dev/null && break
    sleep 2
  done
  adb logcat -d > "$OUT/logcat-$name.txt"
  if ! grep -q "navigation: first fix" "$OUT/logcat-$name.txt"; then
    echo "::error::$name: no fix reached the location service"
    adb shell dumpsys location > "$OUT/location-$name.txt" || true
    echo "--- dumpsys location (kOSMos, providers)"
    grep -iE "kosmos|gps provider|network provider|enabled|Location setting" "$OUT/location-$name.txt" | head -40 || true
    echo "--- logcat (app, location)"
    grep -iE "kOSMos|LocationManager|LocationProvider|Gnss|ActivityManager.*kosmos" "$OUT/logcat-$name.txt" | tail -40 || true
    return 1
  fi
  if grep -E "FATAL EXCEPTION|AndroidRuntime.*$PKG" "$OUT/logcat-$name.txt"; then
    echo "::error::$name: kOSMos crashed while guiding"
    return 1
  fi
  echo "$name: $(grep -o 'navigation: first fix from [a-z]*' "$OUT/logcat-$name.txt" | head -1)"
}

# Location on at Start; then off at Start and switched on later (the service must recover).
guide on true || fail=1
guide off-then-on false || fail=1
exit "$fail"
