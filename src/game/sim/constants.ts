/** Fixed simulation rate. Everything gameplay-relevant advances in these steps. */
export const STEP = 1 / 120;

/** Movement tuning. Units are world units (Pip is ~0.9 tall) and seconds. */
export const PHYS = {
  gravity: 46,
  fallGravityMul: 1.45,
  apexGravityMul: 0.6,
  apexThreshold: 2.2,
  maxFall: 24,
  jumpVel: 15.2,
  jumpCutMul: 0.45,
  runSpeed: 7.6,
  groundAccel: 70,
  groundDecel: 75,
  turnAccel: 140,
  airAccel: 48,
  airDecel: 14,
  coyoteTime: 0.1,
  jumpBuffer: 0.13,
  stompBounce: 11,
  stompBounceHeld: 15.5,
  pushSpeed: 2.6,
  hurtKnockX: 6,
  hurtKnockY: 9,
  invulnTime: 1.4,
};

export const PIP_SIZE = { hw: 0.3, h: 0.9 };

/** Distance from the 2D plane (z = 0) within which Pip may shift back into 2D. */
export const LANE_TOLERANCE = 0.6;

export const SHIFT_DURATION = 1.15;

export const DEATH_Y = -9;

export const MAX_CELLS = 3;
