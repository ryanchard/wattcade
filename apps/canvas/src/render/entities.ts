/**
 * One draw function per entity, all working in WORLD metres and projected by
 * the shared primitives. `scene.ts` orchestrates passes and calls in here; it
 * owns no geometry of its own.
 *
 * The governing rule for everything below is SILHOUETTE FIRST: at speed the
 * rider reads the street by outline, before colour registers. A dog and a
 * wheelie bin must be told apart by shape alone, so each entity gets the two
 * or three parts that carry its identity (a dog's four legs and upright tail,
 * a bin's overhanging lid) and nothing else.
 *
 * Two hard constraints apply to every function here:
 *   - Determinism. Nothing may call `Math.random`. Per-entity variation comes
 *     from `hashPick` on the entity id; animation comes from `w.elapsed`, from
 *     the entity's own `phase`, or from distance travelled.
 *   - Footprint honesty. A hazard's drawn extent along the street must stay
 *     inside the collision box `rules.hazardHalfDepth` uses, or the sprite
 *     and the hitbox disagree. See `HAZARD_DRAW_DEPTH_M`.
 */
import { isHazardActive } from '@paperboy/game-core';
import { PALETTE, hashPick, shade } from './palette.js';
import {
  box, groundEllipse, groundGlow, groundQuad, pointGlow, polygon, prism,
  shadow, uprightEllipse, wheel,
} from './primitives.js';
import type { DrawCtx } from './primitives.js';
import type {
  HazardState, HouseState, Paper, StackState, WorldState,
} from '../world.js';

const TAU = Math.PI * 2;

/**
 * Drawn extent along the street, per hazard kind. `rules.hazardHalfDepth`
 * is exactly half of this and the Phaser port derives its hazard zone from
 * the same numbers — if a sprite here grows past its value, the collision
 * box must grow with it or the two will disagree.
 */
export function hazardDrawDepth(kind: string): number {
  return kind === 'car' ? 4 : 1;
}

// --- Small shared shapes ---------------------------------------------------

/**
 * A rectangle lying in a wall plane at constant lateral — the plane every
 * window, door and flag lives in.
 */
function wallRect(
  d: DrawCtx, lateral: number,
  d0: number, d1: number, h0: number, h1: number,
  fill: string,
): void {
  polygon(d, [
    d0, lateral, h0, d1, lateral, h0, d1, lateral, h1, d0, lateral, h1,
  ], fill);
}

/** A rectangle in an end-wall plane at constant distance. */
function endRect(
  d: DrawCtx, distance: number,
  l0: number, l1: number, h0: number, h1: number,
  fill: string,
): void {
  polygon(d, [
    distance, l0, h0, distance, l1, h0, distance, l1, h1, distance, l0, h1,
  ], fill);
}

/**
 * A thick line in the (distance, height) plane at a fixed lateral: the
 * building block for bike frames, legs, handles and tails.
 */
function bar(
  d: DrawCtx, lateral: number,
  d0: number, h0: number, d1: number, h1: number,
  thickness: number, fill: string,
): void {
  const dd = d1 - d0;
  const dh = h1 - h0;
  const len = Math.hypot(dd, dh) || 1;
  const nd = (-dh / len) * (thickness / 2);
  const nh = (dd / len) * (thickness / 2);
  polygon(d, [
    d0 + nd, lateral, h0 + nh,
    d1 + nd, lateral, h1 + nh,
    d1 - nd, lateral, h1 - nh,
    d0 - nd, lateral, h0 - nh,
  ], fill);
}

// --- House -----------------------------------------------------------------

const HOUSE_LATERAL = 0.75;
const HOUSE_WIDTH = 1.4;
const HOUSE_DEPTH = 9;
/** Walls are deliberately low: the pitched roof above them does the reading. */
const WALL_HEIGHT = 2.4;
const EAVE_OVERHANG = 0.2;
/** The road-facing wall plane — the frontage the rider actually sees. */
const WALL_FRONT = HOUSE_LATERAL + HOUSE_WIDTH / 2;
/** Detail plane, a hair proud of the wall so trim never z-fights the wall. */
const FACE = WALL_FRONT + 0.012;

const ROOF_RISE = [0.72, 0.95, 1.22];
const DOOR_OFFSET = [0.9, 1.9, 2.8];
const PANE_COUNT = [2, 3];
const CROSS_GABLE = [true, false, false];
const HAS_CHIMNEY = [true, false];
const CHIMNEY_OFFSET = [-3.2, 2.7];

/**
 * Where this house's front door sits along the street. Shared by the house
 * draw and the porch-glow pass so the pool can never drift off the door it
 * is supposed to be spilling from.
 */
export function houseDoorDistance(house: HouseState): number {
  return house.spec.distance + hashPick(`${house.spec.id}d`, DOOR_OFFSET);
}

/** Is this house's porch light on? Subscriber, window intact. */
export function houseIsLit(house: HouseState): boolean {
  return house.spec.subscriber && !house.windowBroken;
}

