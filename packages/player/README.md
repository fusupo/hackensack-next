# @hackensack/player

Draws a Hackensack picture into any web page from a **bundle**: one JSON file
holding a component, every definition it uses and, optionally, default data.
Make a bundle with `npm run bundle -- <projectDir> <component> [--sample]`
or the editor's **Export for player** button.

Build the player with `npm run build:player`. It writes two files to
`packages/player/dist/`:

- `hackensack-player.js`: an ES module (`import { mount } from './hackensack-player.js'`);
- `hackensack-player.iife.js`: a classic script that sets `window.HackensackPlayer`.

Either one also defines the `<hackensack-picture>` element. Both include the
engine and all of math.js (about 670 kB minified, 190 kB gzipped).

## The element

```html
<script src="hackensack-player.iife.js"></script>

<hackensack-picture src="weather-card.bundle.json" data='{"precip": 80}'></hackensack-picture>

<hackensack-picture>
  <script type="application/json">{ "format": "hackensack/bundle/1", "root": "…", "components": { … } }</script>
  <script type="application/json" data-hackensack="data">{ "precip": 80 }</script>
</hackensack-picture>
```

- The bundle comes from `src` (fetched relative to the page; a `file://` page
  can't fetch, so serve it), or else from an inline JSON script.
- The data comes from the `data` attribute, or else from an inline JSON script
  marked `data-hackensack="data"`.
- Changing `src` or `data` redraws. The `data` property sets the attribute, and
  `errors` lists the problems of the last draw. Each draw fires a
  `hackensack-render` event.
- The picture is drawn in an open shadow root, so the page's CSS doesn't reach
  inside it; size the element itself.

## The JS API

```js
const picture = HackensackPlayer.mount(element, bundle, { precip: 80 })
picture.update({ precip: 20 }) // draws again
picture.errors                 // problems of the last draw
picture.destroy()              // empties the element
```

`bundle` is the parsed JSON. The bundle is compiled once, and each `update`
only renders. `createRenderer(bundle).render(data)` does the same without a
DOM and returns `{ markup, errors }`.

## Data

The data you give is laid over the bundle's default data **one input at a
time**: `{ precip: 80 }` changes `precip` and keeps every other default. An
input's value is replaced whole (a list or an object isn't merged into), and
each `update` starts again from the defaults rather than from the last call.

## Problems

Nothing throws. A bundle that can't be read, an expression that fails or data
that isn't JSON shows a small note in the picture's bottom-left corner (its
messages as plain text), and whatever is valid still draws.
