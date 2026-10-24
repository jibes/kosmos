import { parseContacts, withUri, type Contact } from './contacts';
import { parseFavourites, type Favourite } from './favourites';

/**
 * What the user keeps in the app, as one file to save elsewhere: the favourites and the
 * contacts placed (with their points, so a restore asks nothing again). Clearing the app's data
 * or a new phone loses neither then.
 */
export interface Backup {
  favourites: Favourite[];
  contacts: Contact[];
}

const KIND = 'kosmos-backup';

export function backupText(b: Backup, now: number): string {
  // A contact's link is this phone's own: on another it would open someone else, or nobody.
  const contacts = b.contacts.map((c) => withUri(c, undefined));
  return JSON.stringify(
    { kind: KIND, v: 1, at: new Date(now).toISOString(), ...b, contacts },
    null,
    1,
  );
}

/** A backup file read back, anything malformed in it dropped; `null` when it is none. */
export function parseBackup(text: string): Backup | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || (raw as { kind?: unknown }).kind !== KIND) return null;
    const { favourites, contacts } = raw as { favourites?: unknown; contacts?: unknown };
    return {
      favourites: parseFavourites(JSON.stringify(favourites ?? [])),
      contacts: parseContacts(JSON.stringify(contacts ?? [])),
    };
  } catch {
    return null;
  }
}

/** The file's name, dated: several backups side by side stay apart. */
export const backupFileName = (now: number) =>
  `kosmos-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
