import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { categoriesFor, foundFor, foundOf, type Kind } from '../core/categories';
import { nominatimSearchUrl, parseNominatim } from '../core/details';
import { formatLngLat, type LngLat } from '../core/geo';
import { otherForms, plusCode } from '../core/queryForms';
import { parseShared } from '../core/shared';
import { openShared } from './useShared';
import { parsePhoton, searchUrl, type Place, type SearchBias } from '../core/search';
import {
  blankItems,
  folderItems,
  matchFavourites,
  type Folder,
  type Item,
  type ListInput,
} from '../core/searchList';
import { getJson, nominatimSlot } from './http';
import { logEvent } from './usageLog';
import { fill, t } from '../i18n';
import { touch } from './layout';
import { useSwipe } from './useSwipe';
import { CloseIcon, SearchIcon } from './icons';
import { placeOf, useFavourites } from './useFavourites';
import { placeOfContact } from './useContacts';
import { matchContacts, type Contact } from '../core/contacts';
import { isFavourite } from '../core/favourites';
import { forgetRecent, rememberPlace, rememberRecent, useRecent } from './useRecent';
import { folderName, labelOf as label, rowClass, rowKey, rowLabel, SearchRow } from './SearchRow';

type Status = 'idle' | 'loading' | 'done' | 'error' | 'slow';

/** What is being searched for: by name, or a kind of place (or a chain) on the map. */
export interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  category: Kind | null;
  setCategory: (c: Kind | null) => void;
  /** A list of the user's own, or the kinds of place, open in the field's place. */
  folder: Folder | null;
  /** Into a list or out of it; the text was for the other, so it goes. */
  setFolder: (f: Folder | null) => void;
  /** Empties the field and ends the category (its dots go with it). */
  clear: () => void;
  /** The text to search for, out of any category or list. */
  searchFor: (q: string) => void;
}

/** The search's own state, kept by whoever should outlive the bar (App, across a route). */
export function useSearch(): SearchState {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Kind | null>(null);
  const [folder, setFolderState] = useState<Folder | null>(null);
  return useMemo(
    () => ({
      query,
      setQuery,
      category,
      setCategory,
      folder,
      setFolder: (f: Folder | null) => {
        setFolderState(f);
        setQuery('');
        setCategory(null);
      },
      clear: () => {
        setQuery('');
        setCategory(null);
        setFolderState(null);
      },
      /** Words to search for from elsewhere (a shared message): out of any kind or list first. */
      searchFor: (q: string) => {
        setQuery(q);
        setCategory(null);
        setFolderState(null);
      },
    }),
    [query, category, folder],
  );
}

interface Props {
  /** Kept outside, to survive the bar being hidden; the bar keeps its own without it. */
  search?: SearchState;
  /** Kept in the page but out of sight (a route open over it). */
  hidden?: boolean;
  lang: string;
  onPick: (place: Place) => void;
  /** Must be stable; it is read when a query fires. */
  bias: () => SearchBias | undefined;
  /** Hides the result list while a place card is showing. */
  collapsed: boolean;
  onFocus: () => void;
  /** Overrides the default "Search places" prompt, e.g. when choosing a route start. */
  placeholder?: string;
  autoFocus?: boolean;
  /** Shows a Cancel button; also what Escape does on an empty field. */
  onCancel?: () => void;
  /**
   * Places of a category from the map itself, nearest first; `null` ends the category. Without
   * it the bar searches by name only (choosing a route's start or destination).
   */
  onCategory?: (c: Kind | null, given?: Place[]) => Promise<Place[]>;
  /** Bumped to search the category again where the map now is. */
  categoryRun?: number;
  /** The search key on a category: all its places on the map, none picked. */
  onShowAll?: () => void;
  /** The user's contacts on the map: found by name, added or removed from the empty field. */
  contacts?: { list: Contact[]; busy: boolean; onAdd: () => void; onForget: () => void };
  /** Contacts found by name only, without their list or adding them (a route's own field). */
  people?: Contact[];
  /** Where distances in the lists count from: the user in view, else the map's middle. */
  from?: () => LngLat | undefined;
}

