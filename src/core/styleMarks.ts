import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Palette } from './palette';
import { CONTACT_ICON, CONTACT_SOURCE, FAV_ICON, FAV_SOURCE, FONT } from './style';

type Expr = ExpressionSpecification;

/**
 * The user's own marks on the map: contacts at their addresses and favourite places, each a
 * tinted icon (drawn by the app) and its name, above the map's labels.
 */

/** Favourites: a star and the name, above the map's labels, below search results. */
export function favourites(p: Palette): LayerSpecification[] {
  return [
    {
      id: 'fav-stars',
      type: 'symbol',
      source: FAV_SOURCE,
      layout: {
        'icon-image': FAV_ICON,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 16, 1.15] as unknown as Expr,
        // Always shown; placed, so a tap finds it (an ignored placement is not hit-tested).
        'icon-allow-overlap': true,
      },
      paint: {
        'icon-color': p.favourite,
        'icon-halo-color': p.routeCasing,
        'icon-halo-width': 1.5,
      },
    },
    {
      id: 'fav-names',
      type: 'symbol',
      source: FAV_SOURCE,
      minzoom: 12,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONT.bold],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 8,
        'text-optional': true,
      },
      paint: { 'text-color': p.favourite, 'text-halo-color': p.halo, 'text-halo-width': 1.6 },
    },
  ];
}

/** Contacts: a person and the name, as favourites are marked, in their own colour. */
export function contacts(p: Palette): LayerSpecification[] {
  return [
    {
      id: 'contact-icons',
      type: 'symbol',
      source: CONTACT_SOURCE,
      layout: {
        'icon-image': CONTACT_ICON,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 16, 1.15] as unknown as Expr,
        // Always shown; placed, so a tap finds it.
        'icon-allow-overlap': true,
      },
      paint: { 'icon-color': p.contact, 'icon-halo-color': p.routeCasing, 'icon-halo-width': 1.5 },
    },
    {
      id: 'contact-names',
      type: 'symbol',
      source: CONTACT_SOURCE,
      minzoom: 12,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONT.bold],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 8,
        'text-optional': true,
      },
      paint: { 'text-color': p.contact, 'text-halo-color': p.halo, 'text-halo-width': 1.6 },
    },
  ];
}