function drawWindow(
  d: DrawCtx, house: HouseState, lit: boolean,
): void {
  // The paper's smash target is the fixed global WINDOW_LATERAL band that
  // `classifyLanding` (packages/game-core/src/landing.ts) checks against —
  // NOT this house's `windowLateral` field, which only positions the pane
  // drawn here on the road-facing wall at the house's window station.
  const wd = house.spec.distance - 2.2;
  const panes = hashPick(`${house.spec.id}w`, PANE_COUNT);
  const paneW = 0.58;
  const gap = 0.11;
  const total = panes * paneW + (panes - 1) * gap;
  const h0 = 1.02;
  const h1 = 1.9;
  const left = wd - total / 2;

  // Casing, then the mullion field, then each pane inset into it.
  wallRect(d, FACE, left - 0.12, left + total + 0.12, h0 - 0.12, h1 + 0.12,
    PALETTE.houseTrim);
  wallRect(d, FACE + 0.004, left - 0.04, left + total + 0.04, h0 - 0.04, h1 + 0.04,
    PALETTE.mullion);

  const glass = house.windowBroken
    ? PALETTE.windowBroken
    : lit ? PALETTE.windowLit : PALETTE.windowDark;

  for (let i = 0; i < panes; i++) {
    const p0 = left + i * (paneW + gap);
    wallRect(d, FACE + 0.008, p0, p0 + paneW, h0, h1, glass);
    if (lit && !house.windowBroken) {
      // A brighter core inside the pane reads as a lamp behind the glass
      // rather than as a flat coloured rectangle.
      wallRect(d, FACE + 0.012, p0 + 0.1, p0 + paneW - 0.1, h0 + 0.12, h1 - 0.26,
        PALETTE.windowLitCore);
    }
  }

  if (house.windowBroken) {
    // Jagged remnants clinging to the frame — a smashed window has to look
    // smashed, not merely switched off.
    const s = PALETTE.windowShard;
    polygon(d, [
      left, FACE + 0.014, h1, left + 0.3, FACE + 0.014, h1,
      left + 0.09, FACE + 0.014, h1 - 0.34,
    ], s);
    polygon(d, [
      left + total - 0.34, FACE + 0.014, h1, left + total, FACE + 0.014, h1,
      left + total - 0.05, FACE + 0.014, h1 - 0.42,
    ], s);
    polygon(d, [
      left + total * 0.4, FACE + 0.014, h0, left + total * 0.62, FACE + 0.014, h0,
      left + total * 0.48, FACE + 0.014, h0 + 0.3,
    ], s);
  }

  // Sill, projecting a little into the light.
  polygon(d, [
    left - 0.14, WALL_FRONT, h0 - 0.14,
    left + total + 0.14, WALL_FRONT, h0 - 0.14,
    left + total + 0.14, WALL_FRONT + 0.1, h0 - 0.14,
    left - 0.14, WALL_FRONT + 0.1, h0 - 0.14,
  ], PALETTE.houseTrim);
  wallRect(d, WALL_FRONT + 0.1, left - 0.14, left + total + 0.14,
    h0 - 0.2, h0 - 0.14, PALETTE.houseTrimDim);
}

function drawPorch(
  d: DrawCtx, house: HouseState, doorD: number, lit: boolean,
): void {
  const out = house.spec.porchLateral;
  const deckH = 0.14;
  const roofH = 2.1;

  // Deck.
  box(d, {
    distance: doorD,
    lateral: (WALL_FRONT + out) / 2,
    depth: 2.4,
    width: out - WALL_FRONT,
    height: deckH,
    top: PALETTE.porchDeck,
    left: shade(PALETTE.porchDeck, 0.78),
    right: shade(PALETTE.porchDeck, 0.62),
  });

  // Posts, drawn before the roof so the roof caps them.
  for (const s of [-1, 1]) {
    box(d, {
      distance: doorD + s * 1.05,
      lateral: out - 0.07,
      depth: 0.11, width: 0.11,
      height: roofH - deckH, base: deckH,
      top: PALETTE.houseTrim,
      left: shade(PALETTE.houseTrim, 0.9),
      right: shade(PALETTE.houseTrim, 0.7),
    });
  }

  box(d, {
    distance: doorD,
    lateral: (WALL_FRONT + out + 0.16) / 2,
    depth: 2.7,
    width: out + 0.16 - WALL_FRONT,
    height: 0.16, base: roofH,
    top: shade(PALETTE.porchRoof, lit ? 1.15 : 1.0),
    left: shade(PALETTE.houseTrim, 0.85),
    right: shade(PALETTE.houseTrim, 0.66),
  });

  // The lamp itself: a small warm face beside the door, plus its halo. Dark
  // and inert when the house is not lit, so the two states differ in shape
  // and in brightness, not brightness alone.
  const lampD = doorD + 0.68;
  wallRect(d, FACE + 0.01, lampD - 0.075, lampD + 0.075, 1.72, 1.94,
    lit ? PALETTE.lampGlass : shade(PALETTE.lampBody, 1.5));
  wallRect(d, FACE + 0.014, lampD - 0.105, lampD + 0.105, 1.94, 2.0,
    PALETTE.lampBody);
  if (lit) pointGlow(d, lampD, FACE + 0.14, 1.83, 17, 0.95);
}

