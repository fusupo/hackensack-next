// Animation nodes in the editor (#15). Each test seeds its own copy of
// sun-card (n0, an svg holding three sun instances); the windmill tests also
// copy the windmill example into it. windmill (w0, an svg) holds a sun circle
// w4 under a vars node w13 naming its radius, with an animate w5, the rotor instance w7 (period from wind) inside a
// translate(100, 56) group, and a grid w10 of raindrops w11, each falling with
// an animateTransform w12. Its sample is { wind: 20, precip: 40 }: one turn in
// 4.266667 s and four drops. Every test is a top-level `test`, so the
// validation contract selects it as `e2e/animation.spec.ts::<title>`.

import { cpSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import {
  expect,
  openProject,
  pickComponent,
  saveButton,
  test,
} from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const WINDMILL = join(import.meta.dirname, '..', 'examples', 'windmill')

const preview = (page: Page) => page.getByTestId('preview')
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const nodes = (page: Page) => page.locator('.react-flow__node')
const edges = (page: Page) => page.locator('.react-flow__edge')
const fitView = (page: Page) =>
  page.locator('.react-flow__controls-fitview').click()
const inspector = (page: Page) => page.locator('.inspector')
const inspectorHeader = (page: Page) => page.locator('.inspector-header')
const palette = (page: Page) => page.locator('.palette')
/** A param field in the inspector, by its label (start from page: see the lore). */
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true })
const sampleData = (page: Page) =>
  page.getByRole('textbox', { name: 'Sample data (JSON)' })
const rotorTurn = (page: Page) =>
  preview(page).locator('animateTransform[type="rotate"]')
const pauseButton = (page: Page) =>
  page.getByRole('button', { name: 'Pause animation', exact: true })
const playButton = (page: Page) =>
  page.getByRole('button', { name: 'Play animation', exact: true })

/** Select a node by clicking its card's header. */
async function select(page: Page, id: string) {
  await fitView(page)
  await graphNode(page, id).locator('.bloq-header').click()
  await expect(inspectorHeader(page)).toContainText(id)
}

/** Add a node from the palette and select it; returns its id. */
async function addAndSelect(page: Page, type: string) {
  const ids = () =>
    nodes(page).evaluateAll((all) => all.map((n) => n.getAttribute('data-id')!))
  const before = await ids()
  await palette(page).getByRole('button', { name: type, exact: true }).click()
  await fitView(page)
  await expect.poll(async () => (await ids()).length).toBe(before.length + 1)
  const id = (await ids()).find((i) => !before.includes(i))!
  await select(page, id)
  return id
}

/** Plug a child's output into its parent's empty slot. */
async function wire(page: Page, child: string, parent: string) {
  await fitView(page)
  await graphNode(page, child)
    .locator('.react-flow__handle-right')
    .dragTo(
      graphNode(page, parent).locator('.react-flow__handle-left.slot-empty'),
    )
}

/** Type params into the selected node's inspector fields. */
async function fill(page: Page, params: Record<string, string>) {
  for (const [name, value] of Object.entries(params))
    await field(page, name).fill(value)
}

/** Open the seeded project on sun-card (it opens on sun, the first by name). */
async function openCard(page: Page, project: SeededProject) {
  await openProject(page, project)
  await pickComponent(page, 'sun-card')
  await expect(preview(page).locator('circle')).toHaveCount(3)
}

/** Add the windmill example to the seeded project and open it on windmill. */
async function openWindmill(page: Page, project: SeededProject) {
  for (const kind of ['components', 'samples'])
    cpSync(join(WINDMILL, kind), join(project.dir, kind), { recursive: true })
  await openProject(page, project)
  await pickComponent(page, 'windmill')
  await expect(rotorTurn(page)).toHaveCount(1)
}

/** Run something on the preview's live <svg>. */
const onSvg = <T>(page: Page, run: (svg: SVGSVGElement) => T) =>
  preview(page)
    .locator('svg')
    .evaluate(run as (svg: SVGSVGElement) => T)

/** A drawn element's box on screen. */
const box = (locator: Locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { width: r.width, height: r.height }
  })

