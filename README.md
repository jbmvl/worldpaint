# worldpaint

**Stylised 3D landscapes, generated in real time from real geographic data.**

**[Live demo →](https://jbmvl.github.io/worldpaint/demo/)**

## What is WorldPaint?

WorldPaint turns real geographic data — terrain, roads, land use, buildings
and vegetation — into stylized, believable 3D landscapes in real time.

It is built primarily for a viewpoint that moves along a road, not for a
free-roaming terrain generator: it streams the world around a point, keeps a
short lead so what's coming into view is always ready, and pays its
performance budget where a road-level camera actually looks.

Give it a longitude and a latitude and a three.js scene. It reads public
elevation tiles and OpenStreetMap vector tiles, and builds the ground, the
roads, the water, the buildings, the woods, the crops, the road furniture and
the sky around that point — procedurally, with no downloaded assets, no baked
meshes and no build step.

Philosophy, in short:

- **real geographic data**, not purely procedural noise — the shape of the
  land, the road network and the land use come from the real place;
- **believable, not photorealistic** — a landscape that reads as plausible at
  a glance, the way a landscape painting does, not a render that survives a
  close-up;
- **landscape composition, not uniform scattering** — villages, fields and
  woods follow the geography instead of being sprinkled at random;
- **masses → groups → objects → details** — the great shapes are decided
  first, individual objects last;
- **deterministic spatial generation** — the same tile always plants the same
  thing, so nothing pops or reshuffles as the viewpoint returns to a place;
- **real-time streaming around a moving viewpoint** — the world is built
  incrementally around wherever the application currently points it, not
  baked once for a fixed extent.

**Status: experimental, early stage.** This code has been running inside a
single application for a while and is now being lifted out into its own
project. The public API (`createWorld`) is recent and will keep moving before
1.0. Read [Status](#status) below before depending on it.

## Installation

```
git clone https://github.com/jbmvl/worldpaint.git
cd worldpaint
npm install
npm test
```

```
npm run demo
```

opens a standalone demo (plain three.js, no framework) at
<http://localhost:4173/demo/> — free-fly keyboard navigation, click to
teleport, an "show object names" checkbox and a place search field. The same
demo is also hosted at <https://jbmvl.github.io/worldpaint/demo/>, no install
needed. See [`demo/README.md`](./demo/README.md) for details. Short of that,
the other way to see WorldPaint running is through an application that
consumes it, such as the `createWorld` example below.

## Architecture

```
src/
  core/         geography and low-level primitives — lng/lat ↔ tile/metre
                conversion, elevation field, vector-tile fetching, colour
  terrain/      the ground mesh: the terrain bubble, its material, the
                ground-class map, cutting roads into it
  layers/       everything built on top of the terrain — roads, bridges and
                tunnels, street kerbing, buildings, gardens, vegetation,
                crops, road furniture, the road corridor every other layer
                stops at, and the geometry helpers they share
  materials/    procedural textures and shared materials
  environment/  sky, sun, shadows, fog, weather — the optional lighting rig
  inspect/      debug helpers for labelling what's on screen
  themes/       the art direction: palettes, silhouettes, profiles — the one
                file a fork changes to look different
  worldComposer.js   orchestrates the layers in a fixed build order
  world.js           the public entry point: createWorld() and its five verbs
  index.js           the public surface — what an application may import
```

The engine (composition rules, performance budgets, build order) and the art
direction (`themes/default.js`) are deliberately separate — see
[Art direction](#art-direction) below.

## Usage

```js
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createWorld } from 'worldpaint';

const scene = new THREE.Scene();

const world = createWorld({
  THREE,
  scene,
  // Vector tiles are optional: without them you get bare relief.
  vector: { tiles: ['https://…/{z}/{x}/{y}.pbf'], maxZoom: 14 },
  // The sky is optional too: without it, you light the scene yourself.
  sky: { Sky },
});

await world.setCenter(2.3522, 48.8566);
await world.refresh(2.3522, 48.8566, { force: true });

function frame(delta, camera) {
  const at = { x: camera.position.x, y: 0, z: camera.position.z };
  world.advance(delta, at);
  const paint = world.updateSky({
    camera,
    date: new Date(),
    lng: 2.3522,
    lat: 48.8566,
    // Optional. Omitted, the last one is carried over; never set, it is an
    // ordinary sky — exactly the render you get without ever mentioning weather.
    weather: { cloudCover: 0.9, cloudDensity: 0.85, precipitation: 0.5, wind: 0.4 },
  });
  renderer.setClearColor(paint.clearColor, 1);
  renderer.render(scene, camera);
}
```

The application owns the renderer, the scene, the camera, the clock and the
position. The generator only dresses the point it is shown — including tone
mapping: the light rig intentionally goes above 1 (a night that reads as
truly black is illegible), and `NoToneMapping` — three's default — clips
that to flat white instead of rolling it off. Set
`renderer.toneMapping = THREE.ACESFilmicToneMapping` (or whatever curve the
application already uses) rather than leaving it at the default.

### The five verbs

| | |
|---|---|
| `setCenter(lng, lat)` | move the terrain bubble |
| `refresh(lng, lat, {force})` | rebuild everything that comes from vector data |
| `advance(delta, at)` | one frame of work: planting queues, grass, animation |
| `tunnelAt(x, z)` | road floor and vault crown at a scene point, or `null` outside any covered structure — what a chase camera needs to stay under the roof |
| `setSightline(from, to, {fromRadius, toRadius})` | dither away the trees between the camera and the followed subject; call every frame, `null` turns it off |
| `updateSky({camera, date, lng, lat, weather})` | advance the hour and the weather; returns the night mix, the wetness and the clear colour |
| `dispose()` | release everything that was allocated |

`updateSky` only exists if a sky was requested. Without one, the generator
poses no light: the application lights the scene as it sees fit.

### Showing the sky while the landscape builds

The sky is ready as soon as `createWorld` returns; the landscape takes a few
seconds of tiles. The dome also sits on `SKY_LAYER`, so a camera restricted to
it sees the sky alone — never the terrain appearing piece by piece:

```js
camera.layers.set(SKY_LAYER);      // while setCenter/refresh run
// … render frames with updateSky …
camera.layers.set(0);              // landscape ready
```

When the vector source is not known yet, mount without `vector` and plug it
in later with `world.setVector({ tiles, maxZoom })`, then `refresh(…, { force: true })`.

### Triggering an animal crossing

Everything above is a function of place: the same data renders the same
landscape. One verb is not, and it is deliberately apart:

```js
world.crossFauna({
  kind: 'deer',                                   // any of FAUNA_KINDS
  at: { x: camera.position.x, z: camera.position.z },
  forward: { x: dir.x, z: dir.z },                // where the camera looks, flat
  distanceM: 55,                                  // how far ahead it cuts across
  side: 1,                                        // which side it comes from (1 or -1)
});
```

An animal walks out of one side of the view, **runs** across the observer's
path, and stops on the other side. It is an event, not scenery: the
application picks the species and the moment, the animal is not placed in the
world, and coming back later will not find it. Use it for the random events of
a game — something crossing the road in front of you.

Deer, goats and foxes bound; everything else trots. That is decided per species
(`FAUNA_SPECIES[kind].bound`) and blended in with speed, so a walking deer
still moves diagonally.

### Reading the road, not just the ground

```js
world.roadPositionAt(lng, lat, heightAboveGround, { aheadLng, aheadLat });
```

`world.bubble.toScenePosition(lng, lat, heightAboveGround)` always answers on
the terrain — the natural ground, cut where a road is carved into it. That is
wrong for an embankment or a bridge: the road there sits above the terrain it
crosses, not at its height. `roadPositionAt` answers the same question but on
the road's own platform when one passes through the point, falling back to
`toScenePosition` off-road. `heightAboveGround` keeps the same meaning either
way. The rendered paved surface adds the technical offset `ROAD_LIFT_M`
(2 cm) above that platform. To place an object exactly on the asphalt, add
this exported constant to its height instead of hardcoding an offset.

At a grade-separated crossing two roads can cover the same point in plan —
the one the caller means, and the one it passes over or under. `aheadLng`/
`aheadLat`, a point a few metres ahead along the direction of travel, breaks
the tie in favour of whichever road's own direction matches; without them the
nearest one wins.

```js
world.roadsideAt(lng, lat, { side, offset, heightAboveGround, aheadLng, aheadLat });
```

`roadsideAt` answers the question of an object placed *beside* the road — a
sign, a banner, a spectator: the point on the edge of the nearest rendered
road, `offset` metres beyond it, in scene units. `side` is `1` for the right of
the direction of travel given by `aheadLng`/`aheadLat`, `-1` for the left, and
`0` (default) for whichever side the queried point lies on. The result carries
the road's `tangent` (along travel) and `normal` (from the road towards the
point) so the object can face the road; its height is the road platform while
the point still falls on it (embankment, bridge), the terrain otherwise. It
returns `null` when no road is within `radius`.

```js
world.roadLaneAt(lng, lat, { aheadLng, aheadLat });
```

`roadLaneAt` answers the question of a mobile riding *on* the road: the cross
section of the nearest rendered road, as painted. `usable` is the rideable
half-width (to the inner edge of the edge line, or the carriageway edge);
`carriagewayWidth` excludes the shoulder; `divided` is true when the centre
line is marked, and `laneWidth` is then one half of the carriageway —
otherwise (one-way, or no centre line) the whole of it. `own` and `opposite`
are lateral ranges `{ inner, outer }` measured from the queried point, positive
to the right of travel: the mobile's own lane, and the oncoming one when
nothing forbids it (two-way without centre line), `null` otherwise. `oneway` is
`1` along travel, `-1` against it, `0` two-way or unknown; `offsetM` is the
queried point's offset from the rendered axis; `distance` its distance to it.
It returns `null` when no road is within `radius`.

### Weather

Weather is **state, not art direction**: it changes as you go, so it travels
with the hour through `updateSky` rather than living in the theme. Cloud cover
and density, precipitation (rain or snow) and its intensity, wind and haze each
drive the whole rig at once — the sun dims and loses its warmth under cloud,
shadows fade out rather than snapping off, fog thickens and greys, foliage
sways harder and faster, roads and ground darken when wet, and rain or snow
falls in a box that follows the viewpoint. See `src/environment/weather.js` for
what each coefficient does and why.

The engine never *fetches* the weather: `src/` makes no network request and
knows no service. Where the state comes from — a real forecast, a simulation, a
player setting — is the application's business. The demo drives it from
sliders; a real application might use a free, keyless source such as
Open-Meteo.

The default (`DEFAULT_WEATHER`) is an ordinary sky, and every modulation is
written to be the identity on it: an application that never mentions weather
sees exactly the landscape it saw before the feature existed.

`three` is a peer dependency and is **injected**, never imported: two copies
of three in one page share neither their constants nor their prototypes.

### A fixed, close-up scene (`reach`)

For a start line, a finish, or the replay of an event, nothing needs to be built
beyond a few dozen metres. `reach` caps every layer's radius (it never extends
one) and loads only the vector tiles that touch the disc. `mountAt` centres the bubble and builds everything in one call; there
is no re-centring afterwards, since nothing follows the viewer.

```js
const world = createWorld({ THREE, scene, reach: 120, sky: { Sky } });
world.setVector({ tiles, maxZoom: 14 });
await world.mountAt(lng, lat);
```

Without `reach`, behaviour is unchanged. With it, the terrain keeps only the
bubble tiles that touch the reach, and is carved for roads only inside it; the
ground map is read back only around it, and water is laid only inside that same
square; trees are sown only within it. The
terrain is meshed once, after the roads have carved it, and the returned promise
resolves on a complete scene: tiles meshed, trees sown. `mountAt(lng, lat,
{ budgetMs })` yields to the browser every `budgetMs` (100 ms by default;
`Infinity` never yields). Grass and crops are still scattered around the camera
each frame. The fog keeps the bubble's radius: pass `sky.fogRadius` to draw it
in and hide what lies beyond the reach.

On a recorded place (`demo/lab/mount.html`), a 120 m scene takes about half a
second from `createWorld` to the first frame in headless Chrome, against four
seconds for the full bubble. Shader compilation, on the first render, is a large
share of that: an application that knows it will mount a scene can warm it with
`renderer.compileAsync`.

### A lighter scene for modest devices (`detail`)

A phone pays for the decor twice: building it on a slow CPU, then drawing it.
`detail` lightens a moving scene without fixing it in place:

```js
const world = createWorld({
  THREE, scene, sky: { Sky, fogRadius: 720 },
  detail: { radius: 400, density: 0.4 },
  view: { segmentsByRing: [96, 48, 24] },
});
```

`radius` caps every layer's radius, like `reach`, but the terrain, the vector
tiles and the ground map keep the whole bubble, so the scene still follows the
viewer and the landscape beyond stays coloured. Trees are not capped. `density`
(0..1) thins grass and crops. Draw the fog in to hide the edge of the detail.

On `demo/lab/mount.html` (`await mountLab.run({ reach: null, lieu: 'angers',
detail: { radius: 400, density: 0.4 }, view: { segmentsByRing: [96, 48, 24] } })`),
a town centre builds about three to four times faster than the full bubble,
with about a third of its triangles.

### Art direction

Everything that decides what things *look* like — palettes, tree
silhouettes, stand types, crop looks, road profiles, furniture colours —
lives in one file, `src/themes/default.js`, exported as `defaultTheme`. The
rest of `src/` decides *how* a landscape is composed: where a tree goes, how
a road cuts into terrain, when a tile is replanted.

Pass your own slices to change the look. Slices replace wholesale — no deep
merge, so what you read is what you get:

```js
import { createWorld, defaultTheme } from 'worldpaint';

createWorld({
  THREE,
  scene,
  theme: {
    towns: [{ name: 'adobe', walls: ['#d9c3a5'], roofs: ['#9c6b4a'], roofShapes: ['flat'] }],
    windows: { ...defaultTheme.windows, litShare: 0.6 },
  },
});
```

The resolved theme is frozen and handed down to the layers, which each keep
it on their own instance. Nothing holds it globally, so two worlds with
different themes can live side by side on one page.

Performance budgets and streaming ranges are deliberately **not** in the
theme: they are frames per second, not taste. Neither are composition
rules — the village-palette lattice, the forest-stand lattice, reading field
edges out of the ground-class map. Those are the engine, and they stay open.

The shipped theme is not a neutral sample. It is a European, broadly French
countryside seen from a road, and that is on purpose — an engine that cannot
paint anything convinces nobody.

## Data sources

- **Elevation**: [Mapzen Terrarium tiles hosted by AWS Open
  Data](https://registry.opendata.aws/terrain-tiles/) — free, no key.
- **Vector tiles**: OpenMapTiles-schema tiles, which the application
  supplies — any provider, or your own.
- **Natural regions**: a table of landscape profiles, **embedded** in the
  package — no request, no key, no failure mode. A place resolves to the region
  whose anchor is nearest, and that region decides which trees, village
  palettes, crops, livestock and haze belong there. See `src/core/regions.js`
  for the records, `src/core/regionInterpretation.js` for the closed vocabulary,
  and `docs/regions.md` for how to write a region. Outside any covered region
  the scenery **switches off** — nothing is fetched, nothing is placed, you see
  the sky and nothing below it. That is deliberate: scenery drawn from the
  default lists looks like scenery, so nobody notices it is wrong. Forcing a
  region (`world.setRegion`) turns it back on anywhere.

## What the scenery is made of

`docs/inventaire.md` is the inventory: for every object in the scene — surface,
tree, building, road fitting, animal, landmark — it says whether it is **read**
from the tiles, **inferred** from what was read, or **invented** under stated
conditions, with the actual thresholds and regional tables. `docs/surfaces.md`
covers the ground in detail, `docs/regions.md` the natural regions.

Attribution for whatever you display is your responsibility;
`world.attribution` gives the string for the defaults. WorldPaint expects
the OpenMapTiles schema specifically — a different vector-tile schema will
need its own mapping in `layers/`.

## Status

- WorldPaint is currently used in [Dot Racing](https://github.com/jbmvl/1230-bornes)
  as its first, and so far only, real-world consumer.
- The public API (`createWorld` and the five verbs) is recent and may still
  change before a 1.0.
- A standalone demo exists — hosted at
  <https://jbmvl.github.io/worldpaint/demo/>, or `npm run demo` locally (see
  `demo/README.md`) — free-fly keyboard navigation, click-to-teleport, an
  object-name overlay and a place search. It is a thin application, not a
  reference UI.
- There is no published npm package yet.

## Philosophy / roadmap

The immediate goal is improving the landscape's perceptual credibility —
still within the composition philosophy above, not by adding realism for its
own sake. Areas identified but not yet built:

- spatial grouping refinements between existing masses (villages, fields,
  woods);
- forest structure — stands that read as a forest rather than a scatter of
  trees;
- edges and clearings where a wood meets a field, instead of a hard cut;
- secondary/undergrowth vegetation.

None of the above is implemented today — this section is a direction, not a
feature list.

## Tests

```
npm test
```

722 tests, plain `node --test`, no browser, no build.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).

Les mesures CPU par couche et le banc de terrain sont décrits dans
[docs/performance.md](./docs/performance.md).
