# CLAUDE.md


This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `PLAN.md` first.** It holds the goal, the lessons from the earlier Hackensack prototypes, the design principles, the decisions made so far, the milestones and the open questions. Keep it current: record decisions there as they're made and tick off milestones as they land.

Status: M0–M3 done (scaffold, engine, read-only editor, authoring). M4, compound nodes in the editor, is in progress: entering a definition and breadcrumbs (#1), use counts (#2), renaming, duplicating and deleting components and projects with stable definition ids (#3), and the preview inside a definition, highlighted in context or isolated (#4), are done. Browser tests (Playwright) run in the factory's `verify` alongside Vitest (#27). M5, pictographic primitives, has started: the `grid` repeat node (#6), the expression helpers `remap`, `clamp` and `mix` (#7), and the path, polygon and polyline nodes (#8) are done.

## Commands

The project needs **Node 24** (Vite 8 and Vitest 5 need ≥ 22.12; the machine default is 22.11). `.nvmrc` pins it, so run `nvm use` in the repo first. In a non-interactive shell: `source ~/.nvm/nvm.sh && nvm use`.

```
npm run dev            # editor dev server (Vite); saves projects to ./projects (git-ignored)
HACKENSACK_PROJECTS=/some/dir npm run dev   # save projects somewhere else
npm test               # Vitest, one worker, files run one after another
npx vitest run src/engine/index.test.ts   # a single test file
npx vitest run -t 'declares the spec'      # tests whose name matches
npx playwright install chromium   # once per Playwright version; the factory's `setup` runs the same
npm run test:e2e       # browser tests (Playwright), one worker, no retries
npx playwright test e2e/components.spec.ts   # a single browser test file
npm run typecheck      # tsc -b over all tsconfig projects
npm run lint           # oxlint
npm run format         # Prettier (code only; *.md is excluded on purpose)
npm run build          # typecheck + production build
```

Run these one at a time, never in parallel (see Constraints).

## Layout

- `src/engine/`: the engine. `compile(name, library)` → `program.render(data)` → `toSvgString(output)`; `render(data, { trackOrigins: true })` also tags each element drawn inside an instance with `origin`, the path of instance ids that drew it (never serialized); PLAN.md's *Engine design* and *Spec format v3* sections describe the rules. Definitions carry an `id` and instances' `ref`s hold it, resolved with `indexById` (`spec.ts`), never by file name. Node types live in the registry (`nodes.ts`); the structural ones, `each`, `grid` and `component`, draw no element of their own, though a `grid` wraps each cell in a `<g transform>`. `expr.ts` holds the math.js sandbox and the `remap`, `clamp` and `mix` helpers, which check their own arguments; import new helpers there before `import` is disabled. `pathdata.ts` holds the `{expr}` hole scanner behind a path's `d` and the `points` reader for `polygon` and `polyline` (a list of pairs, or a literal point string with holes). Pure TypeScript that must run in Node (principle 5). Two guard rails enforce this:
  - `tsconfig.engine.json` type-checks it without the DOM lib or ambient types, so `document`/`window` are compile errors.
  - `.oxlintrc.json` forbids imports of React, React Flow or `editor/` code from it.
- `server/`: the dev-server plugin the editor saves through. `projectStore.ts` does the file I/O (tested with temp folders); `plugin.ts` is a thin HTTP layer (`GET`/`PUT`/`DELETE /__hackensack/projects/<root>/<project>/<kind>/<name>`, `POST .../<project>/rename`, `DELETE .../<project>`; every change needs the `X-Hackensack: 1` header). Deleting a project only removes a folder that holds nothing but component and sample files, checked before anything is removed. `examples/` is read-only through it.
- `src/editor/`: the React + React Flow editor. It may import the engine, never the reverse.
  - `api.ts` loads the workspace from the plugin, falling back to `examples.ts` (bundled examples, read-only) when there's no dev server. `projects.ts` holds the project model and pure operations on it: unsaved files plus a queue of files to delete on save (`removed`, never overlapping `unsaved`; `pendingCount` counts both), new/rename/duplicate/delete component, rename/duplicate project. `upgrade.ts` upgrades v2 files to v3 on load and `ids.ts` makes definition ids. `commit.ts`'s `commitProject` saves: every write first, then the deletions.
  - `edit.ts`: pure spec edits (add/connect/disconnect/delete nodes, params, root, inputs). `scope.ts`: the static scope analysis behind the inspector's scope panel; keep it in step with the engine's rules in `src/engine/render.ts` (`each` and `grid` frames, and the grid's rule for its variable names in `compile.ts`).
  - `layout.ts` turns a spec into React Flow nodes/edges: root on the right, children to the left, each child's output plugged into a numbered slot on its parent. `BloqNode.tsx` renders a node card at exactly `nodeHeight()` so layout and rendering agree.
  - `trail.ts`: the breadcrumb trail of entered component definitions (`Breadcrumbs.tsx` draws it). The last crumb is the component being edited; the first is the one compiled and previewed. `diagnostics.ts`'s `problemsAt` rebases render problems onto the entered instance. `settleTrail` falls back to the default component when the open one is deleted.
  - `highlight.ts`: `markEntered` flags what the entered instance chain drew (`data-entered`) and dims the rest (`data-dimmed`), on the topmost element only, for the in-context preview. Inside a definition the preview pane's In context / Isolated choice (remembered in `localStorage`) switches to the definition rendered alone with its own sample, and the Sample data pane follows it.
  - `usage.ts`: where each definition is used, and `namesById`/`definitionName`, which every view uses to show an instance's definition by name (refs are ids).
  - `App.tsx` owns the workspace state; every graph/inspector change goes through its `onEdit`, which freezes the auto layout before the first edit. It recompiles when the library changes and re-renders on every valid data edit. `PreviewPane` inserts the engine's SVG markup directly, which is safe because the engine only emits registry elements with escaped values.
  - Pure logic lives in `.ts` files with tests in `editor.test.ts` (Node environment, no DOM). The React components are checked in a browser, not by unit tests.
- `examples/<project>/`: example projects in the planned layout (`components/*.json`, `samples/*.data.json`) plus `expected/*.svg` golden outputs checked by `src/engine/examples.test.ts`. `raindrops` shows the `grid` node (one drop per 5 mm of rain); `e2e/grid.spec.ts` copies it into its seeded project. `weather-sky` shows the expression helpers (temperature to sun height, cloud cover to sky colour); `e2e/weather-sky.spec.ts` copies it the same way. `pictograms` shows the path, polyline and polygon nodes, with `cloud` and `drop` icons as components; `e2e/paths.spec.ts` copies it the same way. A golden mismatch means output changed: review it, then update with `npx vitest run -u`.
- Tests are `src/**/*.test.ts`, run in the Node environment and type-checked by `tsconfig.test.json` (Node types, no DOM).
- `e2e/`: browser tests (Playwright Test, `@playwright/test` pinned to 1.64.1), type-checked by `tsconfig.e2e.json`. `playwright.config.ts` starts its own dev server on `127.0.0.1`, on a free port the OS picks for each run (`HACKENSACK_E2E_PORT` picks one instead), with `--strictPort` and never reusing a running one, and with `HACKENSACK_PROJECTS` set to a fresh temporary folder, removed when the run exits, so they never touch `projects/`. The config runs in Playwright's main process and again in each worker, so whatever a run chooses (the port, the folder) is chosen once and handed down through `process.env` with `??=`. `fixtures.ts` seeds each test its own copy of `examples/sun-card` (components and samples only, which a project delete requires) and answers the editor's `prompt`/`confirm` dialogs; find the Project and Component menus by role (`projectMenu`, `componentMenu`), not by label. The single project sets `testDir: 'e2e'` and there is no top-level `testDir`, so the config's `rootDir` is the repo root and Playwright's JUnit names files `e2e/<file>.spec.ts`, as contract selectors do: `e2e/<file>.spec.ts::<title>` for a top-level test, `e2e/<file>.spec.ts::<Describe> › <title>` for one inside `test.describe` (as in `harness.spec.ts`). Give tests distinctive titles. With `FACTORY_RESULTS_DIR` set, results also go to `$FACTORY_RESULTS_DIR/playwright.xml`. The browser for a run is installed by the factory's `setup` setting, which runs `npx playwright install chromium` and nothing else (no `npm ci`); a developer runs the same once per Playwright version. `check-port-refused.mjs` shows a server already on the port is refused rather than tested.
- `tsconfig.json` only references the per-area projects: engine, app (editor, with DOM), test, node (`vite.config.ts`), and e2e (browser tests).

## Reference implementation

`~/Dev/Hackensack` is the predecessor (2015–2017), used as reference only; don't copy its code or stack. Useful entry points:
- `git show 020a754:bloqsnet/bloqs/base.js` and `git show 020a754:bloqsnet/bloqsnet.js`: the 2015 engine, whose scoping and math.js semantics this project keeps.
- `bloqsnet/bloqs/*.js` at HEAD: the node vocabulary and SVG attribute groupings.
- `test_json/spinner.json` (written for `020a754`) and `test_json/rain_bars.json` (for HEAD): examples to port.
- Its `CLAUDE.md` documents the HEAD engine's known bugs.

## Constraints

- Run tests serially (no parallel workers), and never run several Node/build processes at once. This machine freezes otherwise.
- `react/preserve-manual-memoization` is off in `.oxlintrc.json` because the React Compiler isn't enabled; turn it back on if `react({ compiler: true })` is ever added.

## Escapement Settings

- **context-path**: ../hackensack-next-ctx
- **base-branch**: main
- **static**: . ~/.nvm/nvm.sh && nvm use >/dev/null && npx tsc -b
- **setup**: . ~/.nvm/nvm.sh && nvm use >/dev/null && npx playwright install chromium
- **verify**: . ~/.nvm/nvm.sh && nvm use >/dev/null && { npx vitest run --reporter=default --reporter=junit --outputFile.junit="$FACTORY_RESULTS_DIR/junit.xml"; v=$?; npx playwright test; p=$?; [ "$v" -eq 0 ] && [ "$p" -eq 0 ]; }
- **test-results**: junit:$FACTORY_RESULTS_DIR
- **test-files**: src/**/*.test.ts, server/**/*.test.ts, e2e/**
- **browser-tests**: playwright
- **validation-files**: package.json, package-lock.json, vite.config.ts, playwright.config.ts, tsconfig.json, tsconfig.app.json, tsconfig.engine.json, tsconfig.node.json, tsconfig.test.json, tsconfig.e2e.json, .nvmrc, CLAUDE.md

## Project Context

@../hackensack-next-ctx/PROJECT_LORE.md