test('offers animate and animateTransform in the palette and lists their SMIL params in the inspector', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  const group = palette(page).locator('section', {
    has: page.getByRole('heading', { name: 'Animation', exact: true }),
  })
  await expect(group.locator('button')).toHaveText([
    'animate',
    'animateTransform',
  ])

  // animate: Animation and Timing sections, and its params.
  await addAndSelect(page, 'animate')
  for (const heading of ['Animation', 'Timing'])
    await expect(
      inspector(page).getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible()
  for (const name of [
    'attributeName',
    'from',
    'to',
    'by',
    'values',
    'keyTimes',
    'calcMode',
    'additive',
    'begin',
    'dur',
    'repeatCount',
    'fill',
  ])
    await expect(field(page, name)).toBeVisible()
  await expect(field(page, 'type')).toHaveCount(0)
  // The hints name the allowed values, and what fill and additive do.
  await expect(field(page, 'calcMode')).toHaveAttribute(
    'title',
    /linear, discrete, paced/,
  )
  await expect(field(page, 'additive')).toHaveAttribute(
    'title',
    /replace, sum.*sum adds/,
  )
  await expect(field(page, 'fill')).toHaveAttribute(
    'title',
    /freeze, remove.*freeze keeps the end value, remove goes back/,
  )
  await expect(field(page, 'dur')).toHaveAttribute('title', /seconds/)

  // animateTransform: a type, and no attributeName (it is always transform).
  await addAndSelect(page, 'animateTransform')
  await expect(field(page, 'type')).toHaveAttribute(
    'title',
    /translate, scale, rotate, skewX, skewY/,
  )
  await expect(field(page, 'attributeName')).toHaveCount(0)
})

test('wires an animate into a circle, refuses a rect there, and saves the animated circle', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  const circle = await addAndSelect(page, 'circle')
  await fill(page, { r: '5' })
  await wire(page, circle, 'n0')
  const animate = await addAndSelect(page, 'animate')
  await fill(page, {
    attributeName: 'r',
    from: '5',
    to: '20',
    dur: '2',
    repeatCount: 'indefinite',
  })
  await wire(page, animate, circle)

  const drawn = preview(page).locator(
    'circle[r="5"] > animate[attributeName="r"][dur="2s"][to="20"]',
  )
  await expect(drawn).toHaveCount(1)
  await expect(drawn).toHaveAttribute('repeatCount', 'indefinite')
  await expect(page.locator('.bloq-problem-count')).toHaveCount(0)
  // The circle's card has its animation and one more, empty, slot.
  await expect(
    graphNode(page, circle).locator('.react-flow__handle-left'),
  ).toHaveCount(2)
  await expect(
    graphNode(page, animate).locator('.react-flow__handle-left'),
  ).toHaveCount(0)

  // A rect can't go into the circle: nothing is wired.
  const rect = await addAndSelect(page, 'rect')
  const wired = await edges(page).count()
  await wire(page, rect, circle)
  await expect(edges(page)).toHaveCount(wired)
  await expect(
    graphNode(page, circle).locator('.react-flow__handle-left'),
  ).toHaveCount(2)

  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  const saved = project.json('components/sun-card.json') as {
    nodes: Record<string, { children?: string[]; params?: object }>
  }
  expect(saved.nodes[circle]!.children).toEqual([animate])
  expect(saved.nodes[animate]!.params).toEqual({
    attributeName: 'r',
    from: '5',
    to: '20',
    dur: 2,
    repeatCount: 'indefinite',
  })
  expect(saved.nodes.n0!.children).toContain(circle)
  expect(saved.nodes[rect]!.children ?? []).toEqual([])
})

const exposedHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Exposed variables', exact: true })
const exposeSelect = (page: Page) =>
  page.getByRole('combobox', { name: 'Expose a param', exact: true })

