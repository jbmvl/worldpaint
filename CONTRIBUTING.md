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
  layers/       everything built on top of the terrain (roads, water,
                buildings, vegetation, crops, furniture)
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
  (guardrails, lamps, signs, traffic lights) deliberately does not.
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
