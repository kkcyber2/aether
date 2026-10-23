# Aether Basin

A real-time 3D caldera you can fly through. The terrain is generated from layered
value noise at load time — no model files, no image textures, no asset downloads.

**[Live demo](#) · [Report an issue](https://github.com/kkcyber2/aether/issues)**

---

## What it is

A browser-based survey of an imaginary volcanic basin. You orbit a ridge of rock
that rises a kilometre above a lake, land on six named waypoints, and move the sun
to change the light across the whole scene.

The point is that nothing here is a photograph. The wall is a heightfield, the
snowline is a slope test, and the treeline is 2,200 instanced cones placed by a
density mask. Everything you see is arithmetic.

## Running it

Requires Node 18+ (only for the local static server — the site itself has no
build step and no runtime dependencies).

```bash
npm start          # http://localhost:4173
```

Or serve the folder with anything:

```bash
python3 -m http.server 4173
```

Opening `index.html` directly with `file://` will not work — ES modules and WebGL
need a real origin.

## Tests

```bash
npm test           # node --test
```

20 tests over the pure terrain and noise modules. They run without a browser or a
WebGL context, which is the reason the terrain maths lives in its own file rather
than inside the render loop.

What they pin:

- determinism — the same seed always builds the same world
- no `NaN`/`Infinity` anywhere on the disc
- the rim rises above the basin floor and above the outer plain on every bearing
- a lake exists in the basin and the outer plain stays dry
- every landmark's reported height matches the heightfield at its own position
- normals are unit length and point upward; slope stays in `0..1`
- the world contains all four surface zones
- noise stays in range, is continuous, and `fbm` respects its bounds

## How it works

```
js/noise.js     value noise, fBm (with a ridged mode), PRNG, easing
js/terrain.js   the caldera: radial profile, heightfield, normals, surface zones
js/app.js       renderer, lighting, camera rig, instanced treeline, HUD wiring
```

**The caldera** is a radial profile: a narrow resurgent dome at the centre, a steep
wall from `r=0.22` to `r=0.36`, a rim crest, then an apron falling to a plain. A
breach is cut into the rim at one bearing so the basin has a visible outlet.

Ridged fractal noise is masked to the wall band, which keeps the outer plain calm
and stops the whole world looking uniformly crumpled. The basin floor is carved
explicitly below the lake level; without that step the water plane ends up buried
inside the terrain and the lake reads as more grey rock.

**Surface zones** are chosen per vertex from height and slope — snow on high,
shallow ground, bare rock on anything steep, scree between, ash on the floor. Each
vertex also samples two noise fields for tonal break-up, because flat vertex colour
reads as moulded plastic.

**Lighting** is a warm key, a cool hemisphere fill, a low bounce, and a rim light
from behind. The rim light is what makes the ridges legible; without it the mass
has no silhouette.

## Controls

| Input | Action |
|---|---|
| Drag | Orbit |
| Scroll / pinch | Climb and descend |
| Click a marker or a waypoint row | Fly to it |
| Sun slider | Move the sun from dawn to noon |

## Accessibility

- Markers are real `<button>` elements and the waypoint rows are focusable and
  respond to Enter/Space, so the whole scene is navigable by keyboard.
- `prefers-reduced-motion` disables the idle camera drift and the water shimmer.
- Every landmark label has an `aria-label`; the canvas carries a description.
- The survey notes are plain HTML, so the site still says something with JS off.

## Honest limits

- **Desktop-first.** It runs on mobile and the HUD reflows, but a 100k-triangle
  scene on a mid-range phone is not going to hold 60 fps.
- **No shadows.** There is no shadow map; depth comes from the rim light and the
  slope-driven darkening. Real shadow casting would roughly double the frame cost.
- **One terrain, one seed.** The seed is fixed at `20261`. Change it in
  `js/terrain.js` to get a different basin — the tests hold for any seed.
- **The lake is a flat disc.** It is placed at the waterline and clipped by the
  terrain, not simulated. There are no reflections beyond a specular highlight.

## Licence

MIT — see [LICENSE](LICENSE).

Built by **KK (Conan Sultan Khan)** · <kkdev9715@gmail.com>
[github.com/kkcyber2](https://github.com/kkcyber2) · LinkedIn: _add profile URL_
