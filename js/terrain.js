// Caldera heightfield. Pure functions — no THREE dependency, so this is
// directly testable in Node without a WebGL context.
import { makeNoise2D, fbm, smoothstep, clamp, lerp } from './noise.js';

export const DEFAULT = {
  segments: 224,
  worldScale: 2.0,       // world units per terrain unit
  seed: 20261,
};

/**
 * Radial profile of the caldera, 0..1 from the centre outward.
 * Centre: low resurgent dome. 0.22-0.38: steep wall. 0.38-0.5: rim crest.
 * Beyond: outer flank falling away to a plain.
 */
function profile(r) {
  const dome = 0.22 * (1 - smoothstep(0.0, 0.15, r));
  const wall = 0.95 * smoothstep(0.22, 0.355, r) * (1 - smoothstep(0.50, 0.72, r));
  const apron = 0.16 * (1 - smoothstep(0.55, 0.96, r));
  return dome + wall + apron;
}

/** A single breach in the rim where meltwater leaves the basin. */
function notch(angle) {
  const target = 2.35; // radians
  let d = Math.atan2(Math.sin(angle - target), Math.cos(angle - target));
  const bite = Math.exp(-(d * d) / (0.10));
  return 1 - 0.72 * bite;
}

export function createTerrain(opts = {}) {
  const { segments, seed, worldScale } = { ...DEFAULT, ...opts };
  const noiseA = makeNoise2D(seed);
  const noiseB = makeNoise2D(seed + 7919);
  const noiseC = makeNoise2D(seed + 104729);

  /** Height in terrain units for a point in [-1,1]^2. */
  function heightAt(x, z) {
    const r = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);

    const base = profile(clamp(r, 0, 1)) * notch(angle);

    // The resurgent dome: a *narrow* pillow of rock at the centre. It has to
    // fall back under the waterline quickly, otherwise the whole basin floor
    // stays above the lake and the water plane ends up buried in the terrain.
    const domeH = 0.085 * (1 - smoothstep(0.0, 0.055, r));

    // Ridged detail only where the wall exists, so the plain stays calm.
    const wallMask = smoothstep(0.20, 0.36, r) * (1 - smoothstep(0.52, 0.80, r));
    const ridges = fbm(noiseA, x * 3.1, z * 3.1, { octaves: 5, ridged: true, gain: 0.52 });
    const erosion = fbm(noiseB, x * 7.4, z * 7.4, { octaves: 3, gain: 0.45 });
    const grain = fbm(noiseC, x * 18.0, z * 18.0, { octaves: 2, gain: 0.5 });

    let h = base + ridges * 0.30 * wallMask + erosion * 0.075 * (0.35 + wallMask) + grain * 0.012;
    // Carve a true basin: the floor must sit below the lake surface, otherwise
    // the water plane pokes through the ground and the lake reads as a puddle.
    const floorMask = 1 - smoothstep(0.16, 0.23, r);
    const floor = 0.004 + grain * 0.005 + domeH;
    h = lerp(h, floor, floorMask * 0.97);

    // Keep the outer plain above the waterline. Without this the flank drifts
    // under the lake surface and the whole caldera reads as a puddle in the sea
    // rather than a lake held inside a rim.
    const shelfMask = smoothstep(0.52, 0.70, r);
    if (shelfMask > 0) {
      // The shelf must clear the waterline by a real margin at the rim of the
      // disc, where `erosion` can pull it down several centimetres.
      const shelf = 0.105 + grain * 0.03 + erosion * 0.012;
      h = lerp(h, Math.max(h, shelf), shelfMask);
    }
    return h;
  }

  function normalAt(x, z, eps = 0.004) {
    const hL = heightAt(x - eps, z);
    const hR = heightAt(x + eps, z);
    const hD = heightAt(x, z - eps);
    const hU = heightAt(x, z + eps);
    const nx = (hL - hR) / (2 * eps);
    const nz = (hD - hU) / (2 * eps);
    const ny = 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  /** 0 = flat, 1 = vertical. */
  function slopeAt(x, z) {
    const n = normalAt(x, z);
    return 1 - n[1];
  }

  const WATER_LEVEL = 0.06;

  function surfaceAt(x, z) {
    const h = heightAt(x, z);
    if (h < WATER_LEVEL) return 'water';
    const s = slopeAt(x, z);
    if (h > 0.86 && s < 0.42) return 'snow';
    if (s > 0.55) return 'rock';
    if (h > 0.62) return 'scree';
    return 'ash';
  }

  // --- landmarks -------------------------------------------------------
  // Placed by polar coordinates on real terrain features, then resolved to
  // the actual height so the label can never float off the surface.
  const LANDMARK_SPEC = [
    { name: 'Ashgate Saddle', azimuth: 2.35, radius: 0.40, note: 'The rim breach. Meltwater leaves the basin here in a single braided channel.' },
    { name: 'Halden Rim', azimuth: 0.55, radius: 0.44, note: 'Highest continuous crest on the north-east shoulder, 41 m above the lake.' },
    { name: 'The Bellows', azimuth: 3.95, radius: 0.42, note: 'Fumarole field. Warm ground and sulphur staining on the inner wall.' },
    { name: 'Cinder Step', azimuth: 5.15, radius: 0.38, note: 'A terraced lava flow that cooled in three distinct pulses.' },
    { name: 'Vesper Lake', azimuth: 1.15, radius: 0.115, note: 'The basin floor. Still, cold and 60 m at its deepest sounding.' },
    { name: 'Quiet Dome', azimuth: 4.60, radius: 0.055, note: 'Resurgent dome pushing up through the lakebed, still rising 3 mm a year.' },
  ];

  const landmarks = LANDMARK_SPEC.map((spec) => {
    const x = Math.cos(spec.azimuth) * spec.radius;
    const z = Math.sin(spec.azimuth) * spec.radius;
    return { ...spec, x, z, y: heightAt(x, z), surface: surfaceAt(x, z) };
  });

  return {
    segments,
    seed,
    worldScale,
    heightAt,
    normalAt,
    slopeAt,
    surfaceAt,
    landmarks,
    WATER_LEVEL,
    /** Terrain units -> world units. */
    toWorldX: (x) => x * worldScale,
    toWorldZ: (z) => z * worldScale,
    toWorldY: (h) => h * worldScale * 0.55,
  };
}
