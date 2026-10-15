import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  byName,
  categoriesFor,
  isCategoryWord,
  misspeltFor,
  nameOf,
  NAME_MIN,
  squeeze,
  without,
  type Category,
  type Kind,
} from '../core/categories';
import { formatDistance } from '../core/route';
import { nominatimSearchUrl, parseNominatim } from '../core/details';
import type { LngLat } from '../core/geo';
import { parsePhoton, searchUrl, type Place, type SearchBias } from '../core/search';
import { getJson, nominatimSlot } from './http';
import { fill, t, units } from '../i18n';
import { touch } from './layout';
import { CloseIcon, SearchIcon } from './icons';

type Status = 'idle' | 'loading' | 'done' | 'error' | 'slow';

/** A name several places in view share: how many, and where they are. */
type Shared = { name: string; n: number; at: (LngLat & { name: string })[] };

/** What is being searched for: by name, or a kind of place (or a chain) on the map. */
export interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  category: Kind | null;
  setCategory: (c: Kind | null) => void;
  /** Empties the field and ends the category (its dots go with it). */
  clear: () => void;
}

/** The search's own state, kept by whoever should outlive the bar (App, across a route). */
export function useSearch(): SearchState {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Kind | null>(null);
  return useMemo(
    () => ({
      query,
      setQuery,
      category,
      setCategory,
      clear: () => {
        setQuery('');
        setCategory(null);
      },
    }),
    [query, category],
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
  onCategory?: (c: Kind | null) => Promise<Place[]>;
  /** The name several places in view share that the text begins: "media" → MediaMarkt, 3. */
  onNames?: (text: string) => Promise<Shared | null>;
  /** Bumped to search the category again where the map now is. */
  categoryRun?: number;
  /** The search key on a category: all its places on the map, none picked. */
  onShowAll?: () => void;
}

const label = (k: Kind) => nameOf(k) ?? t[`cat_${k as Category}`];

const DEBOUNCE_MS = 200;
/** A search server that has not answered by now is not going to; say so instead of spinning. */
const TIMEOUT_MS = 5000;
/** Nominatim is only asked for text left alone this long (OSMF policy: never as-you-type). */
const SETTLE_MS = 5000;
/** A fallback answer that takes longer than this is not coming. */
const FALLBACK_MS = 8000;
/**
 * Names in view are read before Photon's names show, so their row does not push the list down
 * under a finger; tiles not read by then are left out for this text.
 */
const NAMES_MS = 1000;
/** Answers by query and roughly where the map looked: "Hauptbahnhof" means another one elsewhere. */
const cache = new Map<string, Place[]>();

/** About 50 km across, and four zoom steps: the same search there gets the same answer. */
const area = (b: SearchBias | undefined) =>
  b ? `${Math.round(b.lat * 2)},${Math.round(b.lng * 2)},${Math.floor(b.zoom / 4)}` : '';

/**
 * A row of the list: a kind of place (or a chain, with how many are in view) to search the map
 * for, or a place found by name.
 */
type Item = { cat: Kind; n?: number; place?: undefined } | { place: Place; cat?: undefined };

interface Response {
  key: string;
  places: Place[];
  status: 'done' | 'error' | 'slow';
  /** Nominatim's answer while Photon was down: not kept, and Enter asks again. */
  fallback?: boolean;
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
  onNames,
  categoryRun,
  onShowAll,
}: Props) {
  const own = useSearch();
  /** A kind of place chosen from the suggestions: its places come from the map, not by name. */
  const { query, setQuery, category, setCategory } = search ?? own;
  const [response, setResponse] = useState<Response | null>(null);
  const [cursor, setCursor] = useState({ key: '', index: 0 });
  const [focused, setFocused] = useState(false);
  /** Bumped by Enter after a failed or unanswered search, to ask again. */
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  /** Enter pressed before results arrived: jump to the first one when they do. */
  const jumpFor = useRef<string | null>(null);
  /** When the text last changed, and the query Enter asked again for (it may ask at once). */
  const edited = useRef(0);
  const askedFor = useRef<string | null>(null);
  const onPickRef = useRef(onPick);
  const onCategoryRef = useRef(onCategory);
  const onNamesRef = useRef(onNames);
  useEffect(() => {
    onPickRef.current = onPick;
    onCategoryRef.current = onCategory;
    onNamesRef.current = onNames;
  });
  /** The shared name in view for a text, once looked for (`null`: none, or not in time). */
  const [shared, setShared] = useState<{
    key: string;
    found: Shared | null;
  } | null>(null);

  const q = query.trim();
  const key = category ? `cat|${category}` : `${lang}|${q}|${area(bias())}`;
  const cached = category ? undefined : cache.get(key);
  const looksForNames = !category && !!onNames && squeeze(q).length >= NAME_MIN;
  const namesKnown = !looksForNames || shared?.key === key;
  const current: Omit<Response, 'key'> | null = !namesKnown
    ? null
    : cached
      ? { places: cached, status: 'done' }
      : response?.key === key
        ? response
        : null;
  const status: Status = q.length < 2 ? 'idle' : (current?.status ?? 'loading');
  // While a new query loads, the previous names stay put instead of flickering away. A category
  // shows only its own places: never names, nor the last category's places, to be tapped.
  const sameKind = !!response && !category && !response.key.startsWith('cat|');
  /** "museum", "Lebensm…": the kinds of place the text may mean, offered above the names. */
  const kinds = category || !onCategory ? [] : categoriesFor(q);
  // "media" → MediaMarkt, 3 in view: a chain is searched on the map like a kind of place. A
  // name that is a kind's own word ("Apotheke am Markt") is the kind's already.
  const found = namesKnown && shared?.key === key ? shared.found : null;
  const chain = found && !isCategoryWord(found.name) ? found : null;
  const suggestions: Item[] = [
    ...kinds.map((cat) => ({ cat })),
    ...(chain ? [{ cat: byName(chain.name), n: chain.n }] : []),
  ];
  // Photon's names, without the branches the chain's row already counts.
  const named = current?.places ?? (sameKind ? response.places : []);
  const results = chain ? without(named, chain.at) : named;
  /** None of the kind in view: the nearest around it, said so above them. */
  const beyond = !!category && results.length > 0 && results.every((p) => p.beyond);
  /** "kindergaten": a guess, after the names, so Enter never takes it for a name it resembles. */
  const guesses = category || !onCategory || !current ? [] : misspeltFor(q);
  const items: Item[] = [
    ...suggestions,
    ...results.map((place) => ({ place })),
    ...guesses.map((cat) => ({ cat })),
  ];
  // A name search offers its top row for Enter; a category picks nothing until asked.
  const active = cursor.key === key ? Math.min(cursor.index, items.length - 1) : category ? -1 : 0;
  const setActive = (index: number) => setCursor({ key, index });

  // A category asks the map, never the search server; leaving it clears its dots.
  useEffect(() => {
    const ask = onCategoryRef.current;
    if (!ask) return;
    let live = true;
    ask(category)
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

  // Names in view, read from the map's own tiles while Photon is asked; given up on in time.
  useEffect(() => {
    const ask = onNamesRef.current;
    if (!looksForNames || !ask) return;
    let live = true;
    const settle = (found: Shared | null) => {
      if (live) setShared({ key, found });
      live = false;
    };
    const late = setTimeout(() => settle(null), NAMES_MS);
    ask(q)
      .then(settle)
      .catch(() => settle(null));
    return () => {
      live = false;
      clearTimeout(late);
    };
    // Every edit asks again, a trailing space too: the edit cleared the last answer.
  }, [q, key, looksForNames, query]);

  useEffect(() => {
    if (category || q.length < 2 || cache.has(key)) return;
    const ctrl = new AbortController();
    const fallback = new AbortController();
    let timedOut = false;
    const done = (places: Place[], fallback = false) => {
      if (!fallback) {
        if (cache.size > 64) cache.delete(cache.keys().next().value as string);
        cache.set(key, places);
      }
      setResponse({ key, places, status: 'done', fallback });
      if (jumpFor.current === key) {
        jumpFor.current = null;
        if (places[0]) {
          onPickRef.current(places[0]);
          input.current?.blur();
        }
      }
    };
    /** Photon failed or hung: ask Nominatim once for this settled query, in its time slot. */
    const viaNominatim = async () => {
      await new Promise((go) => setTimeout(go, nominatimSlot()));
      if (fallback.signal.aborted) return null;
      const own = new AbortController();
      fallback.signal.addEventListener('abort', () => own.abort());
      const late = setTimeout(() => own.abort(), FALLBACK_MS);
      try {
        const r = await getJson(nominatimSearchUrl(q, lang, bias()), own.signal);
        return r.ok ? parseNominatim(r.json) : null;
      } finally {
        clearTimeout(late);
      }
    };
    const timer = setTimeout(async () => {
      const limit = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, TIMEOUT_MS);
      try {
        const res = await fetch(searchUrl(q, lang, bias()), { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const places = parsePhoton(await res.json());
        clearTimeout(limit);
        done(places);
        return;
      } catch (e) {
        clearTimeout(limit);
        if (ctrl.signal.aborted && !timedOut) return;
        console.warn('search failed', e);
      }
      const status = timedOut ? 'slow' : 'error';
      if (q.length < 3) {
        setResponse({ key, places: [], status });
        return;
      }
      // Photon's timeout means the text has been left alone for 5 s already. A quick failure
      // says so at once and waits until the text has settled as long, unless Enter asked.
      if (!timedOut && askedFor.current !== key) {
        setResponse({ key, places: [], status });
        const wait = edited.current + SETTLE_MS - Date.now();
        await new Promise((go) => setTimeout(go, Math.max(0, wait)));
        if (fallback.signal.aborted) return;
      }
      const places = await viaNominatim().catch(() => null);
      if (fallback.signal.aborted) return;
      if (places) done(places, true);
      else setResponse({ key, places: [], status });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
      fallback.abort();
    };
  }, [q, key, lang, bias, category, retry]);

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
    onPick(place);
    input.current?.blur();
  };

  /** Search the map for a kind of place; the field shows its name. */
  const choose = (c: Kind) => {
    setCategory(c);
    setQuery(label(c));
  };

  const choice = (it: Item) => (it.cat ? choose(it.cat) : pick(it.place));

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
      if (results.length && onShowAll) requestAnimationFrame(onShowAll);
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
      const fresh = current || active < suggestions.length;
      const it = fresh ? items[active] : undefined;
      if (it) choice(it);
      else if (q.length >= 2 && status === 'loading') jumpFor.current = key;
    } else if (e.key === 'Escape') {
      if (query) {
        setQuery('');
        setCategory(null);
      } else if (onCancel) onCancel();
      else input.current?.blur();
    }
  };

  /** What the list has to say instead of results; also read out to a screen reader. */
  const note =
    status === 'done' && !items.length
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
  const showList = open && (status !== 'idle' || suggestions.length > 0);

  return (
    <div className="search" data-open={showList || undefined} hidden={hidden}>
      {showList && (
        <ul className="results surface" id={listId} role="listbox">
          {beyond && (
            <li className="r-empty" role="presentation">
              {t.beyondView}
            </li>
          )}
          {items.map((it, i) => (
            <li
              key={it.cat ? `cat|${it.cat}` : `${it.place.name}${it.place.lat}${it.place.lng}`}
              role="option"
              id={`${listId}-${i}`}
              className={it.cat ? 'r-cat' : undefined}
              aria-selected={i === active}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choice(it)}
              onPointerEnter={() => setActive(i)}
            >
              {it.cat ? (
                <>
                  <SearchIcon />
                  <span className="r-name">{label(it.cat)}</span>
                  <span className="r-detail">{it.n ? fill(t.inView, { n: it.n }) : t.catHint}</span>
                </>
              ) : (
                <>
                  <span className="r-name">{it.place.name}</span>
                  {it.place.distance !== undefined ? (
                    <span className="r-detail">
                      {formatDistance(it.place.distance, lang, units)}
                    </span>
                  ) : (
                    it.place.detail && <span className="r-detail">{it.place.detail}</span>
                  )}
                </>
              )}
            </li>
          ))}
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
      {open && q.length < 2 && <p className="hint">{touch() ? t.hint : t.hintMouse}</p>}
      <p className="sr-only" role="status">
        {showList
          ? note ||
            `${beyond ? `${t.beyondView} ` : ''}${
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
            // Names in view are read anew for the new text, wherever the map now is.
            setShared(null);
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
