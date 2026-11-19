// The weather card in the editor (#9), M5's acceptance case. Each test seeds
// its own copy of sun-card and copies the weather-card example into it (its
// `sun` has sun-card's id, so sun.json is overwritten by an identical file).
//
// weather-card draws, inside a 240 x 160 svg (n0): a sky rect (n1, fill from
// the cloud cover), a ground rect (n2), a sun in a group that fades with the
// cloud cover (n3, n4), a cloud in a group that drifts with the wind and grows
// with the cover (n5, n6), and the rain: a group that drifts and slants with
// the wind (n7) around a grid of raindrops, one per 10 percent (n8, n9). Its
// sample is 18 degrees, 40% rain, 60% cloud cover and 20 km/h of wind.

import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  expect,
  openProject,
  pickComponent,
  saveButton,
  test,
} from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const WEATHER_CARD = join(import.meta.dirname, '..', 'examples', 'weather-card')

interface Node {
  type: string
  ref?: string
  params?: Record<string, unknown>
  children?: string[]
}
interface Spec {
  root: string
  nodes: Record<string, Node>
  [key: string]: unknown
}

const preview = (page: Page) => page.getByTestId('preview')
const sky = (page: Page) => preview(page).locator('rect').first()
const sunGroup = (page: Page) => preview(page).locator('g[opacity]')
const sunAt = (page: Page) => sunGroup(page).locator('> g')
const cloudGroup = (page: Page) =>
  preview(page).locator('g[transform*="scale("]')
const cloud = (page: Page) => cloudGroup(page).locator('path')
const rainGroup = (page: Page) =>
  preview(page).locator('g[transform*="skewX("]')
const drops = (page: Page) => preview(page).locator('ellipse')
const problems = (page: Page) => page.locator('.bloq-problem-count')
const sampleData = (page: Page) =>
  page.getByRole('textbox', { name: 'Sample data (JSON)' })
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const inspector = (page: Page) => page.locator('.inspector')
const fitView = (page: Page) =>
  page.locator('.react-flow__controls-fitview').click()

/** Sample data as typed into the Sample data pane. */
const day = (over: Record<string, number> = {}) =>
  JSON.stringify({
    temperature: 18,
    precip: 40,
    cloudCover: 60,
    wind: 20,
    ...over,
  })

/** Copy the weather-card example into the seeded project. */
function addWeatherCard(project: SeededProject) {
  for (const kind of ['components', 'samples'])
    cpSync(join(WEATHER_CARD, kind), join(project.dir, kind), {
      recursive: true,
    })
}

/** Open the seeded project on weather-card, drawn from its sample. */
async function openWeatherCard(page: Page, project: SeededProject) {
  await openProject(page, project)
  await pickComponent(page, 'weather-card')
  await expect(sunAt(page)).toHaveAttribute('transform', 'translate(56, 69.44)')
}

test('draws the weather card from the example sample data', async ({
  page,
  project,
}) => {
  addWeatherCard(project)
  await openWeatherCard(page, project)
  await expect(sky(page)).toHaveAttribute('fill', '#9fb1c2')
  await expect(sunGroup(page)).toHaveAttribute('opacity', '0.61')
  await expect(cloudGroup(page)).toHaveAttribute(
    'transform',
    'translate(94, 20) scale(1.36)',
  )
  await expect(cloud(page)).toHaveAttribute('fill', '#92979e')
  await expect(rainGroup(page)).toHaveAttribute(
    'transform',
    'translate(106, 90) skewX(10)',
  )
  await expect(drops(page)).toHaveCount(4)
  await expect(problems(page)).toHaveCount(0)
})

test('moves the sun when the temperature in the sample data changes', async ({
  page,
  project,
}) => {
  addWeatherCard(project)
  await openWeatherCard(page, project)
  // Hotter than 40 degrees: the sun stops at the top.
  await sampleData(page).fill(day({ temperature: 60 }))
  await expect(sunAt(page)).toHaveAttribute('transform', 'translate(56, 36)')
  // Colder than -10: it stops at the horizon.
  await sampleData(page).fill(day({ temperature: -30 }))
  await expect(sunAt(page)).toHaveAttribute('transform', 'translate(56, 112)')
  await sampleData(page).fill(day({ temperature: 28 }))
  await expect(sunAt(page)).toHaveAttribute('transform', 'translate(56, 54.24)')
  await expect(problems(page)).toHaveCount(0)
})

