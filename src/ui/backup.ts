import { backupFileName, backupText, parseBackup } from '../core/backup';
import { fill, t } from '../i18n';
import { saveFile } from './native';
import { favouritesNow, restoreFavourites } from './useFavourites';
import { contactsNow, restoreContacts } from './useContacts';
import { logEvent } from './usageLog';

/** The favourites and contacts as one file to keep elsewhere. */
export function saveBackup(): Promise<boolean> {
  const now = Date.now();
  const favourites = favouritesNow();
  const contacts = contactsNow();
  logEvent('backup.save', { favourites: favourites.length, contacts: contacts.length });
  return saveFile(
    backupFileName(now),
    backupText({ favourites, contacts }, now),
    'application/json',
  );
}

/** A backup file read back and added to what there is; what to tell the user. */
export async function restoreBackup(file: File): Promise<string> {
  const b = parseBackup(await file.text().catch(() => ''));
  if (!b) return t.backupInvalid;
  const favourites = restoreFavourites(b.favourites);
  const contacts = restoreContacts(b.contacts);
  logEvent('backup.restore', { favourites, contacts });
  return fill(t.backupRestored, { favourites, contacts });
}
