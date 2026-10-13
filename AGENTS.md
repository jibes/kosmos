# kOSMos: agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
List deviations from it here, each with a reason.

## Stack

- TypeScript strict, React 19, Vite, MapLibre GL JS 6, vite-plugin-pwa, Vitest, Playwright, Capacitor 8 (Android). Node: see `.nvmrc`.
- Check library APIs against the installed types in `node_modules`, not from memory. MapLibre 6 has no default export: `import * as maplibregl`.

## Product rules (MECE)

Five jobs, one control each: **view** (the map), **find** (search), **locate** (location button), **inspect** (tap a label / long-press → place card with share + route; the route card is part of inspect), **go** (Start on the route card → turn-by-turn). A new feature must fit one of them or argue for a sixth. No settings screen: theme follows the system, language follows the browser.

## Architecture

- `src/core/` is pure logic with no DOM, and every module has tests in `tests/`. The whole map look is `core/palette.ts` (colours) + `core/style.ts` (layers, OpenMapTiles schema). Colours never appear in the style directly; a test enforces it.
- `src/ui/` holds components and map glue (`useMap`, markers, gestures) and may import from `core/`, never the other way round.
- Map labels use self-hosted Inter through the style's `font-faces`, registered under the glyph server's font names (`FONT` in `core/style.ts`) so other scripts fall back to the same weight.
- MapLibre's worker is bundled with `?url` and set via `setWorkerUrl` (`ui/useMap.ts`); without it the worker 404s after bundling.
- Compass: `core/compass.ts` (pure: heading from orientation events, circular smoothing, course vs compass by speed) and `ui/useCompass.ts` (streams headings to subscribers, not React state). The location button cycles off → follow → compass (`Follow` in `ui/Controls.tsx`).
- Guidance is `core/nav.ts`: pure, fed fixes and time, covered by replay tests. The UI only subscribes it to location (`useLocation().subscribe`) and renders `NavState`.
- Keep each file under 800 lines; split before adding to it.

## Invariants

- Storage keys follow `kosmos.<name>.v<N>` (`kosmos.view.v1`). Never rename an existing key: bump the version and migrate.
- Network calls go only to OpenFreeMap, Photon and the FOSSGIS Valhalla router (README → Privacy, CSP in `index.html`).
- The router is a volunteer service under fair use: one request per trip or travel-mode change, re-requested only when the start moves more than 150 m (`ui/useRoute.ts`), and while navigating only on a confirmed off-route, at most every 30 s (`ui/useNav.ts`). Never poll it.
- No user-facing string is hard-coded. Add it to `src/i18n/en.ts` and `de.ts`.
- Android app ID `io.github.jibes.kosmos` and the release key are permanent; changing either breaks updates for installed users.

## Android

- `android/` is a committed Capacitor project; `npx cap sync android` copies `dist/` in (ignored by git).
- Icons are vector adaptive icons in `res/drawable` + `res/mipmap-anydpi`; web PNGs come from `npm run icons` (set `CHROMIUM_PATH` in cloud sessions).
- Navigation on Android: `useLocation().background(true)` moves location to the background-geolocation plugin's foreground service; speech uses the system engine (`ui/voice.ts`), keep-awake the native plugin (`ui/wakeLock.ts`). The web build falls back to Web Speech and Screen Wake Lock.
- CI boots an Android 14 emulator after the build and runs `scripts/android-smoke.sh` (install, launch, no crash, no web errors, `kosmos:ready` logged once the map loads; `loggingBehavior: 'production'` forwards the web console to logcat in release builds) before any release. Its artifact `android-smoke` holds a screenshot with real tiles and the logcat; the latest screenshot is also force-pushed to the `ci-smoke` branch.
- Release: bump `package.json` version on main → `android.yml` publishes `v<version>` if that tag does not exist.

## Deviations

- `android.yml` uses the runner's preinstalled JDK 21 and Android SDK instead of setup actions, and boots the emulator with the SDK's own tools instead of `android-emulator-runner` (fewer third-party actions to pin).
- `upload-artifact` stays on a tag, as in the apps-data templates (TODO pin).
- Fonts and tiles for scripts beyond Latin come from OpenFreeMap's glyph server at runtime; self-hosting all of Noto would add tens of MB.

## Done checklist (before every push)

1. `npm run check` (typecheck, lint, format:check, unit)
2. `npm run build && npm run e2e` (cloud sessions: `CHROMIUM_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome` when the preinstalled Chromium does not match `@playwright/test`)
3. If you fixed a bug, a test now covers it.
4. README is updated if you changed behaviour, scripts or services.
