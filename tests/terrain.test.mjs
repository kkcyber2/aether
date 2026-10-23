import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../js/terrain.js';
import { makeNoise2D, fbm, mulberry32, smoothstep, clamp } from '../js/noise.js';

const t = createTerrain();

test('heightAt is deterministic for a given seed', () => {
  const a = createTerrain({ seed: 1234 });
  const b = createTerrain({ seed: 1234 });
  for (const [x, z] of [[0, 0], [0.3, -0.2], [-0.77, 0.61]]) {
    assert.equal(a.heightAt(x, z), b.heightAt(x, z));
  }
});

test('different seeds produce different terrain', () => {
  const a = createTerrain({ seed: 1 });
  const b = createTerrain({ seed: 2 });
  let differing = 0;
  for (let k = 0; k < 40; k++) {
    const x = (k / 40) * 1.4 - 0.7;
    const z = (k / 40) * 1.2 - 0.6;
    if (Math.abs(a.heightAt(x, z) - b.heightAt(x, z)) > 1e-6) differing++;
  }
  assert.ok(differing > 20, `expected most samples to differ, got ${differing}/40`);
});

test('heightAt never returns NaN or Infinity anywhere on the disc', () => {
  for (let k = 0; k < 900; k++) {
    const x = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    if (Math.hypot(x, z) > 1) continue;
    const h = t.heightAt(x, z);
    assert.ok(Number.isFinite(h), `non-finite height at ${x},${z}: ${h}`);
  }
});

test('the caldera wall rises well above the basin floor', () => {
  const floor = t.heightAt(0.13, 0.02);
  const rim = t.heightAt(0.40, 0);
  assert.ok(rim - floor > 0.65, `rim should tower over the floor: floor=${floor} rim=${rim}`);
});

test('the rim is higher than the outer plain on every bearing', () => {
  for (let d = 0; d < 360; d += 15) {
    const a = (d * Math.PI) / 180;
    const rimH = t.heightAt(Math.cos(a) * 0.42, Math.sin(a) * 0.42);
    const plainH = t.heightAt(Math.cos(a) * 0.88, Math.sin(a) * 0.88);
    assert.ok(rimH > plainH, `bearing ${d}°: rim ${rimH} should exceed plain ${plainH}`);
  }
});

test('a lake exists: some of the basin floor is below the waterline', () => {
  let below = 0;
  let total = 0;
  for (let k = 0; k < 4000; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.24;
    const h = t.heightAt(Math.cos(a) * r, Math.sin(a) * r);
    total++;
    if (h < t.WATER_LEVEL) below++;
  }
  const pct = (below / total) * 100;
  assert.ok(pct > 2, `basin should hold water, only ${pct.toFixed(1)}% was below the waterline`);
  assert.ok(pct < 95, `basin should keep a shore, ${pct.toFixed(1)}% was below the waterline`);
});

test('water covers a small, contained part of the world — not the whole map', () => {
  let below = 0;
  let total = 0;
  for (let k = 0; k < 12000; k++) {
    const x = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    if (Math.hypot(x, z) > 1) continue;
    total++;
    if (t.heightAt(x, z) < t.WATER_LEVEL) below++;
  }
  const pct = (below / total) * 100;
  assert.ok(pct < 12, `water should be confined to the basin, but covered ${pct.toFixed(1)}% of the disc`);
});

test('the outer plain stays above the waterline', () => {
  for (let d = 0; d < 360; d += 30) {
    const a = (d * Math.PI) / 180;
    for (const r of [0.80, 0.88, 0.94]) {
      const h = t.heightAt(Math.cos(a) * r, Math.sin(a) * r);
      assert.ok(h > t.WATER_LEVEL, `plain flooding at bearing ${d}°, r=${r}: ${h}`);
    }
  }
});

test('every landmark sits on the surface it reports', () => {
  assert.equal(t.landmarks.length, 6);
  for (const lm of t.landmarks) {
    assert.equal(lm.y, t.heightAt(lm.x, lm.z), `${lm.name} height must match the heightfield`);
    assert.equal(lm.surface, t.surfaceAt(lm.x, lm.z), `${lm.name} surface must match`);
    // Vesper Lake is the water body itself, so it is the one landmark that is
    // expected to sit at or below the waterline.
    if (lm.surface === 'water') {
      assert.ok(lm.y <= t.WATER_LEVEL + 1e-6, `${lm.name} is a water feature and should sit at the waterline`);
    } else {
      assert.ok(lm.y > t.WATER_LEVEL, `${lm.name} is a land feature but sits underwater`);
    }
  }
});

