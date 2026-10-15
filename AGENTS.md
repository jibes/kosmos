# kOSMos: agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
List deviations from it here, each with a reason.

## Stack

- TypeScript strict, React 19, Vite, MapLibre GL JS 6, vite-plugin-pwa, Vitest, Playwright, Capacitor 8 (Android). Node: see `.nvmrc`.
- Check library APIs against the installed types in `node_modules`, not from memory. MapLibre 6 has no default export: `import * as maplibregl`.

## Product rules (MECE)

Five jobs, one control each: **view** (the map), **find** (search), **locate** (location button), **inspect** (tap a label / long-press → place card with share + route; the route card is part of inspect), **go** (Start on the route card → turn-by-turn). A new feature must fit one of them or argue for a sixth. No settings screen: theme follows the system (while navigating it follows the sun instead: light by day, dark after sunset and in tunnels), language follows the browser.

## Architecture

- `src/core/` is pure logic with no DOM, and every module has tests in `tests/`. The whole map look is `core/palette.ts` (colours) + `core/style.ts` (layers, OpenMapTiles schema). Colours never appear in the style directly; a test enforces it.
- `src/ui/` holds components and map glue (`useMap`, markers, gestures) and may import from `core/`, never the other way round.
- Map labels use self-hosted Inter through the style's `font-faces`, registered under the glyph server's font names (`FONT` in `core/style.ts`) so other scripts fall back to the same weight.
- MapLibre's worker is bundled with `?url` and set via `setWorkerUrl` (`ui/useMap.ts`); without it the worker 404s after bundling.
- Compass: `core/compass.ts` (pure: heading from orientation events, tilt-aware: the top of the screen lying flat, the back held upright, since alpha alone is up to 90° off upright; circular smoothing, course vs compass by speed) and `ui/useCompass.ts` (streams headings to subscribers, not React state). The location button cycles off → follow → compass (`Follow` in `ui/Controls.tsx`).
- Category search: `core/categories.ts` (pure: one table of kinds of place, each with its OpenMapTiles `poi` subclasses and words in en/de; `categoriesFor` suggests at most two, exact words first; nearest first) and `ui/categorySearch.ts`, which fetches and decodes the zoom-14 tiles of the view itself (`core/tiles.ts`; only zoom 14 holds every place, the map's own lower-zoom tiles keep only important ones; at most 48 tiles, nearest the centre; a new category from a view wider than zoom 12 zooms in once; searching an area again never moves the map); no search server. Suggestions are rows above the Photon names, taken by tap or Enter; editing the text leaves the category. Results are dots and names in the style's `search` source, above labels and tappable; `ui/useCategory.ts` owns them, "show all" (Enter) and the "Search this area" offer after the user's own pan or zoom (40 % of a view or a zoom step).
- Opening hours: `core/hours.ts` (pure: the common `opening_hours` subset; anything else is shown as written, never guessed) and `ui/PlaceDetails.tsx`.
- Lanes: `core/lanes.ts` (pure: Valhalla `turn_lanes` per maneuver, shown only when some lanes lead the right way and some do not; size by distance and speed). Comes with the same route request.
- Navigation theme: `core/daylight.ts` (pure: sun elevation, tunnel match against `brunnel=tunnel` lines) and `ui/useNavTheme.ts`, which reads tunnels from the tiles already loaded every few seconds (Valhalla's native response has no tunnel flag); dark holds in a tunnel until a fix outside (GPS often stops there), and each drive starts undecided. While navigating it decides both ways (`data-theme` on `<html>`): the system's dark media query yields to `data-theme='light'`, and `styles.css` repeats the dark tokens under `data-theme='dark'`.
- Public transport guidance is `core/ride.ts` (pure, replay-tested like `nav.ts`): walk → wait → ride → arrived from fixes and time; GPS when a fix is fresh, the timetable's arrival times underground. `ui/useRide.ts` also ticks every 3 s so it moves on without fixes; `ui/RideView.tsx` renders it; its banner opens the whole trip (`TransitLegs` with the current leg open and passed stops dimmed). A missed departure (still walking once the vehicle has left; on board only when the position moves along its line) or a cancelled trip offers a new connection (one request, user-initiated); a late vehicle keeps the ride going while the position is on its line.
- Route drawing, the fit and the start marker are `ui/useRouteLayer.ts`, so `App.tsx` stays the wiring.
- Heading while navigating: `NavState.moving` (hysteresis 3 → 1.5 m/s; progress counts only beyond GPS jitter, max(6 m, accuracy/2)) picks the route's course over the compass; standing still never flips it.
- Guidance UI: `ui/NavBar.tsx` (time left, mute, End with a second tap; the voice is `useMuted` in `ui/voice.ts`: driving keeps it on or off for the next drive in `kosmos.muted.v1`, every other trip starts silent, as people are around; Done on arrival, which also ends guidance after 60 s and closes the trip). `NavWaiting` (in `ui/NavView.tsx`) stands in whenever guidance has no route yet, so End is always on screen. Off the route the arrow and camera follow the fix itself. The app's own camera moves wait while a finger is on the map (`touching` in `App.tsx`): any move resets MapLibre's gesture handlers. Long-press does nothing while guiding. A failed reroute keeps the old route (`useRoute` reports `kept`), and the banner says so only while still off the route.
- Guidance is `core/nav.ts`: pure, fed fixes and time, covered by replay tests. Fixes worse than `COARSE_M` (65 m: network, tunnels, approximate) move the dot only; a turn is done only 10 m past it on the road after it (going straight on, or waiting at the light, takes no turn); off the route `prompt` stays quiet; going back down the route (40 m, or a course against it 3 fixes in a row) is off it; getting to the route from a car park is not. `ui/useGuidance.ts` wires it to the map: the arrow, the camera (both the user and the way back when off the route), rerouting that keeps the followed route until a new one arrives; the last fix counts at once at Start, and the dot follows while the route is still coming. Prompts are queued, never cut off (`ui/voice.ts`). A fix may only move along the route as far as plausible travel since the last one (`reachOf`), so self-crossing routes and U-turns onto the other carriageway skip nothing; arrival is said only on arriving and then latched; the early alert moves out with speed (30 s ahead). The UI only subscribes it to location (`useLocation().subscribe`) and renders `NavState`.
- Layout: `ui/layout.ts` (the side layout for wide screens and phones held sideways, same query as `styles.css`; camera paddings), `ui/usePanel.ts` (publishes the panel height as `--panel-h` so the map buttons sit just above it; keeps a selected pin clear of its card; starts location on opening only when already granted), `ui/prefs.ts` (remembered choices), `ui/motion.ts` (camera moves honour reduced motion).
- Units: `core/route.ts` `unitsFor` (region of the locale: US miles/feet, UK miles/yards, else metric) for display, speech, speed and the router's own instructions; `units` in `i18n`.
- Language: `i18n` picks en or de; `locale` is the browser's own tag for it (en-GB, de-AT) for clocks, weekdays, numbers and the voice. English copy is British. `capital` starts a sentence built from parts (lines without a name become "bus", "tram").
- Accessibility: `ui/a11y.ts` (a card's heading takes focus on opening, closing from the keyboard goes back to search; radio groups are one Tab stop with arrow keys). `.toasts` is the always-present live region. A button whose label names the next action has no `aria-pressed`; a toggle keeps one label with `aria-pressed` (mute). Colour tokens `--danger` and `--late` keep text contrast in both themes; targets are at least 44 px.
- Keep each file under 800 lines; split before adding to it.

## Invariants

- Storage keys follow `kosmos.<name>.v<N>` (`kosmos.view.v1`). Never rename an existing key: bump the version and migrate.
- Network calls go only to OpenFreeMap, Photon, the FOSSGIS Valhalla router, Transitous and Nominatim (README → Privacy, CSP in `index.html`).
- Nominatim (`core/details.ts`, `ui/usePlaceDetails.ts`) follows the OSMF usage policy: one `lookup` by OSM id per place card opened, cached; as search fallback one `search` for a settled query only when Photon fails or exceeds 5 s, never as-you-type (a quick failure waits until the text has been left alone 5 s, or Enter; `SearchBar.tsx`); one request a second across both (`nominatimSlot` in `ui/http.ts`), which also names the app.
- Transitous (`core/transit.ts`) is volunteer-run too: one plan request per trip, travel-mode or departure change (the time field settles 800 ms first); while guiding, at most one `stoptimes` check per ride, in the last 10 min before boarding and not within 3 min of planning (`ui/useRide.ts`). Never polled. Requests go through `ui/http.ts`. The Android app names itself with a User-Agent via `CapacitorHttp`; browsers send their Referer. `Mode` (road: Valhalla, turn-by-turn in `core/nav.ts`) vs `TravelMode` (adds `transit`: guided by `core/ride.ts`).
- The router is a volunteer service under fair use: one request per trip or travel-mode change, re-requested by an open road route only when the start moves more than 150 m (or twice the accuracy) and at most once a minute, never for public transport (`ui/useRoute.ts`), and while navigating only on a confirmed off-route, at most every 30 s and backing off to 4 min while standing in the same place (`rerouteDue` in `core/nav.ts`), for one route leaving in the direction of travel. Never poll it.
- A new data source or bundled asset goes into `THIRD_PARTY_NOTICES.md` (linked from About).
- No user-facing string is hard-coded. Add it to `src/i18n/en.ts` and `de.ts`.
- Android app ID `io.github.jibes.kosmos` and the release key are permanent; changing either breaks updates for installed users.

## Android

- `android/` is a committed Capacitor project; `npx cap sync android` copies `dist/` in (ignored by git).
- Icons are vector adaptive icons in `res/drawable` + `res/mipmap-anydpi`; web PNGs come from `npm run icons` (set `CHROMIUM_PATH` in cloud sessions).
- The app's own native code (registered in `MainActivity`): `KosmosPlugin.java` opens the app's system settings (offered when location was refused, `openAppSettings` in `ui/native.ts`) and writes log lines under the tag `kOSMos` (`nativeLog`, `forwardErrors`); `NavLocationPlugin.java` + `NavLocationService.java` keep location coming while guiding: a `location`-type foreground service on the platform's `LocationManager` (GPS, network for approximate-only or GPS off), no Google Play services; it asks for location and, on Android 13+, the notification once. `useLocation().background(true)` keeps the WebView watch until the service's first fix.
- Release builds log nothing from the WebView (`loggingBehavior: 'debug'`): the bridge would otherwise write every fix to logcat. Too old a WebView (< 100, `minWebViewVersion`) shows `public/webview.html` (static, both languages, outside i18n since the app cannot run there).
- Back button: `ui/useBack.ts` (`@capacitor/app`) and Escape share one ladder in `App.tsx` (About → picker → navigation, which needs a second press → route → place); with nothing left back minimises the app instead of quitting.
- Navigation on Android: `useLocation().background(true)` moves location to `NavLocationService`; speech uses the system engine (`ui/voice.ts`), keep-awake the native plugin (`ui/wakeLock.ts`). The web build falls back to Web Speech and Screen Wake Lock.
- CI boots an Android 14 emulator after the build and runs `scripts/android-smoke.sh` (install, launch, no crash, no web errors, `kosmos:ready` logged under the tag `kOSMos` once the map loads) before any release. The build job has no secrets (npm and Gradle run there, also for pull requests) and leaves the APK unsigned, with a throwaway-signed copy for the emulator; the `release` job (main only) signs that tested APK with apksigner, checks the certificate against README and publishes. The Gradle wrapper JAR and distribution are checked against gradle.org's checksums. Its artifact `android-smoke` holds a screenshot with real tiles and the logcat; the latest screenshot is also force-pushed to the `ci-smoke` branch.
- Release: bump `package.json` version on main → `android.yml` publishes `v<version>` if that tag does not exist.

## Deviations

- `android.yml` uses the runner's preinstalled JDK 21 and Android SDK instead of setup actions, and boots the emulator with the SDK's own tools instead of `android-emulator-runner` (fewer third-party actions to pin).
- Fonts and tiles for scripts beyond Latin come from OpenFreeMap's glyph server at runtime; self-hosting all of Noto would add tens of MB.

## Done checklist (before every push)

1. `npm run check` (typecheck, lint, format:check, unit)
2. `npm run build && npm run e2e` (cloud sessions: `CHROMIUM_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome` when the preinstalled Chromium does not match `@playwright/test`)
3. If you fixed a bug, a test now covers it.
4. README is updated if you changed behaviour, scripts or services.
