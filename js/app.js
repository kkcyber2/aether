// Renderer + camera rig for Aether Basin.
// Built on the vendored Three.js r147 UMD build (global THREE).
import { createTerrain } from './terrain.js';
import { mulberry32, smoothstep, clamp, makeNoise2D, fbm } from './noise.js';

const terrain = createTerrain({ segments: 224 });

/* ---------------------------------------------------------------- palette */
const PALETTE = { water: 0x16242c };

/* --------------------------------------------------------------- renderer */
const canvas = document.getElementById('world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = false;
// Without tone mapping the snow clips to pure white and the whole basin reads
// as a flat beige stump, so tone the highlights down before the palette is applied.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b1219, 0.030);

// A vertical gradient rather than flat black: gives the mass something to sit in
// and separates the silhouette from the sky.
(function backgroundGradient() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#060a10');
  grad.addColorStop(0.42, '#0d1822');
  grad.addColorStop(0.62, '#16242e');
  grad.addColorStop(1.0, '#0a0f14');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  scene.background = tex;
})();

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 60);

/* ----------------------------------------------------------------- lights */
const sun = new THREE.DirectionalLight(0xfff2dd, 2.35);
sun.position.set(3.2, 3.9, 1.1);
scene.add(sun);

const sky = new THREE.HemisphereLight(0x9fc6e8, 0x2a2320, 0.48);
scene.add(sky);

const bounce = new THREE.DirectionalLight(0x6ea8c8, 0.30);
bounce.position.set(-2, 0.6, -2.4);
scene.add(bounce);

// Rim light from behind and low: this is what reads the ridges, and it is the
// difference between a lit stump and a mountain.
const rim = new THREE.DirectionalLight(0x8fb6d8, 0.85);
rim.position.set(-1.6, 0.9, -3.2);
scene.add(rim);

/* ------------------------------------------------------------------ build */
const SEG = terrain.segments;
const N = SEG + 1;
const positions = new Float32Array(N * N * 3);
const colors = new Float32Array(N * N * 3);

const colorFor = (h, slope) => {
  if (h < terrain.WATER_LEVEL) return new THREE.Color(0x3b3a36);
  // Snow is pulled well short of white so it keeps form under tone mapping.
  if (h > 0.95 && slope < 0.38) return new THREE.Color(0xb9c4cd);
  if (slope > 0.62) return new THREE.Color(0x544c45).lerp(new THREE.Color(0x6f665c), smoothstep(0.62, 0.95, slope));
  if (h > 0.72) return new THREE.Color(0x7d766c).lerp(new THREE.Color(0xb9c4cd), smoothstep(0.78, 1.02, h) * 0.62);
  return new THREE.Color(0x3d3d42).lerp(new THREE.Color(0x625a52), smoothstep(0.10, 0.62, h));
};

let i = 0;
for (let z = 0; z < N; z++) {
  for (let x = 0; x < N; x++) {
    const u = (x / SEG) * 2 - 1;
    const v = (z / SEG) * 2 - 1;
    const h = terrain.heightAt(u, v);
    positions[i] = terrain.toWorldX(u);
    positions[i + 1] = terrain.toWorldY(h);
    positions[i + 2] = terrain.toWorldZ(v);
    const c = colorFor(h, terrain.slopeAt(u, v), u, v);
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
    i += 3;
  }
}

const indices = [];
for (let z = 0; z < SEG; z++) {
  for (let x = 0; x < SEG; x++) {
    const a = z * N + x;
    const b = a + 1;
    const c = a + N;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
}

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
geo.setIndex(indices);
geo.computeVertexNormals();

const groundMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.94,
  metalness: 0.02,
  flatShading: false,
});
const ground = new THREE.Mesh(geo, groundMat);
scene.add(ground);

