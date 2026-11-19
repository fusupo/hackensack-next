// The embeddable player (#16) in a real page: the built files, mount(),
// update(), the problem note and <hackensack-picture>.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type * as Player from '../packages/player/src/index.ts'
import type { PlayerHandle } from '../packages/player/src/index.ts'
import {
  builtPlayer,
  chipsBundle,
  ES_FILE,
  exampleBundle,
  IIFE_FILE,
  iifePage,
  inlineJson,
  servePage,
} from './playerPages.ts'

declare global {
  interface Window {
    HackensackPlayer: typeof Player
    bundles: Record<string, unknown>
    handle: PlayerHandle
    esPlayer: typeof Player
  }
}

// The first test that needs the player builds it (math.js included).
test.beforeAll(async () => {
  test.setTimeout(120_000)
  await builtPlayer()
})

const sunCard = () => exampleBundle('sun-card', 'sun-card', { sample: true })
const SUN_FILL = '#f5b942'

/** A page with an empty #pic and the given bundles as window.bundles. */
async function mountPage(page: Page, bundles: Record<string, unknown>) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await servePage(
    page,
    iifePage('<div id="pic"></div>', `window.bundles = ${inlineJson(bundles)}`),
  )
  return errors
}

const pic = (page: Page) => page.locator('#pic')
const note = (page: Page) => page.locator('#pic [data-hackensack-problems]')

