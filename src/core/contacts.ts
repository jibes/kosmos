import { fold } from './categories';

/**
 * The user's contacts with a postal address, placed on the map: read from the phone's address
 * book (or picked in the browser) only when the user asks, each address looked up once by
 * Photon and kept on the device with its point, so it is never sent again.
 */
export interface Contact {
  name: string;
  address: string;
  /** Where the address is, once looked up. */
  lng?: number;
  lat?: number;
  /** The lookup found nothing: not asked again until the address changes. */
  missed?: true;
}

/** Back in the app after this long: the address book is read again (moves, new contacts). */
export const REREAD_AFTER_MS = 10 * 60_000;

/** The app was put away at `hiddenAt` and is back `now`: time to read the address book again. */
export const rereadDue = (hiddenAt: number | null, now: number) =>
  hiddenAt !== null && now - hiddenAt >= REREAD_AFTER_MS;

/** A phone's address book can be long; this many addresses are placed at most. */
export const CONTACTS_MAX = 500;

/** One line for an address written over several, as the address book or a picker gives it. */
export const addressLine = (raw: string) =>
  raw
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(', ');

const keyOf = (c: Pick<Contact, 'name' | 'address'>) => `${c.name}|${addressLine(c.address)}`;

/**
 * What the address book holds now, merged with what was placed before: a known address keeps its
 * point; a new or changed one is to be looked up (`todo`); contacts gone are gone.
 */
export function mergeContacts(
  known: Contact[],
  read: { name: string; address: string }[],
): { contacts: Contact[]; todo: Contact[] } {
  const byKey = new Map(known.map((c) => [keyOf(c), c]));
  const seen = new Set<string>();
  const contacts: Contact[] = [];
  const todo: Contact[] = [];
  for (const r of read) {
    const name = r.name.trim();
    const address = addressLine(r.address);
    if (!name || !address) continue;
    const key = keyOf({ name, address });
    if (seen.has(key)) continue;
    seen.add(key);
    const had = byKey.get(key);
    if (had && (had.lng !== undefined || had.missed)) contacts.push(had);
    else {
      const c = { name, address };
      contacts.push(c);
      todo.push(c);
    }
    if (contacts.length >= CONTACTS_MAX) break;
  }
  return { contacts, todo };
}

/** A contact whose name the text begins, or one of its words: "anna", "müller", "Anna M". */
export function matchContacts(list: Contact[], query: string, limit = 3): Contact[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  return list
    .filter((c) => c.lng !== undefined)
    .filter((c) => {
      const name = fold(c.name);
      return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
    })
    .slice(0, limit);
}

/** What storage holds, anything malformed dropped. */
export function parseContacts(raw: string | null): Contact[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (c): c is Contact =>
          !!c &&
          typeof c.name === 'string' &&
          typeof c.address === 'string' &&
          (c.lng === undefined || (Number.isFinite(c.lng) && Number.isFinite(c.lat))),
      )
      .slice(0, CONTACTS_MAX);
  } catch {
    return [];
  }
}

/** The map's person layer: the contacts placed, by name and their place in the list. */
export function contactFeatures(list: Contact[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: list.flatMap((c, i) =>
      c.lng === undefined || c.lat === undefined
        ? []
        : [
            {
              type: 'Feature' as const,
              id: i,
              geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
              properties: { name: c.name, contact: i },
            },
          ],
    ),
  };
}

/** Contacts from a backup added to those there are: one placed already keeps its point. */
export function addContacts(here: Contact[], restored: Contact[]): Contact[] {
  const known = new Set(here.map(keyOf));
  const added = restored.filter((c) => !known.has(keyOf(c)));
  return [...here, ...added].slice(0, CONTACTS_MAX);
}
