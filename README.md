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
<<<<<<< HEAD
  layers/       everything built on top of the terrain — roads, water,
                buildings, vegetation, crops, road furniture, the road
                corridor every other layer stops at, and the geometry
                helpers they share
=======
  layers/       everything built on top of the terrain — roads, street
                kerbing, water, buildings, gardens, vegetation, crops, road
                furniture, and the geometry helpers they share
>>>>>>> claude/urban-street-logic-2r00se
  materials/    procedural textures and shared materials
  environment/  sky, sun, shadows, fog — the optional lighting rig
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
  const paint = world.updateSky({ camera, date: new Date(), lng: 2.3522, lat: 48.8566 });
  renderer.setClearColor(paint.clearColor, 1);
  renderer.render(scene, camera);
}
```

The application owns the renderer, the scene, the camera, the clock and the
position. The generator only dresses the point it is shown.

### The five verbs

| | |
|---|---|
| `setCenter(lng, lat)` | move the terrain bubble |
| `refresh(lng, lat, {force})` | rebuild everything that comes from vector data |
| `advance(delta, at)` | one frame of work: planting queues, grass, animation |
| `updateSky({camera, date, lng, lat})` | advance the hour; returns the night mix and the clear colour |
| `dispose()` | release everything that was allocated |

`updateSky` only exists if a sky was requested. Without one, the generator
poses no light: the application lights the scene as it sees fit.

`three` is a peer dependency and is **injected**, never imported: two copies
of three in one page share neither their constants nor their prototypes.

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

178 tests, plain `node --test`, no browser, no build.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
