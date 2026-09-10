/**
 * The velodrome palette. An indoor track is a specific place: Siberian pine
 * boards under hard overhead rigs, a cold near-black arena beyond the rail,
 * and two painted lines that everybody who has watched a track race knows on
 * sight. Warm wood against cold dark IS the look — every colour here either
 * belongs to the boards or belongs to the dark, and nothing is a generic
 * dark-UI accent.
 */
export const PALETTE = {
  /** Warm honey pine, lit. */
  boards: '#C99A5E',
  /** The unlit stretches of board between the light pools. */
  boardsShadow: '#8A6236',
  /** The cote d'azur strip at the inner edge of the track. */
  cote: '#2E7FA8',
  /** The sprinters' line. */
  sprintLine: '#C2372F',
  /** Near-black surround, cold against the warm wood. */
  arena: '#0E1418',
  /** The hard white of the overhead rigs. */
  light: '#FFF4DC',
} as const;

export type PaletteToken = keyof typeof PALETTE;

/**
 * Derived tokens. Kept as functions of the six above rather than as new
 * hand-picked hex values, so the palette stays one decision rather than
 * twelve that can drift apart.
 */
export const INK = {
  /** Board seams — the shadow colour, thinned. */
  seam: 'rgba(78, 52, 26, 0.35)',
  /** The black measurement line, 20 cm up from the cote d'azur. */
  measurement: 'rgba(14, 20, 24, 0.85)',
  /** Painted white (stayers' line, finish line) — never pure #fff. */
  paint: 'rgba(255, 244, 220, 0.82)',
  /** The rail and roof structure above the banking. */
  rail: '#1A2429',
  /** Deep arena, for the vignette's outer stop. */
  arenaDeep: '#070B0E',
  /** Typography: the numbers sit in the overhead light. */
  text: '#FFF4DC',
  textDim: 'rgba(255, 244, 220, 0.55)',
  textFaint: 'rgba(255, 244, 220, 0.28)',
} as const;

/** The two riders. The player is the warm one; the rival is cold steel. */
export const KIT = {
  playerBody: '#E8DCC4',
  playerAccent: '#C2372F',
  rivalBody: '#2A3B44',
  rivalAccent: '#2E7FA8',
  frame: '#12181C',
} as const;

/**
 * The heavy condensed stack. Numbers are the typography in this game — lap
 * count, gap, watts — so they need weight and a narrow set width, and they
 * are drawn through drawTabular() so the digits cannot jitter as they change.
 */
export const DISPLAY_FONT =
  '"Haettenschweiler", "Arial Narrow", "Roboto Condensed", ' +
  '"Oswald", Impact, system-ui, sans-serif';

/** Everything that is not a number stays quiet. */
export const LABEL_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
