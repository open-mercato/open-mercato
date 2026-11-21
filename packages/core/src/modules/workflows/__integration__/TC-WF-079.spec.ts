import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
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
 * The example module registers, only when `OM_INTEGRATION_TEST` is set:
 * - `example.version-pinning-fixture` at v1 and v2. Each version parks on a
 *   WAIT_FOR_SIGNAL step and then takes its own path (v1: `wait_v1` →
 *   `approved_v1`; v2: `wait_v2` → `approved_v2`).
 * - `example.version-pinning-parent-fixture`, whose SUB_WORKFLOW step pins the
 *   fixture to `version: 1` — a trusted, definition-authored pin.
 *
 * Two guarantees:
 * - The public start boundary always runs the LATEST code version. A caller
 *   holding only `workflows.instances.create` who sends `version: 1` gets v2,
 *   so a retained older graph cannot be used to skip steps v2 added.
 * - An instance already running on v1 (seeded through the trusted pin while v2
 *   is the latest) resumes on its original v1 graph.
 *
 * Surfaces under test:
 * - POST /api/workflows/instances (with and without `version`)
 * - GET /api/workflows/instances?parentInstanceId=
 * - POST /api/workflows/instances/[id]/signal
 * - GET /api/workflows/instances/[id] and /api/workflows/instances/[id]/steps
 * - GET /api/workflows/definitions
 */

const FIXTURE_WORKFLOW_ID = 'example.version-pinning-fixture'
const PARENT_FIXTURE_WORKFLOW_ID = 'example.version-pinning-parent-fixture'
const FIXTURE_SIGNAL = 'example_version_pinning_approve'
const SINGLE_VERSION_WORKFLOW_ID = 'example.todo-created-reference'
const INSTANCE_CREATE_FEATURES = [
  'workflows.view',
  'workflows.definitions.view',
  'workflows.instances.view',
  'workflows.instances.create',
]

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

async function findChildInstanceId(
  request: APIRequestContext,
  token: string,
  parentInstanceId: string,
): Promise<string | null> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const response = await apiRequest(
      request,
      'GET',
      `/api/workflows/instances?parentInstanceId=${encodeURIComponent(parentInstanceId)}&limit=10`,
      { token },
    )
    expect(response.status(), `GET child instances should return 200 (got ${response.status()})`).toBe(200)
    const body = await readJsonSafe<{ data?: Array<{ id?: string }> }>(response)
    const childId = body?.data?.[0]?.id
    if (childId) return childId
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

test.describe('TC-WF-079: code-defined workflow version pinning', () => {
  test('a caller with the instance-create grant cannot start a retained older code version', async ({ request }) => {
    test.setTimeout(120_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const email = `qa-tc-wf-079-${stamp}@example.com`
    const password = 'StrongSecret123!'
    const created: string[] = []
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-wf-079-${stamp}`,
        ...(tenantId ? { tenantId } : {}),
      })
      await setRoleAclFeatures(request, superadminToken, { roleId, features: INSTANCE_CREATE_FEATURES, organizations: null })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-WF-079',
      })
      const creatorToken = await getAuthToken(request, email, password)

      const requestedV1Id = await startWorkflowInstanceFixture(request, creatorToken, { workflowId: FIXTURE_WORKFLOW_ID, version: 1 })
      created.push(requestedV1Id)
      const unversionedId = await startWorkflowInstanceFixture(request, creatorToken, { workflowId: FIXTURE_WORKFLOW_ID })
      created.push(unversionedId)

      for (const instanceId of [requestedV1Id, unversionedId]) {
        const parked = await pollWorkflowInstance(request, creatorToken, instanceId, (i) => i.status === 'PAUSED', { timeoutMs: 20_000 })
        expect(parked?.currentStepId, 'every public start parks on the latest (v2) wait step').toBe('wait_v2')
        expect((await getInstanceDetail(request, creatorToken, instanceId))?.version, 'every public start persists the latest version').toBe(2)
      }

      await signalInstance(request, adminToken, requestedV1Id)
      await pollWorkflowInstance(request, adminToken, requestedV1Id, (i) => i.status === 'COMPLETED', { timeoutMs: 20_000 })
      const requestedSteps = await stepIdsOf(request, adminToken, requestedV1Id)
      expect(requestedSteps, 'the version: 1 request runs the v2 graph').toContain('approved_v2')
      expect(requestedSteps.filter((stepId) => stepId.endsWith('_v1')), 'the version: 1 request never enters a v1 step').toEqual([])
    } finally {
      for (const instanceId of created) {
        await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      }
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('an instance already running on v1 resumes on its original graph while v2 is latest', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const created: string[] = []

    try {
      const parentId = await startWorkflowInstanceFixture(request, token, { workflowId: PARENT_FIXTURE_WORKFLOW_ID })
      created.push(parentId)
      const childId = await findChildInstanceId(request, token, parentId)
      expect(childId, 'the trusted SUB_WORKFLOW pin starts a child instance').toBeTruthy()
      created.push(childId!)

      const childParked = await pollWorkflowInstance(request, token, childId!, (i) => i.status === 'PAUSED', { timeoutMs: 20_000 })
      expect(childParked?.currentStepId, 'the pinned child parks on the v1 wait step').toBe('wait_v1')
      expect((await getInstanceDetail(request, token, childId!))?.version, 'the pinned child persists version 1').toBe(1)

      const latestId = await startWorkflowInstanceFixture(request, token, { workflowId: FIXTURE_WORKFLOW_ID })
      created.push(latestId)
      expect((await getInstanceDetail(request, token, latestId))?.version, 'v2 is the latest version meanwhile').toBe(2)

      await signalInstance(request, token, childId!)
      await pollWorkflowInstance(request, token, childId!, (i) => i.status === 'COMPLETED', { timeoutMs: 20_000 })
      const childSteps = await stepIdsOf(request, token, childId!)
      expect(childSteps, 'the v1 instance resumes through approved_v1').toContain('approved_v1')
      expect(childSteps.filter((stepId) => stepId.endsWith('_v2')), 'the v1 instance never enters a v2 step').toEqual([])
    } finally {
      for (const instanceId of created.reverse()) {
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