test('lists what a vars node above a shape puts in scope for its animation child', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  // A vars node naming rad, wired into the picture.
  const v = await addAndSelect(page, 'vars')
  await wire(page, v, 'n0')
  await select(page, v)
  await page.getByRole('button', { name: 'Add a name', exact: true }).click()
  const name = page.getByRole('textbox', {
    name: 'Name of value 1',
    exact: true,
  })
  await name.fill('rad')
  await name.press('Enter')
  await page
    .getByRole('textbox', { name: 'Expression of rad', exact: true })
    .fill('12')

  // A circle under it reads rad; its inspector offers no way to expose a
  // param (expose was removed in spec format v4).
  const circle = await addAndSelect(page, 'circle')
  await fill(page, { r: 'rad' })
  await expect(exposeSelect(page)).toHaveCount(0)
  await expect(exposedHeading(page)).toHaveCount(0)
  await wire(page, circle, v)

  // An animate in the circle reads rad too.
  const animate = await addAndSelect(page, 'animate')
  await fill(page, {
    attributeName: 'r',
    values: '{rad}; {rad * 2}; {rad}',
    dur: '3',
  })
  await wire(page, animate, circle)
  await select(page, animate)

  const frame = inspector(page).locator('.scope-frame', {
    has: page.getByRole('heading', { name: `vars ${v}`, exact: true }),
  })
  await expect(frame.locator('code')).toHaveText(['rad'])
  await expect(
    inspector(page).getByRole('heading', { name: /^exposed by/ }),
  ).toHaveCount(0)
  // And the engine reads it: the circle and the values come from rad.
  await expect(
    preview(page).locator('circle[r="12"] > animate[values="12; 24; 12"]'),
  ).toHaveCount(1)
})

test('the inspector has no Exposed variables section on a shape, a group or an svg node', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  // The svg at the root of sun-card.
  await select(page, 'n0')
  await expect(field(page, 'width')).toBeVisible()
  await expect(exposedHeading(page)).toHaveCount(0)
  await expect(exposeSelect(page)).toHaveCount(0)
  // A group and two shapes, each with a param set.
  for (const [type, param] of [
    ['g', 'opacity'],
    ['circle', 'r'],
    ['rect', 'width'],
  ] as const) {
    await addAndSelect(page, type)
    await fill(page, { [param]: '1' })
    await expect(field(page, param)).toHaveValue('1')
    await expect(exposedHeading(page)).toHaveCount(0)
    await expect(exposeSelect(page)).toHaveCount(0)
  }
})

test('windmill dur and rain follow the sample data in the live preview', async ({
  page,
  project,
}) => {
  await openWindmill(page, project)
  await expect(rotorTurn(page)).toHaveAttribute('dur', '4.266667s')
  await expect(rotorTurn(page)).toHaveAttribute('attributeName', 'transform')
  await expect(rotorTurn(page)).toHaveAttribute('repeatCount', 'indefinite')
  const drops = preview(page).locator('ellipse > animateTransform')
  await expect(drops).toHaveCount(4)
  await expect(drops.first()).toHaveAttribute('dur', '1.24s')
  await expect(drops.nth(1)).toHaveAttribute('begin', '-0.2s')
  await expect(preview(page).locator('circle > animate')).toHaveAttribute(
    'values',
    '12; 13.44; 12',
  )

  await sampleData(page).fill('{ "wind": 60, "precip": 40 }')
  await expect(rotorTurn(page)).toHaveAttribute('dur', '0.8s')
  await sampleData(page).fill('{ "wind": 0, "precip": 40 }')
  await expect(rotorTurn(page)).toHaveAttribute('dur', '6s')
  await sampleData(page).fill('{ "wind": 0, "precip": 0 }')
  await expect(drops).toHaveCount(0)
  await sampleData(page).fill('{ "wind": 20, "precip": 100 }')
  await expect(drops).toHaveCount(10)
  await expect(drops.first()).toHaveAttribute('dur', '0.7s')

  await expect(page.locator('.bloq-problem-count')).toHaveCount(0)
})