export function drawHouse(d: DrawCtx, house: HouseState): void {
  const id = house.spec.id;
  // A hue difference, not just a brightness difference, so subscriber vs.
  // non-subscriber houses are legible at speed even before the window or
  // mailbox colour registers.
  const wall = hashPick(
    id, house.spec.subscriber ? PALETTE.houseWall : PALETTE.houseWallCool,
  );
  const roof = hashPick(`${id}r`, PALETTE.houseRoof);
  const lit = houseIsLit(house);
  const rise = hashPick(`${id}p`, ROOF_RISE);
  const doorD = houseDoorDistance(house);

  box(d, {
    distance: house.spec.distance,
    lateral: HOUSE_LATERAL,
    depth: HOUSE_DEPTH,
    width: HOUSE_WIDTH,
    height: WALL_HEIGHT,
    top: shade(wall, 0.45),
    left: shade(wall, lit ? 1.0 : 0.62),
    right: shade(wall, lit ? 0.86 : 0.5),
  });

  // The pitched roof. This one shape is most of what turns a cuboid into a
  // house, so it overhangs the walls at the eaves and at both ends.
  prism(d, {
    distance: house.spec.distance,
    lateral: HOUSE_LATERAL,
    depth: HOUSE_DEPTH + 0.5,
    width: HOUSE_WIDTH + EAVE_OVERHANG * 2,
    base: WALL_HEIGHT,
    rise,
    axis: 'distance',
    slope: shade(roof, 1.0),
    gable: shade(roof, 0.74),
  });
  // Fascia along the road-side eave, and the shadow the overhang casts on
  // the wall right under it.
  wallRect(d, WALL_FRONT + EAVE_OVERHANG,
    house.spec.distance - HOUSE_DEPTH / 2 - 0.25,
    house.spec.distance + HOUSE_DEPTH / 2 + 0.25,
    WALL_HEIGHT - 0.13, WALL_HEIGHT, PALETTE.houseTrim);
  wallRect(d, WALL_FRONT + 0.006,
    house.spec.distance - HOUSE_DEPTH / 2,
    house.spec.distance + HOUSE_DEPTH / 2,
    WALL_HEIGHT - 0.18, WALL_HEIGHT, shade(wall, lit ? 0.6 : 0.36));

  // Some houses turn a gable to the street over the entry, so a row does not
  // look stamped from one template.
  if (hashPick(`${id}g`, CROSS_GABLE)) {
    prism(d, {
      distance: doorD,
      lateral: HOUSE_LATERAL + 0.08,
      depth: 3.0,
      width: HOUSE_WIDTH + EAVE_OVERHANG * 2 + 0.16,
      base: WALL_HEIGHT,
      rise: rise + 0.18,
      axis: 'lateral',
      slope: shade(roof, 0.88),
      gable: shade(wall, lit ? 0.92 : 0.56),
    });
    // Barge board along the street-facing gable's two rakes.
    const apex = WALL_HEIGHT + rise + 0.18;
    const lHi = HOUSE_LATERAL + 0.08 + (HOUSE_WIDTH + EAVE_OVERHANG * 2 + 0.16) / 2;
    bar(d, lHi + 0.004, doorD - 1.5, WALL_HEIGHT, doorD, apex, 0.11,
      PALETTE.houseTrim);
    bar(d, lHi + 0.004, doorD, apex, doorD + 1.5, WALL_HEIGHT, 0.11,
      PALETTE.houseTrim);
  }

  if (hashPick(`${id}c`, HAS_CHIMNEY)) {
    box(d, {
      distance: house.spec.distance + hashPick(`${id}co`, CHIMNEY_OFFSET),
      lateral: HOUSE_LATERAL - 0.1,
      depth: 0.5, width: 0.42,
      height: 0.8, base: WALL_HEIGHT + rise * 0.42,
      top: shade(PALETTE.chimney, 0.55),
      left: shade(PALETTE.chimney, 1.0),
      right: shade(PALETTE.chimney, 0.78),
    });
  }

  drawWindow(d, house, lit);

  // Door: frame, leaf, knob.
  const doorColour = hashPick(`${id}dc`, PALETTE.houseDoor);
  wallRect(d, FACE, doorD - 0.48, doorD + 0.48, 0.14, 2.04, PALETTE.houseTrim);
  wallRect(d, FACE + 0.004, doorD - 0.39, doorD + 0.39, 0.14, 1.95,
    shade(doorColour, lit ? 1.1 : 0.8));
  wallRect(d, FACE + 0.008, doorD + 0.24, doorD + 0.31, 1.0, 1.08,
    PALETTE.houseDoorKnob);

  drawPorch(d, house, doorD, lit);
  drawMailbox(d, house);
}