test('the player builds into one ES module and one IIFE file with nothing left to import', async () => {
  const dir = await builtPlayer()
  expect(readdirSync(dir).sort()).toEqual([ES_FILE, IIFE_FILE].sort())
  for (const file of [ES_FILE, IIFE_FILE]) {
    const text = readFileSync(join(dir, file), 'utf8')
    // No import statements of any kind (math.js's own `math.import(` calls
    // and its docs strings mentioning import are not imports).
    expect(text, file).not.toMatch(
      /^\s*(import|export)\b[^;:(]*\bfrom\s*['"][^'"]+['"]/m,
    )
    expect(text, file).not.toMatch(/^\s*import\s*['"]/m)
    expect(text, file).not.toMatch(/(^|[^.\w$'"`])import\s*\(/m)
    expect(text, file).not.toMatch(/\brequire\s*\(/)
    // No UI code came along.
    expect(text, file).not.toMatch(/@xyflow|react-dom/)
    // A sanity bound, not a size goal (all of math.js is inside).
    expect(statSync(join(dir, file)).size, file).toBeLessThan(3_000_000)
  }
  // The ES file exports the API; the IIFE file assigns a global.
  expect(readFileSync(join(dir, ES_FILE), 'utf8')).toMatch(
    /export\s*\{[^}]*\bmount\b/,
  )
  expect(readFileSync(join(dir, IIFE_FILE), 'utf8')).toMatch(
    /^var HackensackPlayer\s*=/,
  )
})

test('one script tag for the IIFE build gives window.HackensackPlayer and the element', async ({
  page,
}) => {
  const errors = await mountPage(page, {})
  const api = await page.evaluate(() => ({
    keys: Object.keys(window.HackensackPlayer).sort(),
    element:
      customElements.get('hackensack-picture') ===
      window.HackensackPlayer.HackensackPicture,
  }))
  expect(api.keys).toEqual(
    expect.arrayContaining([
      'mount',
      'createRenderer',
      'HackensackPicture',
      'BUNDLE_FORMAT',
    ]),
  )
  expect(api.element).toBe(true)
  expect(errors).toEqual([])
})

test('a module script for the ES build exports mount and defines the element', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await servePage(
    page,
    `<!doctype html><html><body><div id="pic"></div>
<script type="module">
  import * as player from './${ES_FILE}'
  window.esPlayer = player
  player.mount(document.getElementById('pic'), ${inlineJson(sunCard())})
</script></body></html>`,
  )
  await expect(pic(page).locator('circle')).toHaveCount(3)
  const api = await page.evaluate(() => ({
    mount: typeof window.esPlayer.mount,
    element:
      customElements.get('hackensack-picture') ===
      window.esPlayer.HackensackPicture,
  }))
  expect(api).toEqual({ mount: 'function', element: true })
  expect(errors).toEqual([])
})

test("mount draws the bundle's picture with its default data into an element", async ({
  page,
}) => {
  const errors = await mountPage(page, { sun: sunCard() })
  await page.evaluate(() => {
    const el = document.getElementById('pic')!
    el.textContent = 'old content'
    window.handle = window.HackensackPlayer.mount(el, window.bundles.sun)
  })
  await expect(pic(page)).not.toContainText('old content')
  await expect(pic(page).locator('svg')).toHaveCount(1)
  // Three suns, each a circle in the colour of the bundle's sample.
  const circles = pic(page).locator('circle')
  await expect(circles).toHaveCount(3)
  for (const circle of await circles.all()) {
    await expect(circle).toHaveAttribute('fill', SUN_FILL)
  }
  await expect(note(page)).toBeHidden()
  expect(await page.evaluate(() => window.handle.errors)).toEqual([])
  expect(errors).toEqual([])
})

test("mount uses the bundle's default data and lets data given to it replace one input at a time", async ({
  page,
}) => {
  await mountPage(page, { chips: chipsBundle() })
  const draw = (data?: Record<string, unknown>) =>
    page.evaluate((given) => {
      window.handle = window.HackensackPlayer.mount(
        document.getElementById('pic')!,
        window.bundles.chips,
        given,
      )
    }, data)
  const bar = pic(page).locator('rect')
  const dots = pic(page).locator('circle')

  await draw()
  await expect(bar).toHaveAttribute('width', '10')
  await expect(bar).toHaveAttribute('fill', 'red')
  await expect(dots).toHaveCount(3)

  // One input given: it changes, the others keep their defaults.
  await draw({ a: 30 })
  await expect(bar).toHaveAttribute('width', '30')
  await expect(bar).toHaveAttribute('fill', 'red')
  await expect(dots).toHaveCount(3)

  // A list is one value: it replaces the default list whole.
  await draw({ xs: [7] })
  await expect(dots).toHaveCount(1)
  await expect(bar).toHaveAttribute('width', '10')
})

test('update(data) redraws the picture and destroy() empties the element and stops updates', async ({
  page,
}) => {
  await mountPage(page, { sun: sunCard() })
  await page.evaluate(() => {
    window.handle = window.HackensackPlayer.mount(
      document.getElementById('pic')!,
      window.bundles.sun,
    )
  })
  const circles = pic(page).locator('circle')
  await expect(circles.first()).toHaveAttribute('fill', SUN_FILL)
  await page.evaluate(() => window.handle.update({ color: 'teal' }))
  await expect(circles).toHaveCount(3)
  await expect(circles.first()).toHaveAttribute('fill', 'teal')

  await page.evaluate(() => window.handle.destroy())
  await expect(pic(page).locator('svg')).toHaveCount(0)
  expect(await pic(page).evaluate((el) => el.childNodes.length)).toBe(0)
  await page.evaluate(() => window.handle.update({ color: 'navy' }))
  expect(await pic(page).evaluate((el) => el.childNodes.length)).toBe(0)
})

test("update(data) overlays the bundle's defaults, not the previous update's data", async ({
  page,
}) => {
  await mountPage(page, { chips: chipsBundle() })
  await page.evaluate(() => {
    window.handle = window.HackensackPlayer.mount(
      document.getElementById('pic')!,
      window.bundles.chips,
    )
  })
  const bar = pic(page).locator('rect')
  await page.evaluate(() => window.handle.update({ a: 50 }))
  await expect(bar).toHaveAttribute('width', '50')
  await page.evaluate(() => window.handle.update({ color: 'blue' }))
  // a is back at its default: the last update's a is not kept.
  await expect(bar).toHaveAttribute('width', '10')
  await expect(bar).toHaveAttribute('fill', 'blue')
  await page.evaluate(() => window.handle.update())
  await expect(bar).toHaveAttribute('fill', 'red')
})

test('a bad expression shows a small problem note and lists the error while the rest of the picture still draws', async ({
  page,
}) => {
  const errors = await mountPage(page, { chips: chipsBundle('=nope * 2') })
  await page.evaluate(() => {
    window.handle = window.HackensackPlayer.mount(
      document.getElementById('pic')!,
      window.bundles.chips,
    )
  })
  // The rest still draws.
  await expect(pic(page).locator('circle')).toHaveCount(3)
  await expect(pic(page).locator('rect')).toHaveAttribute('fill', 'red')
  await expect(pic(page).locator('rect')).not.toHaveAttribute('width', /.*/)
  // A small note inside the element.
  await expect(note(page)).toBeVisible()
  await expect(note(page)).toContainText('1 problem')
  await note(page).locator('summary').click()
  await expect(note(page)).toContainText(
    'chips › bar › width: Undefined symbol nope',
  )
  const sizes = await page.evaluate(() => {
    const box = (s: string) =>
      document.querySelector(s)!.getBoundingClientRect()
    const n = document.querySelector<HTMLElement>(
      '#pic [data-hackensack-problems]',
    )!
    return {
      note: box('#pic [data-hackensack-problems]'),
      svg: box('#pic svg'),
      font: getComputedStyle(n).fontSize,
      inside: document.getElementById('pic')!.contains(n),
    }
  })
  expect(sizes.inside).toBe(true)
  expect(sizes.font).toBe('11px')
  expect(sizes.note.height).toBeLessThan(sizes.svg.height)
  expect(sizes.note.width * sizes.note.height).toBeLessThan(
    (sizes.svg.width * sizes.svg.height) / 2,
  )
  const listed = await page.evaluate(() => window.handle.errors)
  expect(listed).toEqual([
    expect.objectContaining({
      source: 'render',
      message: 'Undefined symbol nope',
      node: 'bar',
    }),
  ])
  expect(errors).toEqual([])
})

test('an unreadable bundle shows a problem note, draws nothing and does not throw', async ({
  page,
}) => {
  const errors = await mountPage(page, {
    broken: { format: 'something-else', root: 3 },
  })
  const result = await page.evaluate(() => {
    try {
      window.handle = window.HackensackPlayer.mount(
        document.getElementById('pic')!,
        window.bundles.broken,
      )
      window.handle.update({ a: 1 })
      return { threw: false, errors: window.handle.errors, thrown: '' }
    } catch (error) {
      return { threw: true, errors: [], thrown: String(error) }
    }
  })
  expect(result.thrown).toBe('')
  expect(result.threw).toBe(false)
  expect(result.errors.length).toBeGreaterThan(0)
  expect(result.errors.every((p) => p.source === 'bundle')).toBe(true)
  await expect(pic(page).locator('svg')).toHaveCount(0)
  await expect(note(page)).toBeVisible()
  await note(page).locator('summary').click()
  await expect(note(page)).toContainText('Not a bundle')
  expect(errors).toEqual([])
})

test('the problem note goes away when an update fixes the data', async ({
  page,
}) => {
  await mountPage(page, { chips: chipsBundle() })
  await page.evaluate(() => {
    window.handle = window.HackensackPlayer.mount(
      document.getElementById('pic')!,
      window.bundles.chips,
      {
        a: 'wide',
      },
    )
  })
  await expect(note(page)).toBeVisible()
  expect(
    (await page.evaluate(() => window.handle.errors)).length,
  ).toBeGreaterThan(0)
  await page.evaluate(() => window.handle.update({ a: 40 }))
  await expect(note(page)).toBeHidden()
  await expect(pic(page).locator('rect')).toHaveAttribute('width', '40')
  expect(await page.evaluate(() => window.handle.errors)).toEqual([])
})

test('the problem note shows markup in a message as plain text', async ({
  page,
}) => {
  const bundle = chipsBundle()
  const spec = bundle.components.chips
  spec.nodes.root.children = [...(spec.nodes.root.children ?? []), 'inst']
  spec.nodes.inst = {
    type: 'component',
    ref: '<b>x</b><img src=x onerror="window.pwned=1">',
  }
  const errors = await mountPage(page, { markup: bundle })
  await page.evaluate(() => {
    window.handle = window.HackensackPlayer.mount(
      document.getElementById('pic')!,
      window.bundles.markup,
    )
  })
  await expect(note(page)).toBeVisible()
  await note(page).locator('summary').click()
  await expect(note(page)).toContainText('<b>x</b>')
  await expect(note(page).locator('b')).toHaveCount(0)
  await expect(note(page).locator('img')).toHaveCount(0)
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
  ).toBeUndefined()
  // The valid part still draws.
  await expect(pic(page).locator('circle')).toHaveCount(3)
  expect(errors).toEqual([])
})

const element = (page: Page) => page.locator('hackensack-picture')
const elementNote = (page: Page) =>
  page.locator('hackensack-picture [data-hackensack-problems]')

test('hackensack-picture loads its bundle from src and takes its data from the data attribute', async ({
  page,
}) => {
  await servePage(
    page,
    iifePage(
      `<hackensack-picture src="sun.bundle.json" data='{"color": "teal"}'></hackensack-picture>`,
    ),
    { 'sun.bundle.json': JSON.stringify(sunCard()) },
  )
  const circles = element(page).locator('circle')
  await expect(circles).toHaveCount(3)
  await expect(circles.first()).toHaveAttribute('fill', 'teal')
  await expect(elementNote(page)).toBeHidden()
  // Drawn in its shadow root.
  expect(
    await element(page).evaluate(
      (el) => el.shadowRoot?.querySelectorAll('circle').length,
    ),
  ).toBe(3)
})

test('hackensack-picture reads an inline bundle and inline data from script tags', async ({
  page,
}) => {
  await servePage(
    page,
    iifePage(`<hackensack-picture>
  <script type="application/json">${inlineJson(sunCard())}</script>
  <script type="application/json" data-hackensack="data">{ "color": "navy" }</script>
</hackensack-picture>`),
  )
  const circles = element(page).locator('circle')
  await expect(circles).toHaveCount(3)
  await expect(circles.first()).toHaveAttribute('fill', 'navy')
  // The scripts are still where they were, in the light DOM.
  expect(
    await element(page).evaluate(
      (el) =>
        el.querySelectorAll(':scope > script[type="application/json"]').length,
    ),
  ).toBe(2)
})

test('hackensack-picture redraws when its data attribute or src changes', async ({
  page,
}) => {
  await servePage(
    page,
    iifePage(`<hackensack-picture src="sun.bundle.json"></hackensack-picture>`),
    {
      'sun.bundle.json': JSON.stringify(sunCard()),
      'chips.bundle.json': JSON.stringify(chipsBundle()),
    },
  )
  const circles = element(page).locator('circle')
  await expect(circles.first()).toHaveAttribute('fill', SUN_FILL)
  await element(page).evaluate((el) =>
    el.setAttribute('data', '{"color": "teal"}'),
  )
  await expect(circles.first()).toHaveAttribute('fill', 'teal')
  await expect(circles).toHaveCount(3)
  // A relative src, resolved against the page.
  await element(page).evaluate((el) => {
    el.removeAttribute('data')
    el.setAttribute('src', 'chips.bundle.json')
  })
  await expect(element(page).locator('rect')).toHaveAttribute('fill', 'red')
  await expect(element(page).locator('rect')).toHaveAttribute('width', '10')
  await element(page).evaluate((el) => el.setAttribute('data', '{"a": 60}'))
  await expect(element(page).locator('rect')).toHaveAttribute('width', '60')
})

test('hackensack-picture shows a problem note for a src that fails and for data that is not JSON', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await servePage(
    page,
    iifePage(`<hackensack-picture id="missing" src="missing.bundle.json"></hackensack-picture>
<hackensack-picture id="baddata" src="sun.bundle.json" data='{"color": '></hackensack-picture>`),
    {
      'sun.bundle.json': JSON.stringify(sunCard()),
      'missing.bundle.json': { status: 404 },
    },
  )
  const missing = page.locator('#missing [data-hackensack-problems]')
  await expect(missing).toBeVisible()
  await missing.locator('summary').click()
  await expect(missing).toContainText(
    "Can't load the bundle missing.bundle.json: 404",
  )
  await expect(page.locator('#missing svg')).toHaveCount(0)

  const badData = page.locator('#baddata [data-hackensack-problems]')
  await expect(badData).toBeVisible()
  await badData.locator('summary').click()
  await expect(badData).toContainText('The data attribute is not JSON')
  // Bad data is ignored: the picture draws with the bundle's defaults.
  await expect(page.locator('#baddata circle').first()).toHaveAttribute(
    'fill',
    SUN_FILL,
  )
  // Fixing the data clears the note.
  await page
    .locator('#baddata')
    .evaluate((el) => el.setAttribute('data', '{"color": "teal"}'))
  await expect(badData).toBeHidden()
  await expect(page.locator('#baddata circle').first()).toHaveAttribute(
    'fill',
    'teal',
  )
  expect(errors).toEqual([])
})

test("hackensack-picture prefers the data attribute over inline data, merges it over the bundle's defaults and has data and errors properties", async ({
  page,
}) => {
  await servePage(
    page,
    iifePage(`<hackensack-picture src="chips.bundle.json" data='{"a": 25}'>
  <script type="application/json" data-hackensack="data">{ "a": 99, "color": "green" }</script>
</hackensack-picture>`),
    { 'chips.bundle.json': JSON.stringify(chipsBundle()) },
  )
  const bar = element(page).locator('rect')
  // The attribute wins whole; the inline data isn't used at all.
  await expect(bar).toHaveAttribute('width', '25')
  // And it is merged over the bundle's defaults, one input at a time.
  await expect(bar).toHaveAttribute('fill', 'red')
  await expect(element(page).locator('circle')).toHaveCount(3)

  // The data property reads the data in use and sets the attribute.
  type Picture = HTMLElement & {
    data?: Record<string, unknown>
    errors: unknown[]
  }
  expect(await element(page).evaluate((el) => (el as Picture).data)).toEqual({
    a: 25,
  })
  await element(page).evaluate((el) => {
    ;(el as Picture).data = { color: 'blue', xs: [1] }
  })
  await expect(bar).toHaveAttribute('fill', 'blue')
  await expect(bar).toHaveAttribute('width', '10')
  await expect(element(page).locator('circle')).toHaveCount(1)
  expect(await element(page).getAttribute('data')).toBe(
    '{"color":"blue","xs":[1]}',
  )
  expect(await element(page).evaluate((el) => (el as Picture).errors)).toEqual(
    [],
  )

  // errors lists the problems of the last draw.
  await element(page).evaluate((el) => {
    ;(el as Picture).data = { a: 'wide' }
  })
  await expect(elementNote(page)).toBeVisible()
  const listed = await element(page).evaluate((el) => (el as Picture).errors)
  expect(listed.length).toBeGreaterThan(0)

  // Without the attribute, the inline data is used.
  await element(page).evaluate((el) => el.removeAttribute('data'))
  await expect(bar).toHaveAttribute('width', '99')
  await expect(bar).toHaveAttribute('fill', 'green')
})

test('hackensack-picture shows a problem note for an inline bundle that is not JSON', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await servePage(
    page,
    iifePage(`<hackensack-picture>
  <script type="application/json">{ "format": "hackensack/bundle/1", </script>
</hackensack-picture>`),
  )
  await expect(elementNote(page)).toBeVisible()
  await elementNote(page).locator('summary').click()
  await expect(elementNote(page)).toContainText('The inline bundle is not JSON')
  await expect(element(page).locator('svg')).toHaveCount(0)
  expect(errors).toEqual([])
})
