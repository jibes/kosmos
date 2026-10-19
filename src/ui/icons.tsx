import type { ReactNode } from 'react';
import type { LaneView } from '../core/lanes';
import type { TravelMode, Turn } from '../core/route';
import type { PlaceKind } from '../core/placeKind';
import type { Vehicle } from '../core/transit';

const Svg = ({
  children,
  size = 20,
  kind,
}: {
  children: ReactNode;
  size?: number;
  kind?: string;
}) => (
  <svg
    data-kind={kind}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Svg>
);

/** Places around this one. */
export const NearbyIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="12" cy="12" r="7.5" strokeDasharray="3 3" />
  </Svg>
);

/** A favourite: filled when the place is one. */
export const StarIcon = ({ filled = false, size = 20 }: { filled?: boolean; size?: number }) => (
  <Svg size={size}>
    <path
      d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Svg>
);

/** Its own name for a favourite. */
export const PencilIcon = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />
  </Svg>
);

/** A grip: hold and drag the row it is on. */
export const GripIcon = () => (
  <Svg>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={3} />
  </Svg>
);

/** A stop a place earlier on the way. */
export const UpIcon = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 19V5m0 0-6 6m6-6 6 6" />
  </Svg>
);

/** Opens a list (right), or goes back out of it (left). */
export const ChevronIcon = ({ back = false, size = 18 }: { back?: boolean; size?: number }) => (
  <Svg size={size}>
    <path d={back ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
  </Svg>
);

/** A search taken before. */
export const ClockIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const CloseIcon = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const CopyIcon = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 5.5v-.5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h.5" />
  </Svg>
);

export const LocateIcon = ({ filled }: { filled?: boolean }) => (
  <Svg>
    <path d="M20 4 4 11l7 2 2 7 7-16Z" fill={filled ? 'currentColor' : 'none'} />
  </Svg>
);

/** Compass-follow mode: the arrow inside a ring, like a held compass. */
export const CompassModeIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 5.5 15.5 16 12 13.8 8.5 16 12 5.5Z" fill="currentColor" />
  </Svg>
);

/** The whole route: where it starts, the way, where it ends. */
export const WholeRouteIcon = () => (
  <Svg>
    <circle cx="4.8" cy="19.2" r="2.4" />
    <path d="M7.1 17.6c5.2-1.6 2.6-9.4 9.2-11.1" strokeDasharray="2.4 2.4" />
    <circle cx="19" cy="5.2" r="2.9" fill="currentColor" />
  </Svg>
);

export const NoLocationIcon = () => (
  <Svg>
    <path d="M20 4 13.6 18.6M11.4 13.2 4 11l9.5-4.2M3 3l18 18" />
  </Svg>
);

/** Two-tone needle; north half in the accent colour. */
export const NeedleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.5 15.2 12H8.8L12 2.5Z" fill="var(--accent)" />
    <path d="M12 21.5 8.8 12h6.4L12 21.5Z" fill="currentColor" opacity="0.35" />
  </svg>
);

export const ShareIcon = () => (
  <Svg size={18}>
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
    <path d="M5 12.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5" />
  </Svg>
);

/** Coins: a route with toll roads. */
export const CoinsIcon = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <ellipse cx="9" cy="6.5" rx="6" ry="2.5" />
    <path d="M3 6.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4" />
    <ellipse cx="15" cy="13.5" rx="6" ry="2.5" />
    <path d="M9 13.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4" />
  </Svg>
);

export const RouteIcon = () => (
  <Svg size={18}>
    <path d="M5 21v-6a5 5 0 0 1 5-5h9" />
    <path d="m15 6 4 4-4 4" />
  </Svg>
);

/** The kOSMos mark: one orbit, one point on it. */
export const Mark = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
    <rect width="512" height="512" rx="116" fill="#0b0d12" />
    <circle cx="256" cy="256" r="122" fill="none" stroke="#f2f1ee" strokeWidth="22" />
    <circle cx="342.3" cy="169.7" r="34" fill="#6e8bff" stroke="#0b0d12" strokeWidth="16" />
  </svg>
);

