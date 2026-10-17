import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  buildMinimalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

export const integrationMeta = {
  dependsOnModules: ['workflows', 'sales', 'audit_logs'],
}

type CausationFrameSnapshot = {
  kind?: string
  id?: string | null
  meta?: Record<string, unknown>
}

type CausationSnapshot = {
  correlationId?: string
  frames?: CausationFrameSnapshot[]
}

type ActionLogCauseItem = {
  id: string
  commandId: string
  causeKind?: string | null
  causeId?: string | null
}

const CLIENT_CORRELATION_ID = '00000000-0000-4000-8000-00000000c0de'
const INSTANCE_POLL_TIMEOUT_MS = 8_000
const AUDIT_POLL_TIMEOUT_MS = 6_000

function buildOrderUpdateDefinitionPayload(workflowId: string, stamp: number, externalReference: string) {
  return {
    workflowId,
    workflowName: `QA Workflow Causation ${stamp}`,
    description: 'Workflow whose single transition updates a sales order through UPDATE_ENTITY',
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'start-to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto',
          activities: [
            {
              activityId: 'tag-order',
              activityName: 'tagOrder',
              activityType: 'UPDATE_ENTITY',
              config: {
                commandId: 'sales.orders.update',
                input: { id: '{{context.orderId}}', externalReference },
              },
            },
          ],
        },
      ],
    },
    enabled: true,
  }
}

async function listOrderActionLogs(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<ActionLogCauseItem[]> {
  const query = new URLSearchParams({ resourceKind: 'sales.order', resourceId: orderId, pageSize: '50' })
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query.toString()}`, { token })
  const body = await readJsonSafe<{ items?: ActionLogCauseItem[] }>(response)
  expect(response.status(), `GET audit actions should return 200 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(200)
  return body?.items ?? []
}

async function readInstanceCausation(
  request: APIRequestContext,
  token: string,
  instanceId: string,
): Promise<CausationSnapshot | null> {
  const response = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token })
  const body = await readJsonSafe<{ data?: { metadata?: { causation?: CausationSnapshot | null } | null } }>(response)
  expect(response.status(), `GET instance should return 200 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(200)
  return body?.data?.metadata?.causation ?? null
}

/**
 * TC-WF-066: workflow causation (spec 2026-10-08-insights-causation-and-explain).
 *
 * Covers:
 * - POST /api/workflows/definitions
 * - POST /api/workflows/instances
 * - GET  /api/workflows/instances/{id}
 * - GET  /api/audit_logs/audit-logs/actions
 *
 * A workflow activity's command write is attributed to the workflow instance that
 * ran it. The HTTP start schema strips a client-supplied `metadata.causation`, so
 * the start causation stored on the instance is the server-derived one.
 */
test.describe('TC-WF-066: workflow causation', () => {
  test('attributes an UPDATE_ENTITY write to the workflow instance that ran it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    if (!(await canManageSalesOrders(request, token))) {
      test.skip(true, 'sales order management is unavailable for the admin role on this database')
    }

    const stamp = Date.now() + randomInt(1_000)
    const workflowId = `qa-wf-cause-write-${stamp}`
    let orderId: string | null = null
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)
      definitionId = await createWorkflowDefinitionFixture(
        request,
        token,
        buildOrderUpdateDefinitionPayload(workflowId, stamp, `qa-causation-${stamp}`),
      )
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId,
        initialContext: { orderId },
      })
      const startedInstanceId = instanceId
      const targetOrderId = orderId

      const finished = await pollWorkflowInstance(
        request,
        token,
        startedInstanceId,
        (instance) => instance.status === 'COMPLETED' || instance.status === 'FAILED',
        { timeoutMs: INSTANCE_POLL_TIMEOUT_MS },
      )
      expect(finished?.status, 'the UPDATE_ENTITY run should complete').toBe('COMPLETED')

      await expect
        .poll(
          async () =>
            (await listOrderActionLogs(request, token, targetOrderId))
              .filter((item) => item.commandId === 'sales.orders.update')
              .map((item) => ({ causeKind: item.causeKind ?? null, causeId: item.causeId ?? null })),
          { timeout: AUDIT_POLL_TIMEOUT_MS, message: 'the workflow write should be attributed to the workflow instance that ran it' },
        )
        .toContainEqual({ causeKind: 'workflow', causeId: startedInstanceId })
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('strips a client metadata.causation at the start schema and stores the server-derived start causation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)
    const payload = buildMinimalDefinitionPayload(stamp, '-cause-start')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        metadata: {
          causation: {
            correlationId: CLIENT_CORRELATION_ID,
            frames: [{ kind: 'business_rule', id: 'x' }],
          },
        },
      })

      const causation = await readInstanceCausation(request, token, instanceId)
      expect(causation, 'the instance stores a start causation').not.toBeNull()
      expect(causation?.correlationId, 'the client correlation id is not stored').not.toBe(CLIENT_CORRELATION_ID)
      const frames = causation?.frames ?? []
      expect(frames.length, 'the stored causation has an entry frame').toBeGreaterThan(0)
      expect(frames[0]?.kind, 'the entry frame is the authenticated user').toBe('user')
      expect(frames.some((frame) => frame.kind === 'business_rule'), 'no client-supplied frame is stored').toBe(false)
      expect(frames.filter((frame) => frame.meta !== undefined), 'the stored causation holds identifiers only').toEqual([])
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
