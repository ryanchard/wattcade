export const G = 9.80665;
export const AIR_DENSITY = 1.225;

/**
 * Speed floor used when converting power to force. Below this the P/v term
 * would explode, so the model approximates a standing start rather than
 * modelling it exactly. The error is confined to the first instant of the
 * start and keeps the integrator stable.
 */
export const V_MIN = 0.5;

/**
 * Ceiling that keeps a large timestep from integrating into nonsense.
 * This is a numerical guard, not a gameplay limiter. The steepest grade
 * the game generates is 6%, and the hard trainer clamp is 8%; these give
 * unclamped steady states of ~18.5 and ~20.4 m/s even at 400 W. Reaching
 * 30 m/s would require roughly a 20% descent, which the route generator
 * never produces.
 */
const V_MAX = 30;

export interface RiderProfile {
  massKg: number;
  ftpWatts: number;
  /**
   * Best five-second effort, in watts. FTP describes what a rider can hold
   * for an hour and says nothing about what they can do for five seconds:
   * two riders on the same FTP can be 600 W apart in a sprint. Any mechanic
   * built on a short, hard effort — shaking a dog off, coming round somebody
   * in the last 50 m — has to scale off this number rather than off FTP.
   *
   * Optional so that every existing caller keeps working; read it through
   * `sprintWatts()`, which falls back to a multiple of FTP.
   */
  sprintWatts?: number;
  cdA: number;
  crr: number;
  drivetrainEfficiency: number;
}

/**
 * Peak five-second power as a multiple of FTP, used when a rider has not
 * told us their own. Three to four times FTP is the ordinary range for a
 * trained rider; the middle of it is the least wrong guess available.
 */
export const DEFAULT_SPRINT_MULTIPLE = 3.5;

/**
 * The rider's peak five-second power, or an estimate from their FTP when
 * they have not entered one. Never returns less than FTP: a sprint that is
 * weaker than an hour effort is a typo, not a rider.
 */
export function sprintWatts(rider: RiderProfile): number {
  const stated = rider.sprintWatts;
  if (stated !== undefined && Number.isFinite(stated) && stated > 0) {
    return Math.max(rider.ftpWatts, stated);
  }
  return rider.ftpWatts * DEFAULT_SPRINT_MULTIPLE;
}

export const DEFAULT_RIDER: RiderProfile = {
  massKg: 85,
  ftpWatts: 200,
  sprintWatts: 700,
  cdA: 0.32,
  crr: 0.005,
  drivetrainEfficiency: 0.97,
};

export interface PhysicsState {
  speed: number;
  distance: number;
}

export interface PhysicsInput {
  powerWatts: number;
  gradePercent: number;
  crr: number;
  headwind: number;
}

function resistiveForce(
  speed: number, input: PhysicsInput, rider: RiderProfile,
): number {
  const theta = Math.atan(input.gradePercent / 100);
  const gravity = rider.massKg * G * Math.sin(theta);
  const rolling = input.crr * rider.massKg * G * Math.cos(theta);
  const apparent = speed + input.headwind;
  // Signed square: apparent * Math.abs(apparent) instead of apparent ** 2.
  // Drag must oppose the direction of airflow, not always oppose motion.
  // A plain square would make a tailwind stronger than the rider's speed
  // push them *backwards*; the signed square keeps drag opposing the actual
  // direction of apparent airflow.
  const aero =
    0.5 * AIR_DENSITY * rider.cdA * apparent * Math.abs(apparent);
  return gravity + rolling + aero;
}

export function stepPhysics(
  state: PhysicsState,
  input: PhysicsInput,
  rider: RiderProfile,
  dt: number,
): PhysicsState {
  const wheelPower = Math.max(0, input.powerWatts) * rider.drivetrainEfficiency;
  const propulsion = wheelPower / Math.max(state.speed, V_MIN);
  const net = propulsion - resistiveForce(state.speed, input, rider);
  const accel = net / rider.massKg;

  let speed = state.speed + accel * dt;
  if (!Number.isFinite(speed) || speed < 0) speed = 0;
  if (speed > V_MAX) speed = V_MAX;

  return {
    speed,
    distance: state.distance + ((state.speed + speed) / 2) * dt,
  };
}

/** Closed-form steady state, by bisection. Used for tuning and tests. */
export function steadyStateSpeed(
  powerWatts: number,
  gradePercent: number,
  rider: RiderProfile,
): number {
  const wheelPower = Math.max(0, powerWatts) * rider.drivetrainEfficiency;
  const input: PhysicsInput = {
    powerWatts, gradePercent, crr: rider.crr, headwind: 0,
  };
  const excess = (v: number) =>
    wheelPower / Math.max(v, V_MIN) - resistiveForce(v, input, rider);

  let lo = 0;
  let hi = V_MAX;
  if (excess(hi) > 0) return hi;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (excess(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
