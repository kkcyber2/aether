// Deterministic value noise + fractal brownian motion.
// Everything here is pure and seed-driven so the world is reproducible.

/** Fast 32-bit PRNG returning floats in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Bilinear value noise. Returns values in [-1, 1].
 * Continuity is C1 at lattice boundaries because of the smoothstep easing.
 */
export function makeNoise2D(seed) {
  return function noise2D(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);

    const a = hash2(x0, y0, seed);
    const b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed);
    const d = hash2(x0 + 1, y0 + 1, seed);

    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return (top + (bottom - top) * fy) * 2 - 1;
  };
}

/**
 * Fractal brownian motion: sum octaves of value noise with diminishing amplitude.
 * `ridged` folds each octave so crests sharpen into ridges.
 */
export function fbm(noise2D, x, y, opts = {}) {
  const octaves = opts.octaves ?? 4;
  const lacunarity = opts.lacunarity ?? 2.0;
  const gain = opts.gain ?? 0.5;
  const ridged = opts.ridged ?? false;

  let total = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;

  for (let i = 0; i < octaves; i++) {
    let n = noise2D(x * freq, y * freq);
    if (ridged) n = 1 - Math.abs(n);
    total += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : total / norm;
}

/** Smooth 0..1 ramp between two edges. */
export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
