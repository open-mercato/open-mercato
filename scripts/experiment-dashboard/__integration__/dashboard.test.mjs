import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
import { buildDashboardAssets } from '../cli.mjs'
import { startDashboardServer } from '../server.mjs'

const hostileSource =
  '<img src="x" onerror="globalThis.artifactExecuted = true"><script>globalThis.artifactExecuted = true</script>'

function experiment() {
  return {
    schemaVersion: 1,
    id: 'producer/α',
    name: 'Alpha evaluation',
    status: 'running',
    metadata: { model: 'local/model-alpha', runner: 'fixture-agent' },
    updatedAt: new Date().toISOString(),
    lanes: [
      { id: 'implementation', label: 'Implementation', total: 57 },
      { id: 'safety/品質', label: 'Safety' },
      { id: 'constructor', label: 'Prototype lane', total: 1 },
    ],
    active: [
      {
        caseId: 'book/create',
        laneId: 'implementation',
        phase: 'Generating source',
        toolCalls: 2,
      },
    ],
    cases: [
      {
        id: 'book/create',
        title: 'Create a book module',
        group: 'Code',
        prompt: 'Build the books module.',
        lanes: {
          implementation: {
            status: 'running',
            attempts: 1,
            diagnostics: ['Fixture diagnostic'],
            responses: [
              {
                text: 'I created a books module and generated the source files.',
              },
            ],
            files: [
              { path: 'src/books.ts', content: 'export const books = []' },
              { path: 'src/inert-example.txt', content: hostileSource },
            ],
            tools: [
              {
                name: 'write',
                path: 'src/books.ts',
                isError: false,
                content: 'Generated the source file.',
              },
            ],
            evidence: {
              selectedRouter: ['module-data'],
              checks: ['Fixture semantic assertion'],
            },
          },
          'safety/品質': { status: 'pass' },
          constructor: { status: 'pass' },
        },
      },
      ...Array.from({ length: 56 }, (_, index) => ({
        id: `fixture:${index}`,
        title: `Other task ${index}`,
        group: 'Review',
        lanes: {
          implementation: { status: 'pending' },
          'safety/品質': { status: 'pending' },
        },
      })),
    ],
  }
}

async function writeSnapshot(directory, snapshot) {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, 'experiment.next.json'),
    JSON.stringify(snapshot),
  )
  await fs.rename(
    path.join(directory, 'experiment.next.json'),
    path.join(directory, 'experiment.json'),
  )
}

async function environment(run) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dashboard-browser-test-'),
  )
  let server
  let browser
  try {
    const alphaDirectory = path.join(directory, 'alpha')
    const betaDirectory = path.join(directory, 'beta')
    const alpha = experiment()
    const beta = {
      schemaVersion: 1,
      id: 'other',
      name: 'Beta evaluation',
      status: 'completed',
      metadata: { model: 'local/model-beta' },
      lanes: [],
      cases: [],
    }
    await writeSnapshot(alphaDirectory, alpha)
    await writeSnapshot(betaDirectory, beta)
    const assetsDir = await buildDashboardAssets({
      cacheDir: path.join(directory, 'assets'),
    })
    server = await startDashboardServer({
      experiments: [alphaDirectory, betaDirectory],
      port: 0,
      assetsDir,
    })
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    const channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : channel ? { channel } : {}),
    })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(server.url)
    await run({ page, alpha, alphaDirectory, betaDirectory })
    assert.deepEqual(
      pageErrors,
      [],
      'The production bundle must run without browser exceptions',
    )
  } finally {
    await browser?.close()
    await server?.close()
    await fs.rm(directory, { recursive: true, force: true })
  }
}

