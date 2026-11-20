import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  getCapturedOmEvents,
  installOmEventCollector,
} from '@open-mercato/core/modules/core/__integration__/helpers/sseEventCollector'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-081: overlapping step-through Continue requests publish `resumed` once
 * per real transition (#7186 review)
 *
 * Two Continue requests fired together both read the same PAUSED snapshot.
 * The resume is a conditional write on the observed wait, so whichever request
 * loses answers 409 and publishes nothing. When the requests do not actually
 * overlap, the second one legitimately continues the NEXT parked step. Either
 * way every `resumed` on the bus matches exactly one 200 response, and no step
 * is announced as resumed twice.
 */

const RESUMED = 'workflows.instance.resumed'

async function waitForEventBridgeSubscription(page: Page): Promise<void> {
  await page.goto('/backend')
  await page.waitForLoadState('domcontentloaded')
  await installOmEventCollector(page)
  await page.waitForFunction(
    () => (window as unknown as { __omEventBridgeReady?: boolean }).__omEventBridgeReady === true,
    undefined,
    { timeout: 30_000 },
  )
}

async function resumedStepsFor(page: Page, instanceId: string): Promise<string[]> {
  const events = await getCapturedOmEvents(page)
  return events
    .filter((event) => event.id === RESUMED && event.payload?.id === instanceId)
    .map((event) => String(event.payload?.stepId))
}

async function readInstance(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  instanceId: string,
): Promise<{ status?: string; currentStepId?: string }> {
  const response = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ data?: { status?: string; currentStepId?: string } }>(response)
  return body?.data ?? {}
}

test.describe('TC-WF-081: overlapping step-through Continue requests', () => {
  test('publish resumed only for the request whose resume write wins', async ({ page, request }) => {
    test.setTimeout(90_000)
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-081-${timestamp}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      await login(page, 'admin')
      await waitForEventBridgeSubscription(page)

      definitionId = await createWorkflowDefinitionFixture(request, token, {
        workflowId,
        workflowName: `QA TC-WF-081 ${timestamp}`,
        description: 'Integration test: overlapping step-through resumes',
        version: 1,
        enabled: true,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'first', stepName: 'First', stepType: 'AUTOMATED' },
            { stepId: 'second', stepName: 'Second', stepType: 'AUTOMATED' },
            { stepId: 'third', stepName: 'Third', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { transitionId: 'start-to-first', fromStepId: 'start', toStepId: 'first', trigger: 'auto' },
            { transitionId: 'first-to-second', fromStepId: 'first', toStepId: 'second', trigger: 'auto' },
            { transitionId: 'second-to-third', fromStepId: 'second', toStepId: 'third', trigger: 'auto' },
            { transitionId: 'third-to-end', fromStepId: 'third', toStepId: 'end', trigger: 'auto' },
          ],
        },
      })

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId,
        initialContext: {},
        stepThrough: true,
      })
      const runId = instanceId

      await expect.poll(async () => (await readInstance(request, token, runId)).status, { timeout: 10_000 }).toBe('PAUSED')

      const continueRun = () =>
        apiRequest(request, 'POST', `/api/workflows/instances/${encodeURIComponent(runId)}/step-through`, {
          token,
          data: { action: 'continue' },
        })
      const responses = await Promise.all([continueRun(), continueRun(), continueRun()])
      const statuses = responses.map((response) => response.status())

      expect(statuses.every((status) => status === 200 || status === 409)).toBe(true)
      const winners = statuses.filter((status) => status === 200).length
      expect(winners).toBeGreaterThanOrEqual(1)

      await expect.poll(async () => (await resumedStepsFor(page, runId)).length, { timeout: 10_000 }).toBe(winners)
      await page.waitForTimeout(500)
      const resumedSteps = await resumedStepsFor(page, runId)
      expect(resumedSteps).toHaveLength(winners)
      expect(new Set(resumedSteps).size).toBe(resumedSteps.length)

      const settled = await readInstance(request, token, runId)
      expect(['PAUSED', 'COMPLETED']).toContain(settled.status)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
