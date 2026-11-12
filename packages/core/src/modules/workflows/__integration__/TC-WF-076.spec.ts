import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  getCapturedOmEvents,
  installOmEventCollector,
  type CapturedEvent,
} from '@open-mercato/core/modules/core/__integration__/helpers/sseEventCollector'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-076: workflows.instance.paused / resumed reach the bus (#7186)
 *
 * Both events carry `clientBroadcast: true`, so the DOM Event Bridge is an
 * observable, fixture-free view of what the executor published. A run that
 * parks on a signal, resumes, re-parks on a second signal and resumes again
 * must publish exactly paused → resumed → paused → resumed for that instance,
 * each with the identity-only lifecycle payload, and a stale delivery the
 * engine refuses must publish nothing.
 */

const IDENTITY_KEYS = ['id', 'organizationId', 'status', 'stepId', 'tenantId', 'version', 'workflowId']
const PARK_EVENT_IDS = new Set(['workflows.instance.paused', 'workflows.instance.resumed'])

async function waitForEventBridgeSubscription(page: Page): Promise<void> {
  await page.goto('/backend')
  await page.waitForLoadState('domcontentloaded')
  await installOmEventCollector(page)
  // The bridge marks readiness in EventSource onopen and the server never
  // replays: an event emitted before the handshake is silently dropped.
  await page.waitForFunction(
    () => (window as unknown as { __omEventBridgeReady?: boolean }).__omEventBridgeReady === true,
    undefined,
    { timeout: 30_000 },
  )
}

async function parkEventsFor(page: Page, instanceId: string): Promise<CapturedEvent[]> {
  const events = await getCapturedOmEvents(page)
  return events.filter((event) => PARK_EVENT_IDS.has(event.id) && event.payload?.id === instanceId)
}

async function parkSequenceFor(page: Page, instanceId: string): Promise<string[]> {
  return (await parkEventsFor(page, instanceId)).map((event) => `${event.id}@${String(event.payload?.stepId)}`)
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

async function sendSignal(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  instanceId: string,
  signalName: string,
) {
  return apiRequest(request, 'POST', `/api/workflows/instances/${encodeURIComponent(instanceId)}/signal`, {
    token,
    data: { signalName, payload: { secretNote: 'must-not-be-broadcast' } },
  })
}

test.describe('TC-WF-076: workflows.instance.paused / resumed lifecycle events', () => {
  test('a park → resume → re-park → resume run publishes each transition exactly once', async ({ page, request }) => {
    test.setTimeout(90_000)
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-074-${timestamp}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      await login(page, 'admin')
      await waitForEventBridgeSubscription(page)

      definitionId = await createWorkflowDefinitionFixture(request, token, {
        workflowId,
        workflowName: `QA TC-WF-076 ${timestamp}`,
        description: 'Integration test: paused/resumed lifecycle events',
        version: 1,
        enabled: true,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            {
              stepId: 'wait_one',
              stepName: 'Wait for first signal',
              stepType: 'WAIT_FOR_SIGNAL',
              signalConfig: { signalName: 'qa_wf_074_one' },
            },
            {
              stepId: 'wait_two',
              stepName: 'Wait for second signal',
              stepType: 'WAIT_FOR_SIGNAL',
              signalConfig: { signalName: 'qa_wf_074_two' },
            },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { transitionId: 'start-to-one', fromStepId: 'start', toStepId: 'wait_one', trigger: 'auto' },
            { transitionId: 'one-to-two', fromStepId: 'wait_one', toStepId: 'wait_two', trigger: 'auto' },
            { transitionId: 'two-to-end', fromStepId: 'wait_two', toStepId: 'end', trigger: 'auto' },
          ],
        },
      })
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId,
        initialContext: { secretNote: 'must-not-be-broadcast' },
      })
      const runId = instanceId

      await expect.poll(async () => (await readInstance(request, token, runId)).status, { timeout: 10_000 }).toBe('PAUSED')
      await expect
        .poll(async () => parkSequenceFor(page, runId), { timeout: 10_000 })
        .toEqual(['workflows.instance.paused@wait_one'])

      const firstSignal = await sendSignal(request, token, runId, 'qa_wf_074_one')
      expect(firstSignal.status()).toBe(200)
      await expect
        .poll(async () => parkSequenceFor(page, runId), { timeout: 10_000 })
        .toEqual([
          'workflows.instance.paused@wait_one',
          'workflows.instance.resumed@wait_one',
          'workflows.instance.paused@wait_two',
        ])

      const stale = await sendSignal(request, token, runId, 'qa_wf_074_one')
      expect(stale.status()).toBe(400)

      const secondSignal = await sendSignal(request, token, runId, 'qa_wf_074_two')
      expect(secondSignal.status()).toBe(200)
      await expect.poll(async () => (await readInstance(request, token, runId)).status, { timeout: 10_000 }).toBe('COMPLETED')
      await expect
        .poll(async () => parkSequenceFor(page, runId), { timeout: 10_000 })
        .toEqual([
          'workflows.instance.paused@wait_one',
          'workflows.instance.resumed@wait_one',
          'workflows.instance.paused@wait_two',
          'workflows.instance.resumed@wait_two',
        ])

      for (const event of await parkEventsFor(page, runId)) {
        const payload = event.payload ?? {}
        expect(Object.keys(payload).sort()).toEqual(IDENTITY_KEYS)
        expect(payload).toMatchObject({ id: runId, workflowId, version: 1 })
        expect(payload.status).toBe(event.id === 'workflows.instance.paused' ? 'PAUSED' : 'RUNNING')
        expect(JSON.stringify(payload)).not.toContain('must-not-be-broadcast')
      }
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