test('draws more raindrops when the precipitation chance in the sample data rises', async ({
  page,
  project,
}) => {
  addWeatherCard(project)
  await openWeatherCard(page, project)
  await expect(drops(page)).toHaveCount(4)
  await sampleData(page).fill(day({ precip: 0 }))
  await expect(drops(page)).toHaveCount(0)
  await sampleData(page).fill(day({ precip: 100 }))
  await expect(drops(page)).toHaveCount(10)
  // Two rows of five.
  await expect(
    rainGroup(page).locator('g[transform="translate(64, 16)"]'),
  ).toHaveCount(1)
  await expect(problems(page)).toHaveCount(0)
})

test('recolours the sky and resizes the cloud when the cloud cover in the sample data changes', async ({
  page,
  project,
}) => {
  addWeatherCard(project)
  await openWeatherCard(page, project)
  await sampleData(page).fill(day({ cloudCover: 0 }))
  await expect(sky(page)).toHaveAttribute('fill', '#bfe3ff')
  await expect(cloud(page)).toHaveAttribute('fill', '#ffffff')
  await expect(cloudGroup(page)).toHaveAttribute(
    'transform',
    'translate(94, 20) scale(1)',
  )
  await expect(sunGroup(page)).toHaveAttribute('opacity', '1')

  await sampleData(page).fill(day({ cloudCover: 100 }))
  await expect(sky(page)).toHaveAttribute('fill', '#8a8f99')
  await expect(cloud(page)).toHaveAttribute('fill', '#4a525e')
  await expect(cloudGroup(page)).toHaveAttribute(
    'transform',
    'translate(94, 20) scale(1.6)',
  )
  await expect(sunGroup(page)).toHaveAttribute('opacity', '0.35')
  await expect(problems(page)).toHaveCount(0)
})

test('drifts the cloud and leans the rain when the wind in the sample data changes', async ({
  page,
  project,
}) => {
  addWeatherCard(project)
  await openWeatherCard(page, project)
  await sampleData(page).fill(day({ wind: 0 }))
  await expect(cloudGroup(page)).toHaveAttribute(
    'transform',
    'translate(84, 20) scale(1.36)',
  )
  await expect(rainGroup(page)).toHaveAttribute(
    'transform',
    'translate(96, 90) skewX(0)',
  )
  await sampleData(page).fill(day({ wind: 60 }))
  await expect(cloudGroup(page)).toHaveAttribute(
    'transform',
    'translate(114, 20) scale(1.36)',
  )
  await expect(rainGroup(page)).toHaveAttribute(
    'transform',
    'translate(126, 90) skewX(30)',
  )
  // Past 60 km/h nothing moves further.
  await sampleData(page).fill(day({ wind: 80 }))
  await expect(rainGroup(page)).toHaveAttribute(
    'transform',
    'translate(126, 90) skewX(30)',
  )
  await expect(cloudGroup(page)).toHaveAttribute(
    'transform',
    'translate(114, 20) scale(1.36)',
  )
  await expect(problems(page)).toHaveCount(0)
})

test('keeps the cloud inside the card and the rain below it at full wind and cover', async ({
  page,
  project,
}) => {
  addWeatherCard(project)
  await openWeatherCard(page, project)

  /** Boxes in card units: the sky rect is the whole 240 x 160 card. */
  const boxes = async () => {
    const card = await sky(page).boundingBox()
    const cloudBox = await cloud(page).boundingBox()
    const sunBox = await sunAt(page).boundingBox()
    const dropBoxes = await Promise.all(
      (await drops(page).all()).map((d) => d.boundingBox()),
    )
    if (!card || !cloudBox || !sunBox) throw new Error('nothing drawn')
    const k = 240 / card.width
    const toCard = (b: {
      x: number
      y: number
      width: number
      height: number
    }) => ({
      left: (b.x - card.x) * k,
      top: (b.y - card.y) * k,
      right: (b.x + b.width - card.x) * k,
      bottom: (b.y + b.height - card.y) * k,
    })
    return {
      cloud: toCard(cloudBox),
      sun: toCard(sunBox),
      drops: dropBoxes.map((b) => {
        if (!b) throw new Error('a drop has no box')
        return toCard(b)
      }),
    }
  }

  const stormy = { temperature: 2, precip: 100, cloudCover: 100, wind: 55 }
  for (const data of [stormy, { ...stormy, temperature: 18, wind: 80 }]) {
    await sampleData(page).fill(JSON.stringify(data))
    await expect(drops(page)).toHaveCount(10)
    await expect(cloudGroup(page)).toHaveAttribute('transform', /scale\(1\.6\)/)
    const b = await boxes()
    expect(b.cloud.left).toBeGreaterThanOrEqual(0)
    expect(b.cloud.right).toBeLessThanOrEqual(240)
    expect(b.cloud.top).toBeGreaterThanOrEqual(0)
    const topDrop = Math.min(...b.drops.map((d) => d.top))
    expect(topDrop).toBeGreaterThan(b.cloud.bottom)
  }

  // The sun never touches the cloud: sample, sunny and stormy.
  const sunny = { temperature: 28, precip: 0, cloudCover: 10, wind: 5 }
  for (const [data, cloudAt] of [
    [JSON.parse(day()), 'translate(94, 20) scale(1.36)'],
    [sunny, 'translate(86.5, 20) scale(1.06)'],
    [stormy, 'translate(111.5, 20) scale(1.6)'],
  ] as const) {
    await sampleData(page).fill(JSON.stringify(data))
    await expect(cloudGroup(page)).toHaveAttribute('transform', cloudAt)
    const b = await boxes()
    const apart =
      b.sun.right < b.cloud.left ||
      b.cloud.right < b.sun.left ||
      b.sun.bottom < b.cloud.top ||
      b.cloud.bottom < b.sun.top
    expect(apart, JSON.stringify({ data, sun: b.sun, cloud: b.cloud })).toBe(
      true,
    )
  }
  await expect(problems(page)).toHaveCount(0)
})

