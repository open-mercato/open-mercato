import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  buildCompletedRunDefinitionPayload,
  buildMinimalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceSteps,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  openWorkflowStudio,
  WORKFLOW_TAKEN_ROUTE_STROKE,
  workflowEdgePath,
  workflowLastRunToggle,
  workflowNodeStatus,
} from '@open-mercato/core/helpers/integration/workflowsUi'

/**
 * TC-WF-058 [P0] (UI): the execution overlay after a run.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §8.3: *"**Overlay on the
 * Studio canvas:** "Show last run" paints node states with DS status tokens"*.
 * Section 10 names it as a required Playwright path.
 *
 * What makes this worth a browser test rather than a unit test of
 * `deriveRunExecution`: the overlay is a RENDER-TIME decoration
 * (`workflows/AGENTS.md` → "The Studio overlay is render-time only"), so the
 * things that can break are the wiring, not the derivation — the toggle not
 * fetching, the derived status not reaching the node card, the taken route not
 * being repainted, or the overlay leaking into the document. Each is asserted:
 *
 * - BEFORE the toggle every node reads `not_started`, and the overlay fetches
 *   nothing — an author editing a definition must not pay for three requests
 *   they never asked for.
 * - AFTER it, each executed step reads its run status off `data-node-status` and
 *   the route the run took is repainted with the success token, while a route it
 *   did not take is not.
 * - A definition that has never run says so instead of painting an empty overlay
 *   that reads like "nothing executed".
 *
 * Surfaces under test:
 * - /backend/definitions/visual-editor?id= ("Last run" toggle)
 * - GET /api/workflows/instances, /instances/[id]/steps, /instances/[id]/events
 */

test.describe('TC-WF-058: the Studio paints the last run', () => {
  test('toggling the overlay paints the executed steps and the route they took', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildCompletedRunDefinitionPayload(stamp)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        initialContext: { probe: stamp },
      })
      const finished = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'COMPLETED' || instance.status === 'FAILED',
        { timeoutMs: 40_000 },
      )
      expect(finished?.status, 'the fixture run completes, so there is a run to paint').toBe(
        'COMPLETED',
      )

      // The overlay reads `StepInstance` rows for step state — the authoritative
      // source — so the run must have left them behind. START is deliberately
      // absent: it leaves no row at all, which is exactly why §8.3 resolves
      // START/END from the instance status instead (`resolveNodeRunStatus`).
      const steps = await listWorkflowInstanceSteps(request, token, instanceId)
      expect(
        steps.filter((step) => step.status === 'COMPLETED').map((step) => step.stepId).sort(),
        'the run recorded a completed row per executed step',
      ).toEqual(['end', 'finish', 'prepare'])
      expect(
        steps.some((step) => step.stepId === 'start'),
        'the START step records no execution row of its own',
      ).toBe(false)

      await login(page, 'admin')

      // Any run-view request the page makes; used to prove the overlay is inert
      // until it is switched on.
      let runRequestCount = 0
      await page.route('**/api/workflows/instances**', async (route) => {
        runRequestCount += 1
        await route.fallback()
      })

      await openWorkflowStudio(page, definitionId)

      // The editor's own look. `toWorkflowStatus` collapses an absent status to
      // `not_started`, which is what an un-overlaid canvas must read as.
      await expect(workflowNodeStatus(page, 'prepare')).toHaveAttribute(
        'data-node-status',
        'not_started',
      )
      await expect(workflowNodeStatus(page, 'finish')).toHaveAttribute(
        'data-node-status',
        'not_started',
      )
      expect(runRequestCount, 'the overlay fetches nothing until it is enabled').toBe(0)

      const toggle = workflowLastRunToggle(page)
      await expect(toggle).toBeVisible()
      await expect(toggle, 'the overlay is off by default').toHaveAttribute('aria-pressed', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')

      // Every executed step is repainted from its recorded status.
      await expect(workflowNodeStatus(page, 'prepare')).toHaveAttribute(
        'data-node-status',
        'completed',
        { timeout: 30_000 },
      )
      await expect(workflowNodeStatus(page, 'finish')).toHaveAttribute(
        'data-node-status',
        'completed',
      )
      // START/END carry no execution record of their own; §8.3's conventions
      // resolve them from the instance status.
      await expect(workflowNodeStatus(page, 'start')).toHaveAttribute(
        'data-node-status',
        'completed',
      )
      await expect(workflowNodeStatus(page, 'end')).toHaveAttribute('data-node-status', 'completed')

      // Status is never colour-only (§4.6): the card also announces it.
      await expect(
        page.locator('.react-flow__node[data-id="prepare"] [role="group"]').first(),
      ).toHaveAttribute('aria-label', /completed/i)

      // The TAKEN PATH. A transition leaves no row of its own, so the overlay
      // derives it from `TRANSITION_EXECUTED` events; the repaint reaches the DOM
      // only as the edge's inline stroke.
      await expect(workflowEdgePath(page, 'prepare-to-finish')).toHaveAttribute(
        'style',
        new RegExp(WORKFLOW_TAKEN_ROUTE_STROKE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        { timeout: 30_000 },
      )
      expect(runRequestCount, 'and enabling it is what triggers the fetch').toBeGreaterThan(0)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('a definition that has never run says so instead of painting an empty overlay', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)

    let definitionId: string | null = null

    try {
      const payload = buildMinimalDefinitionPayload(stamp, '-neverrun')
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      await login(page, 'admin')
      await openWorkflowStudio(page, definitionId)

      const toggle = workflowLastRunToggle(page)
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')

      await expect(
        toggle.getByText(/never run/i),
        'the toggle states that there is no run to paint',
      ).toBeVisible({ timeout: 30_000 })
      // And no node is repainted, so an author cannot read the absence of a run
      // as a run that did nothing.
      await expect(workflowNodeStatus(page, 'start')).toHaveAttribute(
        'data-node-status',
        'not_started',
      )
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