/* ------------------------------------------------------------------ water */
const waterGeo = new THREE.CircleGeometry(terrain.worldScale * 0.30, 96);
// A metallic, low-roughness material needs an environment map to reflect. With
// no envMap in the scene it renders near-black, which made the lake look like
// more grey rock. Keep metalness low and let the emissive carry the water read.
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x3f7f96,
  roughness: 0.22,
  metalness: 0.06,
  transparent: true,
  opacity: 0.92,
  emissive: 0x123844,
  emissiveIntensity: 0.85,
});
const water = new THREE.Mesh(waterGeo, waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = terrain.toWorldY(terrain.WATER_LEVEL);
scene.add(water);

// Thin ground-fog band at the foot of the rim. Sells scale and hides the seam
// where the terrain drops to the plain.
const fogBandMat = new THREE.MeshBasicMaterial({
  color: 0x9fb6c8,
  transparent: true,
  opacity: 0.075,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const fogBand = new THREE.Mesh(
  new THREE.CylinderGeometry(terrain.worldScale * 0.60, terrain.worldScale * 0.72, 0.30, 48, 1, true),
  fogBandMat
);
fogBand.position.y = terrain.toWorldY(0.30);
scene.add(fogBand);

/* --------------------------------------------------------------- treeline */
// Clustered, not uniform: a pure random scatter reads as a mathematical ring.
const CONIFERS = 2200;
const trunkGeo = new THREE.ConeGeometry(0.020, 0.082, 5);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x25301f, roughness: 0.95 });
const trees = new THREE.InstancedMesh(trunkGeo, trunkMat, CONIFERS);

const rand = mulberry32(terrain.seed);
const clumpNoise = makeNoise2D(terrain.seed + 5150);
const fbmClump = (x, y) => fbm(clumpNoise, x, y, { octaves: 3, gain: 0.55 });
let placed = 0;
let guard = 0;
const dummy = new THREE.Object3D();
while (placed < CONIFERS && guard < CONIFERS * 60) {
  guard++;
  // Bias samples into clumps so the treeline has clearings and thickets.
  const cu = rand() * 2 - 1;
  const cv = rand() * 2 - 1;
  const u = clamp(cu + (rand() - 0.5) * 0.16, -1, 1);
  const v = clamp(cv + (rand() - 0.5) * 0.16, -1, 1);
  const r = Math.hypot(u, v);
  if (r > 0.94) continue;
  // density mask: some bands stay bare
  if (fbmClump(u * 2.6, v * 2.6) < -0.05) continue;
  const h = terrain.heightAt(u, v);
  if (h <= terrain.WATER_LEVEL + 0.01 || h > 0.58) continue;
  if (terrain.slopeAt(u, v) > 0.30) continue;
  const s = 0.7 + rand() * 0.85;
  dummy.position.set(terrain.toWorldX(u), terrain.toWorldY(h), terrain.toWorldZ(v));
  dummy.scale.set(s, s * (0.8 + rand() * 0.7), s);
  dummy.rotation.y = rand() * Math.PI * 2;
  dummy.updateMatrix();
  trees.setMatrixAt(placed++, dummy.matrix);
}
trees.count = placed;
scene.add(trees);

/* ------------------------------------------------------------- camera rig */
const rig = {
  azimuth: 2.2,
  elevation: 0.86,   // steep enough to look *into* the basin, not at its wall
  radius: 4.3,
  target: new THREE.Vector3(0, terrain.toWorldY(0.30), 0),
  // desired values, eased toward each frame
  dAzimuth: 2.2,
  dElevation: 0.86,
  dRadius: 4.3,
  dTarget: new THREE.Vector3(0, terrain.toWorldY(0.30), 0),
};

function applyRig() {
  const ce = Math.cos(rig.elevation);
  camera.position.set(
    rig.target.x + Math.sin(rig.azimuth) * ce * rig.radius,
    rig.target.y + Math.sin(rig.elevation) * rig.radius,
    rig.target.z + Math.cos(rig.azimuth) * ce * rig.radius
  );
  camera.lookAt(rig.target);
}

/* -------------------------------------------------------------- interaction */
let dragging = false;
let lastX = 0;
let lastY = 0;
let hasInteracted = false;

const markInteracted = () => {
  if (!hasInteracted) {
    hasInteracted = true;
    document.getElementById('hint').classList.add('is-hidden');
  }
};

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  markInteracted();
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  rig.dAzimuth -= dx * 0.005;
  rig.dElevation = clamp(rig.dElevation + dy * 0.004, 0.03, 1.32);
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false;
  if (e && e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  rig.dRadius = clamp(rig.dRadius * (1 + Math.sign(e.deltaY) * 0.08), 0.85, 6.5);
  markInteracted();
}, { passive: false });

// Touch pinch
let pinchStart = 0;
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    pinchStart = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (pinchStart > 0) {
      rig.dRadius = clamp(rig.dRadius * (pinchStart / d), 0.85, 6.5);
    }
    pinchStart = d;
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { pinchStart = 0; }, { passive: true });

/* ------------------------------------------------------------------ labels */
const labelLayer = document.getElementById('labels');
const markerEls = terrain.landmarks.map((lm) => {
  const el = document.createElement('button');
  el.className = 'marker';
  el.type = 'button';
  el.textContent = lm.name;
  el.setAttribute('aria-label', `Fly to ${lm.name}`);
  el.addEventListener('click', () => flyTo(lm));
  labelLayer.appendChild(el);
  return el;
});

function flyTo(lm) {
  markInteracted();
  rig.dTarget.set(
    terrain.toWorldX(lm.x),
    terrain.toWorldY(lm.y) + 0.02,
    terrain.toWorldZ(lm.z)
  );
  rig.dRadius = 1.55;
  rig.dElevation = 0.46;
  rig.dAzimuth = lm.azimuth + 1.1;
}

const wpList = document.getElementById('wp-list');
terrain.landmarks.forEach((lm, idx) => {
  const li = document.createElement('li');
  li.tabIndex = 0;
  li.innerHTML = `<span class="n">${String(idx + 1).padStart(2, '0')}</span>
    <span><span class="name">${lm.name}</span><span class="note">${lm.note}</span></span>
    <span class="tag">${lm.surface}</span>`;
  li.addEventListener('click', () => flyTo(lm));
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flyTo(lm); }
  });
  wpList.appendChild(li);
});