const DEBOUNCE_MS = 200;
/** A pull down the list this far, or a quick flick, puts it away. */
const PUT_AWAY_PX = 64;
const FLICK_PX_PER_MS = 0.5;
/** A search server that has not answered by now is slow: another is asked meanwhile. */
const TIMEOUT_MS = 5000;
/** Photon is given up at the requests' own limit (`ui/http.ts`); a late answer still counts. */
const PHOTON_MAX_MS = 20_000;
/** Nominatim is only asked for text left alone this long (OSMF policy: never as-you-type). */
const SETTLE_MS = 5000;
/** A fallback answer that takes longer than this is not coming. */
const FALLBACK_MS = 8000;
/** Answers by query and roughly where the map looked: "Hauptbahnhof" means another one elsewhere. */
const cache = new Map<string, Place[]>();
/** The other form an answer in `cache` was found for. */
const altFor = new Map<string, string>();
/** Other forms of a text are asked for only from this long (a word being typed finds some). */
const FORMS_MIN = 4;

/** A point typed or pasted (coordinates, a map link, a Plus Code) as a place of its own. */
const pointPlace = (at: LngLat, lang: string, name?: string): Place => ({
  name: name ?? formatLngLat(at, 5, lang),
  detail: name ? formatLngLat(at, 5, lang) : t.point,
  lng: at.lng,
  lat: at.lat,
});

/** About 50 km across, and four zoom steps: the same search there gets the same answer. */
const area = (b: SearchBias | undefined) =>
  b ? `${Math.round(b.lat * 2)},${Math.round(b.lng * 2)},${Math.floor(b.zoom / 4)}` : '';

interface Response {
  key: string;
  places: Place[];
  status: 'done' | 'error' | 'slow';
  /** Nominatim's answer while Photon was down: not kept, and Enter asks again. */
  fallback?: boolean;
  /** Nothing for the text as typed: what was found for this other form of it instead. */
  alt?: string;
  /** Photon failed, Nominatim is still to be asked: said so, not "try again". */
  pending?: boolean;
}

