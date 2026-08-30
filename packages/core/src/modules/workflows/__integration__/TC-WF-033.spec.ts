import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import { runWorkflowPaletteCommand } from '@open-mercato/core/helpers/integration/workflowsUi'

/**
 * TC-WF-033: route reattachment preserves the route's configuration (#4233).
 *
 * Spec 2026-07-26-workflows-ux-redesign.md section 4.1: "dragging a route
 * endpoint onto another node re-targets it preserving label, conditions, and
 * activities; invalid targets snap back with an inline reason".
 *
 * The assertion that matters is what gets PERSISTED, so the test drags the
 * route's target anchor onto another step, saves, and re-reads the definition
 * through the API: the transition must keep its durable `transitionId`,
 * `transitionName`, `condition`, `priority` and `activities` while only
 * `toStepId` changes. Keeping the id is what makes the edit safe for the engine
 * (`pendingTransition` / `WorkflowBranchInstance.branchKey` resolve against it).
 *
 * The second case covers the refusal path: a self-loop is rejected with a named
 * reason and the route is left exactly as it was.
 *
 * Self-contained: the definition is created via the API in setup and deleted in
 * `finally`; nothing relies on seeded or demo data.
 */

type DefinitionRecord = {
  id?: string
  definition?: {
    transitions?: Array<{
      transitionId?: string
      fromStepId?: string
      toStepId?: string
      transitionName?: string
      priority?: number
      condition?: unknown
      activities?: Array<{ activityId?: string; activityType?: string }>
    }>
  }
}

const RICH_TRANSITION_ID = 't_qa_wf033_rich'
const RICH_CONDITION = { operator: 'AND', rules: [{ field: 'amount', operator: '>', value: 5000 }] }
const RICH_ACTIVITY = {
  activityId: 'notify_reviewer',
  activityName: 'Notify Reviewer',
  activityType: 'SEND_EMAIL',
  config: { to: '{{context.requesterEmail}}', subject: 'Escalated', body: 'Escalated for review' },
}

function buildReattachDefinitionPayload(timestamp: number) {
  return {
    workflowId: `qa-wf033-reattach-${timestamp}`,
    workflowName: `QA WF-033 Reattach ${timestamp}`,
    description: 'Route reattachment fixture (#4233)',
    version: 1,
    enabled: false,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK', userTaskConfig: { assignedTo: 'admin' } },
        { stepId: 'notify', stepName: 'Notify', stepType: 'AUTOMATED' },
        { stepId: 'approved', stepName: 'Approved', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't_qa_wf033_start', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        {
          transitionId: RICH_TRANSITION_ID,
          fromStepId: 'review',
          toStepId: 'notify',
          trigger: 'manual',
          transitionName: 'Escalate for notification',
          priority: 60,
          condition: RICH_CONDITION,
          activities: [RICH_ACTIVITY],
        },
        { transitionId: 't_qa_wf033_done', fromStepId: 'notify', toStepId: 'approved', trigger: 'auto' },
      ],
    },
  }
}

