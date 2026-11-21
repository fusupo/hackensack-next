---
name: hackensack-author
description: Write or change a Hackensack picture (a component spec, hackensack/4 JSON) for someone, checking and looking at it as you go. Use when asked to make, draw, design, build, change or fix a Hackensack picture, card, icon, pictogram or component, or a spec in a project's components/ folder, in this repository.
---

# Authoring a Hackensack picture

A Hackensack picture is a **spec**: a JSON file describing a tree of nodes whose params read data. You write it, check it with the engine, look at what it draws, and fix it until both are right. The person then opens it in the editor.

## Before you write

1. **Read the reference:** `docs/spec-reference.md`. It has the spec's rules, what each param kind accepts, and every node type with its params. Don't guess param names or node types; take them from it.
2. **Find the closest example** in `examples/` and read its `components/*.json`:
   - `examples/sun-card`: instances of one component;
   - `examples/raindrops`: a `grid`, one icon per amount;
   - `examples/weather-sky`: `remap`, `clamp` and `mix`;
   - `examples/pictograms`: path, polygon and polyline icons as components;
   - `examples/weather-card`: a whole picture from several inputs;
   - `examples/weather-vars`: a `vars` node naming a value once;
   - `examples/windmill`: animation, and labels on every node.
3. **Use Node 24:** run `. ~/.nvm/nvm.sh && nvm use` once in the shell before the commands below.

## Write

- Write into the project folder you were given: `components/<name>.json` for each definition, and `samples/<name>.data.json` with data for its inputs. Never write into `examples/`. With no folder given, use `projects/<project>/` (git-ignored; the editor lists it).
- Each new definition needs a fresh `id`: 8 lowercase hex characters, different from every other definition in the project. An instance's `ref` is that id, not the name.
- `nodes` is flat. Every id in `children` must exist, and every node has exactly one parent. Shapes take only animation nodes as children; group shapes with `g`.
- Give every node a `label` saying what it is in the picture (`"sky"`, `"left blade"`).
- Strings in `color` and `string` params are literal: write `"=expr"` to compute one. Use `count(l)`, not `size(l)`.
- Repeated or reusable shapes go in their own definition (a `g` root, inputs for what varies), used through instances.

## Check, look, fix

1. `npm run check -- <projectDir> <component> --sample`: it prints one line per problem (definition, node and its label, param, message) and nothing when the component is clean. Fix every problem and run it again until it prints nothing.
2. `npm run render -- <projectDir> <component> --sample --png <file.png> --out <file.svg>`: then look at the PNG (read the image file). Check that it shows what was asked: shapes where they should be, colours and sizes right. Try other data too: write a second data file and pass `--data <file>` instead of `--sample`, for example the lowest and highest values an input can take.
3. Repeat until `check` prints nothing and the picture is right. Write the PNG outside the project folder (a temporary folder) unless the person wants it.

## Hand over

Tell the person which files you wrote and what the inputs do, and that they can open the project in the editor with `npm run dev` (for a project outside `projects/`, start it with `HACKENSACK_PROJECTS=<the folder holding the project> npm run dev`).