/* -------------------------------------------------------------------- sun */
const sunSlider = document.getElementById('sun');
const sunOut = document.getElementById('sun-out');
function setSun(deg) {
  const rad = (deg * Math.PI) / 180;
  sun.position.set(Math.cos(rad) * 4.2, Math.sin(rad) * 4.2, 1.6);
  const low = clamp(1 - (deg - 8) / 42, 0, 1);          // 0 at noon, 1 at dawn
  sun.intensity = 1.15 + low * 0.85;
  sun.color.setHSL(0.095 - low * 0.045, 0.18 + low * 0.42, 0.66 - low * 0.10);
  sky.intensity = 0.52 + (1 - low) * 0.35;
  rim.intensity = 0.55 + low * 0.55;
  sunOut.textContent = `${Math.round(deg)}°`;
}
setSun(Number(sunSlider.value));
sunSlider.addEventListener('input', () => {
  setSun(Number(sunSlider.value));
  markInteracted();
});

/* ----------------------------------------------------------------- readings */
const rSurface = document.getElementById('r-surface');
const rAlt = document.getElementById('r-alt');
const rBearing = document.getElementById('r-bearing');
const rNearest = document.getElementById('r-nearest');

function nearestTo(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const lm of terrain.landmarks) {
    const d = Math.hypot(lm.x - x, lm.z - z);
    if (d < bestD) { bestD = d; best = lm; }
  }
  return best;
}

const SURFACE_LABEL = { water: 'water', snow: 'snow', rock: 'rock', scree: 'scree', ash: 'ash' };

/* ------------------------------------------------------------------- loop */
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clock = new THREE.Clock();
let frame = 0;
let fpsAcc = 0;
let fpsN = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  fpsAcc += dt; fpsN++;

  // ease the rig toward its target — frame-rate independent
  const k = 1 - Math.pow(0.0016, dt);
  rig.azimuth += (rig.dAzimuth - rig.azimuth) * k;
  rig.elevation += (rig.dElevation - rig.elevation) * k;
  rig.radius += (rig.dRadius - rig.radius) * k;
  rig.target.lerp(rig.dTarget, k);
  applyRig();

  // slow ambient drift when untouched
  if (!hasInteracted && !prefersReduced) {
    rig.dAzimuth += dt * 0.035;
  }

  // water shimmer: barely-there so it reads as liquid, not plastic
  if (!prefersReduced) {
    water.position.y = terrain.toWorldY(terrain.WATER_LEVEL) + Math.sin(clock.elapsedTime * 0.6) * 0.0012;
    waterMat.roughness = 0.14 + Math.sin(clock.elapsedTime * 0.35) * 0.03;
  }

  renderer.render(scene, camera);

  // HUD at ~6 Hz, not every frame
  if (frame % 10 === 0) {
    // where is the camera footprint on the terrain?
    const tx = rig.target.x / terrain.worldScale;
    const tz = rig.target.z / terrain.worldScale;
    const h = terrain.heightAt(clamp(tx, -1, 1), clamp(tz, -1, 1));
    rSurface.textContent = SURFACE_LABEL[terrain.surfaceAt(clamp(tx, -1, 1), clamp(tz, -1, 1))] || '—';
    rAlt.textContent = `${Math.round((rig.radius - 0.9) * 820)} m`;
    let bearing = ((rig.azimuth * 180) / Math.PI) % 360;
    if (bearing < 0) bearing += 360;
    rBearing.textContent = `${String(Math.round(bearing)).padStart(3, '0')}°`;
    const near = nearestTo(clamp(tx, -1, 1), clamp(tz, -1, 1));
    rNearest.textContent = near ? near.name.toLowerCase() : '—';

    // project markers, rejecting any that would collide with one already
    // placed — overlapping labels were unreadable at the default view
    const placed = [];
    terrain.landmarks.forEach((lm, idx) => {
      const v = new THREE.Vector3(
        terrain.toWorldX(lm.x),
        terrain.toWorldY(lm.y) + 0.03,
        terrain.toWorldZ(lm.z)
      );
      v.project(camera);
      const el = markerEls[idx];
      if (v.z > 1) { el.style.display = 'none'; return; }
      // hide the label the further the camera is from it
      const dist = Math.hypot(lm.x - tx, lm.z - tz);
      const px = (v.x * 0.5 + 0.5) * window.innerWidth;
      const py = (-v.y * 0.5 + 0.5) * window.innerHeight;
      const w = el.offsetWidth || 96;
      const collides = placed.some((p) => Math.abs(p.x - px) < w * 0.9 && Math.abs(p.y - py) < 26);
      if (collides && dist > 0.30) { el.style.display = 'none'; return; }
      placed.push({ x: px, y: py });
      el.style.display = '';
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      el.style.opacity = String(clamp(1.35 - dist, 0.45, 1));
    });
  }
  frame++;

  requestAnimationFrame(tick);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

applyRig();
renderer.render(scene, camera);
requestAnimationFrame(tick);

// expose a tiny surface for the smoke test / debugging
window.__aether = {
  terrain,
  treesPlaced: placed,
  vertexCount: N * N,
  triangleCount: indices.length / 3,
};
