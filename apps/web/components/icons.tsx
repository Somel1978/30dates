import type { SVGProps } from 'react';

/** Small line-icon set (24px grid, 1.6 stroke), drawn to sit beside text in the gold palette. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => <Icon {...p}><path d="m15 5-7 7 7 7" /></Icon>;
export const ChevronRight = (p: IconProps) => <Icon {...p}><path d="m9 5 7 7-7 7" /></Icon>;
export const Check = (p: IconProps) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const Lock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
);
export const Snowflake = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4 12 6.5 14.5 4M9.5 20 12 17.5l2.5 2.5" />
  </Icon>
);
export const Family = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="6.5" r="2.5" />
    <circle cx="16.5" cy="8" r="2" />
    <path d="M3.5 19.5v-3a4.5 4.5 0 0 1 9 0v3M13 19.5v-2a3.5 3.5 0 0 1 7 0v2" />
  </Icon>
);
export const Home = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M6 9.5v10h12v-10M10 19.5v-5h4v5" />
  </Icon>
);
export const Compass = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
  </Icon>
);
export const Coins = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="9" cy="7" rx="5" ry="2.5" />
    <path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7" />
    <path d="M10 15.6c.9 1.1 2.8 1.9 5 1.9 2.8 0 5-1.1 5-2.5v-4c0-1.3-1.9-2.3-4.4-2.5" />
  </Icon>
);
export const Pin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Icon>
);
export const Spark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Icon>
);
export const Person = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </Icon>
);
export const Seal = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="9" r="5.5" />
    <path d="m8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7" />
  </Icon>
);
export const Mic = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Icon>
);
export const Cup = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9Z" />
    <path d="M16.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.8M8 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5" />
  </Icon>
);
export const Wine = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 3h9l-.6 5.5a4 4 0 0 1-7.8 0L7.5 3ZM12 12.5V20M8.5 20.5h7" />
  </Icon>
);
export const Calendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Icon>
);
export const Table = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="4" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="14" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="14" width="7" height="7" rx="1.5" />
  </Icon>
);
export const Heart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z" />
  </Icon>
);
export const Wrench = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 5.5a4 4 0 0 0-5.3 5.3L4 16a2 2 0 0 0 2.8 2.8l5.2-5.2a4 4 0 0 0 5.3-5.3l-2.4 2.4-2.4-.6-.6-2.4 2.6-2.2Z" />
  </Icon>
);
