import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { categoriesFor, type Category } from '../core/categories';
import { formatDistance } from '../core/route';
import { nominatimSearchUrl, parseNominatim } from '../core/details';
import { parsePhoton, searchUrl, type Place, type SearchBias } from '../core/search';
import { getJson, nominatimSlot } from './http';
import { t } from '../i18n';
import { CloseIcon, SearchIcon } from './icons';

type Status = 'idle' | 'loading' | 'done' | 'error' | 'slow';

interface Props {
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
  /** Places of a category from the map itself, nearest first; `null` ends the category. */
  onCategory: (c: Category | null) => Promise<Place[]>;
  /** Bumped to search the category again where the map now is. */
  categoryRun: number;
  /** The search key on a category: all its places on the map, none picked. */
  onShowAll: () => void;
}

const label = (c: Category) => t[`cat_${c}`];

const DEBOUNCE_MS = 200;
/** A search server that has not answered by now is not going to; say so instead of spinning. */
const TIMEOUT_MS = 5000;
const cache = new Map<string, Place[]>();

/** A row of the list: a kind of place to search the map for, or a place found by name. */
type Item = { cat: Category; place?: undefined } | { place: Place; cat?: undefined };

interface Response {
  key: string;
  places: Place[];
  status: 'done' | 'error' | 'slow';
}

export function SearchBar({
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
}: Props) {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<Response | null>(null);
  const [cursor, setCursor] = useState({ key: '', index: 0 });
  const [focused, setFocused] = useState(false);
  /** A kind of place chosen from the suggestions: its places come from the map, not by name. */
  const [category, setCategory] = useState<Category | null>(null);
  /** Bumped by Enter after a failed or unanswered search, to ask again. */
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  /** Enter pressed before results arrived: jump to the first one when they do. */
  const jumpFor = useRef<string | null>(null);
  const onPickRef = useRef(onPick);
  const onCategoryRef = useRef(onCategory);
  useEffect(() => {
    onPickRef.current = onPick;
    onCategoryRef.current = onCategory;
  });

  const q = query.trim();
  const key = category ? `cat|${category}` : `${lang}|${q}`;
  const cached = category ? undefined : cache.get(key);
  const current = cached
    ? { places: cached, status: 'done' as const }
    : response?.key === key
      ? response
      : null;
  const status: Status = q.length < 2 ? 'idle' : (current?.status ?? 'loading');
  // While a new query loads, the previous results stay put instead of flickering away.
  const results = current?.places ?? response?.places ?? [];
  /** "museum", "Lebensm…": the kinds of place the text may mean, offered above the names. */
  const suggestions = category ? [] : categoriesFor(q);
  const items: Item[] = [
    ...suggestions.map((cat) => ({ cat })),
    ...results.map((place) => ({ place })),
  ];
  // A name search offers its top row for Enter; a category picks nothing until asked.
  const active = cursor.key === key ? Math.min(cursor.index, items.length - 1) : category ? -1 : 0;
  const setActive = (index: number) => setCursor({ key, index });

  // A category asks the map, never the search server; leaving it clears its dots.
  useEffect(() => {
    let live = true;
    onCategoryRef
      .current(category)
      .then((places) => {
        if (!live || !category) return;
        setResponse({ key: `cat|${category}`, places, status: 'done' });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [category, categoryRun]);

  useEffect(() => {
    if (category || q.length < 2 || cache.has(key)) return;
    const ctrl = new AbortController();
    const fallback = new AbortController();
    let timedOut = false;
    const done = (places: Place[]) => {
      if (cache.size > 64) cache.delete(cache.keys().next().value as string);
      cache.set(key, places);
      setResponse({ key, places, status: 'done' });
      if (jumpFor.current === key) {
        jumpFor.current = null;
        if (places[0]) {
          onPickRef.current(places[0]);
          input.current?.blur();
        }
      }
    };
    /** Photon failed or hung: ask Nominatim once for this settled query (never as-you-type). */
    const viaNominatim = async () => {
      await new Promise((go) => setTimeout(go, nominatimSlot()));
      if (fallback.signal.aborted) return null;
      const r = await getJson(nominatimSearchUrl(q, lang, bias()), fallback.signal);
      return r.ok ? parseNominatim(r.json) : null;
    };
    const timer = setTimeout(async () => {
      const limit = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, TIMEOUT_MS);
      try {
        const res = await fetch(searchUrl(q, lang, bias()), { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        done(parsePhoton(await res.json()));
      } catch (e) {
        if (ctrl.signal.aborted && !timedOut) return;
        console.warn('search failed', e);
        const places = q.length >= 3 ? await viaNominatim().catch(() => null) : null;
        if (fallback.signal.aborted) return;
        if (places) done(places);
        else setResponse({ key, places: [], status: timedOut ? 'slow' : 'error' });
      } finally {
        clearTimeout(limit);
      }
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
  const choose = (c: Category) => {
    setCategory(c);
    setQuery(label(c));
  };

  const choice = (it: Item) => (it.cat ? choose(it.cat) : pick(it.place));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (n)
        setActive(
          (Math.max(active, e.key === 'ArrowDown' ? -1 : 0) + (e.key === 'ArrowDown' ? 1 : n - 1)) %
            n,
        );
    } else if (e.key === 'Enter' && category && active < 0) {
      // "Restaurants" + search: show them all where they are, without choosing one.
      // Close the list first, so the fit measures the map the user will see.
      input.current?.blur();
      if (results.length) requestAnimationFrame(onShowAll);
    } else if (
      e.key === 'Enter' &&
      (status === 'error' || status === 'slow') &&
      !suggestions.length
    ) {
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

  const open = !collapsed && focused;
  const showList = open && (status !== 'idle' || suggestions.length > 0);

  return (
    <div className="search" data-open={showList || undefined}>
      {showList && (
        <ul className="results surface" id={listId} role="listbox">
          {items.map((it, i) => (
            <li
              key={it.cat ? `cat|${it.cat}` : `${it.place.name}${it.place.lat}${it.place.lng}`}
              role="option"
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
                  <span className="r-detail">{t.catHint}</span>
                </>
              ) : (
                <>
                  <span className="r-name">{it.place.name}</span>
                  {it.place.distance !== undefined ? (
                    <span className="r-detail">{formatDistance(it.place.distance, lang)}</span>
                  ) : (
                    it.place.detail && <span className="r-detail">{it.place.detail}</span>
                  )}
                </>
              )}
            </li>
          ))}
          {status === 'done' && !items.length && (
            <li className="r-empty">{category ? t.noneHere : t.noResults}</li>
          )}
          {status === 'error' && <li className="r-empty">{t.searchOffline}</li>}
          {status === 'slow' && <li className="r-empty">{t.searchSlow}</li>}
          {status === 'loading' && !items.length && <li className="r-empty r-loading" />}
        </ul>
      )}
      {open && q.length < 2 && <p className="hint">{t.hint}</p>}
      <label className="bar surface">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder ?? t.search}
          aria-label={placeholder ?? t.search}
          autoFocus={autoFocus}
          aria-controls={listId}
          aria-expanded={showList}
          role="combobox"
          value={query}
          onChange={(e) => {
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
        {status === 'loading' && <span className="spinner" aria-hidden="true" />}
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
