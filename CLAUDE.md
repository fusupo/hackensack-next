# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `PLAN.md` first.** It holds the goal, the lessons from the earlier Hackensack prototypes, the design principles, the decisions made so far, the milestones and the open questions. Keep it current: record decisions there as they're made and tick off milestones as they land.

Status: M0–M3 done (scaffold, engine, read-only editor, authoring). Next is M4, compound nodes in the editor.

## Commands

The project needs **Node 24** (Vite 8 and Vitest 5 need ≥ 22.12; the machine default is 22.11). `.nvmrc` pins it, so run `nvm use` in the repo first. In a non-interactive shell: `source ~/.nvm/nvm.sh && nvm use`.

```
npm run dev            # editor dev server (Vite); saves projects to ./projects
HACKENSACK_PROJECTS=/some/dir npm run dev   # save projects somewhere else
npm test               # Vitest, one worker, files run one after another
npx vitest run src/engine/index.test.ts   # a single test file
npx vitest run -t 'declares the spec'      # tests whose name matches
npm run typecheck      # tsc -b over all tsconfig projects
npm run lint           # oxlint
npm run format         # Prettier (code only; *.md is excluded on purpose)
npm run build          # typecheck + production build
```

Run these one at a time, never in parallel (see Constraints).

## Layout

- `src/engine/`: the engine. `compile(name, library)` → `program.render(data)` → `toSvgString(output)`; PLAN.md's *Engine design* and *Spec format v2* sections describe the rules. Pure TypeScript that must run in Node (principle 5). Two guard rails enforce this:
  - `tsconfig.engine.json` type-checks it without the DOM lib or ambient types, so `document`/`window` are compile errors.
  - `.oxlintrc.json` forbids imports of React, React Flow or `editor/` code from it.
- `server/`: the dev-server plugin the editor saves through. `projectStore.ts` does the file I/O (tested with temp folders); `plugin.ts` is a thin HTTP layer (`GET`/`PUT /__hackensack/projects/...`, writes need the `X-Hackensack: 1` header). `examples/` is read-only through it.
- `src/editor/`: the React + React Flow editor. It may import the engine, never the reverse.
  - `api.ts` loads the workspace from the plugin, falling back to `examples.ts` (bundled examples, read-only) when there's no dev server. `projects.ts` holds the project model and pure operations on it (unsaved-file tracking, duplicate, new component…).
  - `edit.ts`: pure spec edits (add/connect/disconnect/delete nodes, params, root, inputs). `scope.ts`: the static scope analysis behind the inspector's scope panel; keep it in step with the engine's rules in `src/engine/render.ts`.
  - `layout.ts` turns a spec into React Flow nodes/edges: root on the right, children to the left, each child's output plugged into a numbered slot on its parent. `BloqNode.tsx` renders a node card at exactly `nodeHeight()` so layout and rendering agree.
  - `App.tsx` owns the workspace state; every graph/inspector change goes through its `onEdit`, which freezes the auto layout before the first edit. It recompiles when the library changes and re-renders on every valid data edit. `PreviewPane` inserts the engine's SVG markup directly, which is safe because the engine only emits registry elements with escaped values.
  - Pure logic lives in `.ts` files with tests in `editor.test.ts` (Node environment, no DOM). The React components are checked in a browser, not by unit tests.
- `examples/<project>/`: example projects in the planned layout (`components/*.json`, `samples/*.data.json`) plus `expected/*.svg` golden outputs checked by `src/engine/examples.test.ts`. A golden mismatch means output changed: review it, then update with `npx vitest run -u`.
- Tests are `src/**/*.test.ts`, run in the Node environment and type-checked by `tsconfig.test.json` (Node types, no DOM).
- `tsconfig.json` only references the per-area projects: engine, app (editor, with DOM), test, and node (`vite.config.ts`).

## Reference implementation

`~/Dev/Hackensack` is the predecessor (2015–2017), used as reference only; don't copy its code or stack. Useful entry points:
- `git show 020a754:bloqsnet/bloqs/base.js` and `git show 020a754:bloqsnet/bloqsnet.js`: the 2015 engine, whose scoping and math.js semantics this project keeps.
- `bloqsnet/bloqs/*.js` at HEAD: the node vocabulary and SVG attribute groupings.
- `test_json/spinner.json` (written for `020a754`) and `test_json/rain_bars.json` (for HEAD): examples to port.
- Its `CLAUDE.md` documents the HEAD engine's known bugs.

## Constraints

- Run tests serially (no parallel workers), and never run several Node/build processes at once. This machine freezes otherwise.
- `react/preserve-manual-memoization` is off in `.oxlintrc.json` because the React Compiler isn't enabled; turn it back on if `react({ compiler: true })` is ever added.
