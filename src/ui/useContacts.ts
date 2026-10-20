import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  addContacts,
  contactFeatures,
  mergeContacts,
  parseContacts,
  rereadDue,
  type Contact,
} from '../core/contacts';
import { parsePhoton, searchUrl, type Place } from '../core/search';
import { CONTACT_ICON, CONTACT_SOURCE } from '../core/style';
import { fill, lang, t } from '../i18n';
import { isNative, openAppSettings, readContacts } from './native';
import { CONTACTS_KEY, store, stored } from './prefs';
import { logEvent } from './usageLog';
import { forgetPeople } from './useRecent';

let list: Contact[] = parseContacts(stored(CONTACTS_KEY));
const listeners = new Set<() => void>();

function set(next: Contact[]) {
  list = next;
  store(CONTACTS_KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useContacts = () => useSyncExternalStore(subscribe, () => list);
export const contactAt = (i: number): Contact | undefined => list[i];
export const contactsNow = () => list;

/** Contacts from a backup, added to these with their points; how many were new. */
export function restoreContacts(restored: Contact[]): number {
  const next = addContacts(list, restored);
  const added = next.length - list.length;
  set(next);
  return added;
}

/** The browser's contact picker (Chrome on Android): the user picks whom to add. */
interface ContactsManager {
  select(
    props: string[],
    o: { multiple: boolean },
  ): Promise<
    {
      name?: string[];
      address?: { addressLine?: string[]; city?: string; postalCode?: string; country?: string }[];
    }[]
  >;
}
const picker = () => (navigator as Navigator & { contacts?: ContactsManager }).contacts ?? null;

/** Contacts can be added here: the app's address book, or the browser's picker. */
export const contactsAvailable = () => isNative || !!picker();

/** One Photon lookup a little over a second apart: a volunteer-friendly pace for a long list. */
const LOOKUP_GAP_MS = 1100;

async function lookUp(address: string): Promise<{ lng: number; lat: number } | null> {
  // A hung request would hold the import, and every later "Add contacts", for good.
  const res = await fetch(searchUrl(address, lang, undefined, 1), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(String(res.status));
  const [hit] = parsePhoton(await res.json());
  return hit ? { lng: hit.lng, lat: hit.lat } : null;
}

let running = false;

/**
 * Reads the contacts (asking for the address book, or opening the picker, when `ask`) and
 * places each new address, one lookup at a time; what was placed before keeps its point.
 * Returns how many contacts have a place, `'denied'` when the app may not read them, or `null`
 * when nothing was read (the picker closed, already reading).
 */
export async function importContacts(ask: boolean): Promise<number | 'denied' | null> {
  if (running) return null;
  running = true;
  try {
    let read: { name: string; address: string }[] | null;
    if (isNative) {
      read = await readContacts(ask);
      if (!read) return 'denied';
    } else {
      const p = picker();
      if (!p || !ask) return null;
      const picked = await p.select(['name', 'address'], { multiple: true }).catch(() => null);
      if (!picked) return null;
      read = picked.flatMap((c) =>
        (c.address ?? []).slice(0, 1).map((a) => ({
          name: c.name?.[0] ?? '',
          address: [
            ...(a.addressLine ?? []),
            [a.postalCode, a.city].filter(Boolean).join(' '),
            a.country,
          ]
            .filter(Boolean)
            .join(', '),
        })),
      );
      // Picked in the browser: added to those there are, not instead of them.
      read = [...list.map(({ name, address }) => ({ name, address })), ...read];
    }
    if (!read) return null;
    const { contacts, todo } = mergeContacts(list, read);
    set(contacts);
    let failed = 0;
    for (const c of todo) {
      // Taken off meanwhile: the rest is not looked up.
      if (!list.includes(c)) continue;
      const at = await lookUp(c.address).catch(() => undefined);
      // A failed request (offline) is tried again next time; a lookup that found nothing is not.
      if (at !== undefined) {
        set(list.map((x) => (x === c ? (at ? { ...c, ...at } : { ...c, missed: true }) : x)));
      } else if (++failed >= 3) break; // Photon down: the rest another time, not all at once.
      await new Promise((go) => setTimeout(go, LOOKUP_GAP_MS));
    }
    const placed = list.filter((c) => c.lng !== undefined).length;
    logEvent('contacts.import', { read: read.length, placed });
    return placed;
  } finally {
    running = false;
  }
}

/** Takes them all off the map and off the device, recent searches of them too. */
export const forgetContacts = () => {
  set([]);
  forgetPeople();
};

/** A contact's place, its card opened from the search or the map. */
export const placeOfContact = (c: Contact): Place => ({
  name: c.name,
  detail: c.address,
  lng: c.lng ?? 0,
  lat: c.lat ?? 0,
  kind: 'person',
});

/** A person: a head and shoulders, white on clear, tinted by the style (an SDF image). */
function person(size = 56): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(size / 2, size * 0.36, size * 0.15, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(size / 2, size * 0.78, size * 0.27, size * 0.2, 0, Math.PI, 0);
  g.fill();
  return g.getImageData(0, 0, size, size);
}

/** The contacts on the map, in step with the list; refreshed from the address book on opening. */
export function useContactLayer(map: maplibregl.Map | null) {
  const contacts = useContacts();
  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      if (!map.hasImage(CONTACT_ICON)) {
        map.addImage(CONTACT_ICON, person(), { sdf: true, pixelRatio: 2 });
      }
    };
    const missing = (e: { id: string }) => {
      if (e.id === CONTACT_ICON) ensure();
    };
    if (map.isStyleLoaded()) ensure();
    map.on('styledata', ensure);
    map.on('styleimagemissing', missing);
    return () => {
      map.off('styledata', ensure);
      map.off('styleimagemissing', missing);
    };
  }, [map]);
  useEffect(() => {
    if (!map) return;
    const apply = () =>
      (map.getSource(CONTACT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
        contactFeatures(contacts),
      );
    if (map.getSource(CONTACT_SOURCE)) apply();
    else map.once('load', apply);
    return () => {
      map.off('load', apply);
    };
  }, [map, contacts]);
  // Added in the app before: the address book again, never asking (moves, new contacts), on
  // opening and on coming back after a while.
  useEffect(() => {
    if (!isNative) return;
    if (list.length) void importContacts(false);
    let hiddenAt: number | null = null;
    const onVisible = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (rereadDue(hiddenAt, Date.now()) && list.length) void importContacts(false);
      if (!document.hidden) hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}

/** "3 contacts on the map", "1 contact on the map", or none with an address. */
export const onMapText = (n: number) =>
  n === 0 ? t.contactsNone : n === 1 ? t.contactOnMap : fill(t.contactsOnMap, { n });

/**
 * The search's contacts row, where contacts can be added here at all: adding (said when done,
 * as it takes a moment per address), removing, and the list to find them in.
 */
export function useContactsRow(
  say: (text: string, actions?: { label: string; run: () => void }[]) => void,
) {
  const contacts = useContacts();
  const [busy, setBusy] = useState(false);
  const onAdd = useCallback(() => {
    setBusy(true);
    void importContacts(true)
      .then((n) => {
        // Refused before: only the system's settings can allow it now.
        if (n === 'denied') {
          say(
            t.contactsDenied,
            openAppSettings ? [{ label: t.settings, run: openAppSettings }] : undefined,
          );
        } else if (n !== null) say(onMapText(n));
      })
      .finally(() => setBusy(false));
  }, [say]);
  return useMemo(
    () =>
      contactsAvailable() ? { list: contacts, busy, onAdd, onForget: forgetContacts } : undefined,
    [contacts, busy, onAdd],
  );
}
