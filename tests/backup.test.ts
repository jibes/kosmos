import { describe, expect, it } from 'vitest';
import { backupFileName, backupText, parseBackup } from '../src/core/backup';
import { addContacts } from '../src/core/contacts';

const fav = { name: 'Café', detail: 'Berlin', lng: 13.35, lat: 52.5, at: 1, label: 'Coffee' };
const anna = { name: 'Anna', address: 'Hauptstr. 1, Berlin', lng: 13.4, lat: 52.52 };

describe('backup', () => {
  it('reads back what it wrote', () => {
    const now = Date.UTC(2026, 9, 18);
    const text = backupText({ favourites: [fav], contacts: [anna] }, now);
    expect(parseBackup(text)).toEqual({ favourites: [fav], contacts: [anna] });
    expect(backupFileName(now)).toBe('kosmos-backup-2026-10-18.json');
  });

  it("leaves out the phone's own link to a contact", () => {
    const uri = 'content://com.android.contacts/contacts/lookup/0r1-ABC/7';
    const text = backupText({ favourites: [], contacts: [{ ...anna, uri }] }, 0);
    expect(text).not.toContain('content://');
    expect(parseBackup(text)?.contacts).toEqual([anna]);
  });

  it('is no backup unless it says so; drops what is malformed in one', () => {
    expect(parseBackup('{"favourites":[]}')).toBeNull();
    expect(parseBackup('not json')).toBeNull();
    const b = parseBackup(
      JSON.stringify({ kind: 'kosmos-backup', favourites: [fav, { name: 1 }], contacts: 'x' }),
    );
    expect(b).toEqual({ favourites: [fav], contacts: [] });
  });

  it('adds contacts, one here keeping its point', () => {
    const here = [{ name: 'Anna', address: 'Hauptstr. 1, Berlin', lng: 1, lat: 2 }];
    const ben = { name: 'Ben', address: 'Ring 2', missed: true as const };
    expect(addContacts(here, [anna, ben])).toEqual([here[0], ben]);
  });
});
