import type * as maplibregl from 'maplibre-gl';
import { POI_GROUP, type PlaceKind } from '../core/placeKind';
import { POI_ICON_PREFIX } from '../core/stylePoi';
import { glyphOf } from './icons';

/** Drawn at twice its size on screen, for sharp edges. */
const SIZE = 40;
const RATIO = 2;

/**
 * A kind's icon for the map: a disc with the kind's line drawing cut out of it, one colour, so
 * the style tints it by the kind's group in either theme (`core/stylePoi.ts`).
 */
function disc(kind: Exclude<PlaceKind, 'person'>): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
  g.fill();
  // The glyph's 24-unit square in the disc's middle, its lines cut out.
  const scale = (SIZE * 0.62) / 24;
  g.translate(SIZE / 2 - 12 * scale, SIZE / 2 - 12 * scale);
  g.scale(scale, scale);
  g.globalCompositeOperation = 'destination-out';
  g.lineWidth = 2.4;
  g.lineCap = g.lineJoin = 'round';
  g.stroke(new Path2D(glyphOf(kind)));
  return g.getImageData(0, 0, SIZE, SIZE);
}

const KINDS = Object.keys(POI_GROUP) as Exclude<PlaceKind, 'person'>[];

/**
 * The places' icons, there before any tile is laid out (one laid out without them keeps none)
 * and again for each new style; asked for on the spot as well, should a tile be quicker.
 */
export function registerPoiIcons(map: maplibregl.Map) {
  const add = (kind: Exclude<PlaceKind, 'person'>) => {
    const id = POI_ICON_PREFIX + kind;
    if (!map.hasImage(id)) map.addImage(id, disc(kind), { sdf: true, pixelRatio: RATIO });
  };
  const ensure = () => KINDS.forEach(add);
  const missing = (e: { id: string }) => {
    const kind = e.id.slice(POI_ICON_PREFIX.length) as Exclude<PlaceKind, 'person'>;
    if (e.id.startsWith(POI_ICON_PREFIX) && KINDS.includes(kind)) add(kind);
  };
  if (map.isStyleLoaded()) ensure();
  map.on('styledata', ensure);
  map.on('styleimagemissing', missing);
  return () => {
    map.off('styledata', ensure);
    map.off('styleimagemissing', missing);
  };
}
