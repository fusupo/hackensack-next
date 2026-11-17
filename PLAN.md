# hackensack-next: plan

Living document. Read this before starting work; update it when a decision is made or a milestone lands.

## Goal

A node-based authoring tool for **data-driven pictographic graphics**: playful, illustrative pictures whose structure and appearance are driven by data (how many raindrops, where the sun sits, how grey the clouds are), not charts with axes. You author a **spec** once as a graph of components. At runtime the spec is combined with **data** to produce the picture.

The original 2015 vision also had native iOS/Android interpreters for the spec. That part is dropped: a JS runtime (browser, webview, Node) is the distribution target now. The spec format should still stay portable and declarative so other runtimes remain possible.

Not the goal: competing with Vega/Vega-Lite on charts. Their grammar is built around scales, axes and marks. This tool is built around generating structure from data, closer in spirit to Isotype pictograms and node-based procedural tools (Houdini, Blender geometry nodes). Closest relative in the "author once, interpret at runtime with inputs" space is Rive, which is animation/state-machine oriented rather than structure-from-data.

## Background: what we learned from Hackensack

Reference repo: `~/Dev/Hackensack` (same author, 2015–2017; got running again Nov 2026 at commit `2870a77`). Its git history has two attempts:

1. **Jan–Jul 2015, first prototype; engine last seen at commit `020a754` (4 Jan 2016). This is the one that worked.**
   - Variable environments inherited down the tree: a node's env = parent's env + its own locals. Root `data` is visible everywhere; `svg_each` layers `<id>_d` / `<id>_idx` per item on top.
   - Expressions solved with **math.js** (`sin`, `cos`, `size`, `pi`, …), per node, per param.
   - DOM rendering; root renders all children.
   - Verified Nov 2026: `test_json/spinner.json` renders correctly in this engine. Changing the root data list from 3 to 6 items makes the spinner go from 3 spokes to 6. Run it with `git archive 020a754` plus the Bower deps from `~/Documents/darkstar_bak/Documents/Hackensack/bower_components`, with the webcomponents polyfill removed.
   - Problem: **speed.** Envs were cloned and pushed down eagerly on every change. `svg_each` re-solved and rebuilt its whole subtree per item, then `cloneNode`d it. Expressions were re-parsed on every evaluation, every edit re-rendered from the root, and there was heavy `console.log` in hot paths.

2. **Jan 2016, second attempt (`68b05f1` onward, now HEAD).** Rendering rewritten to build SVG *strings* and evaluate `{…}` expressions afterwards by regex over the rendered string, with partial evaluation (unresolved expressions kept in braces for an outer pass). Then minilisp replaced math.js, and webpack/React replaced plain scripts.
   - Broke scoping: inside `svg_each`, outer variables like `{cy}` come out as the literal text `cy`. Root only renders `children[0]`. minilisp has only `+ - * /` and lookup.
   - The underlying instinct (partially evaluate a template, finish it when data arrives) was sound. Doing it with regex over strings is what made it fragile.

Other lessons:
- About half the 2015 effort went into a hand-built node canvas (d3, then a custom SVG stage). Use a library.
- The old spec embedded data inside the root node (`data` param as a JSON string). There was no real boundary between spec and data, which is the boundary the whole idea depends on.
- Example specs drifted silently as the engine changed. Examples must be tests.

## Design principles

1. **Spec and data are separate.** A spec declares its inputs; data is supplied at render time. Sample data for authoring lives alongside the spec but is not part of it.
2. **Lexical scoping via linked frames, never copying.** Each scope is a small frame `{vars, parent}`; lookup walks up the chain. An `each` iteration is one tiny frame. Nothing is pushed down, so there is no propagation cost.
3. **Compile once, evaluate many times.** `compile(spec)` parses and compiles every expression once and returns a `render(data)` function. Editing a node recompiles only that node.
4. **The engine is pure.** No DOM, no editor imports. It produces a plain SVG tree that can be serialized to a string or applied to the DOM. It must run in Node for tests.
5. **Examples are tests.** Every example spec has a golden expected output and runs in CI. If the engine changes, examples either still pass or are migrated in the same change.
6. **Errors stay local.** A bad expression marks its node/param with an error and renders the rest; it never blanks the picture.
7. **Measure before optimizing further.** Principles 2 and 3 should make a few hundred elements trivially fast. Dependency tracking (signals) and in-place DOM patching only get built if measurements demand them.

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| Codebase | New repo; Hackensack is reference only | Valuable parts are ideas, not code; 2016 stack |
| Language / build | TypeScript, Vite | Standard, fast |
| Editor UI | React + React Flow (xyflow) | Canvas, drag, wire, zoom and minimap for free |
| Expressions | math.js, infix syntax | Proven in the 2015 engine; spinner already uses it; approachable |
| Scoping | 2015 semantics (inherit down the tree), implemented as linked frames | Correct and cheap |
| Tests | Vitest, **run serially** (no parallel workers) | Machine constraint in global CLAUDE.md |

Structure: single package to start, with `src/engine/` (pure, no DOM/React imports) and `src/editor/`. Extract the engine into its own package when a second consumer exists (e.g. an embeddable player).

## Spec format v2 (proposal; firm up in M1)