/**
 * The signature element: a warm elliptical pool of porch light on the lawn.
 * Painted on the GROUND, in its own pass between the street and the entity
 * loop, so anything standing in the pool is lit by it rather than erased.
 */
export function drawHouseGlow(d: DrawCtx, house: HouseState): void {
  const doorD = houseDoorDistance(house);
  groundGlow(d, doorD, 2.5, 3.5, 1.9, 1.0);
  groundGlow(d, doorD, 1.95, 1.9, 1.0, 0.6);
}

function drawMailbox(d: DrawCtx, house: HouseState): void {
  const dist = house.spec.distance;
  const lat = house.spec.mailboxLateral;
  const body = house.spec.subscriber
    ? PALETTE.mailboxSubscriber
    : PALETTE.mailboxPlain;

  box(d, {
    distance: dist, lateral: lat,
    depth: 0.11, width: 0.11, height: 0.78,
    top: shade(PALETTE.mailboxPost, 0.9),
    left: shade(PALETTE.mailboxPost, 1.0),
    right: shade(PALETTE.mailboxPost, 0.72),
  });
  box(d, {
    distance: dist, lateral: lat,
    depth: 0.54, width: 0.3, height: 0.2, base: 0.78,
    top: shade(body, 0.6),
    left: shade(body, 1.0),
    right: shade(body, 0.8),
  });
  // Rounded top, as a shallow prism.
  prism(d, {
    distance: dist, lateral: lat,
    depth: 0.54, width: 0.3,
    base: 0.98, rise: 0.14,
    axis: 'distance',
    slope: shade(body, 0.9),
    gable: shade(body, 1.1),
  });

  // The flag is a free gameplay signal: up means this house is still owed a
  // paper, down means it has been served.
  const flagD = dist - 0.2;
  const flagL = lat + 0.16;
  if (house.delivered) {
    bar(d, flagL, flagD, 0.92, flagD - 0.26, 0.86, 0.05, PALETTE.mailboxFlagDown);
    wallRect(d, flagL + 0.002, flagD - 0.3, flagD - 0.14, 0.78, 0.9,
      PALETTE.mailboxFlagDown);
  } else {
    bar(d, flagL, flagD, 0.92, flagD, 1.36, 0.05, PALETTE.mailboxFlagUp);
    wallRect(d, flagL + 0.002, flagD, flagD + 0.2, 1.18, 1.36,
      PALETTE.mailboxFlagUp);
  }
}

// --- Rider -----------------------------------------------------------------

const WHEEL_R = 0.33;

/**
 * A kid on a bike, seen from behind and slightly above. The parts that carry
 * the read are the two rolling wheels, the forward-hunched torso, and the
 * canvas paper bag bulging at the hip.
 */
