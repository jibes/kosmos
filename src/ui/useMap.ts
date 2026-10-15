import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Theme } from '../core/palette';
import { ROUTE_SOURCE, SEARCH_SOURCE, buildStyle } from '../core/style';
import { DEFAULT_VIEW, VIEW_KEY, parseView, serializeView } from '../core/view';
import { mapFontFaces } from './fonts';
import { nativeLog } from './native';

// MapLibre resolves its worker next to its own module, which bundling moves; point it at the copy.
maplibregl.setWorkerUrl(new URL(workerUrl, document.baseURI).href);

function storedView() {
  try {
    return parseView(localStorage.getItem(VIEW_KEY));
  } catch {
    return null;
  }
}

/** Owns the MapLibre instance: creation, view persistence and theme swaps. */
export function useMap(
  container: RefObject<HTMLDivElement | null>,
  theme: Theme,
  labelLang: string,
): maplibregl.Map | null {
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const initial = useRef({ theme, labelLang });

  useEffect(() => {
    if (!container.current) return;
    const v = storedView() ?? DEFAULT_VIEW;
    const m = new maplibregl.Map({
      container: container.current,
      style: buildStyle({
        ...initial.current,
        lang: initial.current.labelLang,
        fontFaces: mapFontFaces(),
      }),
      center: [v.lng, v.lat],
      zoom: v.zoom,
      bearing: v.bearing,
      pitch: v.pitch,
      hash: 'map',
      attributionControl: false,
      maxPitch: 75,
      fadeDuration: 180,
      validateStyle: import.meta.env.DEV,
      cancelPendingTileRequestsWhileZooming: true,
    });
    m.keyboard.enable();
    const save = () => {
      const c = m.getCenter().wrap();
      const view = {
        lng: c.lng,
        lat: c.lat,
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
      };
      try {
        localStorage.setItem(VIEW_KEY, serializeView(view));
      } catch {
        // Private mode or full storage: the URL hash still carries the view.
      }
    };
    m.on('moveend', save);
    // The Android CI smoke test waits for this line in logcat.
    m.once('load', () => {
      console.info('kosmos:ready');
      nativeLog('info', 'kosmos:ready');
    });
    // Exposed for end-to-end tests and the curious.
    (window as unknown as { kosmos?: maplibregl.Map }).kosmos = m;
    setMap(m);
    return () => {
      m.remove();
      setMap(null);
    };
  }, [container]);

  useEffect(() => {
    if (!map) return;
    const { theme: t0, labelLang: l0 } = initial.current;
    if (t0 === theme && l0 === labelLang) return;
    initial.current = { theme, labelLang };
    map.setStyle(buildStyle({ theme, lang: labelLang, fontFaces: mapFontFaces() }), {
      diff: true,
      // The route and search dots live in the map, not in the style; carry them over a theme swap.
      transformStyle: (prev, next) => {
        const sources = { ...next.sources };
        for (const id of [ROUTE_SOURCE, SEARCH_SOURCE]) {
          const kept = prev?.sources[id];
          if (kept) sources[id] = kept;
        }
        return { ...next, sources };
      },
    });
  }, [map, theme, labelLang]);

  return map;
}