```json
{
  "format": "hackensack/2",
  "inputs": {
    "l":  { "type": "list", "of": "number" },
    "cy": { "type": "number" }
  },
  "root": "n0",
  "nodes": {
    "n0": { "type": "svg",  "params": { "width": "400", "height": "400" }, "children": ["n1"] },
    "n1": { "type": "g",    "params": { "transform": "translate(200, 200)" }, "children": ["n2"] },
    "n2": { "type": "each", "params": { "list": "l", "as": "d", "index": "i" }, "children": ["n3"] },
    "n3": { "type": "g",    "params": { "transform": "translate(sin(i / size(l) * 2 * pi) * 50, cos(i / size(l) * 2 * pi) * 50) rotate(360 - 360 / size(l) * i)" }, "children": ["n4", "n5", "n6"] },
    "n4": { "type": "circle", "params": { "r": "10", "fill": "'#fff'" } },
    "n5": { "type": "rect",   "params": { "x": "-10", "width": "20", "height": "cy", "fill": "'#fff'" } },
    "n6": { "type": "circle", "params": { "cy": "cy", "r": "10", "fill": "'#fff'" } }
  },
  "editor": { "n0": { "x": 180, "y": 170 } }
}
```

with sample data in a sibling file (`spinner.data.json`): `{ "l": [1, 2, 3], "cy": 25 }`.

Notes on the proposal:
- **Children are ordered arrays** on the parent. One parent per node, so the graph is a tree (as in Hackensack).
- **Editor layout lives in its own `editor` section**, so the engine can ignore it.
- **`each` names its bindings** (`as`, `index`, default `d` / `i`), replacing Hackensack's `<id>_d` / `<id>_idx`. Inner names shadow outer ones; nested `each` nodes pick distinct names.
- **Transform syntax is open.** It is shown above as a structured string with expressions inside function arguments. Alternatives: a list of `{op, args}` like Hackensack. Decide in M1.

## Engine design (M1)

- `compile(spec): Program`: validates structure and inputs, compiles each param expression with math.js `compile()`, and collects errors per node/param.
- `program.render(data): SvgNode`: walks the tree with a scope chain. The root frame holds `data`; `each` pushes one frame per item. Returns a plain tree `{tag, attrs, children}`.
- `toSvgString(tree)`: for tests, export and the embeddable player. DOM application comes later, and patching only if needed (principle 7).
- **Scope lookup:** math.js `evaluate(scope)` can take a Map-like scope object. Implement one whose `get`/`has` walk the frame chain. **Verify this** against the current math.js API before relying on it.
- **Node registry:** each node type declares its SVG tag, its params (name, kind: `number`/`length`/`color`/`string`/`enum`/`transform`, default, group) and its child cardinality. The editor's param inspector is generated from this. Hackensack's grouping by SVG spec section is worth keeping.
- **Units:** numbers are SVG user units by default; `%` and `px` are allowed as suffixes on lengths. This replaces Hackensack's `percpx` `{expr}px` wrapping.

## Milestones

- **M0: scaffold.** Vite + TS + React + React Flow + Vitest (serial), lint and format, `CLAUDE.md` with commands.
  - *Done when:* `npm run dev` shows an empty editor shell and `npm test` runs one passing test.
- **M1: engine.** Spec v2 types, `compile` and `render`, scope chain, node types `svg`, `g`, `rect`, `circle`, `ellipse`, `line`, `text`, `each`. Port `spinner` and `rain_bars` from Hackensack as golden tests.
  - *Done when:* both examples render to expected SVG in Node. The spinner shows 3 spokes for 3 items and 6 for 6. An outer variable used inside `each` resolves (the case Hackensack HEAD gets wrong). A bad expression reports an error without blanking the output.
- **M2: editor, read-only.** Load a spec and its sample data, show the graph in React Flow, live preview pane, data pane (JSON editor).
  - *Done when:* editing sample data updates the preview live.
- **M3: editor, authoring.** Palette, add, connect and delete nodes, param inspector generated from the registry, expression error display on nodes/params, save/load spec files.
  - *Done when:* the spinner can be rebuilt from scratch in the editor.
- **M4: pictographic primitives.** Reusable symbols/icons, grid repeat (Isotype-style "one icon per N units"), value-to-scale helpers. A weather-card example: temperature, precipitation chance, cloud cover and wind driving one picture.
  - *Done when:* the weather card is authored in the editor and responds to all four inputs.
- **Later:**
  - animation (Hackensack had `animate` / `animateTransform` nodes);
  - an embeddable player (`<script>` + spec + data → SVG);
  - partial evaluation for shipping templates;
  - dependency tracking, only if measured to be needed.

## Open questions

- **Expression vs literal:** should every param be an expression, with strings quoted (`"'#fff'"` above, which is ugly for colors)? Or should the param kind decide (color params literal unless prefixed with `=`)?
- **Transform representation:** see the spec format notes.
- **Where sample data lives:** a sibling `*.data.json` file, or a `samples` section in the spec file that the engine ignores?
- **Input types:** how rich? Enough for the editor to generate a data form, or just JSON for now?
- **Graph shape:** the node graph is a tree today. Are shared/reused subgraphs (symbols) a node type, or graph edges to a definition? (M4)
- **Project name.**
