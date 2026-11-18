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
2. **Everything is a component.** Every spec file is a component definition with declared inputs. Compound nodes (a sun, a cloud) and top-level pictures (a weather card) use the same mechanism. Rendering a picture with data means instantiating its outermost component with that data as inputs. See *Compound nodes*.
3. **Lexical scoping via linked frames, never copying.** Each scope is a small frame `{vars, parent}`; lookup walks up the chain. An `each` iteration is one tiny frame. Nothing is pushed down, so there is no propagation cost.
4. **Compile once, evaluate many times.** `compile(spec)` parses and compiles every expression once and returns a `render(data)` function. Editing a node recompiles only that node.
5. **The engine is pure.** No DOM, no editor imports. It produces a plain SVG tree that can be serialized to a string or applied to the DOM. It must run in Node for tests.
6. **Examples are tests.** Every example spec has a golden expected output and runs in CI. If the engine changes, examples either still pass or are migrated in the same change.
7. **Errors stay local.** A bad expression marks its node/param with an error and renders the rest; it never blanks the picture.
8. **Measure before optimizing further.** Principles 3 and 4 should make a few hundred elements trivially fast. Dependency tracking (signals) and in-place DOM patching only get built if measurements demand them.

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| Codebase | New repo; Hackensack is reference only | Valuable parts are ideas, not code; 2016 stack |
| Language / build | TypeScript, Vite | Standard, fast |
| Editor UI | React + React Flow (xyflow) | Canvas, drag, wire, zoom and minimap for free |
| Expressions | math.js, infix syntax | Proven in the 2015 engine; spinner already uses it; approachable |
| Graph model | Wires mean **nesting**: a node's output plugs into a parent's child slot, and the graph constructs a DOM tree. No value-carrying (dataflow) wires: values reach parameters only through scope | Matches Hackensack and the SVG output; keeps the engine a tree walk (decided 2026-11-17) |
| Scoping | 2015 semantics (inherit down the tree), implemented as linked frames | Correct and cheap |
| Node params as variables | Opt-in per node via `expose`; subtree only | Layout cases like "fill the parent's width" without flooding the scope panel (decided 2026-11-17) |
| Tests | Vitest, **run serially** (no parallel workers) | Machine constraint in global CLAUDE.md |
| Toolchain versions | Node 24 (pinned in `.nvmrc`), Vite 8, Vitest 5, TypeScript 7, React 19, React Flow 13 | Latest at M0; Vite 8 and Vitest 5 need Node ≥ 22.12 (decided 2026-11-17) |
| Lint / format | oxlint (Vite template default) + Prettier for code; Markdown excluded from Prettier | Prettier pads tables into very long lines (decided 2026-11-17) |
| Graph orientation | Root on the right; children to its left, each output plugged into an ordered child slot on the parent's left edge | Matches "wires mean nesting" and node-editor convention (Blender's output node is rightmost) (decided 2026-11-17, M2) |
| Project files | A Vite dev-server plugin (`server/`) reads and writes project folders. Two roots: `examples/` (read-only: they are golden-test fixtures) and `projects/` (yours; override with `HACKENSACK_PROJECTS`). `projects/` is git-ignored: what you save there is yours, not part of the repo. A stopgap until the editor can open and save a project anywhere (see Open questions). A production build has no server and falls back to the bundled examples, read-only | Works in any browser; edits only touch disk on Save (decided 2026-11-17, M3). Ignoring `projects/` keeps test saves out of `git status` and commits (decided 2026-11-18, M4, #5) |
| Editing model | The spec is the single source of truth; graph nodes/edges are derived from it each render. React Flow keeps only transient state (sizes, positions mid-drag). The first edit to a component saves the automatic layout as positions, so nothing jumps | Simple and predictable; positions are saved with the spec (decided 2026-11-17, M3) |
| Wiring rules | Dropping a child on an occupied slot inserts before it; every container shows one extra empty slot; a child that already has a parent is moved; the root can't be deleted or placed inside another node; connections that would break the tree are refused while dragging | (decided 2026-11-17, M3) |
| Graph layout | Positions from the spec's `editor` section when present, else an automatic tidy-tree layout (`src/editor/layout.ts`) | Example specs carry no positions yet (decided 2026-11-17, M2) |
| Entering a definition | Double-click an instance to edit its definition; a breadcrumb trail (`sun-card › sun`) leads back out. The trail remembers the instance entered through. The last crumb is what you edit; the first is what gets compiled and previewed, with its sample data, so an edit inside shows up in every instance at once. Inside a definition the preview pane offers In context / Isolated, remembered in browser storage and starting on In context. In context shows the first crumb's picture with what the entered instance drew highlighted (an accent glow) and the rest dimmed to 25%; every drawing of it counts (inside an `each` too), and if it draws nothing the pane says so and nothing is dimmed. Isolated shows the edited definition alone, with its own sample data (its input defaults, with a note, when it has no sample file), and the Sample data pane then edits that definition's sample. Picking a component from the menu starts a fresh trail | Makes "one edit, every instance updates" visible while you edit, and shows where the entered instance sits in the picture (decided 2026-11-17, M4, #1; highlight and isolated view added 2026-11-18, #4) |
| Problems inside an entered definition | Render problems are shown for the instance you entered through, with their path made relative to it; compile problems always show. The scope panel inside a definition uses that definition's own sample data | Exact and simple; scope values from the entered instance can come later (decided 2026-11-17, M4) |
| Use counts | A definition's count is the number of instance nodes that use it, across all the project's components, unsaved edits included. Direct uses only (a component used inside another one doesn't count again for the outer one's users). Instances with an empty or missing ref aren't counted and get no badge. The inspector's "Used in" list is plain text; jumping to a use may come later | Same idea as Blender's user count on node groups: an edit inside a definition should never surprise you (decided 2026-11-17, M4, #2) |
| Definition identity | Spec format v3: every definition has an `id` (8 random hex characters, made when it is created or duplicated), and an instance's `ref` holds that id, not the file name. The file name stays the human name. The engine resolves refs through `indexById`; an unknown id, an id claimed by two definitions, a definition without an id and a v2 spec are reported. The editor upgrades v2 files as it loads them (each file gets an id, its name refs become ids) and marks them unsaved; the repo's examples and `projects/sun-card-too` were migrated, goldens unchanged | Renaming a component can't break its instances, and no other file has to change (decided 2026-11-17, M4, #3; the "reference identity" open question) |
| Renaming, duplicating and deleting components | Pending until Save, like every other edit: a rename moves the file and its sample under the new name with the same id; a duplicate gets a new id and a copy of the sample; a delete removes the file and sample and leaves its instances pointing at an id nothing has ("missing component", rendering nothing). Old files are queued for deletion; Save writes every changed file first and deletes queued ones after, so an interrupted save can at worst leave a duplicate id, which is reported. The last component of a project can't be deleted | Disk never holds a half-renamed project (decided 2026-11-17, M4, #3) |
| Renaming and deleting projects | They act on disk at once, after a confirm: a rename moves the folder (unsaved edits and queued deletions carry over), a delete removes it. The file store only deletes a folder that holds nothing but `components/*.json` and `samples/*.data.json`, checked before anything is removed. Examples can't be renamed or deleted | A project is a folder; there is nothing to queue (decided 2026-11-17, M4, #3) |
| Browser tests | Playwright Test (`@playwright/test`, pinned exactly to 1.64.1, Chromium only) in `e2e/`, one worker, no retries, against a dev server of its own on a port chosen for each run, with a temporary projects folder. `setup` installs only the browser (`npx playwright install chromium`). The factory's `verify` runs Vitest, then Playwright even when Vitest failed, and fails if either did; both write JUnit into `$FACTORY_RESULTS_DIR`, and `test-results` names that folder. The single project sets `testDir: 'e2e'` with no top-level `testDir`, so selectors read `e2e/<file>.spec.ts::<title>` (or `::<Describe> › <title>`), and `browser-tests` is set | Editor behaviour becomes ordinary `test` evidence that runs on every attempt, instead of manual checks after the PR is open (decided 2026-11-18, #27; layout, per-run port and install settled in #29 to match #27's final text, which fusupo/escapement#104 quotes) |
| Engine purity enforcement | Separate `tsconfig.engine.json` without DOM lib + oxlint import bans on `src/engine/**` | Principle 5 checked by tools, not by convention (decided 2026-11-17) |

Structure: single package to start, with `src/engine/` (pure, no DOM/React imports) and `src/editor/`. Extract the engine into its own package when a second consumer exists (e.g. an embeddable player).

## Spec format v3 (v2 in M1; definition ids added in M4, #3)

Types: `src/engine/spec.ts`. Working examples: `examples/*/components/*.json`. The spinner as it is stored (`examples/spinner/components/spinner.json`):

```json
{
  "format": "hackensack/3",
  "id": "95ef367e",
  "inputs": {
    "l": { "type": "list" },
    "cy": { "type": "number" }
  },
  "root": "n0",
  "nodes": {
    "n0": { "type": "svg", "params": { "width": 400, "height": 400 }, "children": ["n1"] },
    "n1": { "type": "g", "params": { "transform": "translate(200, 200)" }, "children": ["n2"] },
    "n2": { "type": "each", "params": { "list": "l" }, "children": ["n3"] },
    "n3": { "type": "g", "params": { "transform": "translate(sin(i / count(l) * 2 * pi) * 50, cos(i / count(l) * 2 * pi) * 50) rotate(360 - 360 / count(l) * i)" }, "children": ["n4", "n5", "n6"] },
    "n4": { "type": "circle", "params": { "r": 10, "fill": "#ffffff" } },
    "n5": { "type": "rect", "params": { "x": -10, "width": 20, "height": "cy", "fill": "#ffffff" } },
    "n6": { "type": "circle", "params": { "cy": "cy", "r": 10, "fill": "#ffffff" } }
  }
}
```

Sample data lives in the project's `samples/` folder (`examples/spinner/samples/spinner.data.json`): `{ "l": [1, 2, 3], "cy": 25 }`.

Rules (decided 2026-11-17, M1; ids in M4):
- **Every definition has an `id`**, unique within its library, and instances refer to it by that id (see "Definition identity" above). Format `hackensack/2` had no ids and refs by file name; the editor upgrades it on load.
- **Children are ordered arrays** on the parent. One parent per node, so the graph is a tree (as in Hackensack). Nodes not reachable from `root` are reported.
- **Editor layout lives in an optional `editor` section**, so the engine can ignore it.
- **How a param value is read depends on its kind** (the node registry, `src/engine/nodes.ts`):
  - JSON numbers and booleans are always literal.
  - For number, length, transform and list params, a string is an expression.
  - For color and string params, a string is literal, so `"#ffffff"` just works.
  - A leading `=` makes any string an expression: `"fill": "=color"`.
- **Lengths** are expressions with an optional trailing `%` or `px` unit (`"100%"`, `"d * 4px"`). The unit is split off before evaluating, because math.js reads `50%` as `0.5`.
- **Transforms** are SVG transform syntax whose arguments are expressions: `"translate(sin(a) * 50, 0) rotate(45)"`. Parsed once at compile time. Allowed functions: translate, scale, rotate, skewX, skewY, matrix.
- **`each` names its bindings** (`as`, `index`, defaults `d` / `i`), replacing Hackensack's `<id>_d` / `<id>_idx`. Inner names shadow outer ones. `each` renders no element of its own: its children are repeated in place.
- **Component inputs** (`inputs`) declare `type` (number, string, boolean, list, object, any), optional `default` and optional `inherit: true`. Instance bindings for `string` inputs are literal like other string params; all other bindings are expressions. **A value of the wrong type is rejected** (decided 2026-11-17): it's reported and the input is left unset, the same as a missing input, with no fallback to the default. This applies whether the value came from top-level data, a binding or inheritance.
- **Numbers in output** are rounded to 6 decimals, and `-0` prints as `0`.
- **Expressions use `count(l)` for list length, not `size(l)`.** In current math.js, `size()` returns a one-element list, and functions like `sin` refuse lists. (The 2015 engine's old math.js allowed it.)
- **Expressions are sandboxed.** They can't assign variables, and math.js's `import`, `evaluate`, `parse`, `compile`, `createUnit`, `simplify`, `derivative` and `resolve` are disabled, since specs may be shared.

## Compound nodes (components)

Node graphs nest. A definition like a sun is authored once, saved to the project's component library, and used as a single node in other compositions, any number of times. This is the same model as Blender node groups, Houdini digital assets and Figma components.

**Project layout (proposal):**
```
my-project/
  components/        # the library: one definition per file
    sun.json
    cloud.json
    weather-card.json
  samples/           # sample inputs for authoring and previews
    weather-card.data.json
```

**Definition** = a spec file (format above): declared `inputs` (its interface) plus a node tree.

**Instance** = a node that references a definition by its `id` (here `sun`'s) and binds its inputs with expressions evaluated in the instance's own scope:
```json
"n7": { "type": "component", "ref": "8c4f9004", "params": { "radius": "d * 2", "rays": "8" } }
```

**Scoping within a graph:** lexical, following the 2015 semantics. A node sees the variables exposed by its ancestors on the path to the root (root inputs, `each` bindings, …), nearest first, with inner names shadowing outer ones. It sees nothing from siblings or descendants.

**Exposing parameters is opt-in (decided 2026-11-17).** A node's parameters are not variables by default; descendants can't read "my parent's `width`". A node can explicitly expose some of its evaluated parameters under a name, visible to its subtree only:
```json
"n0": { "type": "svg", "params": { "width": "400", "height": "400" }, "expose": { "cardW": "width", "cardH": "height" } }
```
Exposed names appear in the scope panel under that node, like any other frame. This keeps the panel limited to variables someone deliberately made available.

**Scoping across a component boundary (proposal, agreed in direction 2026-11-17):** components may reach into their surroundings, but **only for names they declare**. Each declared input has a mode:

| Mode | Example | Resolution at each instance |
|---|---|---|
| required | `rays` | Must be bound on the instance |
| default | `radius = 20` | Instance binding, else the default |
| inherited | `palette` | Instance binding, else looked up **by name in the instance's scope** (its chain to the root) |

Like CSS inherited properties (`color` inherits, `width` doesn't). Undeclared caller variables stay invisible inside the definition.

Why the limit: a definition is edited once but used in many surroundings. Without declarations, "what's in scope inside the sun?" has no single answer, the editor can't show a scope panel there, and renaming a variable in one picture could silently break a component used elsewhere. With declarations:
- Inside a definition, the scope panel shows exactly its inputs. Values come from sample inputs, or from the instance the user entered through.
- At each instance, the editor checks that inherited names are provided by the surroundings; if not, it shows a local error badge.
- UX: typing an undeclared name inside a definition that *is* in scope at the entered-from instance offers "inherit `palette` from surroundings?" and adds the declaration.

Instances can sit inside `each` and bind inputs to `d`, `i` and so on.

**Scope panel (editor):** selecting a node lists every variable in scope, grouped by where it comes from (root inputs, `each` n2, inherited inputs, …), nearest first, with shadowed names marked. Hackensack's Env pane (`js/views/env-view.js`, which walks the parent chain) is the precedent.

**Editing semantics:**
- Double-clicking an instance **enters its definition**; a breadcrumb trail (`weather-card › sun`) navigates back out. Edits change the definition, so **every instance updates**.
- The editor shows a **use count** on instances and definitions (Blender's user-count badge), so shared edits are never a surprise.
- Changing a definition's interface (removing or renaming an input) leaves instances with errors on the affected bindings, which stay local (principle 7). It doesn't break the render.
- **Make unique (later):** copy the definition to a new file (`sun-2.json`) and repoint the chosen instance(s), decoupling them from the shared definition. Blender's "make single user", Figma's "detach".
- **Collapse to component (later):** select nodes in a graph and turn them into a new definition plus one instance.

**Engine:** `compile` resolves `ref`s through a library loader, compiles each definition **once** and caches it, and rejects reference cycles (a sun containing a sun). An instance renders as `definition.render(boundInputs)`, with its output spliced into the caller's tree. This fits compile-once naturally.

## Engine design (built in M1)

Code: `src/engine/`. Public API in `index.ts`:

```ts
const program = compile('spinner', library)          // parse and compile every reachable definition once
const { output, errors } = program.render({ l: [1, 2, 3], cy: 25 })
toSvgString(output)                                   // pretty-printed SVG markup
```

- `compile(rootName, library)` takes definitions by name (a project's `components/*.json`). It resolves `ref`s by definition id (`indexById`), compiles each definition once, and rejects reference cycles (`component cycle: a → b → a`). It never throws for spec problems; they go in `program.errors`.
- `program.render(data)` evaluates only. It returns SVG nodes (`{tag, attrs, children}` or text) plus render-time errors. A render error carries a `path` of instance node ids, so an error inside a nested component can be traced to the instance that triggered it. Errors repeated by an `each` are reported once.
- **Scope:** `Frame` (`scope.ts`) is a linked frame that also implements the Map-like interface math.js accepts as a scope, so expressions read straight from the chain. Frames record their source (component inputs, `each`, `expose`) for the editor's scope panel. A component instance starts a new chain with no parent.
- **Missing or wrong-type inputs** are reported once where the instance is and left out of the frame, so only expressions that use them fail. The rest of the component still renders.
- **Errors stay local:** a failing expression omits just that attribute; an `each` whose list fails renders nothing; an instance whose `ref` matches no definition id renders nothing. The rest of the picture renders either way.
- **Tests:** `engine.test.ts` covers each rule; `examples.test.ts` renders every example against its golden SVG in `examples/*/expected/`. Update goldens deliberately with `npx vitest run -u` after reviewing the new output.

## Milestones

- **M0: scaffold.** ✅ Done 2026-11-17. Vite + TS + React + React Flow + Vitest (serial), lint and format, `CLAUDE.md` with commands.
  - *Done when:* `npm run dev` shows an empty editor shell and `npm test` runs one passing test.
- **M1: engine.** ✅ Done 2026-11-17. Spec v2 types, `compile` and `render`, scope chain, node types `svg`, `g`, `rect`, `circle`, `ellipse`, `line`, `text`, `each`, `component` (instances), a library loader and cycle detection. Port `spinner` and `rain_bars` from Hackensack as golden tests.
  - *Done when:* both examples render to expected SVG in Node. The spinner shows 3 spokes for 3 items and 6 for 6. An outer variable used inside `each` resolves (the case Hackensack HEAD gets wrong). A bad expression reports an error without blanking the output. A version of the spinner refactored to use a `spoke` component renders identically to the flat one. Inside a component, an undeclared caller variable is invisible, while an *inherited* input resolves from the instance's surroundings. When the surroundings don't provide an inherited input, that instance reports a local error.
- **M2: editor, read-only.** ✅ Done 2026-11-17. Load a spec and its sample data, show the graph in React Flow, live preview pane, data pane (JSON editor).
  - *Done when:* editing sample data updates the preview live.
- **M3: editor, authoring.** ✅ Done 2026-11-17. Palette, add, connect and delete nodes, param inspector generated from the registry, **scope panel** for the selected node, expression error display on nodes/params, save/load spec files.
  - *Done when:* the spinner can be rebuilt from scratch in the editor.
  - Also in M3 (moved up from M4, because the spinner needs `l` and `cy`): editing a component's inputs, and the project's other components in the palette as instances.
  - Verified by driving the UI in a browser: new project, inputs declared, six nodes added and configured, six wires dragged, saved; the saved file renders byte-for-byte the same as `examples/spinner/expected/spinner-3.svg`.
- **M4: compound nodes in the editor.**
  - ✅ Double-click to enter a definition, breadcrumbs to exit (#1). The `sun-card` example is the acceptance case: three suns at different sizes, and a test that one edit to `sun` changes all three.
  - Save the current graph as a component.
  - ✅ Rename, duplicate and delete components and projects (#3). Definitions got stable ids (spec format v3), so a rename touches only the renamed file; component changes wait for Save, project renames and deletes act on disk.
  - ✅ Preview inside a definition (#4). The preview pane offers In context (the picture you came from, with what the entered instance drew highlighted and the rest dimmed) or Isolated (the definition alone with its own sample data, which the Sample data pane then edits).
  - ✅ Use-count badges (#2). Every instance node shows how many instances its definition has across the project ("used 3×"); the Component menu, the palette and the breadcrumb hint show the same count, and the inspector lists where a definition is used. `src/editor/usage.ts` works it out from the in-memory library.
  - *Done when:* a `sun` component is built, used three times at different sizes in another composition, and one edit inside it updates all three.
- **M5: pictographic primitives.** Grid repeat (Isotype-style "one icon per N units"), value-to-scale helpers, and an icon/path node. A weather-card example: temperature, precipitation chance, cloud cover and wind driving one picture, built from `sun`, `cloud` and `raindrop` components.
  - *Done when:* the weather card is authored in the editor and responds to all four inputs.
- **Later:**
  - "make unique" and "collapse to component";
  - undo/redo, editing `expose` in the inspector (M3 gaps; `expose` works if written in the JSON);
  - offering to remove or repoint the instances of a deleted component (for now they stay, as "missing component");
  - in-app dialogs instead of the browser's prompt() for names;
  - animation (Hackensack had `animate` / `animateTransform` nodes);
  - an embeddable player (`<script>` + spec + data → SVG);
  - partial evaluation for shipping templates;
  - dependency tracking, only if measured to be needed.

## Open questions

- **Input types:** how rich? Enough for the editor to generate a data form, or just JSON for now?
- **Component children / slots:** can an instance take child nodes (e.g. a `card-frame` component that wraps whatever is plugged into it)? Proposed: not in M1, but keep the format open to it.
- **Preview while inside a definition:** decided in M4 (#1, then #4): the preview shows the picture you entered from with the entered instance highlighted, or, by choice, the definition on its own. See "Entering a definition" under Decisions made. The engine marks what each instance drew with `render(data, { trackOrigins: true })`.
- **Reference identity:** decided in M4 (#3): definitions have stable ids and refs hold them (spec format v3). See "Definition identity" under Decisions made.
- **Where projects live:** for now the editor saves under one folder, `./projects` by default (git-ignored, #5). Long term it should open and save a project anywhere on the file system, like any other app. Wait until the project and component format settles.
- **Sharing a library across projects:** each project has its own `components/` for now. Is a shared or global library wanted later?
- **Named derived values:** should there be a `vars`/`let` node that exposes computed names to its subtree (e.g. `rainRatio = rain / max(rain)`), so expressions further down stay short? It would show up in the scope panel like any other source. Or generalize `expose` to accept arbitrary expressions on any node, which would make a separate `vars` node unnecessary.
- **Per-instance overrides:** beyond input bindings, can one instance tweak something inside its definition without making it unique? Proposed: no, inputs are the only way in. Keeps the model simple.
- **Project name.**
