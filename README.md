# Hackensack

A node-based editor for **data-driven pictographic graphics**: illustrative pictures whose structure and look come from data, such as how many raindrops, where the sun sits or how grey the clouds are. These aren't charts with axes. Its relatives are Isotype pictograms and node tools like Blender's geometry nodes, not Vega.

You build a picture once, as a graph of nodes and reusable components. That graph is a **spec**, a small declarative JSON file. At runtime the spec is combined with **data** and drawn as SVG, in the editor, in Node, or in any web page through the embeddable player.

This is the successor to the 2015–2017 Hackensack prototypes. It is pre-1.0 (the latest tag is `v0.1.0`), so the spec format may still change.

## What a spec looks like

One raindrop for every 5 mm of rain, five to a row (`examples/raindrops`):

```json
{
  "format": "hackensack/4",
  "id": "19c0c748",
  "inputs": { "rain": { "type": "number" } },
  "root": "n0",
  "nodes": {
    "n0": { "type": "svg", "params": { "width": 140, "height": 80 }, "children": ["n1"] },
    "n1": { "type": "g", "params": { "transform": "translate(22, 22)" }, "children": ["n2"] },
    "n2": {
      "type": "grid",
      "params": { "count": "rain / 5", "columns": 5, "spacing": 24, "rowSpacing": 28 },
      "children": ["n3"]
    },
    "n3": { "type": "component", "ref": "a175ebf7" }
  }
}
```

With `{ "rain": 32 }` it draws six drops. Every node is a registry element (shapes, groups, paths, SMIL animation) or a structural node:
- `each` repeats its children over a list;
- `grid` repeats them over a count;
- `vars` names values for a subtree;
- `component` is an instance of another definition (the `raindrop` here, referred to by its id).

Param values that aren't literal are [math.js](https://mathjs.org) expressions, run in a sandbox, plus a few helpers (`remap`, `clamp`, `mix`). Problems are reported per node, and the rest of the picture still draws.

## Getting started

The project needs **Node 24**. `.nvmrc` pins it.

```sh
nvm use
npm ci
npm run dev        # the editor, at the URL Vite prints
```

The editor opens the example projects read-only. New projects are saved to `./projects/`, which git ignores; set `HACKENSACK_PROJECTS=/some/dir` to save them somewhere else. In the editor you can:
- wire nodes in the graph and edit their params in the inspector;
- see the picture update live as you change the sample data;
- enter a component's definition, and make components out of a subtree with Collapse to component;
- undo and redo any edit;
- export a bundle for the player.

## Commands

```sh
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright); run `npx playwright install chromium` once first
npm run typecheck    # tsc over every part of the repo
npm run lint         # oxlint
npm run build        # typecheck and a production build of the editor
npm run build:player # the embeddable player, into packages/player/dist/
npm run bundle -- examples/weather-card weather-card --sample   # a bundle for the player
```

Run them one at a time.

## Layout

| Path | What it is |
|---|---|
| `packages/engine` | `@hackensack/engine`: compiles specs and renders them with data. Pure TypeScript with no DOM, so it runs in Node too |
| `packages/player` | `@hackensack/player`: draws a bundle into a page with `mount()` or `<hackensack-picture>`; see its [README](packages/player/README.md) |
| `src/editor` | The editor (React and React Flow) |
| `server` | The dev-server plugin that reads and writes project files |
| `scripts` | `npm run bundle` |
| `examples` | Example projects, each with components, sample data and the SVG they're expected to draw (checked by the tests) |
| `e2e` | Browser tests |

## The examples

| Example | What it shows |
|---|---|
| `spinner` | `each` around a circle (ported from the 2015 engine) |
| `rain-bars` | One bar per value in a list |
| `sun-card` | Three instances of one `sun` component |
| `raindrops` | A `grid`: one drop per 5 mm of rain |
| `weather-sky` | The expression helpers: temperature to sun height, cloud cover to sky colour |
| `pictograms` | Path, polyline and polygon nodes, with icons as components |
| `weather-card` | All of the above in one picture driven by four inputs |
| `weather-vars` | The weather card with a value named once by a `vars` node |
| `windmill` | Animation: a rotor turned by the wind, falling rain, a pulsing sun |

## More

- [`PLAN.md`](PLAN.md): the goal, the design principles, every decision made so far, the spec format's rules, the milestones and the open questions.
- [`CLAUDE.md`](CLAUDE.md): a detailed map of the code, written for AI coding sessions, and useful to anyone working in it.
