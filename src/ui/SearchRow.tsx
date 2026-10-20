import { foundOf, type Category, type Kind } from '../core/categories';
import { formatDistance } from '../core/route';
import type { Folder, Item } from '../core/searchList';
import { fill, t, units } from '../i18n';
import { ChevronIcon, ClockIcon, CloseIcon, KindIcon, SearchIcon, StarIcon } from './icons';
import { onMapText } from './useContacts';
import { forgetRecent } from './useRecent';

export const labelOf = (k: Kind) => foundOf(k) ?? t[`cat_${k as Category}`];

export const folderName = (f: Folder) =>
  f === 'favourites' ? t.favourites : f === 'contacts' ? t.contacts : t.kindsOfPlace;

/** A row's key among the others, the same while the list changes around it. */
export function rowKey(it: Item): string {
  switch (it.type) {
    case 'contacts':
      return 'act|contacts';
    case 'folder':
      return `folder|${it.folder}`;
    case 'up':
      return `up|${it.folder}`;
    case 'recent':
      return `recent|${'place' in it.recent ? `${it.recent.place.name}${it.recent.place.lat}` : it.recent.kind}`;
    case 'cat':
      return `cat|${it.cat}`;
    case 'place':
      return `${it.contact ? 'c' : it.fav ? 'f' : 'p'}|${it.place.name}${it.place.lat}${it.place.lng}`;
  }
}

export function rowClass(it: Item): string {
  switch (it.type) {
    case 'recent':
    case 'contacts':
      return 'r-recent';
    case 'folder':
      return it.folder === 'favourites' ? 'r-folder r-fav' : 'r-folder';
    case 'up':
      return 'r-up';
    case 'cat':
      return 'r-cat';
    case 'place':
      return it.fav ? 'r-place r-fav' : 'r-place';
  }
}

interface RowProps {
  it: Item;
  lang: string;
  /** Placed contacts, and whether more are being placed. */
  placed: number;
  busy?: boolean;
  onForgetContacts?: () => void;
}

const noFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/** What a row of the search list shows. */
export function SearchRow({ it, lang, placed, busy, onForgetContacts }: RowProps) {
  switch (it.type) {
    case 'folder':
      // A pill: what the list is and how many it holds; it opens in the list's place.
      return (
        <>
          {it.folder === 'favourites' ? (
            <StarIcon filled size={18} />
          ) : it.folder === 'contacts' ? (
            <KindIcon kind="person" />
          ) : (
            <SearchIcon />
          )}
          <span className="r-name">
            {it.folder === 'kinds' ? t.kindsShort : folderName(it.folder)}
          </span>
          {it.folder !== 'kinds' && <span className="r-count">{it.n}</span>}
        </>
      );
    case 'up':
      return (
        <>
          <ChevronIcon back />
          <span className="r-name">{folderName(it.folder)}</span>
        </>
      );
    case 'contacts':
      return (
        <>
          <KindIcon kind="person" />
          <span className="r-name">
            {placed ? onMapText(placed) : busy ? t.contactsPlacing : t.contactsAdd}
          </span>
          <span className="r-detail">{t.contactsHint}</span>
          {!!placed && (
            <button
              type="button"
              className="r-forget icon-btn"
              aria-label={t.contactsForget}
              tabIndex={-1}
              onPointerDown={noFocus}
              onClick={(e) => {
                e.stopPropagation();
                onForgetContacts?.();
              }}
            >
              <CloseIcon />
            </button>
          )}
        </>
      );
    case 'recent': {
      const r = it.recent;
      const name = 'place' in r ? r.place.name : r.label;
      return (
        <>
          <ClockIcon />
          <span className="r-name">{name}</span>
          <span className="r-detail">{'place' in r ? r.place.detail : t.catHint}</span>
          <button
            type="button"
            className="r-forget icon-btn"
            aria-label={fill(t.forgetRecent, { name })}
            tabIndex={-1}
            onPointerDown={noFocus}
            onClick={(e) => {
              e.stopPropagation();
              forgetRecent(r);
            }}
          >
            <CloseIcon />
          </button>
        </>
      );
    }
    case 'cat':
      return (
        <>
          <SearchIcon />
          <span className="r-name">{labelOf(it.cat)}</span>
          <span className="r-detail">{t.catHint}</span>
        </>
      );
    case 'place': {
      const { place } = it;
      const far = it.away ?? place.distance;
      const line = [
        far !== undefined ? formatDistance(far, lang, units) : '',
        it.away !== undefined ? place.detail : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const detail = far !== undefined ? line : place.detail;
      return (
        <>
          {it.fav ? <StarIcon filled /> : <KindIcon kind={place.kind ?? 'place'} />}
          <span className="r-name">{place.name}</span>
          {detail && <span className="r-detail">{detail}</span>}
        </>
      );
    }
  }
}

/** What a screen reader hears for a row that opens a list. */
export const rowLabel = (it: Item) =>
  it.type === 'folder'
    ? it.folder === 'kinds'
      ? fill(t.opensKinds, { name: folderName(it.folder) })
      : fill(t.opensList, { name: folderName(it.folder), n: it.n })
    : it.type === 'up'
      ? `${t.backToSearch}: ${folderName(it.folder)}`
      : undefined;
