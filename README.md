# kOSMos

A quiet, fast map of the world, made from OpenStreetMap.

One map, one search field, one location button. Everything else is the map.

<p align="center"><img src="public/icons/512.png" width="96" alt="kOSMos icon"></p>

## What it does

Designed from first principles: a map app answers six questions, and kOSMos answers each in exactly one way.

| Question                | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is the world like? | A vector map, light or dark with the system, a globe when zoomed out, 3D buildings when tilted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Where is X?             | Search (as you type, biased to what you are looking at); or a category (restaurants, groceries, …) from the map itself, nearest first, without asking a server; the search key shows them all, dots open their place, and after you move the map one tap searches the new area (in view only, without zooming)                                                                                                                                                                                                                                                                                                        |
| Where am I?             | The location button: first tap follows you north-up, the second turns the map with the compass; a beam on your dot shows where the phone points                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| What is here?           | Tap a label, or long-press (right-click) anywhere: name, address, opening hours (open now, until when), phone, website, coordinates, share, route                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| How do I get there?     | Route from the place card: car, bike, walk or public transport (connections with lines, platforms, delays; leave now or later), with alternatives, steps, changeable start and destination; "Open in…" hands off to another app                                                                                                                                                                                                                                                                                                                                                                                       |
| Take me there           | Start: turn-by-turn on the device with spoken prompts, lane guidance where the lane matters (small ahead, large near the turn), heading-up camera (the compass takes over when walking or standing), current speed, automatic rerouting, and a dark map after sunset and in tunnels. By public transport: walk to the stop turn by turn, when the line leaves, stops left and "get off at the next stop", by GPS above ground and by the timetable underground; shortly before boarding one check brings the live departure and platform. Android keeps guiding with the screen off; in the browser keep the app open |

The view is kept between sessions and in the URL (`#map=zoom/lat/lng/bearing/pitch`), so any view is a link.

## Install

- **Web:** <https://jibes.github.io/kosmos/>, installable as a PWA; the app shell works offline, and areas you have viewed stay cached.
- **Android:** [Releases](https://github.com/jibes/kosmos/releases), or with [Obtainium](https://obtainium.imranr.dev/): add `https://github.com/jibes/kosmos`, or on the phone tap [add to Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/jibes/kosmos).

SHA-256 (release certificate): 00:82:00:1C:3F:66:FD:D2:C1:4F:80:85:2F:4A:D2:96:95:A4:91:E5:51:98:5D:DB:7C:99:A5:5F:77:B5:E8:5F

## Privacy

No account, no analytics, no tracking. Your location leaves the device only as the start of a route you ask for. The app talks to exactly five services:

| Service                                                                | For                                     | Sends                                                                                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenFreeMap](https://openfreemap.org)                                 | Map tiles, glyphs for non-Latin scripts | Tile coordinates of what you view                                                                                                           |
| [Photon](https://photon.komoot.io) by komoot                           | Search, address lookup                  | Search text, map centre; the point you long-press                                                                                           |
| [Valhalla](https://valhalla1.openstreetmap.de) by FOSSGIS              | Routing                                 | Route start (your location, when you ask for a route), destination and travel mode                                                          |
| [Transitous](https://transitous.org)                                   | Public transport                        | Start, destination and departure time of a public transport route you ask for; while you follow it, the boarding stop for a departure check |
| [Nominatim](https://nominatim.openstreetmap.org) by the OSM Foundation | Opening hours, phone, website           | The OpenStreetMap id of the place card you open                                                                                             |

## Android permissions

Location (while navigating it runs in a foreground service with a notification, so directions continue with the screen off), notifications (for that notification), keep screen on, internet. Nothing runs in the background outside navigation.

## Run locally

```sh
npm ci
npm run dev        # http://localhost:5173
npm run check      # typecheck, lint, format, unit tests
npm run build && npm run e2e
```

E2E tests run against a synthetic world (`e2e/fixtures/`): generated vector tiles and canned search answers, so they need no network. `SHOTS=<dir> npm run e2e` also writes the screenshots for design review.

Android: `npm run android:sync`, then open `android/` in Android Studio or run `./gradlew assembleDebug` there.

## Release

- **Web:** every push to `main` deploys to GitHub Pages.
- **Android:** bump `version` in `package.json` and push to `main`. The Android workflow builds, signs, smoke-tests the APK on an emulator, checks the signer against the fingerprint above and publishes `v<version>` with the APK. versionCode = major·10⁷ + minor·10⁵ + patch·10³.
- Signing secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them CI builds a debug-signed APK artifact and publishes nothing.

## Stack

TypeScript, React 19, Vite, MapLibre GL JS 6, vite-plugin-pwa, Capacitor 8. Map style written from scratch for the OpenMapTiles schema (`src/core/style.ts`), labels set in self-hosted Inter.

## Licence

[GPL-3.0-or-later](LICENSE). Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Data sources and licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
