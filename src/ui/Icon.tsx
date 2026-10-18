// The app's icon set: drawn on a 24px grid in currentColor, so CSS color and opacity give each
// state. Strokes keep their rendered width at any size (see .icon in index.css): 2px next to the
// medium-weight labels of the toolbars.

const STROKED = {
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5m5 5H9.5a5.5 5.5 0 0 0 0 11H13" />,
  loop: <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4m14-1v1a4 4 0 0 1-4 4H3" />,
  metronome: <path d="M9.5 3h5L19 21H5L9.5 3ZM12 15l5.5-8.5M7.5 15h9" />,
  sliders: (
    <>
      <path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  library: <path d="M4 4h3v16H4V4Zm5 0h3v16H9V4Zm5.4.9 2.9-.8 4.2 15.5-2.9.8-4.2-15.5Z" />,
  lyrics: <path d="M4 6h16M4 10h16M4 14h10M4 18h7m9-4v6m0 0a2 2 0 1 1-2-2h2" />,
  mixer: (
    <>
      <path d="M6 4v8m0 4v4m6-16v2m0 4v10m6-16v10m0 4v2" />
      <circle cx="6" cy="14" r="2" />
      <circle cx="12" cy="8" r="2" />
      <circle cx="18" cy="16" r="2" />
    </>
  ),
  export: <path d="M12 3v12m-5-5 5 5 5-5M5 21h14" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  fit: <path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5" />,
  follow: <path d="M4 12h11m-4-4 4 4-4 4M20 4v16" />,
  zoomIn: <path d="M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm9 3-4.5-4.5M11 8.5v5M8.5 11h5" />,
  zoomOut: <path d="M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm9 3-4.5-4.5M8.5 11h5" />,
  pen: <path d="M4 20h4L19 9l-4-4L4 16v4Z" />,
  keys: <path d="M4 4h16v16H4V4Zm5 0v9m6-9v9M9 13v7m6-7v7M7.5 4v9h3V4m3 0v9h3V4" />,
  pads: <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />,
  mic: <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0m-7 7v2" />,
  search: <path d="M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm9 3-4.5-4.5" />,
  upload: <path d="M12 15V3m-5 5 5-5 5 5M5 21h14" />,
  wave: <path d="M3 12h2m2-5v10m3-13v16m3-11v6m3-9v12m3-8v4m2-2h1" />,
  arrowUp: <path d="M12 19V5m-6 6 6-6 6 6" />,
  arrowDown: <path d="M12 5v14m6-6-6 6-6-6" />,
  automation: <path d="m3 18 5-7 4 3 5-8 4 4" />,
  rowsNormal: <path d="M4 5h16v6H4V5Zm0 8h16v6H4v-6Z" />,
  rowsCompact: <path d="M4 4h16v4H4V4Zm0 6h16v4H4v-4Zm0 6h16v4H4v-4Z" />,
}

const FILLED = {
  // The triangle's centroid sits on the center, so it looks centered rather than measures centered.
  play: <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2Z" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  record: <circle cx="12" cy="12" r="6" />,
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="18.5" r="1.6" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </>
  ),
}

export type IconName = keyof typeof STROKED | keyof typeof FILLED

export function Icon({ name, size = 16, stroke = 2, className = '' }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  const filled = name in FILLED
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={`icon shrink-0 ${className}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {filled ? FILLED[name as keyof typeof FILLED] : STROKED[name as keyof typeof STROKED]}
    </svg>
  )
}