/** A node's shape from the root down: type, ref, params and children in order. */
function shape(spec: Spec, id = spec.root): unknown {
  const node = spec.nodes[id]
  return {
    type: node.type,
    ref: node.ref,
    params: node.params ?? {},
    children: (node.children ?? []).map((child) => shape(spec, child)),
  }
}

test('authors the rain of the weather card in the editor and saves the same tree as the example', async ({
  page,
  project,
}) => {
  addWeatherCard(project)
  // The card without its rain: no n7 (the group), n8 (the grid) or n9 (the
  // raindrop instance), and no slot for them on the root.
  const example = JSON.parse(
    readFileSync(join(WEATHER_CARD, 'components', 'weather-card.json'), 'utf8'),
  ) as Spec
  const dry = structuredClone(example)
  for (const id of ['n7', 'n8', 'n9']) delete dry.nodes[id]
  dry.nodes.n0.children = ['n1', 'n2', 'n3', 'n5']
  writeFileSync(
    join(project.dir, 'components', 'weather-card.json'),
    JSON.stringify(dry, null, 2) + '\n',
  )
  await openWeatherCard(page, project)
  await expect(drops(page)).toHaveCount(0)

  const nodeIds = () =>
    page
      .locator('.react-flow__node')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')))
  const palette = page.locator('.palette')
  /** Add a node from the palette; returns the id of its new card. */
  const add = async (item: ReturnType<Page['locator']>) => {
    const before = await nodeIds()
    await item.click()
    await fitView(page)
    await expect
      .poll(async () => (await nodeIds()).length)
      .toBe(before.length + 1)
    const id = (await nodeIds()).find((n) => !before.includes(n))
    if (!id) throw new Error('no new node')
    return id
  }
  /** Plug a child's output into its parent's empty slot. */
  const wire = async (child: string, parent: string) => {
    await fitView(page)
    await graphNode(page, child)
      .locator('.react-flow__handle-right')
      .dragTo(
        graphNode(page, parent).locator('.react-flow__handle-left.slot-empty'),
      )
  }
  /** Select a node and type its params into the inspector. */
  const set = async (id: string, params: Record<string, string>) => {
    await fitView(page)
    await graphNode(page, id).locator('.bloq-header').click()
    for (const [name, value] of Object.entries(params))
      await inspector(page).getByLabel(name, { exact: true }).fill(value)
  }

  const group = await add(
    palette.getByRole('button', { name: 'g', exact: true }),
  )
  const grid = await add(palette.locator('.palette-grid'))
  const drop = await add(
    palette.locator('.palette-component', { hasText: /^raindrop/ }),
  )
  await wire(drop, grid)
  await wire(grid, group)
  await wire(group, 'n0')
  await expect(page.locator('.react-flow__edge')).toHaveCount(9)

  const W = 'clamp(remap(wind, 0, 60, 0, 30), 0, 30)'
  await set(group, { transform: `translate(96 + ${W}, 90) skewX(${W})` })
  await set(grid, {
    count: 'precip / 10',
    columns: '5',
    spacing: '16',
    rowSpacing: '16',
  })

  // The preview has its rain back, and the graph has no problems.
  await expect(drops(page)).toHaveCount(4)
  await expect(rainGroup(page)).toHaveAttribute(
    'transform',
    'translate(106, 90) skewX(10)',
  )
  await expect(problems(page)).toHaveCount(0)

  await saveButton(page).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
  const saved = project.json('components/weather-card.json') as unknown as Spec
  expect(shape(saved)).toEqual(shape(example))
  expect(saved.id).toBe((example as unknown as { id: string }).id)
  expect(saved.inputs).toEqual(example.inputs)
})
