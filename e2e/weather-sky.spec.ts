// The expression helpers remap, clamp and mix in the editor (#7). Each test
// seeds its own copy of sun-card and copies the weather-sky example into it.
// weather-sky draws a sky rect (n1, fill "=mix('#bfe3ff', '#8a8f99',
// cloud / 100)") and a sun circle (n2, cy "clamp(remap(temperature, -10, 40,
// 100, 20), 20, 100)"). Its sample is 15 degrees and 60% cloud: cy 60 and a
// #9fb1c2 sky.

import { cpSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, openProject, pickComponent, test } from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const WEATHER_SKY = join(import.meta.dirname, '..', 'examples', 'weather-sky')

const preview = (page: Page) => page.getByTestId('preview')
const sun = (page: Page) => preview(page).locator('circle')
const sky = (page: Page) => preview(page).locator('rect')
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const inspector = (page: Page) => page.locator('.inspector')

/** Add the weather-sky example to the seeded project and open it. */
async function openWeatherSky(page: Page, project: SeededProject) {
  for (const kind of ['components', 'samples'])
    cpSync(join(WEATHER_SKY, kind), join(project.dir, kind), {
      recursive: true,
    })
  await openProject(page, project)
  await pickComponent(page, 'weather-sky')
  await expect(sun(page)).toHaveAttribute('cy', '60')
}

test('moves the sun and recolours the sky from the sample data', async ({
  page,
  project,
}) => {
  await openWeatherSky(page, project)
  await expect(sky(page)).toHaveAttribute('fill', '#9fb1c2')

  const data = page.getByRole('textbox', { name: 'Sample data (JSON)' })
  // Hotter than the top of the range: clamp keeps the sun at the top.
  await data.fill('{ "temperature": 60, "cloud": 100 }')
  await expect(sun(page)).toHaveAttribute('cy', '20')
  await expect(sky(page)).toHaveAttribute('fill', '#8a8f99')

  // Colder than the bottom: the sun stays on the horizon; a clear sky.
  await data.fill('{ "temperature": -30, "cloud": 0 }')
  await expect(sun(page)).toHaveAttribute('cy', '100')
  await expect(sky(page)).toHaveAttribute('fill', '#bfe3ff')

  await expect(page.locator('.bloq-problem-count')).toHaveCount(0)
})

test('shows an expression typed into the inspector and reports a bad mix colour', async ({
  page,
  project,
}) => {
  await openWeatherSky(page, project)

  // remap without clamp: 15 degrees on 0..30 maps halfway down 100..0.
  await graphNode(page, 'n2').click()
  await inspector(page)
    .getByLabel('cy', { exact: true })
    .fill('remap(temperature, 0, 30, 100, 0)')
  await expect(sun(page)).toHaveAttribute('cy', '50')

  await graphNode(page, 'n1').click()
  const fillInput = inspector(page).getByLabel('fill', { exact: true })
  // `has` matches inside each .field, so its locator starts from the page.
  const fillField = inspector(page).locator('.field', {
    has: page.getByLabel('fill', { exact: true }),
  })

  // A named colour isn't accepted: the problem shows on the fill field and
  // the rect is drawn without a fill.
  await fillInput.fill("=mix('red', '#000', cloud / 100)")
  await expect(fillField.locator('.field-problem')).toContainText('mix()')
  await expect(fillInput).toHaveAttribute('aria-invalid', 'true')
  await expect(sky(page)).not.toHaveAttribute('fill', /.*/)

  await fillInput.fill("=mix('#ffffff', '#000000', 0.5)")
  await expect(sky(page)).toHaveAttribute('fill', '#808080')
  await expect(fillInput).toHaveAttribute('aria-invalid', 'false')
  await expect(fillField.locator('.field-problem')).toHaveCount(0)
})
