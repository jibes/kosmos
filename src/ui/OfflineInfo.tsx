import { useEffect, useState } from 'react';
import { fill, locale, t } from '../i18n';
import { useFetching, type Fetching } from './offlineState';
import { keptBytes } from './tileStore';
import { lastWorld } from './useKeepMap';

const MB = 1024 * 1024;
const size = (bytes: number) =>
  bytes < MB ? '< 1 MB' : `${Math.round(bytes / MB).toLocaleString(locale)} MB`;
const count = (n: number) => n.toLocaleString(locale);

/** One download under way: what, how far, as a bar and in words. */
function Progress({ text, f }: { text: string; f: Fetching }) {
  const words = fill(text, { done: count(f.done), total: count(f.total) });
  return (
    <>
      <small>{words}</small>
      <progress max={f.total} value={f.done} aria-label={words} />
    </>
  );
}

/**
 * About's offline map: how much is kept on the device, whether the whole world is (and when),
 * and what is being kept now with its progress. The size is read again while a download runs.
 */
export function OfflineInfo() {
  const { world, trip } = useFetching();
  const [bytes, setBytes] = useState<number | null>(null);
  const busy = !!world || !!trip;
  useEffect(() => {
    let live = true;
    const read = () =>
      void keptBytes()
        .then((b) => live && setBytes(b))
        .catch(() => undefined);
    read();
    const id = busy ? window.setInterval(read, 2000) : 0;
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [busy]);
  const last = lastWorld();
  return (
    <dd className="offline-map">
      {bytes !== null && <small>{fill(t.offlineKept, { size: size(bytes) })}</small>}
      {world ? (
        <Progress text={t.worldFetching} f={world} />
      ) : (
        <small>
          {last
            ? fill(t.worldKept, {
                z: last.z,
                date: new Date(last.at).toLocaleDateString(locale, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                }),
              })
            : t.worldWaits}
        </small>
      )}
      {trip && <Progress text={t.tripFetching} f={trip} />}
    </dd>
  );
}
