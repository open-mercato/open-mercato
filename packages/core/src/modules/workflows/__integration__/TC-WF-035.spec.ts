import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { workflowStepNodes } from '@open-mercato/core/helpers/integration/workflowsUi'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-035: route-chip density at the 60-node scale fixture (#4244).
 *
 * Spec 2026-07-26-workflows-ux-redesign.md section 4.4 makes this an explicit
 * exit criterion: "chips cap at 3 with a `+N` overflow badge; semantic zoom
 * collapses chips to dots below a zoom threshold… Acceptance test: a 60-node
 * OZE-scale flow with 5 agent nodes remains navigable".
 *
 * `examples/oze-residential-install-60-nodes.json` is that fixture: 60 steps,
 * 67 routes, and exactly one route (`quote_rendered → quote_sent`) carrying 5
 * activities, so the cap and the overflow badge both have a real target.
 *
 * The two halves of the density defence are asserted at the two zoom levels the
 * author actually sees: fitted (the whole 60-node flow — chips collapse to
 * labelled dot rows) and focused on a single step (chips expand, capped at 3
 * with a `+2` badge).
 *
 * Self-contained: the fixture JSON is posted through the API under a unique
 * workflowId and deleted in `finally`. It ships `enabled: false` and declares no
 * triggers, so loading it can never start a run.
 */

const specDir = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(specDir, '..', 'examples', 'oze-residential-install-60-nodes.json')

type DensityFixture = {
  workflowId: string
  workflowName: string
  description?: string
  version: number
  enabled: boolean
  metadata?: Record<string, unknown>
  definition: { steps: Array<{ stepId: string }>; transitions: Array<{ transitionId: string }> }
}

function loadDensityFixture(timestamp: number): DensityFixture {
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as DensityFixture
  return {
    ...raw,
    workflowId: `qa-wf035-density-${timestamp}`,
    workflowName: `QA WF-035 Density ${timestamp}`,
    enabled: false,
  }
}

async function openStudio(page: Page, definitionId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('.react-flow__node[data-id="quote_rendered"]')).toBeVisible({ timeout: 60_000 })
}

test.describe('TC-WF-035: 60-node density — chip cap, overflow badge and semantic zoom', () => {
  test.describe.configure({ timeout: 180_000 })

  test('the whole flow renders with collapsed chips, and a focused route shows the capped chips plus +N', async ({
    page,
    request,
  }) => {
    const apiToken = await getAuthToken(request, 'admin')
    const fixture = loadDensityFixture(Date.now())
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, apiToken, fixture)
      await login(page, 'admin')
      await openStudio(page, definitionId)

      // Every step of the fixture is on the canvas — the scale is real, not trimmed.
      await expect(workflowStepNodes(page)).toHaveCount(fixture.definition.steps.length, { timeout: 60_000 })

      // Fitted to 60 nodes the canvas sits far below the semantic-zoom
      // threshold, so route details collapse into labelled dot rows instead of
      // stacking unreadable chips over every edge.
      const collapsed = page.locator('[data-testid="route-chips-collapsed"]')
      await expect(collapsed.first()).toBeVisible({ timeout: 30_000 })
      await expect(collapsed.first()).toHaveAttribute('role', 'img')
      await expect(collapsed.first()).toHaveAttribute('aria-label', /route details, zoom in to read them/)
      await expect(page.locator('[data-testid="route-chips"]')).toHaveCount(0)

      // Navigating to a step through the command palette centres it at zoom 1,
      // which is above the threshold — the same path a keyboard-only author uses.
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByPlaceholder('Search commands…')).toBeVisible({ timeout: 15_000 })
      await page.getByPlaceholder('Search commands…').fill('Go to step: Quote rendered')
      await page.getByRole('option', { name: 'Go to step: Quote rendered' }).first().click()

      const overflowChip = page.locator('[data-testid="route-chip-overflow"]')
      await expect(overflowChip).toHaveCount(1, { timeout: 30_000 })
      // 5 activities, capped at 3 → the badge accounts for the remaining 2.
      await expect(overflowChip).toHaveText('+2')
      await expect(overflowChip).toHaveAttribute('aria-label', '2 more activities on this route')

      const overflowRow = page
        .locator('[data-testid="route-chips"]')
        .filter({ has: page.locator('[data-testid="route-chip-overflow"]') })
      await expect(overflowRow).toHaveCount(1)
      // 3 capped activity chips + the overflow badge, never all 5.
      await expect(overflowRow.locator('button')).toHaveCount(4)

      // Every chip is a labelled control, so the dense canvas stays reachable
      // by screen reader as well as by eye (spec section 4.6).
      const chipLabels = await overflowRow.locator('button').evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-label') ?? ''),
      )
      expect(chipLabels.every((label) => label.length > 0), 'every route chip carries an aria-label').toBe(true)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })
})
