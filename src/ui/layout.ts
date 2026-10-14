/** The side layout: wide screens, and phones held sideways (the same query as styles.css). */
export const wide = () =>
  matchMedia('(min-width: 900px), (orientation: landscape) and (min-width: 560px)').matches;

/** Keeps a selected place clear of the panel that describes it, before the card is measured. */
export const padding = () =>
  wide()
    ? { top: 48, bottom: 48, left: 440, right: 48 }
    : { top: 96, bottom: 300, left: 32, right: 32 };

/** While navigating, the user sits low on screen so more of the road ahead shows. */
export const navPadding = () =>
  wide()
    ? { top: Math.round(innerHeight * 0.3), bottom: 60, left: 440, right: 0 }
    : { top: Math.round(innerHeight * 0.42), bottom: 110, left: 0, right: 0 };

export const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

/** Fits a route, a place or category results into the map area the panel leaves free, measured. */
export const routePadding = () => {
  const panel = document.querySelector('.panel')?.getBoundingClientRect();
  if (wide()) return { top: 64, bottom: 64, left: (panel?.right ?? 420) + 48, right: 96 };
  const bottom = panel && panel.height ? innerHeight - panel.top + 24 : 380;
  return { top: 96, bottom: Math.min(bottom, innerHeight - 220), left: 40, right: 80 };
};

/** A finger long-presses; a mouse right-clicks. */
export const touch = () => matchMedia('(pointer: coarse)').matches;
