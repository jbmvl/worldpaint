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

No build step, no browser required for the test suite: `node --test` against
plain ES modules. If you're touching anything visual, the only real
verification is running it inside a consuming application (there is no
standalone demo yet — see the README's Status section).

## Project structure

```
src/
  core/         geography and low-level primitives
  terrain/      the ground mesh: bubble, material, ground-class map, road cut
  layers/       everything built on top of the terrain (roads, bridges and
                tunnels, street kerbing, buildings, gardens, vegetation,
                crops, furniture, animals)
  models/       geometry catalogues, kept apart from the layers that place
                them: `kit.js` is the volume assembler, `animalKit.js` adds
                articulation, `fauna/` holds one file per family of animal
  materials/    procedural textures and shared materials
  environment/  sky, sun, shadows, fog
  inspect/      debug helpers for labelling what's on screen
  themes/       the art direction — see below
  worldComposer.js   orchestrates the layers in a fixed build order
  world.js           createWorld() and the five verbs
  index.js           the public surface
```

## Adding or changing a layer

A "layer" is a class in `src/layers/` that reads vector-tile features (and
sometimes the ground-class map or another layer's published index) and adds
meshes to the scene. Before adding one, read the build-order comment at the
top of `src/worldComposer.js` — it's the single place that says which layer
can depend on which, and why. If your layer needs something another layer
produces, that dependency has to be expressed there, not by importing across
layers or reaching into another layer's internals.

A layer that finds nothing to draw should draw nothing and return quietly —
never throw because its input is empty. A layer that *does* throw aborts the
whole `refresh()` for every layer that runs after it in the same call
(`worldComposer.js` wraps the sequence in one `try`/`catch`), which is a much
larger blast radius than the one layer that failed.

## Where theme changes go

Anything that decides what things *look like* — a colour, a palette, a
silhouette, a profile, a shape option — belongs in `src/themes/default.js`
as a slice of `defaultTheme`, not hardcoded in a layer. A layer reads its
slice as a parameter (or, inside a class, `this.theme.<slice>`) with
`defaultTheme.<slice>` as the default; it never imports `defaultTheme`
directly to read a colour it should have been handed.

Anything that decides *how* a landscape is composed — streaming ranges,
performance budgets, which tile plants what, how field edges are read out of
the ground-class map — is engine, not theme, and stays out of
`themes/default.js` even if it's tempting to make it configurable there.

## Architecture invariants

These are the rules that keep the codebase from turning into the "plat de
nouilles" the `worldComposer.js` header warns about. A PR that breaks one of
these needs a very good reason, stated in the PR description.

- **Deterministic spatial generation.** The same tile plants the same thing,
  every time. No `Math.random()` without a seed derived from position —
  a viewpoint that returns to a place must see the same world, not a
  reshuffled one.
- **No dependency on generation order beyond what `worldComposer.js`
  declares.** A layer reads what an earlier layer published (an index, a
  segment list); it never reaches back into another layer's live state or
  assumes something ran just because it usually does.
- **The road corridor is the one shared spatial boundary.** Anything decorative
  that could end up on a carriageway — hedges, fences, walls, gardens, crops,
  grass, scatter — asks `roadCorridor` (`inCorridor` for a point,
  `clipOutsideCorridor` for a polyline) rather than reading `roadSegments` or
  inventing its own margin. Roadside furniture that belongs at the kerb
  (guardrails, lamps, signs, traffic lights) deliberately does not: it is *meant*
  to stand inside the corridor of the road it serves. It still owes that road,
  and only that one — a lamp set 90 cm past its own kerb lands squarely on the
  crossing carriageway at a junction, or on the neighbour in a bundle. So kerb
  furniture (`atKerb`) asks `roadEdges.edgeClearance` with its own segment ignored, which
  answers for the whole paved surface, junction slabs included.
  `clipOutsideCorridor` **cuts**: it fits anything that genuinely has two ends
  once a road crosses it (a ditch, a vine row, a roadside hedge offset from its
  own carriageway). It is the wrong tool for a line that isn't attached to a
  road but happens to run alongside one — a parcel boundary traced from raw
  survey data, say — because a line that never truly leaves the corridor never
  gets a second endpoint to restart from, and disappears whole. For that shape,
  `pushOutsideCorridor` displaces every point clear of the nearest road instead
  of cutting, keeping the line one continuous run.
- **A junction is a graph node, not a picture.** `roadGraph` is the only place
  where a crossroads exists as such — a node where more than two edges meet
  **at the same level** (`layer`; two ways that cross in XY at different levels
  do not meet at all, and are not welded into a node). It publishes them
  (`mergeRoadLines` returns `{chains, junctions}`) and everything that needs
  one reads that list. Rediscovering junctions later, by looking for places
  where two ribbons overlap, invents different ones: they land somewhere else,
  and there is one per overlapping row instead of one per crossroads.

  A tile is not the survey, though: it simplifies geometry (the vertex at a
  crossroads is collinear with its neighbours, hence redundant, hence dropped)
  and quantises coordinates tile by tile. Two ways that share a node in the
  source data therefore reach the graph without a common vertex more often than
  not, and the junction is simply absent. `graftLooseNodes` repairs that on the
  graph, before anything reads it: a node that is not already a junction and
  that lands on another carriageway is brought onto it, and the host edge is
  cut underneath. Three guards keep it from inventing anything — the same level,
  no `brunnel`, and an angle: past 25° a way *meets* a carriageway, below it
  merely runs along or continues it (that second case is `joinLooseEnds`, the
  tile seam). A vertex in the middle of a chain moves at most by the weld
  tolerance; only a free end may travel the full reach.

  What a junction *looks like* is built from that node, in `roadJunctions.js`:
  its branches give a carriageway **outline** (corner arcs included), every
  branch's ribbon stops on it, and the outline is drawn as one surface. Two
  ribbons must never overlap to make a crossroads — that is a picture, and it
  cannot be made right by lifting one of them.

  That surface is **not horizontal**. It takes one height per mouth, read where
  each branch's ribbon stops, and every outline vertex knows which branches it
  hangs between (`outlineDeckAt`). A slab laid flat at the node's level left a
  step of tens of centimetres against each ribbon as soon as a crossroads sat on
  a slope — and the ground, cut to the ribbon's own platform, then ran over the
  slab on the uphill side. The terrain cut reads the slab too
  (`TerrainBubble.setRoadCut` takes the areas): a junction's carriageway bulges
  past the ribbons that feed it, so an excavation derived from ribbons alone
  leaves the ground standing in its corners.

- **A junction interrupts a ribbon, not a road.** Chains are not cut at
  junctions: the carriageway still crosses them in the data, so the corridor,
  the terrain cut, platform stitching, spaced furniture and kerbs all keep
  reading one whole road. Only the ribbon is laid in pieces — exactly the same
  figure as a tunnel (`roadWorks.drawableRuns`).
- **The carriageway has one edge, and everything that borders it reads that
  edge.** The paved surface is the union of the ribbons and the junction
  surfaces; its boundary is a single object (`layers/roadEdges.js`). A kerb run
  ends exactly where its ribbon ends (`junctionBoundaryAt`), a street corner is
  bordered from the piece of boundary the junction itself publishes
  (`area.edges`), and how much room is left beyond an edge is a **width**
  (`edgeClearance`), never a yes/no probe: a pavement narrows before it
  disappears. Deriving the edge again from a segment axis, or refusing a whole
  pavement because a probe touched some other road, is what put pavements
  across junctions and cut them a half-street short.
- **Two ways are near each other for three different reasons, and only one of
  them is a bundle.** They cross (the graph knows: a junction), one flies over
  the other (`layer` says so), or they *run alongside* — a cycleway beside a
  road, a service road, two separated carriageways. That third case is
  `layers/roadBundles.js`, and it is never `distance < X`: six conditions hold
  together (same level, edge-to-edge gap, parallel tangents, length of the
  proximity run, the same partner throughout, outside junctions and works).
  The void inside a bundle is **painted**, never closed: no carriageway is
  widened, moved or covered — the fill is a ruled surface tied to both edges at
  their own deck heights, hatched by alternating the quads themselves.
  And an area **enclosed** by carriageways is never filled and never claimed:
  a void whose two edges both curve toward it is an island (a roundabout
  centre), and an island stays terrain, with its trees.
- **Road markings are geometry, laid in the same pieces as the ribbon.**
  Nothing paints a line into a road texture. Longitudinal lines, give-way
  bars, crossings and bundle hatching are triangles laid over the drawable
  runs a carriageway already has (`roadWorks.drawableRuns`, then
  `roadJunctions.junctionRibbonRuns`), so they stop at a tunnel mouth and at a
  junction outline without a clipping rule of their own — see
  `layers/roadMarkings.js`. A dashed line's phase comes from the chain's
  curvilinear abscissa from its graph anchor, never from the loop index, so a
  chain cut elsewhere paints the same dashes in the same places. There is one
  white for all of it: `theme.roads.markingColor`.
- **Priority is decided at the junction, once, and read twice.** The data
  carries no priority, so `roadJunctions.branchYields` derives it from what the
  data does carry — the class, hence the width, of each branch: a branch yields
  when a strictly wider one meets it there, and two equal branches yield to
  nobody. The painted bar and the posted sign read that same function. Never
  place a sign because an intersection exists: a random draw between stop,
  give-way and roundabout is what this rule replaced.
- **A bridge is a state of the carriageway, not a class of road.** `brunnel`
  travels as a per-row flag alongside the path (`segment.works`, see
  `layers/roadWorks.js`), never as an extra road profile. That is what keeps a
  road one single chain across its bridge — so kerbing, spaced furniture and
  hedge sides don't restart at every abutment — while still letting the deck
  leave the ground. Anything that reads a platform height must go through
  `RoadIndex.deckAt`, which returns `null` on a works row: the terrain must not
  be carved down to a tunnel slab, and a road must not be stitched up to the
  viaduct that flies over it.
- **Layers don't mutate each other implicitly.** A layer publishes what it
  produces (on itself, or via an explicit return value) and nothing else
  writes into another layer's data uninvited.
- **Performance budgets are not theme parameters.** Frame budgets, streaming
  radii, segment counts by ring — these are frames per second, not taste.
  They live in the engine, not in `themes/default.js`.
- **Engine and application stay separate.** `src/` imports nothing from an
  application that embeds WorldPaint — no framework, no map library, no
  game-specific data. `three` is injected via `options.THREE`, never
  imported directly, so two copies of three in one page never collide.
- **Avoid unnecessary abstraction.** A new interface, base class, or plugin
  point needs at least two real call sites before it's worth adding. One
  concrete layer beats a generic system built for a second one that may
  never arrive.
- **Water is a ground material, not a surface.** There used to be a real water
  system — carved lake beds, chosen water levels, draped sheets. It never
  worked reliably, because the elevation data already gives a lake's surface
  as the ground height: two surfaces at the same altitude can only fight for
  the pixel. Water is now painted into the ground-class map like heath or
  scree, and shaded by the terrain material. Much lighter, and it cannot
  fail — at the cost of a flat-shaded look that a later pass may improve.

## Submitting a PR

- Keep it focused — one layer, one bug, one theme addition per PR is easier
  to review than a sweep across the codebase.
- Add or update a test in `test/` for anything behavioural. The suite is
  plain `node --test`; there's no framework to learn.
- Run `npm test` before opening the PR. All tests must pass.
- Describe *why*, not just *what*, especially if the change touches build
  order, determinism, or the theme/engine boundary — those are the things a
  reviewer can't infer from the diff alone.

## Good first issues

Based on what exists today, not on a wishlist:

- **Forest edges / clearings.** `layers/vegetationLayer.js` currently plants
  a stand type per ground-class cell with a hard boundary; a softer
  transition where a wood meets a field is a named, unimplemented gap (see
  the README's Philosophy / roadmap section).
- **A second theme.** `themes/default.js` is the only theme that exists. A
  second one (even a rough one — a different region, a stylised look)
  would be the fastest way to find places where the engine still assumes
  something about the default theme's shape.
- **Schema documentation for a theme slice.** Each slice in
  `themes/default.js` is documented in comments next to its own definition,
  but there's no single reference of "here is every slice and what each key
  means" for someone writing a theme from scratch.