export function drawRider(d: DrawCtx, w: WorldState): void {
  const blink =
    w.elapsed < w.rider.invulnerableUntil &&
    Math.floor(w.elapsed * 12) % 2 === 0;
  if (blink) return;

  const dist = w.rider.distance;
  const lat = w.rider.lateral;
  shadow(d, dist, lat, 1.0);

  // Wheel rotation comes from distance travelled, not a frame counter, so a
  // paused or replayed frame draws the identical bike.
  const roll = dist / WHEEL_R;
  const crank = roll * 0.42;
  const bbD = dist + 0.02;
  const bbH = 0.30;
  const hipD = dist - 0.10;
  const hipH = 0.95;
  const shD = dist + 0.20;
  const shH = 1.34;
  const barD = dist + 0.36;
  const barH = 0.96;

  const leg = (angle: number, lateral: number, fill: string) => {
    const footD = bbD + Math.cos(angle) * 0.17;
    const footH = bbH + Math.sin(angle) * 0.17;
    const kneeD = (hipD + footD) / 2 + 0.14;
    const kneeH = (hipH + footH) / 2 - 0.04;
    bar(d, lateral, hipD, hipH, kneeD, kneeH, 0.15, fill);
    bar(d, lateral, kneeD, kneeH, footD, footH, 0.12, fill);
  };

  // Far side first: the camera sits behind and to the road side, so lower
  // distance and higher lateral are nearer.
  wheel(d, {
    distance: dist + 0.52, lateral: lat, radius: WHEEL_R, angle: roll,
    tyre: PALETTE.bikeTyre, rim: PALETTE.bikeRim, hub: PALETTE.bikeHub,
  });
  leg(crank + Math.PI, lat - 0.11, shade(PALETTE.riderLeg, 0.7));

  const frame = PALETTE.bikeFrame;
  bar(d, lat, dist + 0.52, WHEEL_R, dist + 0.33, 0.88, 0.07, frame);   // fork
  bar(d, lat, dist - 0.5, WHEEL_R, bbD, bbH, 0.07, frame);             // chainstay
  bar(d, lat, dist - 0.5, WHEEL_R, dist - 0.2, 0.94, 0.06, frame);     // seatstay
  bar(d, lat, bbD, bbH, dist + 0.33, 0.88, 0.08, frame);               // downtube
  bar(d, lat, bbD, bbH, dist - 0.2, 0.94, 0.07, frame);                // seattube
  bar(d, lat, dist - 0.2, 0.94, dist + 0.33, 0.84, 0.07, frame);       // toptube
  wallRect(d, lat + 0.001, dist - 0.34, dist - 0.08, 0.94, 1.0, frame); // saddle

  wheel(d, {
    distance: dist - 0.5, lateral: lat, radius: WHEEL_R, angle: roll,
    tyre: PALETTE.bikeTyre, rim: PALETTE.bikeRim, hub: PALETTE.bikeHub,
  });

  // Handlebar across the body, then the hunched rider over it.
  box(d, {
    distance: barD, lateral: lat, depth: 0.07, width: 0.46,
    height: 0.05, base: barH,
    top: PALETTE.bikeRim,
    left: shade(PALETTE.bikeRim, 0.8),
    right: shade(PALETTE.bikeRim, 0.62),
  });

  bar(d, lat, hipD, hipH, shD, shH, 0.36, PALETTE.rider);
  bar(d, lat + 0.02, shD, shH - 0.02, barD - 0.02, barH + 0.04, 0.1,
    PALETTE.riderSkin);
  leg(crank, lat + 0.11, PALETTE.riderLeg);

  uprightEllipse(d, dist + 0.30, lat, 1.50, 0.16, 0.15, PALETTE.riderHelmet);
  uprightEllipse(d, dist + 0.37, lat + 0.02, 1.44, 0.1, 0.11, PALETTE.riderSkin);
  wallRect(d, lat + 0.03, dist + 0.30, dist + 0.5, 1.54, 1.6,
    shade(PALETTE.riderHelmet, 1.3));

  // The bag is the character detail — slung at the hip on the road side,
  // bulging, with paper ends showing.
  bar(d, lat + 0.14, shD - 0.04, shH - 0.04, dist - 0.26, 0.92, 0.08,
    PALETTE.bagStrap);
  uprightEllipse(d, dist - 0.30, lat + 0.24, 0.80, 0.31, 0.27,
    PALETTE.bagCanvas);
  uprightEllipse(d, dist - 0.30, lat + 0.25, 0.94, 0.29, 0.12,
    shade(PALETTE.bagCanvas, 0.72));
  wallRect(d, lat + 0.26, dist - 0.44, dist - 0.3, 1.0, 1.14, PALETTE.paper);
  wallRect(d, lat + 0.26, dist - 0.28, dist - 0.16, 1.0, 1.1,
    shade(PALETTE.paper, 0.86));
}

// --- Hazards ---------------------------------------------------------------

function drawCar(d: DrawCtx, h: HazardState, colour: string): void {
  const dist = h.distance;
  const lat = h.lateral;
  const wide = h.spec.width;
  const front = dist - 1.96;

  box(d, {
    distance: dist, lateral: lat,
    depth: 3.9, width: wide, height: 0.52, base: 0.24,
    top: shade(colour, 0.72),
    left: shade(colour, 1.0),
    right: shade(colour, 0.8),
  });
  // Cabin: smaller, inset and set BACK from the nose, which is what stops a
  // car reading as a slab.
  box(d, {
    distance: dist + 0.5, lateral: lat,
    depth: 1.9, width: wide - 0.3, height: 0.5, base: 0.76,
    top: shade(colour, 0.66),
    left: PALETTE.carGlass,
    right: shade(PALETTE.carGlass, 1.25),
  });

  for (const dd of [-1.28, 1.28]) {
    wheel(d, {
      distance: dist + dd, lateral: lat + wide / 2 + 0.02,
      radius: 0.28, angle: -dist / 0.28,
      tyre: PALETTE.tyre,
      rim: shade(colour, 0.55),
      hub: shade(colour, 0.85),
    });
  }

  // Cars come toward the rider, so the headlights face them.
  endRect(d, front, lat - wide / 2, lat + wide / 2, 0.24, 0.36,
    shade(colour, 0.42));
  for (const s of [-1, 1]) {
    const l = lat + s * wide * 0.29;
    endRect(d, front - 0.01, l - 0.17, l + 0.17, 0.42, 0.62, PALETTE.carLight);
    pointGlow(d, front - 0.02, l, 0.52, 14, 0.9);
  }
}

