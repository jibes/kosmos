import type { ReactNode } from 'react';
import type { Mode, Turn } from '../core/route';

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg
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

export const CloseIcon = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
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

const MODE_PATHS: Record<Mode, ReactNode> = {
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
};

export const ModeIcon = ({ mode }: { mode: Mode }) => <Svg>{MODE_PATHS[mode]}</Svg>;