export function SearchBar({
  search,
  hidden,
  lang,
  bias,
  onPick,
  collapsed,
  onFocus,
  placeholder,
  autoFocus,
  onCancel,
  onCategory,
  categoryRun,
  onShowAll,
  contacts,
  people,
  from,
}: Props) {
  const own = useSearch();
  /** A kind of place chosen from the suggestions: its places come from the map, not by name. */
  const { query, setQuery, category, setCategory, folder, setFolder } = search ?? own;
  /** Which way the list slides: into a list from the right, back out from the left. */
  const [slide, setSlide] = useState<'in' | 'out' | null>(null);
  const openFolder = (f: Folder | null) => {
    setSlide(f ? 'in' : 'out');
    setFolder(f);
  };
  const [response, setResponse] = useState<Response | null>(null);
  const [cursor, setCursor] = useState({ key: '', index: 0 });
  const [focused, setFocused] = useState(false);
  /** Bumped by Enter after a failed or unanswered search, to ask again. */
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  /**
   * A pull down on the list puts it away with the keyboard, the text kept: the map back in
   * view. Focusing the field brings it back. The list scrolls first, as sheets do.
   */
  const box = useRef<HTMLDivElement>(null);
  const listShown = useRef(false);
  const [pull, setPull] = useState(0);
  useSwipe(
    box,
    () => (listShown.current ? { dir: 1, scrollFirst: true } : null),
    (dy) => setPull(Math.max(0, dy)),
    (dy, v) => {
      setPull(0);
      if (dy > PUT_AWAY_PX || v > FLICK_PX_PER_MS) input.current?.blur();
    },
  );
  const listId = useId();
  /** Enter pressed before results arrived: jump to the first one when they do. */
  const jumpFor = useRef<string | null>(null);
  /** The names Enter showed all of (a `found:` kind): Photon's answer, handed to the map. */
  const foundPlaces = useRef<Place[]>([]);
  /** When the text last changed, and the query Enter asked again for (it may ask at once). */
  const edited = useRef(0);
  const askedFor = useRef<string | null>(null);
  /** The OSM link text last opened as its object. */
  const openedFor = useRef<string | null>(null);
  const onPickRef = useRef(onPick);
  const onCategoryRef = useRef(onCategory);
  useEffect(() => {
    onPickRef.current = onPick;
    onCategoryRef.current = onCategory;
  });

  const q = query.trim();
  // Where the names are asked near, as of when the list was last open: text left in a hidden
  // or closed field is never asked anew just because the map (or the user) moved on.
  const looking = focused && !collapsed && !hidden;
  const [areaThen, setAreaThen] = useState(() => area(bias()));
  const areaNow = looking ? area(bias()) : areaThen;
  if (areaNow !== areaThen) setAreaThen(areaNow);
  const key = folder
    ? `dir|${folder}|${q}`
    : category
      ? `cat|${category}`
      : `${lang}|${q}|${areaNow}`;
  const cached = category || folder ? undefined : cache.get(key);
  const current: Omit<Response, 'key'> | null = cached
    ? { places: cached, status: 'done', alt: altFor.get(key) }
    : response?.key === key
      ? response
      : null;
  // An open list is searched on the device only.
  const status: Status = folder || q.length < 2 ? 'idle' : (current?.status ?? 'loading');
  // While a new query loads, the previous names stay put instead of flickering away. A category
  // shows only its own places: never names, nor the last category's places, to be tapped.
  const sameKind = !!response && !category && !folder && !response.key.startsWith('cat|');
  /** "museum", "Lebensm…": the kinds of place the text may mean, offered above the names. */
  const kinds = category || !onCategory ? [] : categoriesFor(q);
  const suggestions: Item[] = kinds.map((cat) => ({ type: 'cat', cat }));
  const results = current?.places ?? (sameKind ? response.places : []);
  /** None of the kind in view: the nearest around it, said so above them. */
  const beyond = !!category && results.length > 0 && results.every((p) => p.beyond);
  /** An empty field: the lists of the user's own and the kinds of place, then the recent
   * searches (places only when choosing a route's end). Nothing is taken until chosen. */
  const blank = q.length < 2 && !category && !folder;
  const recent = useRecent();
  const favourites = useFavourites();
  const list: ListInput = {
    query: q,
    folder,
    favourites,
    contacts: contacts?.list,
    recent,
    kinds: !!onCategory,
    labelOf: label,
    placeOf,
    placeOfContact,
    from: folder ? from?.() : undefined,
  };
  /** Typed: the user's own favourites and contacts by name, before the world's places. */
  const favs = blank || folder || category ? [] : matchFavourites(favourites, q);
  const items: Item[] = folder
    ? folderItems({ ...list, folder })
    : blank
      ? blankItems(list)
      : [
          ...suggestions,
          ...favs.map((f): Item => ({ type: 'place', place: placeOf(f), fav: true })),
          ...(category ? [] : matchContacts(contacts?.list ?? people ?? [], q)).map((c): Item => ({
            type: 'place',
            place: placeOfContact(c),
            contact: true,
          })),
          ...results
            .filter((p) => !isFavourite(favs, p))
            .map((place): Item => ({ type: 'place', place })),
        ];
  const placed = contacts?.list.filter((c) => c.lng !== undefined).length ?? 0;
  // A name search offers its top row for Enter; a category, or an empty field, picks nothing
  // until asked.
  const active =
    cursor.key === key
      ? Math.min(cursor.index, items.length - 1)
      : folder
        ? q && items.length > 1
          ? 1
          : -1
        : category || blank
          ? -1
          : 0;
  const setActive = (index: number) => setCursor({ key, index });

  // A category asks the map, never the search server; leaving it clears its dots.
  useEffect(() => {
    const ask = onCategoryRef.current;
    if (!ask) return;
    let live = true;
    ask(category, category && foundOf(category) !== null ? foundPlaces.current : undefined)
      .then((places) => {
        if (!live || !category) return;
        setResponse({ key: `cat|${category}`, places, status: 'done' });
      })
      .catch(() => {
        if (live && category) setResponse({ key: `cat|${category}`, places: [], status: 'error' });
      });
    return () => {
      live = false;
    };
  }, [category, categoryRun]);

  // Enter before the answer: taken once the names are here.
  const ready = current?.status === 'done' ? current.places : null;
  useEffect(() => {
    if (jumpFor.current !== key || !ready) return;
    jumpFor.current = null;
    // Several: all of them on the map, as for a kind of place; one: that one.
    if (ready.length > 1 && onCategoryRef.current) {
      foundPlaces.current = ready;
      setCategory(foundFor(q));
      input.current?.blur();
    } else if (ready[0]) {
      // Taken as a tap on it would be: among the recent ones too.
      if (ready[0].distance === undefined) rememberPlace(ready[0]);
      onPickRef.current(ready[0]);
      input.current?.blur();
    }
  }, [key, ready, q, setCategory]);

  useEffect(() => {
    if (category || folder || q.length < 2 || cache.has(key)) return;
    const ctrl = new AbortController();
    const fallback = new AbortController();
    let timedOut = false;
    const done = (places: Place[], fallback = false, alt?: string) => {
      if (!fallback) {
        if (cache.size > 64) cache.delete(cache.keys().next().value as string);
        cache.set(key, places);
        if (alt) altFor.set(key, alt);
      }
      setResponse({ key, places, status: 'done', fallback, alt });
    };
    // Coordinates, a map link or a Plus Code: the point itself, asking no server (a short
    // code after a place's name is placed near that place, found first).
    const shared = parseShared(q);
    if (shared && 'at' in shared) {
      done([pointPlace(shared.at, lang, shared.name)]);
      return;
    }
    // An openstreetmap.org object link: opened as a shared one is, by its id.
    if (shared && 'osm' in shared) {
      // No names for it (none kept: pasted again after other text, it opens again).
      done([], true);
      // Once for the text, however often this runs again.
      if (openedFor.current === key) return;
      openedFor.current = key;
      openShared(shared);
      return;
    }
    openedFor.current = null;
    // A message with a link in it: its words, without the link.
    const text = shared && 'query' in shared ? shared.query : q;
    const plus = plusCode(q, bias());
    if (plus?.at && !plus.rest) {
      done([pointPlace(plus.at, lang)]);
      return;
    }
    /** Photon failed or hung: ask Nominatim once for this settled query, in its time slot. */
    const viaNominatim = async () => {
      await new Promise((go) => setTimeout(go, nominatimSlot()));
      if (fallback.signal.aborted) return null;
      const own = new AbortController();
      fallback.signal.addEventListener('abort', () => own.abort());
      const late = setTimeout(() => own.abort(), FALLBACK_MS);
      try {
        const r = await getJson(nominatimSearchUrl(text, lang, bias()), own.signal);
        return r.ok ? parseNominatim(r.json) : null;
      } finally {
        clearTimeout(late);
      }
    };
    const timer = setTimeout(async () => {
      /** Photon answered (it wins over Nominatim, whenever it comes), or gave up for good. */
      const st: {
        photon: 'asking' | 'in' | 'failed';
        nominatim: 'none' | 'asking' | 'failed' | 'shown';
      } = { photon: 'asking', nominatim: 'none' };
      /** Photon slow or failed: Nominatim once, for this settled query, in its time slot. */
      const fallBack = async (quick: boolean) => {
        if (st.nominatim !== 'none') return;
        st.nominatim = 'asking';
        const status = quick ? 'error' : 'slow';
        logEvent('search.photon', { status });
        // Offline, another server fails as surely: said at once ("needs a connection").
        if (q.length < 3 || !navigator.onLine) {
          st.nominatim = 'failed';
          setResponse({ key, places: [], status: navigator.onLine ? status : 'error' });
          return;
        }
        setResponse({ key, places: [], status, pending: true });
        // Photon slow means the text has been left alone for 5 s already. A quick failure waits
        // until the text has settled as long, unless Enter asked.
        if (quick && askedFor.current !== key) {
          const wait = edited.current + SETTLE_MS - Date.now();
          await new Promise((go) => setTimeout(go, Math.max(0, wait)));
          if (fallback.signal.aborted || st.photon === 'in') return;
        }
        const places = await viaNominatim().catch(() => null);
        if (fallback.signal.aborted || st.photon === 'in') return;
        logEvent('search.nominatim', { found: places?.length ?? -1 });
        st.nominatim = places ? 'shown' : 'failed';
        // Neither has answered: said so (Photon's answer, should it still come, takes over).
        if (places) done(places, true);
        else setResponse({ key, places: [], status });
      };
      // Slow: Nominatim is asked meanwhile, Photon's answer still taken when it comes; at the
      // request limit it is given up.
      const slow = setTimeout(() => void fallBack(false), TIMEOUT_MS);
      const limit = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, PHOTON_MAX_MS);
      const stopTimers = () => {
        clearTimeout(slow);
        clearTimeout(limit);
      };
      try {
        const ask = async (text: string) => {
          const res = await fetch(searchUrl(text, lang, bias()), { signal: ctrl.signal });
          if (!res.ok) throw new Error(String(res.status));
          return parsePhoton(await res.json());
        };
        if (plus?.rest) {
          // "8RJW+Q2 Dublin": the code near the place named.
          const [near] = await ask(plus.rest);
          const at = near ? plusCode(q, near)?.at : null;
          stopTimers();
          st.photon = 'in';
          done(at ? [pointPlace(at, lang)] : []);
          return;
        }
        let places = await ask(text);
        let alt: string | undefined;
        // Nothing for it as typed: another form of it (a postcode written properly, then the
        // area it names; the house number moved; without a misspelled last word), one by one.
        for (const form of places.length || text.length < FORMS_MIN ? [] : otherForms(text)) {
          places = await ask(form);
          if (places.length) {
            alt = form;
            break;
          }
        }
        stopTimers();
        // Nominatim already answered with places, and Photon found none: those stay.
        if (!places.length && st.nominatim === 'shown') {
          st.photon = 'failed';
          return;
        }
        st.photon = 'in';
        done(places, false, alt);
        return;
      } catch (e) {
        stopTimers();
        if (ctrl.signal.aborted && !timedOut) return;
        console.warn('search failed', e);
      }
      st.photon = 'failed';
      if (st.nominatim === 'failed') setResponse({ key, places: [], status: 'slow' });
      else void fallBack(!timedOut);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
      fallback.abort();
    };
  }, [q, key, lang, bias, category, folder, retry, setCategory]);

  // "/" focuses search from anywhere, like most of the web.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (place: Place) => {
    // Found by name (not a dot from the map): worth finding again without typing.
    if (place.distance === undefined) rememberPlace(place);
    if (folder) setFolder(null);
    onPick(place);
    input.current?.blur();
  };

  /** Search the map for a kind of place; the field shows its name, the map its places. */
  const choose = (c: Kind) => {
    rememberRecent({ kind: c, label: label(c) });
    if (folder) setFolder(null);
    setCategory(c);
    setQuery(label(c));
    input.current?.blur();
  };

  /** Enter without picking one of several names: all of them on the map, nearest first. */
  const showFound = (places: Place[]) => {
    logEvent('search.pick', { row: 'all', n: places.length });
    foundPlaces.current = places;
    setCategory(foundFor(q));
    input.current?.blur();
  };

  /** Which kind of row was taken, for the usage log: never the text or the place. */
  const rowOf = (it: Item) => {
    if (it.type === 'place') return it.fav ? 'favourite' : it.contact ? 'contact' : 'name';
    if (it.type === 'cat') return folder ? 'kinds' : 'kind';
    if (it.type === 'folder') return `list:${it.folder}`;
    return it.type;
  };
  const choice = (it: Item) => {
    logEvent('search.pick', { row: rowOf(it), at: items.indexOf(it) });
    switch (it.type) {
      case 'contacts':
        return contacts?.onAdd();
      case 'folder':
        return openFolder(it.folder);
      case 'up':
        return openFolder(null);
      case 'recent':
        return 'place' in it.recent ? pick(it.recent.place) : choose(it.recent.kind as Kind);
      case 'cat':
        return choose(it.cat);
      case 'place':
        return pick(it.place);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keys while an input method composes a word belong to it: Enter commits the word.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (!n) return;
      const next =
        (Math.max(active, e.key === 'ArrowDown' ? -1 : 0) + (e.key === 'ArrowDown' ? 1 : n - 1)) %
        n;
      setActive(next);
      // The row the arrows reached stays in sight in a long list.
      requestAnimationFrame(() =>
        document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' }),
      );
    } else if (e.key === 'Enter' && category && active < 0) {
      // "Restaurants" + search: show them all where they are, without choosing one.
      // Close the list first, so the fit measures the map the user will see.
      input.current?.blur();
      if (onShowAll) requestAnimationFrame(() => onShowAll());
    } else if (
      e.key === 'Enter' &&
      (status === 'error' || status === 'slow' || (current?.fallback && !results.length)) &&
      !suggestions.length
    ) {
      askedFor.current = key;
      setResponse(null);
      setRetry((n) => n + 1);
    } else if (e.key === 'Enter') {
      // Only rows for exactly this query; stale names from the last query would jump wrong.
      const fresh = blank || folder || current || active < suggestions.length;
      const it = fresh ? items[active] : undefined;
      // The top row was not chosen, only offered: with several names, Enter shows them all.
      const all =
        !folder &&
        !!onCategory &&
        it?.type === 'place' &&
        !it.fav &&
        !it.contact &&
        cursor.key !== key &&
        results.length > 1;
      if (all) showFound(results);
      else if (it) choice(it);
      else if (q.length >= 2 && status === 'loading') jumpFor.current = key;
    } else if (e.key === 'Delete' && items[active]?.type === 'recent') {
      const it = items[active];
      if (it.type === 'recent') forgetRecent(it.recent);
    } else if (e.key === 'Escape') {
      if (folder && !query) openFolder(null);
      else if (query) {
        setQuery('');
        setCategory(null);
      } else if (onCancel) onCancel();
      else input.current?.blur();
    }
  };

  /** What the list has to say instead of results; also read out to a screen reader. */
  /** Found for another form of the text: said above the names, so none is taken for it. */
  const instead =
    !category && !folder && current?.alt && results.length
      ? fill(t.foundInstead, { q, alt: current.alt })
      : '';
  const note = current?.pending
    ? t.searchElsewhere
    : folder && q && items.length < 2
      ? t.noResults
      : status === 'done' && !items.length
        ? category
          ? t.noneHere
          : t.noResults
        : status === 'error'
          ? navigator.onLine
            ? t.searchSlow
            : t.searchOffline
          : status === 'slow'
            ? t.searchSlow
            : '';
  const open = !collapsed && focused;
  const showList =
    open &&
    (status !== 'idle' || suggestions.length > 0 || ((blank || !!folder) && items.length > 0));
  useEffect(() => {
    listShown.current = showList;
  });

  /** One row: a line of the list, or a pill in the strip of lists. */
  const option = (it: Item, i: number, Tag: 'li' | 'div') => (
    <Tag
      key={rowKey(it)}
      role="option"
      id={`${listId}-${i}`}
      className={rowClass(it)}
      aria-selected={i === active}
      aria-label={rowLabel(it)}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => choice(it)}
      onPointerEnter={() => setActive(i)}
    >
      <SearchRow
        it={it}
        lang={lang}
        placed={placed}
        busy={contacts?.busy}
        onForgetContacts={contacts?.onForget}
      />
    </Tag>
  );

  return (
    <div ref={box} className="search" data-open={showList || undefined} hidden={hidden}>
      {showList && (
        <ul
          key={folder ?? ''}
          className="results surface"
          data-slide={slide ?? undefined}
          id={listId}
          role="listbox"
          style={
            pull ? { translate: `0 ${pull}px`, opacity: Math.max(0.3, 1 - pull / 240) } : undefined
          }
        >
          {beyond && (
            <li className="r-empty" role="presentation">
              {t.beyondView}
            </li>
          )}
          {instead && (
            <li className="r-empty" role="presentation">
              {instead}
            </li>
          )}
          {items.map((it, i) => {
            // The lists side by side, a strip of their own above the recent searches.
            if (it.type === 'folder') {
              if (items[i - 1]?.type === 'folder') return null;
              const run: number[] = [];
              for (let j = i; items[j]?.type === 'folder'; j++) run.push(j);
              return (
                <li key="strip" role="group" aria-label={t.yourLists} className="r-strip">
                  {run.map((j) => option(items[j], j, 'div'))}
                </li>
              );
            }
            const heading = it.type === 'recent' && items[i - 1]?.type !== 'recent';
            return (
              <Fragment key={rowKey(it)}>
                {heading && (
                  <li role="presentation" className="r-heading" aria-hidden="true">
                    {t.recentHeading}
                  </li>
                )}
                {option(it, i, 'li')}
              </Fragment>
            );
          })}
          {note && (
            <li className="r-empty" role="presentation">
              {note}
            </li>
          )}
          {status === 'loading' && !items.length && (
            <li className="r-empty r-loading" role="presentation" />
          )}
        </ul>
      )}
      {open && q.length < 2 && !showList && (
        <p className="hint">{touch() ? t.hint : t.hintMouse}</p>
      )}
      <p className="sr-only" role="status">
        {showList
          ? note ||
            (folder && !q
              ? fill(t.inList, { name: folderName(folder), n: items.length - 1 })
              : '') ||
            `${beyond ? `${t.beyondView} ` : ''}${instead ? `${instead} ` : ''}${
              results.length === 1
                ? t.oneResult
                : results.length
                  ? fill(t.resultsCount, { n: results.length })
                  : ''
            }`
          : ''}
      </p>
      <label className="bar surface">
        {/* Searching turns the magnifier, so nothing beside the text moves under the thumb. */}
        {status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <SearchIcon />}
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder ?? t.search}
          aria-label={placeholder ?? t.search}
          autoFocus={autoFocus}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
          role="combobox"
          value={query}
          onChange={(e) => {
            edited.current = Date.now();
            // An Enter pressed for the old text does not jump for the new one.
            jumpFor.current = null;
            setQuery(e.target.value);
            // Editing the name of a chosen category goes back to searching by name.
            setCategory(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            onFocus();
          }}
          onBlur={() => setFocused(false)}
        />
        {query && (
          <button
            type="button"
            className="icon-btn"
            aria-label={t.clear}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('');
              setCategory(null);
              input.current?.focus();
            }}
          >
            <CloseIcon />
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            className="bar-cancel"
            onPointerDown={(e) => e.preventDefault()}
            onClick={onCancel}
          >
            {t.cancel}
          </button>
        )}
      </label>
    </div>
  );
}
