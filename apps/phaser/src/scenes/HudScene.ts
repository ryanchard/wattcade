import Phaser from 'phaser';
import type { StreetScene } from './StreetScene.js';

export class HudScene extends Phaser.Scene {
  #score!: Phaser.GameObjects.Text;
  #multiplier!: Phaser.GameObjects.Text;
  #supplies!: Phaser.GameObjects.Text;
  #telemetry!: Phaser.GameObjects.Text;

  constructor() {
    super('hud');
  }

  create(): void {
    const mono = {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      color: '#f2ead9',
    };
    this.#score = this.add.text(20, 18, '0', { ...mono, fontSize: '20px' });
    this.#multiplier = this.add.text(20, 44, '', {
      ...mono, fontSize: '18px', color: '#ffd98a',
    });
    this.#supplies = this.add.text(160, 18, '', { ...mono, fontSize: '20px' });
    this.#telemetry = this.add
      .text(this.scale.width - 20, 18, '', { ...mono, fontSize: '14px' })
      .setOrigin(1, 0);
  }

  override update(): void {
    const street = this.scene.get('street') as StreetScene;
    const run = street.run;
    if (run === null) return;

    this.#score.setText(String(run.score.score));
    this.#multiplier.setText(run.score.multiplier > 1 ? `x${run.score.multiplier}` : '');
    this.#supplies.setText(
      `${run.rider.papers} papers  ${'♦'.repeat(run.rider.lives)}`,
    );
    this.#telemetry.setText(
      [
        `${(run.rider.speed * 3.6).toFixed(1)} km/h`,
        `${Math.round(run.powerCurrent)} W`,
        `${Math.round(run.rider.distance)} m`,
      ].join('\n'),
    );
  }
}
