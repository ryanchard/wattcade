import Phaser from 'phaser';
import { DEFAULT_RIDER } from '@paperboy/trainer';
import type { HazardSpec, HouseSpec } from '@paperboy/game-core';
import { PX_PER_M, project, toBodyX, toBodyY } from '../iso.js';
import type { EntityRecord } from '../logic/entities.js';
import { FIXED_DT, MAX_SUBSTEPS, PaperboyRun } from '../logic/run.js';
import type { RunInput } from '../logic/run.js';
import {
  COLOURS, drawHazardView, drawHouseView, drawPaperView, drawRiderView,
  drawStackView,
} from '../views.js';

interface HazardView {
  container: Phaser.GameObjects.Container;
  zone: Phaser.GameObjects.Zone;
  spec: HazardSpec;
  distance: number;
  lateral: number;
}

export class StreetScene extends Phaser.Scene {
  run: PaperboyRun | null = null;

  #ground!: Phaser.GameObjects.Graphics;
  #rider!: Phaser.GameObjects.Container;
  #riderZone!: Phaser.GameObjects.Zone;
  #hazards = new Map<string, HazardView>();
  #statics = new Map<string, Phaser.GameObjects.Container>();
  #papers = new Map<number, Phaser.GameObjects.Container>();
  #input: RunInput = { steer: 0, throwPaper: false };
  #steerSource: () => number = () => 0;

  // Fixed-timestep accumulator: see run.update() below. `#pendingThrow`
  // survives a frame that spends zero substeps (e.g. a burst of very short
  // frames), rather than being dropped, but is still consumed by exactly one
  // substep once one finally runs — a keypress spends exactly one paper
  // regardless of how the accumulator happens to slice frames.
  #accumulator = 0;
  #pendingThrow = false;

  constructor() {
    super('street');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1b1f3b');
    this.#ground = this.add.graphics().setDepth(-1e9);

    const riderGraphics = this.add.graphics();
    drawRiderView(riderGraphics);
    this.#rider = this.add.container(0, 0, [riderGraphics]);

    // X is distance (along the road), Y is lateral (across it) — this must
    // match toBodyX/toBodyY's convention exactly, since Zone(x, y, width,
    // height) treats `width` as the X extent. The rider is 1.5 m long
    // (distance) by 0.8 m wide (lateral), matching drawRiderView's box and
    // Version A's RIDER_HALF_LENGTH/RIDER_HALF_WIDTH.
    this.#riderZone = this.add.zone(0, 0, 1.5 * PX_PER_M, 0.8 * PX_PER_M);
    this.physics.add.existing(this.#riderZone);
  }

  setInput(input: RunInput): void {
    this.#input = input;
  }

  /**
   * Steering is read fresh every rendered frame rather than latched from the
   * 30 Hz trainer-resistance interval, so it feels as responsive as Version
   * A's per-frame input poll. Throwing stays edge-triggered via setInput.
   */
  setSteerSource(source: () => number): void {
    this.#steerSource = source;
  }

  startRun(seed: number): void {
    for (const v of this.#hazards.values()) {
      v.container.destroy();
      v.zone.destroy();
    }
    this.#hazards.clear();
    this.#statics.forEach((c) => c.destroy());
    this.#statics.clear();
    this.#papers.forEach((c) => c.destroy());
    this.#papers.clear();
    this.run = new PaperboyRun(seed, DEFAULT_RIDER);
  }

  override update(_time: number, deltaMs: number): void {
    const run = this.run;
    if (run === null || run.gameOver) return;

    if (this.#input.throwPaper) this.#pendingThrow = true;
    this.#input = { steer: this.#input.steer, throwPaper: false };

    // Physics must not depend on the display's refresh rate (a 144 Hz
    // monitor must simulate the same game as a 60 Hz one), so the rendered
    // frame's time is banked into an accumulator and spent in fixed
    // FIXED_DT substeps — mirroring Version A's advanceFixed. Entity
    // creation/removal deltas from every substep this frame are collected
    // and applied once after the loop, so a house or hazard is still
    // created exactly once per rendered frame no matter how many substeps
    // ran.
    const steer = this.#steerSource();
    const frameDt = Math.min(0.25, deltaMs / 1000);
    this.#accumulator += frameDt;

    const added: EntityRecord[] = [];
    const removed: string[] = [];
    let steps = 0;
    while (this.#accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      const throwPaper = this.#pendingThrow;
      this.#pendingThrow = false;
      const { stream } = run.update(FIXED_DT, { steer, throwPaper });
      added.push(...stream.added);
      removed.push(...stream.removed);
      this.#accumulator -= FIXED_DT;
      steps += 1;
    }
    // A genuine stall (tab backgrounded, debugger paused, ...) should drop
    // its backlog of substeps rather than replay them all in one burst once
    // the tab wakes back up.
    if (steps === MAX_SUBSTEPS) this.#accumulator = 0;

    for (const record of added) {
      if (record.kind === 'hazard') this.#addHazard(record.id, record.spec as HazardSpec);
      else if (record.kind === 'house') this.#addHouse(record.id, record.spec as HouseSpec);
      else this.#addStack(record.id, record.distance, record.lateral);
    }
    for (const id of removed) {
      const hazard = this.#hazards.get(id);
      if (hazard !== undefined) {
        hazard.container.destroy();
        hazard.zone.destroy();
        this.#hazards.delete(id);
      }
      this.#statics.get(id)?.destroy();
      this.#statics.delete(id);
    }

    this.#moveHazards(run, frameDt);
    this.#syncPapers(run);
    this.#drawGround(run);
    this.#syncPositions(run);
    this.#checkCollisions(run);
  }

  #place(
    container: Phaser.GameObjects.Container,
    distance: number, lateral: number, height: number, cameraDistance: number,
  ): void {
    const p = project(distance, lateral, height, cameraDistance);
    container.setPosition(
      this.scale.width * 0.34 + p.x,
      this.scale.height * 0.62 + p.y,
    );
    // Phaser draws higher depth last, and larger (lateral - distance) is
    // nearer the viewer, so this is the whole painter's sort.
    container.setDepth(lateral - distance);
  }

  #addHouse(id: string, spec: HouseSpec): void {
    const g = this.add.graphics();
    drawHouseView(g, spec);
    const container = this.add.container(0, 0, [g]);
    container.setData('distance', spec.distance);
    container.setData('lateral', 0.75);
    this.#statics.set(id, container);
  }

