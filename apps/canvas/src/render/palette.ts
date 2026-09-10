/**
 * Every colour in the canvas renderer lives here. Drawing code names a role
 * ("the glass in a lit window") and never an inline hex literal, so the whole
 * street can be re-graded from one file.
 *
 * The scene is a paper round shortly before sunrise: a cold blue ambient with
 * one warm light source per subscriber house. Faces are flat-filled and
 * two-tone shaded by `shade()` — nearer/upper faces brighter, the far face
 * dimmer — which is the only lighting model the renderer has.
 */
export const PALETTE = {
  skyTop: '#1b1f3b',
  skyHorizon: '#e8a166',
  road: '#33384a',
  roadLine: '#6d7490',
  sidewalk: '#b9b2a6',
  lawn: '#5f7a5a',
  lawnWet: '#4a6350',
  curb: '#8d8779',

  // --- Houses -------------------------------------------------------------
  houseWall: ['#c47a4e', '#a8623f', '#9c8552', '#7d6b53', '#b0855c'],
  // Cool, desaturated slate/grey hues for non-subscriber houses — a hue
  // difference from `houseWall`, not just a dimmer version of it, so the
  // subscriber/non-subscriber read survives at speed.
  houseWallCool: ['#5f6672', '#6d7480', '#565c66'],
  houseRoof: ['#4a3b33', '#3d3129', '#55443a'],
  /** Fascia boards, eaves, mullions and porch posts: one pale trim colour. */
  houseTrim: '#ddd2b8',
  houseTrimDim: '#8f8874',
  houseDoor: ['#5a3a2c', '#3f4a5c', '#4a3550', '#6a4a30'],
  houseDoorKnob: '#d9b25f',
  chimney: '#6a5a4e',

  // Window states. All three must be separable at a glance: a lit window is
  // the delivery signal, a dark one says "not a subscriber", a broken one
  // says "you cost yourself the multiplier".
  windowLit: '#ffd98a',
  windowLitCore: '#fff3cd',
  windowDark: '#39405a',
  windowBroken: '#14161f',
  windowShard: '#98a1b8',
  mullion: '#2a2620',

  porchRoof: '#33291f',
  porchDeck: '#8b8372',
  lampBody: '#241f1a',
  lampGlass: '#ffcf7e',

  subscriberGlow: '#ffd98a',

  // --- Mailbox ------------------------------------------------------------
  mailboxSubscriber: '#4f9dd6',
  mailboxPlain: '#6b6b6b',
  mailboxPost: '#4a4239',
  /** Flag up = paper still owed. Flag down = delivered. */
  mailboxFlagUp: '#e5533d',
  mailboxFlagDown: '#7a7168',

  // --- Paper --------------------------------------------------------------
  paper: '#f2ead9',
  paperFold: '#cfc5ae',
  paperBand: '#b3503c',
  shadow: 'rgba(10, 12, 24, 0.35)',

  // --- Rider --------------------------------------------------------------
  rider: '#e5533d',
  riderAccent: '#f2ead9',
  riderSkin: '#e8b48c',
  riderHelmet: '#38507e',
  riderLeg: '#2f3648',
  bikeFrame: '#252a38',
  bikeTyre: '#16191f',
  bikeRim: '#98a2ba',
  bikeHub: '#d6dae6',
  bagCanvas: '#cbb98f',
  bagStrap: '#4f4130',

  // --- Hazards ------------------------------------------------------------
  hazard: {
    car: '#c9d1e8',
    dog: '#8a6b4a',
    sprinkler: '#7fc4d6',
    lawnmower: '#7ba05b',
    drain: '#2a2e3d',
    bin: '#4c5a4a',
    skater: '#d98d3f',
  } as Record<string, string>,
  carGlass: '#2b3446',
  carLight: '#fff2c4',
  carTail: '#c4402f',
  tyre: '#16191f',
  dogSnout: '#5c4632',
  dogEye: '#12141a',
  binLid: '#3a4639',
  binRib: '#3f4c3e',
  mowerEngine: '#39463a',
  mowerHandle: '#c3bcaa',
  water: '#bfe6f2',
  waterDim: '#7fa9bd',
  boardDeck: '#d98d3f',
  boardWheel: '#e6dcc6',
  skaterShirt: '#3f6fa8',
  grateFrame: '#454b60',
  grateSlot: '#12141c',

  hud: '#f2ead9',
  hudDim: 'rgba(242, 234, 217, 0.55)',
} as const;

/**
 * Stops for the warm ground pool a porch light throws onto its lawn, and for
 * the small halo around a lamp or a headlight. Painted through a unit radial
 * gradient under `globalCompositeOperation = 'lighter'`, so these are
 * additive contributions to whatever is already on the canvas, not surface
 * colours. Kept outside `PALETTE` so the tuple type survives `as const`.
 */
export const GLOW_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0.0, 'rgba(255, 198, 116, 0.58)'],
  [0.42, 'rgba(255, 176, 96, 0.30)'],
  [0.78, 'rgba(255, 158, 88, 0.09)'],
  [1.0, 'rgba(255, 150, 80, 0.0)'],
];

/**
 * Stable per-entity choice from a palette array. Keyed off the entity id so a
 * house keeps the same wall colour and the same roof pitch every frame —
 * `Math.random` here would make the street shimmer.
 */
export function hashPick<T>(id: string, items: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return items[h % items.length]!;
}

const HEX_COLOUR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Multiplies a hex colour's channels by `amount`. Hardened against the two
 * malformed inputs this codebase's own literals can produce: a short hex
 * like the hazard palette's '#999' fallback, and a non-finite `amount`.
 * Anything that isn't a well-formed 3- or 6-digit hex colour is returned
 * unchanged rather than turned into invalid CSS that canvas silently drops.
 */
export function shade(hex: string, amount: number): string {
  const match = HEX_COLOUR.exec(hex);
  if (match === null) return hex;

  const digits = match[1]!;
  const expanded = digits.length === 3
    ? digits.split('').map((c) => c + c).join('')
    : digits;
  const n = Number.parseInt(expanded, 16);
  const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.min(2, amount)) : 1;

  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * safeAmount);
  const g = clamp(((n >> 8) & 255) * safeAmount);
  const b = clamp((n & 255) * safeAmount);
  return `rgb(${r}, ${g}, ${b})`;
}
