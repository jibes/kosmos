import { useEffect, useState } from 'react';

/** The current time, refreshed every `ms`; keeps render pure for arrival clocks. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
