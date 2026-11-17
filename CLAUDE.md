# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `PLAN.md` first.** It holds the goal, the lessons from the earlier Hackensack prototypes, the design principles, the decisions made so far, the milestones and the open questions. Keep it current: record decisions there as they're made and tick off milestones as they land.

Status: pre-M0, so there is no code yet. Build/test commands go here once M0 scaffolds the project.

## Reference implementation

`~/Dev/Hackensack` is the predecessor (2015–2017), used as reference only; don't copy its code or stack. Useful entry points:
- `git show 020a754:bloqsnet/bloqs/base.js` and `git show 020a754:bloqsnet/bloqsnet.js`: the 2015 engine, whose scoping and math.js semantics this project keeps.
- `bloqsnet/bloqs/*.js` at HEAD: the node vocabulary and SVG attribute groupings.
- `test_json/spinner.json` (written for `020a754`) and `test_json/rain_bars.json` (for HEAD): examples to port.
- Its `CLAUDE.md` documents the HEAD engine's known bugs.

## Constraints

- Run tests serially (no parallel workers), and never run several Node/build processes at once. This machine freezes otherwise.
