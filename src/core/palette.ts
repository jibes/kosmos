/**
 * Two palettes, one structure. Every colour the map draws comes from here, so a theme is a
 * swap of this object and nothing else.
 *
 * Principle: land is quiet, water is the only saturated surface, roads are light (day) or
 * lifted (night), and text carries the hierarchy. The accent is reserved for the user:
 * their position and their selection.
 */
export interface Palette {
  /** Behind the globe at low zoom. */
  space: string;
  land: string;
  residential: string;
  built: string;
  park: string;
  wood: string;
  grass: string;
  sand: string;
  ice: string;
  wetland: string;
  water: string;
  waterway: string;
  building: string;
  aeroway: string;
  /** Roads below z11, before they widen into white ribbons with casings. */
  roadLow: string;
  motorwayLow: string;
  roadMinor: string;
  roadMinorCase: string;
  roadMajor: string;
  roadMajorCase: string;
  motorway: string;
  motorwayCase: string;
  path: string;
  rail: string;
  boundary: string;
  boundaryState: string;
  label: string;
  labelMinor: string;
  labelRoad: string;
  labelWater: string;
  halo: string;
  sky: string;
  horizon: string;
  /** Strength of the directional light on extruded buildings. */
  light: number;
  accent: string;
  /** Unchosen alternative routes. */
  routeAlt: string;
  /** Outline that lifts the route off the roads. */
  routeCasing: string;
  /** The user's favourite places: a star apart from the accent the search and route use. */
  favourite: string;
}

export type Theme = 'light' | 'dark';

export const palettes: Record<Theme, Palette> = {
  light: {
    space: '#dfe5ec',
    land: '#f5f3ef',
    residential: '#efede8',
    built: '#ecebe7',
    park: '#e1ead6',
    wood: '#d8e4cd',
    grass: '#e5ecdc',
    sand: '#f1ebdc',
    ice: '#f8fafc',
    wetland: '#dde8e0',
    water: '#c3d6e5',
    waterway: '#b4cce0',
    building: '#e6e2db',
    aeroway: '#e6e3de',
    roadLow: '#d2cbbf',
    motorwayLow: '#dfba86',
    roadMinor: '#ffffff',
    roadMinorCase: '#e3ded6',
    roadMajor: '#ffffff',
    roadMajorCase: '#d6cfc3',
    motorway: '#f7dfb9',
    motorwayCase: '#e2c08f',
    path: '#c9c0b2',
    rail: '#cbc5bc',
    boundary: '#a39db4',
    boundaryState: '#c9c4d3',
    label: '#2a2927',
    labelMinor: '#6e6961',
    labelRoad: '#5c5851',
    labelWater: '#4b769c',
    halo: '#f5f3ef',
    sky: '#cfdbe8',
    horizon: '#e8edf3',
    light: 0.12,
    accent: '#2f5cff',
    routeAlt: '#a9b6e3',
    routeCasing: '#ffffff',
    favourite: '#a86400',
  },
  dark: {
    space: '#05060a',
    land: '#121417',
    residential: '#15171b',
    built: '#16181c',
    park: '#13201a',
    wood: '#122019',
    grass: '#151d18',
    sand: '#1b1a17',
    ice: '#1b1e22',
    wetland: '#141d1b',
    water: '#0f2338',
    waterway: '#142a42',
    building: '#1a1d21',
    aeroway: '#1c1f24',
    roadLow: '#30343b',
    motorwayLow: '#54493a',
    roadMinor: '#30343b',
    roadMinorCase: '#0e1013',
    roadMajor: '#3c414a',
    roadMajorCase: '#0e1013',
    motorway: '#4a4134',
    motorwayCase: '#191613',
    path: '#33373e',
    rail: '#2c2f35',
    boundary: '#5e5873',
    boundaryState: '#3a3746',
    label: '#e7e5e0',
    labelMinor: '#8d9199',
    labelRoad: '#9b9fa7',
    labelWater: '#6390bb',
    halo: '#121417',
    sky: '#05060a',
    horizon: '#1a2233',
    light: 0.1,
    accent: '#6e8bff',
    routeAlt: '#3b4675',
    routeCasing: '#0b0d12',
    favourite: '#f2b23c',
  },
};
