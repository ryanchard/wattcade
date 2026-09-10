// Same maths as Version A (apps/canvas/src/iso.ts), restated here so the two
// apps stay independent — neither imports across the app boundary.

export const PX_PER_M = 24;

export interface IsoConfig {
  tileW: number;
  tileH: number;
  heightScale: number;
}

export const PHASER_ISO: IsoConfig = {
  tileW: 26,
  tileH: 13,
  heightScale: 18,
};

export function project(
  distance: number,
  lateral: number,
  height: number,
  cameraDistance: number,
  cfg: IsoConfig = PHASER_ISO,
): { x: number; y: number } {
  const a = lateral;
  const b = cameraDistance - distance;
  return {
    x: (a - b) * (cfg.tileW / 2),
    y: (a + b) * (cfg.tileH / 2) - height * cfg.heightScale,
  };
}

// World-space physics scale: metres to the pixel units Arcade Physics bodies
// live in. Kept separate from the isometric projection above — bodies are
// axis-aligned in (distance, lateral) space, screen position is derived by
// projecting that world position each frame.
export const toBodyX = (distance: number): number => distance * PX_PER_M;
export const toBodyY = (lateral: number): number => lateral * PX_PER_M;
export const fromBodyX = (x: number): number => x / PX_PER_M;
export const fromBodyY = (y: number): number => y / PX_PER_M;
