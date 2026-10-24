import { useEffect, useState } from 'react';
import {
  commonsUrl,
  parseCommons,
  parseWikidata,
  thumbWidth,
  wikidataUrl,
  type Photo,
  type PhotoRef,
} from '../core/photo';
import { getJson } from './http';

/** Answers kept for the app's life, by file or item: a card opened again asks nothing. */
const cache = new Map<string, Photo | null>();

const keyOf = (ref: PhotoRef) => ('file' in ref ? ref.file : ref.wikidata);

/** Saving data: no photo at all, rather than one the user did not ask for. */
const savingData = () =>
  !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

async function fetchPhoto(ref: PhotoRef, signal: AbortSignal): Promise<Photo | null> {
  let file = 'file' in ref ? ref.file : null;
  if (!file) {
    const r = await getJson(wikidataUrl(keyOf(ref)), signal);
    if (!r.ok) throw new Error(`wikidata ${r.status}`);
    file = parseWikidata(r.json);
    if (!file) return null;
  }
  // As wide as the card can be: the screen on a phone, the column beside the map.
  const width = thumbWidth(Math.min(window.innerWidth, 440), window.devicePixelRatio);
  const r = await getJson(commonsUrl(file, width), signal);
  if (!r.ok) throw new Error(`commons ${r.status}`);
  return parseCommons(r.json);
}

/**
 * The place's photo from Wikimedia Commons, once its card's details name one: `null` when
 * there is none (or it failed, or data is being saved), `undefined` while it is asked for.
 */
export function usePhoto(ref: PhotoRef | undefined): Photo | null | undefined {
  const key = ref && !savingData() ? keyOf(ref) : undefined;
  const [got, setGot] = useState<{ key: string; photo: Photo | null } | null>(null);
  useEffect(() => {
    if (!ref || !key || cache.has(key)) return;
    const ctrl = new AbortController();
    fetchPhoto(ref, ctrl.signal)
      .then((photo) => {
        cache.set(key, photo);
        if (!ctrl.signal.aborted) setGot({ key, photo });
      })
      // No answer: none this time, asked again when the card opens again.
      .catch(() => !ctrl.signal.aborted && setGot({ key, photo: null }));
    return () => ctrl.abort();
    // The ref is read through its key: a new object for the same file asks nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  return got?.key === key ? got.photo : undefined;
}