const TURN_PATHS: Record<Turn, ReactNode> = {
  straight: <path d="M12 20V5M7 10l5-5 5 5" />,
  depart: (
    <>
      <circle cx="12" cy="18" r="2.2" />
      <path d="M12 15.5V5M7.5 9.5 12 5l4.5 4.5" />
    </>
  ),
  right: <path d="M7 20v-7a4 4 0 0 1 4-4h8M15 5l4 4-4 4" />,
  left: <path d="M17 20v-7a4 4 0 0 0-4-4H5M9 5 5 9l4 4" />,
  'slight-right': <path d="M9 20v-6l7-7M10.5 6H16v5.5" />,
  'slight-left': <path d="M15 20v-6L8 7M13.5 6H8v5.5" />,
  'sharp-right': <path d="M8 4v9l8 6M16.5 13.5V19H11" />,
  'sharp-left': <path d="M16 4v9l-8 6M7.5 13.5V19H13" />,
  uturn: <path d="M8 20V9a4 4 0 0 1 8 0v7M12.5 12.5 16 16l3.5-3.5" />,
  roundabout: (
    <>
      <circle cx="12" cy="10" r="4" />
      <path d="M12 14v6M15 7l4-4M15 3h4v4" />
    </>
  ),
  arrive: (
    <>
      <path d="M12 21s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2" />
    </>
  ),
  ferry: <path d="M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M6 14l1-5h10l1 5M12 9V4" />,
};

export const TurnIcon = ({ turn, size = 22 }: { turn: Turn; size?: number }) => (
  <Svg size={size}>{TURN_PATHS[turn]}</Svg>
);

const MODE_PATHS: Record<TravelMode, ReactNode> = {
  car: (
    <>
      <path d="M4 16v-3.5L6.2 7h11.6l2.2 5.5V16" />
      <path d="M3.5 16h17M4 12.5h16" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="M6 16l3.5-7h6L18 16M9.5 9 12 16h3.5M14 6h2.5" />
    </>
  ),
  foot: (
    <>
      <circle cx="13" cy="4.5" r="1.6" />
      <path d="M9 21l2.2-6.2L14 17v4M11.2 14.8 12.3 9l3 2.5 2.7.8M12.3 9 9.2 10.4 8 13.5" />
    </>
  ),
  transit: (
    <>
      <rect x="6" y="3.5" width="12" height="14" rx="3" />
      <path d="M6 11h12M9.5 20.5l1-3M14.5 20.5l-1-3" />
      <circle cx="9.5" cy="14.2" r="0.7" fill="currentColor" />
      <circle cx="14.5" cy="14.2" r="0.7" fill="currentColor" />
    </>
  ),
};

export const ModeIcon = ({ mode, size }: { mode: TravelMode; size?: number }) => (
  <Svg size={size}>{MODE_PATHS[mode]}</Svg>
);

/** Lane arrows share one stem from the bottom centre, so several overlay as one painted mark. */
const LANE_PATHS: Record<LaneView['arrows'][number]['arrow'], string> = {
  straight: 'M12 21V4M8 8l4-4 4 4',
  left: 'M12 21v-7a4 4 0 0 0-4-4H4M7 7l-3 3 3 3',
  right: 'M12 21v-7a4 4 0 0 1 4-4h4M17 7l3 3-3 3',
  'slight-left': 'M12 21v-6L6.5 8M6 12.5V8h4.5',
  'slight-right': 'M12 21v-6l5.5-7M18 12.5V8h-4.5',
  'sharp-left': 'M12 21v-9l-6 6M6 13.5V18h4.5',
  'sharp-right': 'M12 21v-9l6 6M18 13.5V18h-4.5',
  uturn: 'M12 21V9a3.5 3.5 0 0 0-7 0v8M2 14l3 3 3-3',
  'merge-left': 'M14 21v-6l-5-5V4M6 7l3-3 3 3',
  'merge-right': 'M10 21v-6l5-5V4M12 7l3-3 3 3',
};

/** One lane: arrows that follow the route drawn solid, the others faint behind them. */
export const LaneIcon = ({ lane, size }: { lane: LaneView; size: number }) => (
  <Svg size={size}>
    {[...lane.arrows]
      .sort((a, b) => Number(a.on) - Number(b.on))
      .map(({ arrow, on }) => (
        <path key={arrow} d={LANE_PATHS[arrow]} className={on ? 'on' : 'off'} />
      ))}
  </Svg>
);

