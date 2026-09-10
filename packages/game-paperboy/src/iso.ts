export interface IsoConfig {
  tileW: number;
  tileH: number;
  heightScale: number;
  originX: number;
  originY: number;
}

export const DEFAULT_ISO: IsoConfig = {
  tileW: 26,
  tileH: 13,
  heightScale: 18,
  originX: 0,
  originY: 0,
};

export interface Camera {
  distance: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export function worldToScreen(
  distance: number,
  lateral: number,
  height: number,
  camera: Camera,
  cfg: IsoConfig,
): ScreenPoint {
  const a = lateral;
  const b = camera.distance - distance;
  return {
    x: cfg.originX + (a - b) * (cfg.tileW / 2),
    y: cfg.originY + (a + b) * (cfg.tileH / 2) - height * cfg.heightScale,
  };
}

/**
 * Painter's-algorithm sort key for ground-plane footprints. Deliberately
 * excludes height: entities anchor at their ground footprint for occlusion
 * ordering (the right default—a building farther away draws under a nearer
 * one, regardless of either's height). Consequence: two entities at the same
 * ground footprint tie exactly, even if one flies high above the other.
 * A paper arcing over a house at (distance 100, lateral 4, height 5) and
 * the house (distance 100, lateral 4, height 0) both yield depthKey = -96;
 * draw order is array-order only. The renderer must accept this (harmless if
 * projectiles draw in a later pass, or footprint collisions are rare) or add
 * height as an explicit tie-break. Camera-independent on purpose: within a
 * frame the camera term is constant, so this orders identically to screen y
 * while being computable once per entity. If height is ever added to the key,
 * it must remain camera-independent or the once-per-entity optimisation is lost.
 */
export function depthKey(distance: number, lateral: number): number {
  return lateral - distance;
}