function drawDog(d: DrawCtx, h: HazardState, colour: string): void {
  const dist = h.distance;
  const lat = h.lateral;
  const wide = h.spec.width;
  // Gait from position, not a clock: the same dog at the same spot on the
  // street always has the same legs.
  const gait = Math.sin((h.distance + h.spec.phase * 10) * 3.4);

  for (const [dd, sign] of [[-0.3, 1], [-0.2, -1], [0.14, -1], [0.24, 1]]) {
    box(d, {
      distance: dist + dd! + gait * 0.05 * sign!,
      lateral: lat, depth: 0.09, width: wide * 0.62,
      height: 0.32,
      top: shade(colour, 0.5),
      left: shade(colour, 0.72),
      right: shade(colour, 0.58),
    });
  }

  box(d, {
    distance: dist - 0.04, lateral: lat,
    depth: 0.58, width: wide * 0.6, height: 0.29, base: 0.32,
    top: shade(colour, 1.05),
    left: shade(colour, 0.86),
    right: shade(colour, 1.0),
  });
  box(d, {
    distance: dist + 0.28, lateral: lat,
    depth: 0.26, width: wide * 0.52, height: 0.28, base: 0.46,
    top: shade(colour, 1.1),
    left: shade(colour, 0.9),
    right: shade(colour, 1.02),
  });
  // Snout — the single detail that stops a dog reading as a bin. Centred at
  // dist + 0.40 with depth 0.18 (half-depth 0.09), its far edge reaches
  // dist + 0.49 — just inside hazardHalfDepth('dog') = 0.5, per this
  // module's footprint-honesty invariant.
  box(d, {
    distance: dist + 0.40, lateral: lat,
    depth: 0.18, width: wide * 0.34, height: 0.14, base: 0.48,
    top: shade(PALETTE.dogSnout, 1.1),
    left: shade(PALETTE.dogSnout, 0.9),
    right: shade(PALETTE.dogSnout, 1.0),
  });
  const ear = lat + wide * 0.3;
  polygon(d, [
    dist + 0.2, ear, 0.72, dist + 0.32, ear, 0.72, dist + 0.24, ear, 0.9,
  ], shade(colour, 0.8));
  wallRect(d, ear + 0.004, dist + 0.38, dist + 0.42, 0.62, 0.66, PALETTE.dogEye);
  // Upright tail.
  bar(d, lat, dist - 0.3, 0.54, dist - 0.44, 0.88, 0.08, shade(colour, 0.95));
}

function drawBin(d: DrawCtx, h: HazardState, colour: string): void {
  const dist = h.distance;
  const lat = h.lateral;
  const topW = h.spec.width;
  const botW = topW * 0.76;
  const topD = 0.76;
  const botD = 0.58;
  const H = 0.96;

  // Tapered body: two ruled trapezoids, which is what gives a bin its
  // unmistakable widening-upward outline.
  polygon(d, [
    dist - botD / 2, lat + botW / 2, 0,
    dist + botD / 2, lat + botW / 2, 0,
    dist + topD / 2, lat + topW / 2, H,
    dist - topD / 2, lat + topW / 2, H,
  ], shade(colour, 0.86));
  polygon(d, [
    dist - botD / 2, lat - botW / 2, 0,
    dist - botD / 2, lat + botW / 2, 0,
    dist - topD / 2, lat + topW / 2, H,
    dist - topD / 2, lat - topW / 2, H,
  ], shade(colour, 1.08));

  for (const s of [-0.2, 0.2]) {
    polygon(d, [
      dist + s - 0.04, lat + botW / 2 + 0.002, 0.06,
      dist + s + 0.04, lat + botW / 2 + 0.002, 0.06,
      dist + s + 0.04, lat + topW / 2 + 0.002, H - 0.04,
      dist + s - 0.04, lat + topW / 2 + 0.002, H - 0.04,
    ], PALETTE.binRib);
  }

  // Overhanging lid.
  box(d, {
    distance: dist, lateral: lat,
    depth: topD + 0.1, width: topW + 0.1, height: 0.1, base: H,
    top: shade(PALETTE.binLid, 1.25),
    left: shade(PALETTE.binLid, 1.0),
    right: shade(PALETTE.binLid, 0.82),
  });
  box(d, {
    distance: dist - 0.1, lateral: lat,
    depth: 0.12, width: topW * 0.4, height: 0.07, base: H + 0.1,
    top: shade(PALETTE.binLid, 1.4),
    left: shade(PALETTE.binLid, 1.1),
    right: shade(PALETTE.binLid, 0.9),
  });
}

function drawMower(d: DrawCtx, h: HazardState, colour: string): void {
  const dist = h.distance;
  const lat = h.lateral;
  const wide = h.spec.width;

  for (const dd of [-0.2, 0.2]) {
    for (const s of [-1, 1]) {
      wheel(d, {
        distance: dist + dd, lateral: lat + s * wide * 0.42,
        radius: 0.1, angle: -dist / 0.1,
        tyre: PALETTE.tyre,
        rim: shade(colour, 0.5),
        hub: shade(colour, 0.8),
      });
    }
  }
  // Low deck.
  box(d, {
    distance: dist + 0.08, lateral: lat,
    depth: 0.5, width: wide, height: 0.17, base: 0.08,
    top: shade(colour, 1.1),
    left: shade(colour, 0.86),
    right: shade(colour, 1.0),
  });
  box(d, {
    distance: dist + 0.08, lateral: lat,
    depth: 0.3, width: wide * 0.5, height: 0.22, base: 0.25,
    top: shade(PALETTE.mowerEngine, 1.2),
    left: shade(PALETTE.mowerEngine, 0.95),
    right: shade(PALETTE.mowerEngine, 1.05),
  });
  // Handle raked back toward the rider.
  for (const s of [-1, 1]) {
    bar(d, lat + s * wide * 0.33, dist - 0.14, 0.22, dist - 0.46, 0.88, 0.06,
      PALETTE.mowerHandle);
  }
  box(d, {
    distance: dist - 0.46, lateral: lat,
    depth: 0.07, width: wide * 0.78, height: 0.06, base: 0.86,
    top: PALETTE.mowerHandle,
    left: shade(PALETTE.mowerHandle, 0.82),
    right: shade(PALETTE.mowerHandle, 0.66),
  });
}

