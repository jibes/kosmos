import type { ReactNode } from 'react';

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
