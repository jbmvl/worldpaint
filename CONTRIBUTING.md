# Contributing to WorldPaint

Thanks for looking at the code. This is a small, young project — the bar for
contributing is "does it work and does it fit", not process.

## Setup

```
git clone https://github.com/jbmvl/worldpaint.git
cd worldpaint
npm install
npm test
```

No build step, no browser needed for the test suite: `node --test` against plain
ES modules. `npm run demo` serves the standalone demo; anything visual is only
really verified by looking at it there, or in a consuming application.

## Project structure

```
src/
  core/         geography and low-level primitives (tiles, elevation, climate,
                the landscape profile of a place)
  terrain/      the ground mesh: bubble, material, ground-class map, road cut,
                and what a tile feature says about the ground
  layers/       everything built on the terrain — roads, bridges and tunnels,
                kerbing, buildings, gardens, vegetation, crops, animals, and
                furniture (whose families live in layers/furniture/)
  models/       geometry catalogues, apart from the layers that place them:
                kit.js assembles volumes, animalKit.js adds articulation,
                fauna/ holds one file per family of animal
  materials/    procedural textures and shared materials
  environment/  sky, sun, shadows, fog
  inspect/      debug helpers for labelling what's on screen
  themes/       the art direction — see below
  worldComposer.js   orchestrates the layers in a fixed build order
  world.js           createWorld() and the five verbs
  index.js           the public surface
```

`src/layers/CLAUDE.md` and `src/terrain/CLAUDE.md` map those two directories
file by file, and say what not to add to the big ones. `docs/` explains what
the landscape contains (`inventaire.md`), how the ground is read
(`surfaces.md`), and how a place decides its content (`climats.md`).

## Adding or changing a layer

