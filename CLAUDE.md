# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `PLAN.md` first.** It holds the goal, the lessons from the earlier Hackensack prototypes, the design principles, the decisions made so far, the milestones and the open questions. Keep it current: record decisions there as they're made and tick off milestones as they land.

Status: M0 (scaffold) done. Next is M1, the engine.

## Commands

The project needs **Node 24** (Vite 8 and Vitest 5 need ≥ 22.12; the machine default is 22.11). `.nvmrc` pins it, so run `nvm use` in the repo first. In a non-interactive shell: `source ~/.nvm/nvm.sh && nvm use`.

```
npm run dev            # editor dev server (Vite)
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

- `src/engine/`: the engine. Pure TypeScript that must run in Node (PLAN.md principle 5). Two guard rails enforce this:
  - `tsconfig.engine.json` type-checks it without the DOM lib or ambient types, so `document`/`window` are compile errors.
  - `.oxlintrc.json` forbids imports of React, React Flow or `editor/` code from it.
- `src/editor/`: the React + React Flow editor. It may import the engine, never the reverse.
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
