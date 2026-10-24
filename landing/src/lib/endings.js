// ============================================================
// The umpire's scoring keys, as the real screen draws them: the 18 ways a
// rally ends from server/src/rally-endings.js, each with the icon from
// src/components/Icon.jsx. Copied, not imported, because this site is its
// own service and uploads only what lives under landing/;
// scripts/check-seeit.mjs holds the copy to the originals.
// ============================================================

export const ENDINGS = [
  { key: 'ace', label: 'Ace', outcome: 'winner', by: 'server', path: 'M3 8h6M3 12h4M3 16h6M16 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z' },
  { key: 'putaway', label: 'Put-away', outcome: 'winner', path: 'M4 20h16M6 4l10 10M16 8v6h-6' },
  { key: 'passing', label: 'Passing shot', outcome: 'winner', path: 'M7 20V5M3.5 8.5L7 5l3.5 3.5M14.5 8h4A1.5 1.5 0 0 1 20 9.5v5a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 14.5 8zM16.5 16v4' },
  { key: 'lob', label: 'Lob', outcome: 'winner', path: 'M3 20h18M12 20v-6M4 17C6 4 18 4 20 17' },
  { key: 'drop_winner', label: 'Drop winner', outcome: 'winner', path: 'M3 20h18M12 20v-6M3 7c6 0 11 3.5 12.5 9M16.6 15.3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
  { key: 'dink_winner', label: 'Dink winner', outcome: 'winner', path: 'M3 20h18M12 20v-6M7.5 17.5q4.5-9 9 0M18.4 15.8a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z' },
  { key: 'other_winner', label: 'Other winner', outcome: 'winner', path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l3 3 5-6.5' },
  { key: 'out', label: 'Out of bounds', outcome: 'error', path: 'M3 13h13V4M19.5 15.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z' },
  { key: 'net', label: 'Into the net', outcome: 'error', path: 'M3 20h18M12 20V8M10.3 8h3.4M7.3 10.9a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6zM2.5 8.5l2 1.4' },
  { key: 'dink_error', label: 'Missed dink', outcome: 'error', path: 'M3 20h18M12 20v-8M12 7.4a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6zM4 17c1.2-4.5 3.2-6.6 5.6-7' },
  { key: 'kitchen', label: 'Kitchen fault', outcome: 'error', path: 'M3 4h18v16H3zM7 15.5h8.6a1.2 1.2 0 0 0 1.2-1.2c0-1-.8-1.6-1.9-1.8l-2.2-.4-1-2.1-1.9.8V9.5H7z' },
  { key: 'service', label: 'Service fault', outcome: 'error', by: 'server', path: 'M5.5 9h4A1.5 1.5 0 0 1 11 10.5v5A1.5 1.5 0 0 1 9.5 17h-4A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9zM7.5 17v4M17.5 3.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z' },
  { key: 'foot_fault', label: 'Foot fault', outcome: 'error', by: 'server', path: 'M16 3v18M4 17h14.5a1.5 1.5 0 0 0 1.5-1.5c0-1.5-1.2-2.3-2.8-2.6l-3.2-.6L12.2 9 9.5 10.2V8H4z' },
  { key: 'two_bounce', label: 'Two-bounce fault', outcome: 'error', path: 'M4 20h16M3.5 7.5c3 1.5 4.8 6 6 12.5 1.3-5 3.3-8.3 6-9.3M18 7.3a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z' },
  { key: 'net_touch', label: 'Touched the net', outcome: 'error', path: 'M3 20h18M14 20V4M7.1 5h4A1.5 1.5 0 0 1 12.6 6.5v6A1.5 1.5 0 0 1 11.1 14h-4A1.5 1.5 0 0 1 5.6 12.5v-6A1.5 1.5 0 0 1 7.1 5zM9.1 14v4' },
  { key: 'hit_by_ball', label: 'Hit by the ball', outcome: 'error', path: 'M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 3 1M19 13.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z' },
  { key: 'wrong_position', label: 'Wrong server or receiver', outcome: 'error', path: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7' },
  { key: 'other_fault', label: 'Other fault', outcome: 'error', path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6' },
]
