import { describe, expect, it } from 'vitest';
import { parseLookup } from '../src/core/details';
import {
  commonsFile,
  commonsUrl,
  parseCommons,
  parseWikidata,
  photoRefOf,
  plainText,
  thumbWidth,
  wikidataUrl,
} from '../src/core/photo';

const answer = (info: object) => ({
  query: { pages: [{ title: 'File:X.jpg', imageinfo: [info] }] },
});
const INFO = {
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tor.jpg/500px-Tor.jpg',
  thumbwidth: 500,
  thumbheight: 333,
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Tor.jpg',
  mime: 'image/jpeg',
  extmetadata: {
    Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane&nbsp;Doe</a>' },
    LicenseShortName: { value: 'CC BY-SA 4.0' },
  },
};

describe('commonsFile', () => {
  it('reads a file however OSM writes it', () => {
    expect(commonsFile('File:Brandenburger_Tor.jpg')).toBe('Brandenburger Tor.jpg');
    expect(commonsFile('Datei:Tor.JPG')).toBe('Tor.JPG');
    expect(commonsFile('Tor.png;File:Other.jpg')).toBe('Tor.png');
    expect(commonsFile('https://commons.wikimedia.org/wiki/File:Tor%20Nacht.jpg')).toBe(
      'Tor Nacht.jpg',
    );
    expect(commonsFile('https://upload.wikimedia.org/wikipedia/commons/a/ab/Tor_Nacht.jpg')).toBe(
      'Tor Nacht.jpg',
    );
  });

  it('leaves out categories, other hosts and what is no image', () => {
    expect(commonsFile('Category:Brandenburger Tor')).toBeNull();
    expect(commonsFile('https://example.org/tor.jpg')).toBeNull();
    expect(commonsFile('https://commons.wikimedia.org/wiki/Category:Tor')).toBeNull();
    expect(commonsFile('File:Tour.webm')).toBeNull();
    expect(commonsFile('File:Plan.pdf')).toBeNull();
    expect(commonsFile('')).toBeNull();
    expect(commonsFile(undefined)).toBeNull();
  });
});

describe('photoRefOf', () => {
  it('takes the Commons file first, then a Commons image link, then Wikidata', () => {
    expect(photoRefOf({ wikimedia_commons: 'File:A.jpg', wikidata: 'Q82425' })).toEqual({
      file: 'A.jpg',
    });
    expect(
      photoRefOf({ image: 'https://commons.wikimedia.org/wiki/File:B.jpg', wikidata: 'Q1' }),
    ).toEqual({ file: 'B.jpg' });
    expect(photoRefOf({ image: 'https://example.org/c.jpg', wikidata: 'Q82425' })).toEqual({
      wikidata: 'Q82425',
    });
    expect(photoRefOf({ wikimedia_commons: 'Category:Tor', wikidata: 'Q82425' })).toEqual({
      wikidata: 'Q82425',
    });
    expect(photoRefOf({ wikidata: 'not an item' })).toBeNull();
    expect(photoRefOf({})).toBeNull();
    expect(photoRefOf(null)).toBeNull();
  });

  it('comes with the place card details', () => {
    expect(parseLookup([{ extratags: { wikidata: 'Q82425' } }])).toEqual({
      photo: { wikidata: 'Q82425' },
    });
    expect(parseLookup([{ extratags: { opening_hours: '24/7' } }])).toEqual({ hours: '24/7' });
  });
});

describe('wikidata', () => {
  it('asks for the item image alone, readable from any page', () => {
    const q = new URL(wikidataUrl('Q82425')).searchParams;
    expect(q.get('entity')).toBe('Q82425');
    expect(q.get('property')).toBe('P18');
    expect(q.get('origin')).toBe('*');
  });

  it('reads the first image claim', () => {
    const json = {
      claims: { P18: [{ mainsnak: { datavalue: { value: 'Brandenburger Tor abends.jpg' } } }] },
    };
    expect(parseWikidata(json)).toBe('Brandenburger Tor abends.jpg');
    expect(parseWikidata({ claims: {} })).toBeNull();
    expect(parseWikidata(null)).toBeNull();
  });
});

describe('commons', () => {
  it('asks for the thumbnail, size, page and credit in one request', () => {
    const q = new URL(commonsUrl('Tor Nacht.jpg', 500)).searchParams;
    expect(q.get('titles')).toBe('File:Tor Nacht.jpg');
    expect(q.get('iiurlwidth')).toBe('500');
    expect(q.get('iiprop')).toContain('extmetadata');
    expect(q.get('origin')).toBe('*');
  });

  it('picks a width Commons has ready, at most 960', () => {
    expect(thumbWidth(360, 1)).toBe(500);
    expect(thumbWidth(300, 1)).toBe(330);
    expect(thumbWidth(360, 2)).toBe(960);
    expect(thumbWidth(440, 3)).toBe(960);
    expect(thumbWidth(200, 0)).toBe(250);
  });

  it('reads the thumbnail with its author and licence as plain text', () => {
    expect(parseCommons(answer(INFO))).toEqual({
      src: INFO.thumburl,
      width: 500,
      height: 333,
      page: INFO.descriptionurl,
      artist: 'Jane Doe',
      licence: 'CC BY-SA 4.0',
    });
    const bare = { ...INFO, extmetadata: undefined };
    expect(parseCommons(answer(bare))).toEqual({
      src: INFO.thumburl,
      width: 500,
      height: 333,
      page: INFO.descriptionurl,
    });
  });

  it('takes no file that is missing, no image, or on another host', () => {
    expect(parseCommons({ query: { pages: [{ missing: true }] } })).toBeNull();
    expect(parseCommons(answer({ ...INFO, mime: 'video/webm' }))).toBeNull();
    expect(parseCommons(answer({ ...INFO, thumburl: 'https://example.org/x.jpg' }))).toBeNull();
    expect(
      parseCommons(answer({ ...INFO, thumburl: 'http://upload.wikimedia.org/x.jpg' })),
    ).toBeNull();
    expect(parseCommons(answer({ ...INFO, thumbwidth: 0 }))).toBeNull();
    expect(parseCommons(null)).toBeNull();
  });

  it('keeps a credit short and its text only', () => {
    expect(plainText('<span>A &amp; B</span>')).toBe('A & B');
    expect(plainText('x'.repeat(100))).toHaveLength(80);
  });
});