test('windmill rotor really turns when the animation clock is moved', async ({
  page,
  project,
}) => {
  await openWindmill(page, project)
  // The first blade: 10 wide and 34 tall, pointing up from the hub.
  const blade = preview(page).locator('path').first()
  const seek = async (seconds: number) => {
    await onSvg(page, (svg) => svg.pauseAnimations())
    await preview(page)
      .locator('svg')
      .evaluate((svg: SVGSVGElement, t) => svg.setCurrentTime(t), seconds)
    return box(blade)
  }
  const start = await seek(0)
  expect(start.height).toBeGreaterThan(start.width * 2)
  // A quarter of a turn (4.266667 s a turn) later the blade lies on its side:
  // its width and height have swapped.
  await expect
    .poll(async () => {
      const quarter = await seek(4.266667 / 4)
      return [
        Math.abs(quarter.width - start.height) < 1.5,
        Math.abs(quarter.height - start.width) < 1.5,
      ]
    })
    .toEqual([true, true])
  // Half a turn: upright again.
  await expect
    .poll(async () => {
      const half = await seek(4.266667 / 2)
      return Math.abs(half.height - start.height) < 1.5
    })
    .toBe(true)
})

test("pauses and resumes the preview's animations, stays paused through a data edit, and shows no toggle when nothing animates", async ({
  page,
  project,
}) => {
  await openWindmill(page, project)
  const paused = () => onSvg(page, (svg) => svg.animationsPaused())
  const clock = () => onSvg(page, (svg) => svg.getCurrentTime())

  await expect(pauseButton(page)).toBeVisible()
  await expect(pauseButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(pauseButton(page)).toHaveText('Pause')
  await pauseButton(page).click()
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(playButton(page)).toHaveText('Play')
  expect(await paused()).toBe(true)
  const stopped = await clock()
  await page.waitForTimeout(300)
  expect(await clock()).toBe(stopped)

  // A data edit replaces the markup; the new svg is paused too.
  await sampleData(page).fill('{ "wind": 60, "precip": 40 }')
  await expect(rotorTurn(page)).toHaveAttribute('dur', '0.8s')
  expect(await paused()).toBe(true)
  const after = await clock()
  await page.waitForTimeout(300)
  expect(await clock()).toBe(after)

  // Play: the clock runs again.
  await playButton(page).click()
  await expect(pauseButton(page)).toHaveAttribute('aria-pressed', 'false')
  expect(await paused()).toBe(false)
  const resumed = await clock()
  await expect.poll(clock).toBeGreaterThan(resumed)

  // Not remembered: after a reload the animation runs.
  await pauseButton(page).click()
  await expect(playButton(page)).toBeVisible()
  await page.reload()
  await openProject(page, project)
  await pickComponent(page, 'windmill')
  await expect(rotorTurn(page)).toHaveCount(1)
  await expect(pauseButton(page)).toBeVisible()
  expect(await paused()).toBe(false)

  // A picture without animation has no toggle.
  await pickComponent(page, 'sun-card')
  await expect(preview(page).locator('circle')).toHaveCount(3)
  await expect(pauseButton(page)).toHaveCount(0)
  await expect(playButton(page)).toHaveCount(0)
})

test('entering the rotor highlights its group and leaves its animation alone', async ({
  page,
  project,
}) => {
  await openWindmill(page, project)
  await fitView(page)
  await graphNode(page, 'w7').dblclick()
  const trail = page.getByRole('navigation', { name: 'Component trail' })
  await expect(trail.locator('.breadcrumb-current')).toHaveText('rotor')
  await expect(trail).toContainText('windmill')

  // The rotor's root group is the one entered element.
  const entered = preview(page).locator('[data-entered]')
  await expect(entered).toHaveCount(1)
  await expect(entered).toHaveJSProperty('tagName', 'g')
  await expect(entered.locator('> animateTransform')).toHaveCount(1)
  await expect(rotorTurn(page)).not.toHaveAttribute('data-entered', /.*/)
  await expect(rotorTurn(page)).not.toHaveAttribute('data-dimmed', /.*/)
  // The sun is dimmed as a whole; its animate is left alone.
  await expect(preview(page).locator('circle[fill="#f7c948"]')).toHaveAttribute(
    'data-dimmed',
    'true',
  )
  await expect(preview(page).locator('circle > animate')).not.toHaveAttribute(
    'data-dimmed',
    /.*/,
  )
})
