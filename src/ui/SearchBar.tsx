import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CATEGORY_IDS, categoryFor, type Category } from '../core/categories';
import { formatDistance } from '../core/route';
import { parsePhoton, searchUrl, type Place, type SearchBias } from '../core/search';
import { t } from '../i18n';
import { CloseIcon, SearchIcon } from './icons';

type Status = 'idle' | 'loading' | 'done' | 'error';

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
const cache = new Map<string, Place[]>();

interface Response {
  key: string;
  places: Place[];
  status: 'done' | 'error';
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
  /** "Restaurant", "Lebensmittel", a chip: places of that kind from the map, not by name. */
  const category = categoryFor(q);
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
  // A name search offers its best hit for Enter; a category picks nothing until asked.
  const active =
    cursor.key === key ? Math.min(cursor.index, results.length - 1) : category ? -1 : 0;
  const setActive = (index: number) => setCursor({ key, index });

  // A category asks the map, never the search server; leaving it clears its dots.
  useEffect(() => {
    let live = true;
    onCategoryRef
      .current(category)
      .then((places) => {
        if (!live || !category) return;
        setResponse({ key: `cat|${category}`, places, status: 'done' });
        if (jumpFor.current === `cat|${category}`) {
          jumpFor.current = null;
          if (places[0]) {
            onPickRef.current(places[0]);
            input.current?.blur();
          }
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [category, categoryRun]);

  useEffect(() => {
    if (category || q.length < 2 || cache.has(key)) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(searchUrl(q, lang, bias()), { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const places = parsePhoton(await res.json());
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
      } catch (e) {
        if (ctrl.signal.aborted) return;
        console.warn('search failed', e);
        setResponse({ key, places: [], status: 'error' });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, key, lang, bias, category]);

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

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      if (n)
        setActive(
          (Math.max(active, e.key === 'ArrowDown' ? -1 : 0) + (e.key === 'ArrowDown' ? 1 : n - 1)) %
            n,
        );
    } else if (e.key === 'Enter' && category && active < 0) {
      // "Restaurants" + search: show them all where they are, without choosing one.
      if (results.length) onShowAll();
      input.current?.blur();
    } else if (e.key === 'Enter') {
      // Only results for exactly this query; stale ones from the last query would jump wrong.
      const hit = current?.places[cursor.key === key ? active : 0];
      if (hit) pick(hit);
      else if (q.length >= 2 && status === 'loading') jumpFor.current = key;
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else if (onCancel) onCancel();
      else input.current?.blur();
    }
  };

  const open = !collapsed && focused;
  const showList = open && status !== 'idle';

  return (
    <div className="search" data-open={showList || undefined}>
      {showList && (
        <ul className="results surface" id={listId} role="listbox">
          {results.map((p, i) => (
            <li
              key={`${p.name}${p.lat}${p.lng}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              onPointerEnter={() => setActive(i)}
            >
              <span className="r-name">{p.name}</span>
              {p.distance !== undefined ? (
                <span className="r-detail">{formatDistance(p.distance, lang)}</span>
              ) : (
                p.detail && <span className="r-detail">{p.detail}</span>
              )}
            </li>
          ))}
          {status === 'done' && !results.length && (
            <li className="r-empty">{category ? t.noneHere : t.noResults}</li>
          )}
          {status === 'error' && <li className="r-empty">{t.searchOffline}</li>}
          {status === 'loading' && !results.length && <li className="r-empty r-loading" />}
        </ul>
      )}
      {open && q.length < 2 && (
        <div className="chips" role="group" aria-label={t.categories}>
          {CATEGORY_IDS.map((c) => (
            <button
              key={c}
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setQuery(label(c))}
            >
              {label(c)}
            </button>
          ))}
        </div>
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
          onChange={(e) => setQuery(e.target.value)}
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
