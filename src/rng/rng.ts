// Injectable, seedable pseudo-random number generator.
//
// The rules engine NEVER calls Math.random directly. All randomness flows
// through an injected RNG so that game logic is deterministic and tests are
// reproducible and shrinkable.

/** A source of randomness with a small, deterministic-friendly surface. */
export interface RNG {
  /** Returns a float in [0, 1). */
  next(): number;
  /** Returns an integer in [0, n). Requires n > 0. */
  nextInt(n: number): number;
}

/**
 * A small, fast, deterministic PRNG based on mulberry32. Given the same seed
 * it always produces the same sequence, which is exactly what we want for
 * reproducible tests and replayable matches.
 */
export class SeededRng implements RNG {
  private state: number;

  constructor(seed: number) {
    // Coerce to a 32-bit unsigned integer so behavior is identical across runs.
    this.state = seed >>> 0;
  }

  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`nextInt requires a positive integer, got ${n}`);
    }
    return Math.floor(this.next() * n);
  }
}

/** Convenience factory used throughout tests for a reproducible RNG. */
export function seededRng(seed = 0x9e3779b9): RNG {
  return new SeededRng(seed);
}

/**
 * A non-deterministic RNG backed by Math.random, for production runs where
 * reproducibility is not required. The engine still receives it via injection.
 */
export class SystemRng implements RNG {
  next(): number {
    return Math.random();
  }

  nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`nextInt requires a positive integer, got ${n}`);
    }
    return Math.floor(Math.random() * n);
  }
}