function drawSprinkler(
  d: DrawCtx, h: HazardState, colour: string, elapsed: number,
): void {
  const dist = h.distance;
  const lat = h.lateral;
  const reach = h.spec.width;

  // The damp patch is always drawn, but it is scenery, not a danger signal —
  // now that an off sprinkler is genuinely harmless (`isHazardActive`, the
  // same rule `detectCollision` consults), the spray below is the only
  // thing that is allowed to say "this ground is live right now".
  groundEllipse(d, dist, lat, reach * 0.55, reach * 0.5, PALETTE.lawnWet);

  box(d, {
    distance: dist, lateral: lat,
    depth: 0.2, width: 0.2, height: 0.1,
    top: shade(colour, 1.15),
    left: shade(colour, 0.9),
    right: shade(colour, 1.0),
  });
  box(d, {
    distance: dist, lateral: lat,
    depth: 0.08, width: 0.08, height: 0.14, base: 0.1,
    top: shade(colour, 1.3),
    left: shade(colour, 1.0),
    right: shade(colour, 1.1),
  });

  // The spray is the danger signal, so it is drawn if and only if
  // `isHazardActive` says this sprinkler is actually live right now — the
  // exact predicate `detectCollision` gates the hitbox on.
  if (!isHazardActive(h.spec, elapsed)) return;

  // Oscillating fan of droplets: two trailing arcs so the spray has body.
  const phase = h.spec.phase * TAU;
  const sweep = Math.sin(elapsed * 2.4 + phase);
  for (let arc = 0; arc < 2; arc++) {
    const angle = sweep * 0.95 - arc * 0.3;
    const dirL = Math.cos(angle);
    const dirD = Math.sin(angle);
    const tint = arc === 0 ? PALETTE.water : PALETTE.waterDim;
    for (let i = 1; i <= 9; i++) {
      const u = i / 9;
      const r = 0.06 - u * 0.025;
      uprightEllipse(
        d,
        dist + dirD * reach * u,
        lat + dirL * reach * u,
        0.24 + 2.0 * u * (1 - u),
        r, r,
        tint,
      );
    }
  }
}

function drawSkater(d: DrawCtx, h: HazardState, colour: string): void {
  const dist = h.distance;
  const lat = h.lateral;
  const wide = h.spec.width;

  for (const dd of [-0.24, 0.24]) {
    for (const s of [-1, 1]) {
      wheel(d, {
        distance: dist + dd, lateral: lat + s * wide * 0.38,
        radius: 0.06, angle: -dist / 0.06,
        tyre: shade(PALETTE.boardWheel, 0.55),
        rim: PALETTE.boardWheel,
        hub: shade(PALETTE.boardWheel, 0.8),
      });
    }
  }
  box(d, {
    distance: dist, lateral: lat,
    depth: 0.74, width: wide, height: 0.05, base: 0.1,
    top: shade(PALETTE.boardDeck, 1.1),
    left: shade(colour, 0.85),
    right: shade(colour, 0.7),
  });
  // A small figure, deliberately lower than the rider so the two never swap.
  bar(d, lat - 0.06, dist - 0.16, 0.15, dist - 0.02, 0.58, 0.13,
    shade(PALETTE.riderLeg, 0.75));
  bar(d, lat + 0.06, dist + 0.16, 0.15, dist + 0.02, 0.58, 0.13,
    PALETTE.riderLeg);
  bar(d, lat, dist - 0.02, 0.54, dist + 0.08, 1.02, 0.3, PALETTE.skaterShirt);
  bar(d, lat + 0.06, dist + 0.06, 0.96, dist + 0.36, 0.9, 0.09,
    PALETTE.riderSkin);
  bar(d, lat - 0.04, dist + 0.06, 0.96, dist - 0.26, 1.04, 0.09,
    shade(PALETTE.riderSkin, 0.82));
  uprightEllipse(d, dist + 0.1, lat, 1.14, 0.13, 0.13, PALETTE.riderSkin);
  uprightEllipse(d, dist + 0.09, lat + 0.01, 1.2, 0.14, 0.09,
    PALETTE.riderHelmet);
}

