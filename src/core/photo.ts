/**
 * A photo of a place from Wikimedia Commons, as OpenStreetMap names it: the place's own
 * `wikimedia_commons` file, a Commons link in its `image` tag, else the image its Wikidata item
 * names (P18). Nothing from any other host: an `image` tag can point anywhere.
 */
export const COMMONS_URL = 'https://commons.wikimedia.org/w/api.php';
export const WIKIDATA_URL = 'https://www.wikidata.org/w/api.php';

/** Where a place's photo is to be found: a Commons file by name, or a Wikidata item to ask. */
export type PhotoRef = { file: string } | { wikidata: string };

export interface Photo {
  /** The thumbnail, on upload.wikimedia.org. */
  src: string;
  width: number;
  height: number;
  /** The file's own page on Commons: its author, licence and the full image. */
  page: string;
  /** Who made it, as plain text; absent where Commons does not say. */
  artist?: string;
  /** "CC BY-SA 4.0", "Public domain". */
  licence?: string;
}

/** "Foo bar.jpg" from "File:Foo_bar.jpg", "Datei:…", a Commons page or upload link; else null. */
export function commonsFile(value: string | undefined): string | null {
  let v = value?.split(';')[0].trim();
  if (!v) return null;
  try {
    if (/^https?:\/\//i.test(v)) {
      const u = new URL(v);
      if (u.hostname === 'commons.wikimedia.org') {
        const m = /^\/wiki\/(.+)$/.exec(u.pathname);
        if (!m) return null;
        v = decodeURIComponent(m[1]);
      } else if (u.hostname === 'upload.wikimedia.org') {
        // The original: /wikipedia/commons/a/ab/Name.jpg; a thumbnail's last part is a size.
        const m = /^\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)$/.exec(u.pathname);
        if (!m) return null;
        v = `File:${decodeURIComponent(m[1])}`;
      } else return null;
    }
  } catch {
    return null;
  }
  const m = /^(?:File|Image|Datei|Fichier|Bild):(.+)$/i.exec(v);
  // A category or gallery holds many files: none of them is the place's own.
  if (!m && /^[^:]+:/.test(v)) return null;
  const name = (m ? m[1] : v).replace(/_/g, ' ').trim();
  return /\.(jpe?g|png|webp|gif|tiff?|svg)$/i.test(name) ? name : null;
}

/** The photo OpenStreetMap's tags point to, Commons first. */
export function photoRefOf(tags: Record<string, string> | null | undefined): PhotoRef | null {
  if (!tags) return null;
  const file = commonsFile(tags.wikimedia_commons) ?? commonsFile(tags.image);
  if (file) return { file };
  const q = tags.wikidata?.split(';')[0].trim();
  return q && /^Q\d+$/.test(q) ? { wikidata: q } : null;
}

/** The Wikidata item's image, one claim asked for. */
export function wikidataUrl(item: string): string {
  const q = new URLSearchParams({
    action: 'wbgetclaims',
    entity: item,
    property: 'P18',
    format: 'json',
    origin: '*',
  });
  return `${WIKIDATA_URL}?${q}`;
}

export function parseWikidata(json: unknown): string | null {
  const claims = (
    json as { claims?: { P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } } | null
  )?.claims?.P18;
  const v = claims?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === 'string' ? commonsFile(`File:${v}`) : null;
}

/**
 * Commons renders thumbnails at these widths ahead of time, and asks apps to use them: the
 * smallest that fills the card at the screen's density, at most 960 (the strip is cropped,
 * a larger file would only cost data).
 */
export const THUMB_STEPS = [250, 330, 500, 960];

export function thumbWidth(cssWidth: number, dpr: number): number {
  const need = cssWidth * Math.min(dpr || 1, 3);
  return THUMB_STEPS.find((w) => w >= need) ?? THUMB_STEPS[THUMB_STEPS.length - 1];
}

/** The file's thumbnail, size, page, author and licence, in one request. */
export function commonsUrl(file: string, width: number): string {
  const q = new URLSearchParams({
    action: 'query',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(width),
    iiextmetadatafilter: 'Artist|LicenseShortName',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  return `${COMMONS_URL}?${q}`;
}

/** Commons' Artist field is HTML: a link to the user's page, often. Its text alone. */
export function plainText(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  // A long credit (several people, a whole sentence) is cut; the file's page has it whole.
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

interface ImageInfo {
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  descriptionurl?: string;
  mime?: string;
  extmetadata?: Record<string, { value?: unknown } | undefined>;
}

export function parseCommons(json: unknown): Photo | null {
  const page = (json as { query?: { pages?: { imageinfo?: ImageInfo[] }[] } } | null)?.query
    ?.pages?.[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl || !info.descriptionurl) return null;
  if (!info.mime?.startsWith('image/')) return null;
  let src: URL;
  try {
    src = new URL(info.thumburl);
  } catch {
    return null;
  }
  // Only Wikimedia's own image host: the page allows no other.
  if (src.protocol !== 'https:' || src.hostname !== 'upload.wikimedia.org') return null;
  const width = Number(info.thumbwidth);
  const height = Number(info.thumbheight);
  if (!(width > 0 && height > 0)) return null;
  const meta = (k: string) => {
    const v = info.extmetadata?.[k]?.value;
    return typeof v === 'string' ? plainText(v) || undefined : undefined;
  };
  const artist = meta('Artist');
  const licence = meta('LicenseShortName');
  return {
    src: src.href,
    width,
    height,
    page: info.descriptionurl,
    ...(artist ? { artist } : {}),
    ...(licence ? { licence } : {}),
  };
}
