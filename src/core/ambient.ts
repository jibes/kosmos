/**
 * The light around the phone, from its ambient light sensor, while guiding: dark where the sun
 * and the mapped tunnels cannot tell (a multi-storey car park, an unmapped underpass, dusk
 * under heavy cloud). It only ever adds dark: bright light never overrules night or a tunnel,
 * since a petrol station's canopy at night is bright too.
 *
 * A thumb over the sensor or a passing shadow must not flip the map: dark needs a while below
 * a low threshold, light a while above a much higher one, and between switches there is a
 * pause.
 */

/** Darker than a lit street at night; a covered car park. */
export const DARK_LUX = 10;
/** Overcast daylight indoors and brighter. */
export const LIGHT_LUX = 150;
export const DARK_HOLD_MS = 8_000;
export const LIGHT_HOLD_MS = 5_000;
/** At least this long between two switches, whatever the sensor says. */
export const SWITCH_GAP_MS = 30_000;

export interface Ambient {
  /** Dark around: `true`, bright: `false`, not yet known: `null`. */
  dark: boolean | null;
  /** Since when the light has stayed below `DARK_LUX`, or above `LIGHT_LUX`. */
  below: number | null;
  above: number | null;
  /** When `dark` last changed. */
  changed: number;
}

export const AMBIENT_START: Ambient = { dark: null, below: null, above: null, changed: -Infinity };

/** The next state after a reading of `lux` at `time` (ms). */
export function feedLux(a: Ambient, lux: number, time: number): Ambient {
  const below = lux < DARK_LUX ? (a.below ?? time) : null;
  const above = lux > LIGHT_LUX ? (a.above ?? time) : null;
  const free = time - a.changed >= SWITCH_GAP_MS;
  let dark = a.dark;
  if (free && dark !== true && below !== null && time - below >= DARK_HOLD_MS) dark = true;
  else if (free && dark !== false && above !== null && time - above >= LIGHT_HOLD_MS) dark = false;
  return { dark, below, above, changed: dark === a.dark ? a.changed : time };
}
