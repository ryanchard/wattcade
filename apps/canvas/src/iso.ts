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
 * Painter's-algorithm sort key. Camera-independent on purpose: the camera
 * term is constant within a frame, so this orders identically to screen y
 * while being computable once per entity rather than once per frame.
 */
export function depthKey(distance: number, lateral: number): number {
  return lateral - distance;
}