function drawDrain(d: DrawCtx, h: HazardState): void {
  const dist = h.distance;
  const lat = h.lateral;
  const wide = h.spec.width;
  const dep = 0.72;

  groundQuad(d, dist - dep / 2, lat - wide / 2, dist + dep / 2, lat + wide / 2,
    PALETTE.grateFrame);
  const slots = 5;
  const span = (wide - 0.14) / slots;
  for (let i = 0; i < slots; i++) {
    const l0 = lat - wide / 2 + 0.07 + i * span;
    groundQuad(d, dist - dep / 2 + 0.07, l0, dist + dep / 2 - 0.07,
      l0 + span * 0.55, PALETTE.grateSlot);
  }
  // A shallow lip so the grate is a grate in the ground, not a floating quad.
  polygon(d, [
    dist - dep / 2, lat + wide / 2, 0.04,
    dist + dep / 2, lat + wide / 2, 0.04,
    dist + dep / 2, lat + wide / 2, 0,
    dist - dep / 2, lat + wide / 2, 0,
  ], shade(PALETTE.grateFrame, 0.7));
}

export function drawHazard(d: DrawCtx, h: HazardState, elapsed: number): void {
  const colour = PALETTE.hazard[h.spec.kind] ?? '#999';
  switch (h.spec.kind) {
    case 'car':
      shadow(d, h.distance, h.lateral, h.spec.width * 1.6);
      drawCar(d, h, colour);
      return;
    case 'dog':
      shadow(d, h.distance, h.lateral, h.spec.width);
      drawDog(d, h, colour);
      return;
    case 'bin':
      shadow(d, h.distance, h.lateral, h.spec.width);
      drawBin(d, h, colour);
      return;
    case 'lawnmower':
      shadow(d, h.distance, h.lateral, h.spec.width);
      drawMower(d, h, colour);
      return;
    case 'sprinkler':
      drawSprinkler(d, h, colour, elapsed);
      return;
    case 'skater':
      shadow(d, h.distance, h.lateral, h.spec.width);
      drawSkater(d, h, colour);
      return;
    case 'drain':
      drawDrain(d, h);
      return;
    default:
      shadow(d, h.distance, h.lateral, h.spec.width);
      box(d, {
        distance: h.distance, lateral: h.lateral,
        depth: hazardDrawDepth(h.spec.kind), width: h.spec.width, height: 1.2,
        top: colour, left: shade(colour, 0.72), right: shade(colour, 0.56),
      });
  }
}

// --- Papers ----------------------------------------------------------------

/** A folded paper, tumbling. The fold line is what sells the tumble. */
export function drawPaper(d: DrawCtx, paper: Paper): void {
  shadow(d, paper.distance, paper.lateral, 0.35);

  // Deterministic tumble: a function of where the paper is, never of a
  // frame counter, so the same world state always draws the same paper.
  const a = paper.distance * 2.6 + paper.height * 3.6;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ad = ca * 0.17;
  const ah = sa * 0.17;
  const bd = -sa * 0.11;
  const bh = ca * 0.11;
  const cd = paper.distance;
  const cl = paper.lateral;
  const ch = paper.height + 0.09;

  polygon(d, [
    cd - ad - bd, cl, ch - ah - bh,
    cd - ad + bd, cl, ch - ah + bh,
    cd + bd, cl, ch + bh,
    cd - bd, cl, ch - bh,
  ], PALETTE.paper);
  polygon(d, [
    cd - bd, cl, ch - bh,
    cd + bd, cl, ch + bh,
    cd + ad + bd, cl, ch + ah + bh,
    cd + ad - bd, cl, ch + ah - bh,
  ], shade(PALETTE.paper, 0.84));
  polygon(d, [
    cd - bd * 1.02, cl + 0.01, ch - bh * 1.02,
    cd + bd * 1.02, cl + 0.01, ch + bh * 1.02,
    cd + bd * 1.02 + ad * 0.06, cl + 0.01, ch + bh * 1.02 + ah * 0.06,
    cd - bd * 1.02 + ad * 0.06, cl + 0.01, ch - bh * 1.02 + ah * 0.06,
  ], PALETTE.paperFold);
}

/** A bundle: individual sheets, offset, with a band round the middle. */
export function drawStack(d: DrawCtx, stack: StackState): void {
  const dist = stack.spec.distance;
  const lat = stack.spec.lateral;
  shadow(d, dist, lat, 0.6);

  const sheets = 4;
  const thick = 0.09;
  for (let i = 0; i < sheets; i++) {
    const off = (i % 2 === 0 ? 1 : -1) * 0.035;
    box(d, {
      distance: dist + off, lateral: lat - off,
      depth: 0.56, width: 0.5, height: thick, base: i * thick,
      top: i === sheets - 1 ? PALETTE.paper : shade(PALETTE.paper, 0.95),
      left: shade(PALETTE.paper, 0.84),
      right: shade(PALETTE.paper, 0.68),
    });
  }
  box(d, {
    distance: dist, lateral: lat,
    depth: 0.11, width: 0.55, height: sheets * thick + 0.01, base: 0.005,
    top: PALETTE.paperBand,
    left: shade(PALETTE.paperBand, 0.85),
    right: shade(PALETTE.paperBand, 0.68),
  });
}