A "layer" is a class in `src/layers/` that reads vector-tile features (and
sometimes the ground-class map or another layer's published index) and adds
meshes to the scene. Before adding one, read the build-order comment at the top
of `src/worldComposer.js` — the single place that says which layer may depend on
which. A dependency is expressed there, never by importing across layers or
reaching into another layer's internals.

A layer that finds nothing draws nothing and returns quietly. It must not throw:
`worldComposer.js` wraps the whole sequence in one `try`/`catch`, so one
exception cancels every layer that runs after it.

## Where theme changes go

Anything that decides what things *look like* — a colour, a palette, a
silhouette, a profile, a shape option — is a slice of `defaultTheme` in
`src/themes/default.js`, never hardcoded in a layer. A layer receives its slice
as a parameter (or reads `this.theme.<slice>`) with `defaultTheme.<slice>` as
the default; it never imports `defaultTheme` to fetch a colour it should have
been handed.

Anything that decides *how* a landscape is composed — streaming ranges,
performance budgets, which tile plants what, how field edges are read out of the
ground-class map — is engine, not theme, and stays out of `themes/default.js`.

## Architecture invariants

Breaking one of these needs a very good reason, stated in the PR description.

- **Deterministic spatial generation.** No `Math.random()`: every seed derives
  from a quantised ground position, never from traversal order or the viewpoint.

- **No dependency on generation order** beyond what `worldComposer.js` declares.
  A layer reads what an earlier layer published — an index, a segment list — and
  never reaches into another layer's live state.

- **The road corridor is the one shared spatial boundary.** Anything decorative
  that could land on a carriageway asks `roadCorridor` (`inCorridor`,
  `clipOutsideCorridor`) rather than reading `roadSegments` or inventing a
  margin. Kerb furniture (guardrails, lamps, signs, lights) deliberately stands
  inside the corridor of the road it serves — but only its own, which it checks
  with `roadEdges.edgeClearance`, its own segment ignored.

  `clipOutsideCorridor` **cuts**, which suits anything with two real ends. A
  line that merely runs alongside a road — a parcel boundary from survey data —
  never leaves the corridor, so cutting deletes it whole: use
  `pushOutsideCorridor`, which displaces each point clear and keeps one run.

- **A junction is a graph node, not a picture.** `roadGraph` is the only place a
  crossroads exists as such — a node where more than two edges meet **at the
  same level** — and `mergeRoadLines` publishes the list everything else reads.
  Never rediscover junctions from overlapping ribbons: that finds one per
  overlapping row, in the wrong place.

  Only paved ways count at a node a paved way reaches. A track or footpath
  never opens a mouth onto a road: it is laid over it, markings included
  (`roadNetwork.roadLiftFor`). Unpaved ways still meet each other where no
  paved way arrives.

  Tiles simplify and quantise, so two ways sharing a node in the source often
  arrive without a common vertex. `graftLooseNodes` repairs that on the graph,
  under three guards: same level, no `brunnel`, and an angle past 25° (below
  that a way continues rather than meets — `joinLooseEnds`, the tile seam).

  The picture is built from the node in `roadJunctions.js`: branches give an
  outline, ribbons stop on it, and it is drawn as one surface — **not
  horizontal**, one height per mouth (`outlineDeckAt`), or a crossroads on a
  slope steps against every ribbon. The terrain cut reads that slab too
  (`TerrainBubble.setRoadCut`).

- **A junction interrupts a ribbon, not a road.** Corridor, terrain cut,
  platform stitching, spaced furniture and kerbs keep reading one whole chain;
  only the ribbon is laid in pieces, like a tunnel (`roadWorks.drawableRuns`).

- **The carriageway has one edge**, and it is a single object
  (`layers/roadEdges.js`) covering ribbons and junction surfaces alike. A kerb
  run ends where its ribbon ends (`junctionBoundaryAt`), a street corner is
  bordered from `area.edges`, and room beyond an edge is a **width**
  (`edgeClearance`), never a yes/no probe — a pavement narrows before it stops.

- **Two ways are near each other for three reasons**, and only one is a bundle:
  they cross (the graph knows), one flies over the other (`layer`), or they run
  alongside (`layers/roadBundles.js`). The third is never `distance < X` but six
  conditions together. The void inside a bundle is **painted**, never closed: no
  carriageway is widened, moved or covered. An area enclosed by carriageways is
  an island, not a bundle — it stays terrain, with its trees.

- **Road markings are geometry**, never painted into a texture: triangles laid
  over `roadWorks.drawableRuns` and `roadJunctions.junctionRibbonRuns`, so they
  stop at a tunnel mouth and a junction outline with no clipping rule of their
  own (`layers/roadMarkings.js`). A dash phase comes from the curvilinear
  abscissa from the chain's graph anchor, never a loop index. One white for all
  of it: `theme.roads.markingColor`.

- **Priority is decided at the junction, once, and read twice.** The data
  carries none, so `roadJunctions.branchYields` derives it from each branch's
  class, hence width: a branch yields when a strictly wider one meets it. The
  painted bar and the posted sign read that same function — and a sign is never
  placed merely because an intersection exists.

- **A bridge is a state of the carriageway, not a class of road.** `brunnel`
  travels as a per-row flag (`segment.works`, `layers/roadWorks.js`), keeping a
  road one chain across its bridge while the deck leaves the ground. Platform
  heights go through `RoadIndex.deckAt`, which returns `null` on a works row:
  never carve the terrain down to a tunnel slab, nor stitch a road up to the
  viaduct flying over it.

- **Layers don't mutate each other implicitly.** A layer publishes what it
  produces; nothing writes into another layer's data uninvited.

- **Performance budgets are not theme parameters.** Frame budgets, streaming
  radii and segment counts are frames per second, not taste.

- **Engine and application stay separate.** `src/` imports nothing from an
  embedding application, and `three` is injected via `options.THREE` so two
  copies in one page never collide.

- **Avoid unnecessary abstraction.** A new interface, base class or plugin point
  needs two real call sites before it is worth adding.

- **Water is a ground material, not a surface.** Elevation data already gives a
  lake's surface as the ground height, so water is painted into the ground-class
  map like heath or scree. There is no water sheet, and no water level to pick.

## Submitting a PR

- Keep it focused — one layer, one bug, one theme addition.
- Add or update a test in `test/` for anything behavioural. Plain `node --test`,
  no framework to learn.
- Run `npm test` before opening the PR. All tests must pass.
- Describe *why*, not just *what*, especially for build order, determinism or
  the theme/engine boundary — what a reviewer can't infer from the diff.

## Good first issues

Based on what exists today, not on a wishlist:

- **Forest edges / clearings.** `layers/vegetationLayer.js` plants a stand type
  per ground-class cell with a hard boundary; a softer transition where a wood
  meets a field is a named, unimplemented gap.
- **A second theme.** `themes/default.js` is the only one. A second — even rough
  — is the fastest way to find where the engine still assumes its shape.
- **Schema documentation for a theme slice.** Each slice is documented next to
  its own definition, but there is no single reference of every slice and what
  each key means, for someone writing a theme from scratch.
