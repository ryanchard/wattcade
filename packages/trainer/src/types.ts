export type Unsubscribe = () => void;

export interface TrainerSample {
  t: number;
  power: number | null;
  cadence: number | null;
  speed: number | null;
  distance: number | null;
}

export type TrainerStatusKind =
  | 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface TrainerStatus {
  kind: TrainerStatusKind;
  deviceName: string | null;
  canControlResistance: boolean;
  message: string | null;
}

export interface SimulationParams {
  grade: number;
  headwind: number;
  crr: number;
  cw: number;
}

export interface TrainerSource {
  readonly kind: 'ftms' | 'keyboard' | 'replay';
  readonly canControlResistance: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  onSample(fn: (s: TrainerSample) => void): Unsubscribe;
  onStatus(fn: (s: TrainerStatus) => void): Unsubscribe;
  setSimulation(p: SimulationParams): void;
}