test('landmarks are distinct and named', () => {
  const names = t.landmarks.map((l) => l.name);
  assert.equal(new Set(names).size, names.length, 'landmark names must be unique');
  for (const lm of t.landmarks) {
    assert.ok(lm.name.length > 3);
    assert.ok(lm.note.length > 30, 'each landmark needs a real note');
    assert.ok(Number.isFinite(lm.azimuth) && Number.isFinite(lm.radius));
  }
});

test('normals are unit length and point upward', () => {
  for (const [x, z] of [[0.1, 0.1], [0.35, -0.2], [-0.6, 0.45]]) {
    const n = t.normalAt(x, z);
    const len = Math.hypot(...n);
    assert.ok(Math.abs(len - 1) < 1e-6, `normal not unit length: ${len}`);
    assert.ok(n[1] > 0, 'normals must point up');
  }
});

test('slope is 0..1 and steeper on the wall than on the floor', () => {
  for (const [x, z] of [[0.4, 0], [0.1, 0.05]]) {
    const s = t.slopeAt(x, z);
    assert.ok(s >= 0 && s <= 1, `slope out of range: ${s}`);
  }
  const wallSlope = t.slopeAt(0.30, 0.0);
  const floorSlope = t.slopeAt(0.12, 0.0);
  assert.ok(wallSlope > floorSlope, `wall ${wallSlope} should be steeper than floor ${floorSlope}`);
});

test('surface classification only returns known zones', () => {
  const allowed = new Set(['water', 'snow', 'rock', 'scree', 'ash']);
  for (let k = 0; k < 600; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random();
    const s = t.surfaceAt(Math.cos(a) * r, Math.sin(a) * r);
    assert.ok(allowed.has(s), `unexpected surface: ${s}`);
  }
});

test('the world contains all four land zones', () => {
  const seen = new Set();
  for (let k = 0; k < 9000; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.98;
    seen.add(t.surfaceAt(Math.cos(a) * r, Math.sin(a) * r));
  }
  for (const zone of ['water', 'snow', 'rock', 'ash']) {
    assert.ok(seen.has(zone), `zone missing from the world: ${zone}`);
  }
});

test('world-space mapping is consistent', () => {
  assert.equal(t.toWorldX(1), t.worldScale);
  assert.equal(t.toWorldZ(-1), -t.worldScale);
  assert.ok(t.toWorldY(1) > t.toWorldY(0));
});

/* ------------------------------------------------------------- noise utils */
test('smoothstep clamps and is monotonic', () => {
  assert.equal(smoothstep(0, 1, -5), 0);
  assert.equal(smoothstep(0, 1, 5), 1);
  assert.equal(smoothstep(2, 2, 1), 0);
  assert.equal(smoothstep(2, 2, 3), 1);
  let prev = -1;
  for (let k = 0; k <= 20; k++) {
    const v = smoothstep(0, 1, k / 20);
    assert.ok(v >= prev, 'smoothstep must be monotonic');
    prev = v;
  }
});

test('clamp bounds values', () => {
  assert.equal(clamp(-3, 0, 1), 0);
  assert.equal(clamp(3, 0, 1), 1);
  assert.equal(clamp(0.4, 0, 1), 0.4);
});

test('value noise stays in range and is continuous', () => {
  const n = makeNoise2D(99);
  for (let k = 0; k < 500; k++) {
    const v = n(Math.random() * 40 - 20, Math.random() * 40 - 20);
    assert.ok(v >= -1.0001 && v <= 1.0001, `noise out of range: ${v}`);
  }
  // continuity: a tiny step must not produce a large jump
  for (let k = 0; k < 100; k++) {
    const x = Math.random() * 10;
    const y = Math.random() * 10;
    const d = Math.abs(n(x, y) - n(x + 1e-4, y));
    assert.ok(d < 0.01, `noise discontinuity: ${d}`);
  }
});

test('fbm ridged output stays within the noise range', () => {
  const n = makeNoise2D(7);
  for (let k = 0; k < 300; k++) {
    const v = fbm(n, Math.random() * 5, Math.random() * 5, { octaves: 5, ridged: true });
    assert.ok(v >= -1.01 && v <= 1.01, `fbm out of range: ${v}`);
  }
});

test('mulberry32 is reproducible and in [0,1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let k = 0; k < 50; k++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});
