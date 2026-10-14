/** Camera moves in ms, or none at all when the system asks for reduced motion. */
export const motion = (ms: number) =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : ms;
