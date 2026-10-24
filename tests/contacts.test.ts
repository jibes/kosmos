import { describe, expect, it } from 'vitest';
import {
  addressLine,
  contactFeatures,
  matchContacts,
  mergeContacts,
  parseContacts,
  REREAD_AFTER_MS,
  rereadDue,
} from '../src/core/contacts';

const anna = { name: 'Anna Müller', address: 'Unter den Linden 5\n10117 Berlin' };

describe('contacts', () => {
  it('writes an address on one line', () => {
    expect(addressLine(anna.address)).toBe('Unter den Linden 5, 10117 Berlin');
  });

  it('keeps the points it has, asks for new or changed addresses, forgets those gone', () => {
    const first = mergeContacts([], [anna, { name: 'Bo', address: '' }, anna]);
    expect(first.todo).toEqual([
      { name: 'Anna Müller', address: 'Unter den Linden 5, 10117 Berlin' },
    ]);
    const placed = [{ ...first.contacts[0], lng: 13.38, lat: 52.517 }];
    const again = mergeContacts(placed, [anna]);
    expect(again.todo).toEqual([]);
    expect(again.contacts).toEqual(placed);
    // Not found before: not asked again for the same address.
    expect(mergeContacts([{ ...first.contacts[0], missed: true }], [anna]).todo).toEqual([]);
    // Moved: asked for anew.
    const moved = mergeContacts(placed, [{ ...anna, address: 'Pariser Platz 1, Berlin' }]);
    expect(moved.todo).toHaveLength(1);
    expect(mergeContacts(placed, []).contacts).toEqual([]);
  });

  it('finds a contact by the beginning of its name or a word of it', () => {
    const list = [
      { name: 'Anna Müller', address: 'x', lng: 1, lat: 2 },
      { name: 'Bernd', address: 'y', lng: 1, lat: 2 },
      { name: 'Anton', address: 'z' },
    ];
    expect(matchContacts(list, 'an').map((c) => c.name)).toEqual(['Anna Müller']);
    expect(matchContacts(list, 'mull').map((c) => c.name)).toEqual(['Anna Müller']);
    expect(matchContacts(list, 'b')).toEqual([]);
  });

  it('reads storage, dropping anything malformed, and marks the placed ones', () => {
    const ok = { name: 'A', address: 'B', lng: 1, lat: 2 };
    const raw = JSON.stringify([ok, { name: 'x' }, { name: 'C', address: 'D', missed: true }]);
    const list = parseContacts(raw);
    expect(list).toHaveLength(2);
    expect(contactFeatures(list).features).toHaveLength(1);
    expect(contactFeatures(list).features[0].properties).toEqual({ name: 'A', contact: 0 });
    expect(parseContacts('{')).toEqual([]);
    // Off the globe, half a point, or `missed` anything but true: dropped.
    const bad = [
      { ...ok, lat: 91 },
      { name: 'E', address: 'F', lat: 2 },
      { name: 'G', address: 'H', missed: 'no' },
    ];
    expect(parseContacts(JSON.stringify(bad))).toEqual([]);
  });

  it('reads the address book again on coming back after a while', () => {
    expect(rereadDue(null, 1e9)).toBe(false);
    expect(rereadDue(0, REREAD_AFTER_MS - 1)).toBe(false);
    expect(rereadDue(0, REREAD_AFTER_MS)).toBe(true);
  });

  it("keeps each contact's link into the address book as it is now", () => {
    const uri = 'content://com.android.contacts/contacts/lookup/0r1-ABC/7';
    const placed = {
      name: 'Anna Müller',
      address: addressLine(anna.address),
      lng: 13.39,
      lat: 52.51,
    };
    // A placed contact takes its link, keeping its point; a new one comes with it.
    const first = mergeContacts(
      [placed],
      [
        { ...anna, uri },
        { name: 'Ben', address: 'Hof 1', uri },
      ],
    );
    expect(first.contacts[0]).toEqual({ ...placed, uri });
    expect(first.todo).toEqual([{ name: 'Ben', address: 'Hof 1', uri }]);
    // A link no longer given goes; one that is no address book's is never kept.
    expect(mergeContacts([{ ...placed, uri }], [anna]).contacts[0]).toEqual(placed);
    expect(mergeContacts([placed], [{ ...anna, uri: 'https://example.org' }]).contacts[0]).toEqual(
      placed,
    );
    expect(parseContacts(JSON.stringify([{ ...placed, uri: 'file:///x' }]))).toEqual([placed]);
    expect(parseContacts(JSON.stringify([{ ...placed, uri }]))).toEqual([{ ...placed, uri }]);
  });
});
