import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  listWorkflowInstanceSteps,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-079 [P0] (API): version pinning for code-defined workflows (#7184).
 *
 * Spec `.ai/specs/2026-11-11-code-workflow-version-pinning.md` (Phase 1, step 5).
 * The example module registers `example.version-pinning-fixture` at v1 and v2
 * only when `OM_INTEGRATION_TEST` is set. Each version parks on a
 * WAIT_FOR_SIGNAL step and then takes its own path (v1: `wait_v1` →
 * `approved_v1`; v2: `wait_v2` → `approved_v2`).
 *
 * Both versions are registered in one process, so this proves exact-version
 * resolution on the start, signal and transition paths. Before the change a
 * `version: 1` start ran v2, because code definitions ignored the version.
 *
 * Surfaces under test:
 * - POST /api/workflows/instances (with and without `version`)
 * - POST /api/workflows/instances/[id]/signal
 * - GET /api/workflows/instances/[id] and /api/workflows/instances/[id]/steps
 * - GET /api/workflows/definitions
 */

const FIXTURE_WORKFLOW_ID = 'example.version-pinning-fixture'
const FIXTURE_SIGNAL = 'example_version_pinning_approve'
const SINGLE_VERSION_WORKFLOW_ID = 'example.todo-created-reference'

type InstanceDetail = { id?: string; version?: number; status?: string; currentStepId?: string }

async function getInstanceDetail(
  request: APIRequestContext,
  token: string,
  instanceId: string,
): Promise<InstanceDetail | null> {
  const response = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token })
  expect(response.status(), `GET instance should return 200 (got ${response.status()})`).toBe(200)
  const body = await readJsonSafe<{ data?: InstanceDetail }>(response)
  return body?.data ?? null
}

async function signalInstance(request: APIRequestContext, token: string, instanceId: string): Promise<void> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/workflows/instances/${encodeURIComponent(instanceId)}/signal`,
    { token, data: { signalName: FIXTURE_SIGNAL } },
  )
  expect(response.status(), `signal should return 200 (got ${response.status()})`).toBe(200)
}

async function stepIdsOf(request: APIRequestContext, token: string, instanceId: string): Promise<string[]> {
  const steps = await listWorkflowInstanceSteps(request, token, instanceId)
  return steps.map((step) => step.stepId).filter((stepId): stepId is string => Boolean(stepId))
}

test.describe('TC-WF-079: code-defined workflow version pinning', () => {
  test('an explicit v1 start and an unversioned v2 start each run their own graph', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const created: string[] = []

    try {
      const v1Id = await startWorkflowInstanceFixture(request, token, { workflowId: FIXTURE_WORKFLOW_ID, version: 1 })
      created.push(v1Id)
      const v2Id = await startWorkflowInstanceFixture(request, token, { workflowId: FIXTURE_WORKFLOW_ID })
      created.push(v2Id)

      const v1Parked = await pollWorkflowInstance(request, token, v1Id, (i) => i.status === 'PAUSED', { timeoutMs: 20_000 })
      expect(v1Parked?.currentStepId, 'the v1 start parks on the v1 wait step').toBe('wait_v1')
      expect((await getInstanceDetail(request, token, v1Id))?.version, 'the explicit start persists version 1').toBe(1)

      const v2Parked = await pollWorkflowInstance(request, token, v2Id, (i) => i.status === 'PAUSED', { timeoutMs: 20_000 })
      expect(v2Parked?.currentStepId, 'the unversioned start parks on the v2 wait step').toBe('wait_v2')
      expect((await getInstanceDetail(request, token, v2Id))?.version, 'the unversioned start uses the latest version').toBe(2)

      await signalInstance(request, token, v1Id)
      await pollWorkflowInstance(request, token, v1Id, (i) => i.status === 'COMPLETED', { timeoutMs: 20_000 })
      const v1Steps = await stepIdsOf(request, token, v1Id)
      expect(v1Steps, 'the v1 instance resumes through approved_v1').toContain('approved_v1')
      expect(v1Steps.filter((stepId) => stepId.endsWith('_v2')), 'the v1 instance never enters a v2 step').toEqual([])

      await signalInstance(request, token, v2Id)
      await pollWorkflowInstance(request, token, v2Id, (i) => i.status === 'COMPLETED', { timeoutMs: 20_000 })
      const v2Steps = await stepIdsOf(request, token, v2Id)
      expect(v2Steps, 'the v2 instance resumes through approved_v2').toContain('approved_v2')
      expect(v2Steps.filter((stepId) => stepId.endsWith('_v1')), 'the v2 instance never enters a v1 step').toEqual([])
    } finally {
      for (const instanceId of created) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
    }
  })

  test('a single-version code workflow still starts at version 1 and the list shows the fixture once', async ({ request }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    let singleId: string | null = null

    try {
      singleId = await startWorkflowInstanceFixture(request, token, { workflowId: SINGLE_VERSION_WORKFLOW_ID })
      expect((await getInstanceDetail(request, token, singleId))?.version, 'single-version workflows are unchanged').toBe(1)

      const response = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions?search=${encodeURIComponent(FIXTURE_WORKFLOW_ID)}&limit=50`,
        { token },
      )
      expect(response.status(), `GET definitions should return 200 (got ${response.status()})`).toBe(200)
      const body = await readJsonSafe<{ data?: Array<{ workflowId?: string; version?: number }> }>(response)
      const listed = (body?.data ?? []).filter((definition) => definition.workflowId === FIXTURE_WORKFLOW_ID)
      expect(listed, 'the definitions list shows the fixture once').toHaveLength(1)
      expect(listed[0]?.version, 'and that entry is the latest version').toBe(2)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, singleId)
    }
  })
})