test(
  'dashboard observes arbitrary experiments, scoped metrics and inert result artifacts while preserving inspection state',
  { timeout: 120000 },
  () =>
    environment(async ({ page, alpha, alphaDirectory, betaDirectory }) => {
      await expect(
        page.getByRole('heading', { name: 'Alpha evaluation', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('img', { name: 'Open Mercato', exact: true }),
      ).toBeVisible()
      await expect
        .poll(() =>
          page
            .getByRole('img', { name: 'Open Mercato', exact: true })
            .evaluate((image) => image.naturalWidth),
        )
        .toBeGreaterThan(0)
      await expect(page.getByTestId('throughput').first()).toContainText('—')
      await expect(
        page.getByText('Producer metrics unavailable').first(),
      ).toBeVisible()
      await expect(
        page.getByText(
          'Observed results; the producer has not declared a complete target.',
        ),
      ).toBeVisible()
      await expect(
        page
          .getByRole('row')
          .filter({ hasText: 'fixture:0' })
          .getByRole('button', {
            name: 'Open fixture:0 in Prototype lane',
            exact: true,
          }),
      ).toHaveCount(0)
      await page
        .getByRole('combobox', { name: 'Evaluation lane', exact: true })
        .click()
      await page
        .getByRole('option', { name: 'Prototype lane', exact: true })
        .click()
      await expect(page.getByRole('row')).toHaveCount(2)
      await page
        .getByRole('table')
        .getByRole('button', {
          name: 'Open book/create in Prototype lane',
          exact: true,
        })
        .click()
      await expect(
        page.getByRole('combobox', {
          name: 'Case evaluation lane',
          exact: true,
        }),
      ).toContainText('Prototype lane')
      await page
        .getByRole('button', { name: 'Close case inspection', exact: true })
        .click()
      await page
        .getByRole('combobox', { name: 'Evaluation lane', exact: true })
        .click()
      await page.getByRole('option', { name: 'All lanes', exact: true }).click()
      await expect(page.getByRole('row')).toHaveCount(51)
      await page
        .getByRole('table')
        .getByRole('button', {
          name: 'Open fixture:0 in Implementation',
          exact: true,
        })
        .click()
      await page
        .getByRole('combobox', { name: 'Case evaluation lane', exact: true })
        .click()
      await expect(
        page.getByRole('option', { name: 'Prototype lane', exact: true }),
      ).toHaveCount(0)
      await page.keyboard.press('Escape')
      await page
        .getByRole('button', { name: 'Close case inspection', exact: true })
        .click()
      await page.getByRole('button', { name: 'Next page', exact: true }).click()
      await expect(page.getByRole('row')).toHaveCount(8)
      await page
        .getByRole('button', { name: 'Previous page', exact: true })
        .click()

      await page.getByRole('searchbox', { name: 'Search cases' }).fill('book')
      await page
        .getByRole('combobox', { name: 'Evaluation lane', exact: true })
        .click()
      await page
        .getByRole('option', { name: 'Implementation', exact: true })
        .click()
      await page
        .getByRole('combobox', { name: 'Result status', exact: true })
        .click()
      await page.getByRole('option', { name: 'Running', exact: true }).click()
      await page
        .getByRole('combobox', { name: 'Case group', exact: true })
        .click()
      await page.getByRole('option', { name: 'Code', exact: true }).click()
      await expect(page.getByRole('row')).toHaveCount(2)
      await page
        .getByRole('table')
        .getByRole('button', {
          name: 'Open book/create in Implementation',
          exact: true,
        })
        .click()
      await expect(page.getByTestId('agent-response')).toContainText(
        'I created a books module',
      )
      await page.getByRole('tab', { name: 'Files 2', exact: true }).click()
      await page
        .getByRole('navigation', { name: 'Files', exact: true })
        .getByRole('button', { name: 'src/inert-example.txt', exact: true })
        .click()
      await expect(page.getByTestId('file-content')).toHaveText(hostileSource)
      assert.equal(
        await page
          .locator('#case-inspector img, #case-inspector script')
          .count(),
        0,
      )
      assert.equal(
        await page.evaluate(() => globalThis.artifactExecuted),
        undefined,
      )

      alpha.active[0].metrics = {
        tokensPerSecond: 21.5,
        outputTokens: 215,
        inputTokens: 100,
        totalTokens: 340,
        windowSeconds: 10,
        sampledAt: new Date().toISOString(),
        measurementKind: 'live',
      }
      alpha.cases[0].lanes.implementation.files[1].content =
        hostileSource + '\nUpdated producer artifact.'
      alpha.updatedAt = new Date().toISOString()
      await writeSnapshot(alphaDirectory, alpha)
      await expect(page.getByTestId('throughput').first()).toContainText(
        '21.5',
        { timeout: 10000 },
      )
      await expect(page.getByTestId('outputTokens').first()).toHaveText('215')
      await expect(page.getByTestId('totalTokens').first()).toHaveText('340')
      await expect(
        page.getByText('Live measured sample', { exact: true }),
      ).toBeVisible()
      await expect(page.getByTestId('file-content')).toContainText(
        'Updated producer artifact.',
        { timeout: 10000 },
      )
      await expect(
        page.getByRole('tab', { name: 'Files 2', exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await expect(
        page
          .getByRole('navigation', { name: 'Files', exact: true })
          .getByRole('button', { name: 'src/inert-example.txt', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      await expect(
        page.getByRole('searchbox', { name: 'Search cases' }),
      ).toHaveValue('book')
      await expect(
        page.getByRole('combobox', { name: 'Evaluation lane', exact: true }),
      ).toContainText('Implementation')
      await expect(
        page.getByRole('combobox', { name: 'Result status', exact: true }),
      ).toContainText('Running')
      await expect(
        page.getByRole('combobox', { name: 'Case group', exact: true }),
      ).toContainText('Code')
      await expect(page.getByRole('row')).toHaveCount(2)
      const downloaded = page.waitForEvent('download')
      await page
        .getByRole('link', { name: 'Download file', exact: true })
        .click()
      const download = await downloaded
      assert.equal(
        await fs.readFile(await download.path(), 'utf8'),
        hostileSource + '\nUpdated producer artifact.',
      )

      await page.getByRole('tab', { name: 'Tools 1', exact: true }).click()
      await expect(
        page.getByText('Generated the source file.', { exact: true }),
      ).toBeVisible()
      await page.getByRole('tab', { name: 'Evaluation', exact: true }).click()
      await expect(
        page.getByText('Fixture diagnostic', { exact: true }),
      ).toBeVisible()
      await expect(page.getByText(/Fixture semantic assertion/)).toBeVisible()
      await page
        .getByRole('combobox', { name: 'Case evaluation lane', exact: true })
        .click()
      await page.getByRole('option', { name: 'Safety', exact: true }).click()
      await expect(
        page.getByText('No evaluator evidence retained', { exact: true }),
      ).toBeVisible()

      alpha.active[0].metrics.sampledAt = new Date(
        Date.now() - 60000,
      ).toISOString()
      await writeSnapshot(alphaDirectory, alpha)
      await expect(page.getByTestId('throughput').first()).toContainText('—', {
        timeout: 10000,
      })
      await expect(
        page.getByText('Live sample is stale', { exact: true }),
      ).toBeVisible()
      alpha.active = []
      alpha.metrics = {
        outputTokens: 120,
        generationSeconds: 3,
        sampledAt: new Date(Date.now() - 60000).toISOString(),
        measurementKind: 'completed-response',
      }
      await writeSnapshot(alphaDirectory, alpha)
      await expect(page.getByTestId('throughput').first()).toContainText('40', {
        timeout: 10000,
      })
      await expect(
        page.getByText('Last response', { exact: true }),
      ).toBeVisible()

      await page
        .getByRole('navigation', { name: 'Experiments', exact: true })
        .getByRole('button', {
          name: 'Beta evaluation local/model-beta Completed',
          exact: true,
        })
        .click()
      await expect(
        page.getByRole('heading', { name: 'Beta evaluation', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText('No cases reported yet', { exact: true }),
      ).toBeVisible()
      await expect(page.getByTestId('throughput').first()).toContainText('—')
      await expect(
        page.getByText('Producer metrics unavailable').first(),
      ).toBeVisible()
      await fs.writeFile(path.join(betaDirectory, 'experiment.json'), '{')
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 10000 })

      await page
        .getByRole('navigation', { name: 'Experiments', exact: true })
        .getByRole('button', {
          name: 'Alpha evaluation local/model-alpha Running',
          exact: true,
        })
        .click()
      await expect(
        page.getByRole('heading', { name: 'Alpha evaluation', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('searchbox', { name: 'Search cases' }),
      ).toHaveValue('')
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(
        page.getByRole('heading', { name: 'Alpha evaluation', exact: true }),
      ).toBeVisible()
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        JSON.stringify(
          await page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            overflow: [...document.querySelectorAll('body *')]
              .filter(
                (element) => element.getBoundingClientRect().right > innerWidth,
              )
              .slice(0, 15)
              .map((element) => ({
                tag: element.tagName,
                class: element.className,
                width: element.getBoundingClientRect().width,
                right: element.getBoundingClientRect().right,
              })),
          })),
        ),
      )
    }),
)

test(
  'live throughput expires while repeated network failures leave the last snapshot unchanged',
  { timeout: 30000 },
  () =>
    environment(async ({ page, alpha, alphaDirectory }) => {
      alpha.active[0].metrics = {
        outputTokensPerSecond: 42,
        sampledAt: new Date().toISOString(),
        measurementKind: 'live',
      }
      await writeSnapshot(alphaDirectory, alpha)
      await expect(page.getByTestId('throughput').first()).toContainText('42', {
        timeout: 10000,
      })
      await expect(page.locator('.activity-metrics')).toContainText('42')
      await page.clock.install({ time: new Date() })
      await page.route('**/api/**', (route) => route.abort())
      await page.clock.runFor(4000)
      await expect(
        page.getByText(
          'Connection interrupted. Showing the last received results.',
        ),
      ).toBeVisible()
      await expect(page.getByTestId('throughput').first()).toContainText('42')
      await page.clock.fastForward(31000)
      await expect(page.getByTestId('throughput').first()).toContainText('—', {
        timeout: 1500,
      })
      await expect(
        page.getByText('Live sample is stale', { exact: true }),
      ).toBeVisible()
      await expect(page.locator('.activity-metrics strong')).toHaveCount(0)
    }),
)

test(
  'case inspector presents readable captured prose and clean tabs at desktop and narrow widths',
  { timeout: 30000 },
  () =>
    environment(async ({ page, alpha, alphaDirectory }) => {
      const responseText =
        'The books module is ready for review.\n\nThe implementation preserves the request and reports the generated files.\n\n' +
        'long-artifact-identifier-'.repeat(60)
      alpha.cases[0].lanes.implementation.responses[0].text = responseText
      await writeSnapshot(alphaDirectory, alpha)
      await page
        .getByRole('table')
        .getByRole('button', {
          name: 'Open book/create in Implementation',
          exact: true,
        })
        .click()
      const response = page.getByTestId('agent-response')
      await expect(response).toHaveText(responseText)
      await expect(
        page.getByText('Messages captured so far', { exact: true }),
      ).toBeVisible()
      assert.equal(
        await response.evaluate(
          (element) => getComputedStyle(element).fontFamily,
        ),
        await page
          .locator('body')
          .evaluate((element) => getComputedStyle(element).fontFamily),
      )
      assert.equal(
        await page
          .locator('.capture-note')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
        'rgba(0, 0, 0, 0)',
      )
      const filesTab = page.getByRole('tab', { name: 'Files 2', exact: true })
      const tabGeometry = await filesTab.evaluate((element) => {
        const label = element
          .querySelector('span:not([data-slot])')
          .getBoundingClientRect()
        const count = element
          .querySelector('[data-slot="tabs-trigger-count"]')
          .getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          gap: count.left - label.right,
          background: style.backgroundColor,
          display: style.display,
        }
      })
      assert.ok(
        tabGeometry.gap >= 4,
        'The count is visually separated from its tab label',
      )
      assert.equal(tabGeometry.background, 'rgba(0, 0, 0, 0)')
      assert.match(tabGeometry.display, /^(inline-)?flex$/)
      assert.ok(
        await page
          .getByRole('tablist', { name: 'Case result sections' })
          .evaluate((element) => element.scrollHeight <= element.clientHeight),
        'The desktop tab strip has no vertical scroll overflow',
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(
        page.getByRole('heading', {
          name: 'Create a book module',
          exact: true,
        }),
      ).toBeVisible()
      await expect(
        page.getByRole('combobox', {
          name: 'Case evaluation lane',
          exact: true,
        }),
      ).toBeVisible()
      await expect(response).toHaveText(responseText)
      assert.ok(
        await page
          .getByRole('tablist', { name: 'Case result sections' })
          .evaluate((element) => element.scrollHeight <= element.clientHeight),
        'The narrow tab strip has no vertical scroll overflow',
      )
      assert.ok(
        await response.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
        'Long unbroken response tokens wrap within the reading area',
      )
      assert.ok(
        await response.evaluate(
          (element) =>
            element.getBoundingClientRect().height >
            parseFloat(getComputedStyle(element).lineHeight) * 4,
        ),
        'Multiline prose remains readable and wraps onto multiple lines',
      )
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        'An open inspector does not introduce page-wide horizontal overflow',
      )
      await filesTab.click()
      await expect(
        page.getByRole('tab', { name: 'Files 2', exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('file-content')).toHaveText(
        'export const books = []',
      )
    }),
)
