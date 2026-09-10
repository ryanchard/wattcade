/**
 * Turning a `TrainerStatus` into words a rider can act on.
 *
 * Two riders can both have "connected" trainers and be playing two different
 * games: one whose trainer takes a resistance command and one whose does not.
 * A coloured dot cannot say that, so this says it in a sentence. Pure, so the
 * wording is testable.
 */
import type { TrainerSource, TrainerStatus } from '@paperboy/trainer';

export type TrainerMode =
  | 'none' | 'connecting' | 'controls' | 'readonly' | 'keyboard' | 'lost';

export interface TrainerView {
  readonly mode: TrainerMode;
  /** The state, in plain words. */
  readonly headline: string;
  /** What it means for the ride. */
  readonly detail: string;
  /** Whether a game can expect the road to push back. */
  readonly canControlResistance: boolean;
}

export function describeTrainer(
  kind: TrainerSource['kind'] | null, status: TrainerStatus | null,
): TrainerView {
  if (kind === null || status === null) {
    return {
      mode: 'none',
      headline: 'No trainer connected',
      detail: 'Connect one over Bluetooth, or ride the games from the keyboard.',
      canControlResistance: false,
    };
  }

  if (kind === 'keyboard') {
    return {
      mode: 'keyboard',
      headline: 'Keyboard, no bike',
      detail: 'Hold W to pedal. Nothing here can change resistance.',
      canControlResistance: false,
    };
  }

  switch (status.kind) {
    case 'connecting':
      return {
        mode: 'connecting',
        headline: 'Connecting',
        detail: status.message ?? 'Pick your trainer in the browser’s chooser.',
        canControlResistance: false,
      };

    case 'connected':
      return status.canControlResistance
        ? {
          mode: 'controls',
          headline: `${status.deviceName ?? 'Trainer'}, resistance control`,
          detail: 'Grade and drag are yours to feel. Every game works fully.',
          canControlResistance: true,
        }
        : {
          mode: 'readonly',
          headline: `${status.deviceName ?? 'Trainer'}, reading power only`,
          detail:
            'It measures your watts but will not change resistance. Games ' +
            'built around what the road feels like will be flat.',
          canControlResistance: false,
        };

    case 'disconnected':
      return {
        mode: 'lost',
        headline: 'Trainer disconnected',
        detail: status.message
          ?? 'The link dropped. Connect again to get resistance back.',
        canControlResistance: false,
      };

    case 'error':
      return {
        mode: 'lost',
        headline: 'Trainer error',
        detail: status.message
          ?? 'Something went wrong on the link. Try connecting again.',
        canControlResistance: false,
      };

    case 'idle':
    default:
      return {
        mode: 'none',
        headline: 'No trainer connected',
        detail: 'Connect one over Bluetooth, or ride the games from the keyboard.',
        canControlResistance: false,
      };
  }
}

/**
 * The warning a game's card carries when the rider's setup cannot give it
 * what it needs. Null when there is nothing to warn about — this must never
 * become decoration, or riders will stop reading it.
 */
export function resistanceWarning(
  needsResistance: boolean, view: TrainerView,
): string | null {
  if (!needsResistance || view.canControlResistance) return null;
  if (view.mode === 'keyboard') {
    return 'Needs a trainer that takes resistance. On the keyboard this is a demo.';
  }
  if (view.mode === 'readonly') {
    return 'Your trainer will not change resistance, so this one loses its point.';
  }
  return 'Best with a trainer that takes resistance.';
}