const VEHICLE_PATHS: Record<Vehicle, ReactNode> = {
  bus: (
    <path d="M7 3.5h10a2.5 2.5 0 0 1 2.5 2.5v11h-15V6A2.5 2.5 0 0 1 7 3.5ZM4.5 11h15M8 20v-3M16 20v-3" />
  ),
  tram: (
    <path d="M8 6.5h8a2.5 2.5 0 0 1 2.5 2.5v8.5h-13V9A2.5 2.5 0 0 1 8 6.5ZM5.5 12.5h13M9 3h6M12 3v3.5M9 21l1.5-3.5M15 21l-1.5-3.5" />
  ),
  subway: (
    <path d="M9.5 3.5h5a5 5 0 0 1 5 5v8.5h-15V8.5a5 5 0 0 1 5-5ZM4.5 11.5h15M8 21l2-4M16 21l-2-4" />
  ),
  train: (
    <path d="M8.5 3h7A2.5 2.5 0 0 1 18 5.5V17H6V5.5A2.5 2.5 0 0 1 8.5 3ZM6 10.5h12M8 21l2-4M16 21l-2-4" />
  ),
  ferry: <path d="M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M6 14l1-5h10l1 5M12 9V4" />,
  cable: <path d="M3 5.5 21 2.5M12 4v4M9 8h6a2 2 0 0 1 2 2v7H7v-7a2 2 0 0 1 2-2ZM7 12.5h10" />,
  plane: (
    <path d="M21 15.5 13.5 11V5a1.5 1.5 0 0 0-3 0v6L3 15.5V17l7.5-2.2V19l-2 1.5V22l3.5-1 3.5 1v-1.5l-2-1.5v-4.2L21 17Z" />
  ),
};

/** What a line runs with: bus, tram, underground, train, ferry, cable car, plane. */
export const VehicleIcon = ({ vehicle, size = 14 }: { vehicle: Vehicle; size?: number }) => (
  <Svg size={size}>{VEHICLE_PATHS[vehicle]}</Svg>
);

/** The kinds that are not vehicles: a line drawing each, at the size of a row's text. */
const KIND_PATHS: Record<Exclude<PlaceKind, Vehicle>, ReactNode> = {
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" />
    </>
  ),
  food: <path d="M7 3v8m-2.5-8v5a2.5 2.5 0 0 0 5 0V3M7 11v10M16.5 21V3c-2 1.5-3 4-3 8h3" />,
  cafe: (
    <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Zm11 1.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3m4-3v3" />
  ),
  drink: <path d="M5 4h14l-7 8-7-8Zm7 8v8m-4 0h8" />,
  shop: <path d="M5 8h14l-1 12H6L5 8Zm4 0V6.5a3 3 0 0 1 6 0V8" />,
  stay: (
    <path d="M3 18V7m0 7h18v4m0-4v-2.5A2.5 2.5 0 0 0 18.5 9H11v5M7 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
  ),
  culture: <path d="M3 9.5 12 4l9 5.5M5 10v8m4.7-8v8m4.6-8v8M19 10v8M3 20h18" />,
  park: <path d="M12 21v-6m0 0c3.3 0 6-2.5 6-5.5S15.3 3 12 3 6 6 6 9.5 8.7 15 12 15Z" />,
  health: <path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5V4Z" />,
  school: <path d="M3 9 12 5l9 4-9 4-9-4Zm4 2v5c1.5 1.3 3 2 5 2s3.5-.7 5-2v-5M21 9v5" />,
  town: <path d="M4 20V9l5-3v14m0 0V11h6v9m0-6h5v6M3 20h18M12 14v.01M12 17v.01" />,
  street: <path d="M8 3 5 21m11-18 3 18M12 4v2.5m0 4v3m0 4V20" />,
  address: <path d="M4 11 12 4l8 7m-14-1.5V20h12V9.5M10 20v-5h4v5" />,
  place: (
    <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
  ),
};

const VEHICLES = new Set<string>(['train', 'subway', 'tram', 'bus', 'ferry', 'plane']);

/** A search result's kind at a glance: the vehicle of a station, a cup for a café. */
export const KindIcon = ({ kind, size = 18 }: { kind: PlaceKind; size?: number }) => (
  <Svg size={size} kind={kind}>
    {VEHICLES.has(kind)
      ? VEHICLE_PATHS[kind as Vehicle]
      : KIND_PATHS[kind as Exclude<PlaceKind, Vehicle>]}
  </Svg>
);