async function openStudio(page: Page, definitionId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('.react-flow__node[data-id="review"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(`.react-flow__edge[data-id="${RICH_TRANSITION_ID}"]`)).toHaveCount(1)
}

/**
 * Drag a route's target anchor onto another step's target handle.
 *
 * React Flow renders the reconnect anchors as transparent circles inside the
 * edge group (`.react-flow__edgeupdater-target`) whenever `edgesReconnectable`
 * is on, and resolves the drop against the handle nearest the pointer — so the
 * drop lands on the handle element itself rather than on the card's centre.
 */
async function dragRouteTargetOnto(page: Page, transitionId: string, targetStepId: string): Promise<void> {
  const anchor = page.locator(`.react-flow__edge[data-id="${transitionId}"] .react-flow__edgeupdater-target`)
  await expect(anchor).toHaveCount(1)
  // Hover first. The anchor is a transparent SVG circle in the edges layer,
  // which the nodes layer paints over wherever the two overlap, and it sits one
  // radius off the target card's border — close enough that a card, a route chip
  // or an outcome-row handle can cover it. Playwright's actionability check then
  // fails HERE and names the element that intercepted the pointer, instead of
  // the press silently landing on whatever is on top and the only report being
  // "the toast never appeared".
  await anchor.scrollIntoViewIfNeeded()
  await anchor.hover()

  const anchorBox = await anchor.boundingBox()
  const handle = page.locator(`.react-flow__node[data-id="${targetStepId}"] .react-flow__handle.target`).first()
  const handleBox = await handle.boundingBox()
  expect(anchorBox, 'route reconnect anchor should be laid out').toBeTruthy()
  expect(handleBox, 'target step handle should be laid out').toBeTruthy()

  const from = { x: anchorBox!.x + anchorBox!.width / 2, y: anchorBox!.y + anchorBox!.height / 2 }
  const to = { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 }

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // A short move inside the anchor's own radius before the long one: React Flow
  // only promotes the press to a reconnect drag once the pointer has moved past
  // `connectionDragThreshold`, and a single interpolated sweep can deliver its
  // first `pointermove` already outside the edge's neighbourhood.
  await page.mouse.move(from.x + anchorBox!.width / 4, from.y, { steps: 4 })
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 10 })
  await page.mouse.move(to.x, to.y, { steps: 10 })
  // Settle on the drop point so the last `pointermove` — the one whose
  // connection state `pointerup` reads — is evaluated at the target handle.
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

async function saveDefinition(page: Page, definitionId: string): Promise<void> {
  // The Studio renders no bare Update/Save button — saving is a command, the
  // same path the keyboard-only spec uses.
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(`/api/workflows/definitions/${definitionId}`) && res.request().method() === 'PUT',
      { timeout: 30_000 },
    ),
    runWorkflowPaletteCommand(page, 'Save'),
  ])
  expect(response.status(), 'PUT after reattachment should succeed').toBe(200)
}

test.describe('TC-WF-033: route reattachment preserves route configuration', () => {
  test.describe.configure({ timeout: 120_000 })

  test('re-targeting a route keeps its id, name, condition, priority and activities', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    const payload = buildReattachDefinitionPayload(Date.now())
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, apiToken, payload)
      await login(page, 'admin')
      await openStudio(page, definitionId)

      await dragRouteTargetOnto(page, RICH_TRANSITION_ID, 'approved')
      await expect(page.getByText('Route re-targeted').first()).toBeVisible({ timeout: 10_000 })

      await saveDefinition(page, definitionId)

      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token: apiToken },
      )
      const body = await readJsonSafe<{ data?: DefinitionRecord }>(detail)
      const transitions = body?.data?.definition?.transitions ?? []
      const reattached = transitions.find((transition) => transition.transitionId === RICH_TRANSITION_ID)

      expect(reattached, 'the durable transition id must survive reattachment').toBeTruthy()
      expect(reattached?.fromStepId, 'the source endpoint is untouched').toBe('review')
      expect(reattached?.toStepId, 'the target endpoint is the drop target').toBe('approved')
      expect(reattached?.transitionName, 'route label preserved').toBe('Escalate for notification')
      expect(reattached?.priority, 'route priority preserved').toBe(60)
      expect(reattached?.condition, 'route condition preserved').toEqual(RICH_CONDITION)
      expect(reattached?.activities?.map((activity) => activity.activityId), 'route activities preserved').toEqual([
        'notify_reviewer',
      ])
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })

  test('an invalid target is refused with a named reason and the route is unchanged', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    const payload = buildReattachDefinitionPayload(Date.now() + 1)
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, apiToken, payload)
      await login(page, 'admin')
      await openStudio(page, definitionId)

      // Dropping the target end back onto the route's own source step is a
      // self-loop: refused with its own reason, never a silent revert.
      await dragRouteTargetOnto(page, RICH_TRANSITION_ID, 'review')
      await expect(page.getByText('A route cannot start and end on the same step.').first()).toBeVisible({
        timeout: 10_000,
      })

      await saveDefinition(page, definitionId)

      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token: apiToken },
      )
      const body = await readJsonSafe<{ data?: DefinitionRecord }>(detail)
      const reattached = (body?.data?.definition?.transitions ?? []).find(
        (transition) => transition.transitionId === RICH_TRANSITION_ID,
      )
      expect(reattached?.toStepId, 'a refused reattachment leaves the route where it was').toBe('notify')
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })
})
