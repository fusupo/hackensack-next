// The embeddable player (#16): draws a Hackensack bundle into any page.
//
//   import { mount } from '@hackensack/player'
//   const picture = mount(element, bundle, { precip: 40 })
//   picture.update({ precip: 80 })
//
// Loading it also defines <hackensack-picture>. Built into one ES module and
// one IIFE file (window.HackensackPlayer) by `npm run build:player`.

import { defineElement } from './element.ts'

export { createRenderer, describeProblem } from './core.ts'
export type { Problem, Rendered, Renderer } from './core.ts'
export { mount } from './mount.ts'
export type { MountTarget, PlayerHandle } from './mount.ts'
export { defineElement, HackensackPicture } from './element.ts'
export { BUNDLE_FORMAT } from '@hackensack/engine'
export type { Bundle } from '@hackensack/engine'

defineElement()
