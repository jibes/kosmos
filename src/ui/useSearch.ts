import { useMemo, useState } from 'react';
import type { Kind } from '../core/categories';
import type { Folder } from '../core/searchList';

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
