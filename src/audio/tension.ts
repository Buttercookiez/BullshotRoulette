// Tension-volume mapping (Requirement 9.7).
//
// Pure module: no Howler/PixiJS imports. This computes the playback volume of
// the tension audio layer as a function of how many Rounds remain in the
// Cylinder. As remaining Rounds deplete, tension rises; it reaches its maximum
// (1) when exactly one Round remains.

/** Clamp a value to the inclusive range [0, 1]. */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Compute the tension-layer volume in [0, 1].
 *
 * The volume is non-decreasing as `roundsRemaining` decreases for a fixed
 * `roundsTotal`, and equals the maximum (1) when exactly 1 Round remains.
 *
 * Mapping: `volume = clamp01((roundsTotal - roundsRemaining + 1) / roundsTotal)`.
 * At `roundsRemaining === roundsTotal` this is its minimum (`1 / roundsTotal`,
 * which is > 0); at `roundsRemaining === 1` it is exactly `1`; it increases
 * monotonically as Rounds deplete in between.
 *
 * Edge cases are handled by clamping:
 * - `roundsTotal <= 0` yields 0 (no rounds to track).
 * - `roundsRemaining <= 0` yields 1 (cylinder empty: peak tension, clamped).
 * - `roundsRemaining > roundsTotal` is clamped so the result stays in [0, 1].
 */
export function tensionVolume(roundsRemaining: number, roundsTotal: number): number {
  if (!Number.isFinite(roundsTotal) || roundsTotal <= 0) {
    return 0;
  }
  // Treat a non-finite remaining as fully depleted (peak tension).
  const remaining = Number.isFinite(roundsRemaining) ? roundsRemaining : 0;
  return clamp01((roundsTotal - remaining + 1) / roundsTotal);
}