  #addStack(id: string, distance: number, lateral: number): void {
    const g = this.add.graphics();
    drawStackView(g);
    const container = this.add.container(0, 0, [g]);
    container.setData('distance', distance);
    container.setData('lateral', lateral);
    this.#statics.set(id, container);
  }

  #addHazard(id: string, spec: HazardSpec): void {
    const g = this.add.graphics();
    drawHazardView(g, spec);
    const container = this.add.container(0, 0, [g]);

    // X is distance, Y is lateral (see the rider zone in create()). The
    // hazard's depth (along the road) is its X extent and spec.width
    // (across the road) is its Y extent — this one is genuinely right, not
    // accidentally so.
    const zone = this.add.zone(
      toBodyX(spec.distance),
      toBodyY(spec.lateral),
      (spec.kind === 'car' ? 4 : 1) * PX_PER_M,
      spec.width * PX_PER_M,
    );
    this.physics.add.existing(zone);

    this.#hazards.set(id, {
      container, zone, spec,
      distance: spec.distance,
      lateral: spec.lateral,
    });
  }

  #moveHazards(run: PaperboyRun, dt: number): void {
    for (const v of this.#hazards.values()) {
      if (!v.spec.moving) continue;
      if (v.spec.kind === 'car') {
        // Use the scene's own clamped dt, not the raw Phaser loop delta —
        // otherwise a frame spike would make cars jump relative to
        // everything else, which is driven by fixed substeps of run time.
        v.distance -= v.spec.speed * dt;
      } else {
        const t = run.elapsed + v.spec.phase * 10;
        v.lateral = v.spec.lateral + Math.sin(t * 0.8) * 0.8;
        v.distance = v.spec.distance + Math.sin(t * 0.4) * 2;
      }
      v.zone.setPosition(toBodyX(v.distance), toBodyY(v.lateral));
    }
  }

  #syncPapers(run: PaperboyRun): void {
    const live = new Set(run.papers.map((p) => p.id));
    for (const [id, container] of this.#papers) {
      if (!live.has(id)) {
        container.destroy();
        this.#papers.delete(id);
      }
    }
    for (const p of run.papers) {
      if (this.#papers.has(p.id)) continue;
      const g = this.add.graphics();
      drawPaperView(g);
      this.#papers.set(p.id, this.add.container(0, 0, [g]));
    }
  }

  #drawGround(run: PaperboyRun): void {
    const g = this.#ground;
    g.clear();
    const cam = run.rider.distance;
    const from = cam - 80;
    const to = cam + 280;

    const band = (l0: number, l1: number, colour: number) => {
      const a = project(from, l0, 0, cam);
      const b = project(to, l0, 0, cam);
      const c = project(to, l1, 0, cam);
      const d = project(from, l1, 0, cam);
      const ox = this.scale.width * 0.34;
      const oy = this.scale.height * 0.62;
      g.fillStyle(colour);
      g.fillPoints(
        [a, b, c, d].map((p) => ({ x: ox + p.x, y: oy + p.y })) as
          Phaser.Types.Math.Vector2Like[],
        true,
      );
    };

    band(1.5, 3.0, COLOURS.lawn);
    band(3.0, 4.5, COLOURS.sidewalk);
    band(4.5, 5.5, COLOURS.curb);
    band(5.5, 10.0, COLOURS.road);
  }

  #syncPositions(run: PaperboyRun): void {
    const cam = run.rider.distance;

    for (const container of this.#statics.values()) {
      this.#place(
        container,
        container.getData('distance') as number,
        container.getData('lateral') as number,
        0, cam,
      );
    }
    for (const v of this.#hazards.values()) {
      this.#place(v.container, v.distance, v.lateral, 0, cam);
    }
    for (const p of run.papers) {
      const container = this.#papers.get(p.id);
      if (container !== undefined) {
        this.#place(container, p.distance, p.lateral, p.height, cam);
      }
    }

    this.#rider.setVisible(
      !run.invulnerable || Math.floor(run.elapsed * 12) % 2 === 0,
    );
    this.#place(this.#rider, run.rider.distance, run.rider.lateral, 0, cam);
    this.#riderZone.setPosition(
      toBodyX(run.rider.distance),
      toBodyY(run.rider.lateral),
    );
  }

  #checkCollisions(run: PaperboyRun): void {
    if (run.invulnerable) return;
    for (const v of this.#hazards.values()) {
      // An explicit Arcade query, rather than a registered collider, so the
      // check happens after this frame's positions are final.
      if (this.physics.world.overlap(this.#riderZone, v.zone)) {
        run.crash();
        return;
      }
    }
  }
}
