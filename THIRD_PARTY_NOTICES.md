# Data sources and licences

kOSMos is free software under [GPL-3.0-or-later](LICENSE). It holds no data of its own; everything it shows comes from the sources below, fetched when needed.

## Data

| Source                                                    | Licence                                                   | Used for                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [OpenStreetMap](https://www.openstreetmap.org/copyright)  | ODbL 1.0, © OpenStreetMap contributors                    | Everything on the map, search, routes, places by category                                       |
| [OpenFreeMap](https://openfreemap.org)                    | Service; tiles from OpenStreetMap                         | Vector tiles, glyphs for non-Latin scripts                                                      |
| [OpenMapTiles](https://openmaptiles.org) schema           | CC-BY 4.0                                                 | Tile layer structure the map style is written for                                               |
| [Photon](https://photon.komoot.io) by komoot              | Service (Apache-2.0); data from OpenStreetMap             | Search, addresses                                                                               |
| [Valhalla](https://valhalla1.openstreetmap.de) on FOSSGIS | Service (MIT); data from OpenStreetMap                    | Car, bike and walking routes                                                                    |
| [Nominatim](https://nominatim.org) by the OSM Foundation  | Service (GPL-2.0); data from OpenStreetMap                | Opening hours, phone, website                                                                   |
| [Transitous](https://transitous.org)                      | Service (MOTIS, MIT); timetables under their own licences | Public transport; feeds and licences: [transitous.org/sources](https://transitous.org/sources/) |

## Software

| Component                                                                         | Licence      |
| --------------------------------------------------------------------------------- | ------------ |
| MapLibre GL JS                                                                    | BSD-3-Clause |
| React, React DOM                                                                  | MIT          |
| Capacitor and plugins (share, background geolocation, text to speech, keep awake) | MIT          |
| Workbox (via vite-plugin-pwa)                                                     | MIT          |
| Inter (bundled), Noto (glyph server)                                              | OFL-1.1      |

The map style (`src/core/style.ts`) and palette (`src/core/palette.ts`) are original to this project.
