import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

type TriggeredInstance = {
  id: string
  version: number
  definitionId: string
  context?: { id?: unknown; entityId?: unknown } | null
}

const SETTLE_MS = 3_000
const PAGE_SIZE = 100

async function publishDefinition(
  request: APIRequestContext,
  token: string,
  definitionId: string,
): Promise<{ id: string; version: number }> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/workflows/definitions/${encodeURIComponent(definitionId)}/publish`,
    { token, data: {} },
  )
  const body = await readJsonSafe<{ data?: { id?: string; version?: number } }>(response)
  expect(response.status(), `publish should return 200 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(200)
  return {
    id: expectId(body?.data?.id, 'Publish response should include data.id'),
    version: Number(body?.data?.version),
  }
}

async function disableWorkflowDefinitionIfExists(
  request: APIRequestContext,
  token: string,
  definitionId: string,
): Promise<void> {
  await apiRequest(request, 'PUT', `/api/workflows/definitions/${encodeURIComponent(definitionId)}`, {
    token,
    data: { enabled: false },
  }).catch(() => undefined)
}

/**
 * The trigger listens to a tenant-wide event, so people created by specs running
 * in parallel start instances of this workflow too. Only the instances started
 * for the person this spec created are its own.
 */
async function listInstancesStartedFor(
  request: APIRequestContext,
  token: string,
  workflowId: string,
  personId: string,
): Promise<TriggeredInstance[]> {
  const instances: TriggeredInstance[] = []
  let hasMore = true
  for (let offset = 0; hasMore; offset += PAGE_SIZE) {
    const response = await apiRequest(
      request,
      'GET',
      `/api/workflows/instances?workflowId=${encodeURIComponent(workflowId)}&limit=${PAGE_SIZE}&offset=${offset}`,
      { token },
    )
    const body = await readJsonSafe<{ data?: TriggeredInstance[]; pagination?: { hasMore?: boolean } }>(response)
    if (response.status() !== 200) {
      throw new Error(`GET /api/workflows/instances returned ${response.status()}: ${JSON.stringify(body)}`)
    }
    instances.push(...(body?.data ?? []))
    hasMore = body?.pagination?.hasMore === true
  }
  return instances.filter(
    (instance) => instance.context?.id === personId || instance.context?.entityId === personId,
  )
}

async function instancesStartedByNewPerson(
  request: APIRequestContext,
  token: string,
  workflowId: string,
  personId: string,
): Promise<TriggeredInstance[]> {
  await expect
    .poll(async () => (await listInstancesStartedFor(request, token, workflowId, personId)).length, {
      timeout: 30_000,
      message: 'the event trigger should start an instance for the created person',
    })
    .toBeGreaterThan(0)
  // The starts for one event are sequential, so a second (per-version) instance
  // can land just after the first one is visible.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  return listInstancesStartedFor(request, token, workflowId, personId)
}

/**
 * TC-WF-065 [P0] (API): an event trigger starts one instance, on the latest
 * published version.
 *
 * Publishing copies a definition — embedded triggers included — into a new
 * version row and leaves the source row enabled, because instances and pinned
 * sub-workflow callers keep running it. The trigger loader used to project the
 * triggers of every enabled row, so each event started one instance per
 * version. The versioning spec
 * (2026-06-26-subworkflow-explicit-ports-schema-builder) requires "trigger
 * fires latest published": one event, one instance, newest version.
 */
test.describe('TC-WF-065: event triggers fire on the latest published version only', () => {
  test('one event starts a single instance on the newest version after each publish', async ({ request }) => {
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)
    const payload = buildMinimalDefinitionPayload(stamp, '-versions')
    const definitionIds: string[] = []
    const personIds: string[] = []

    try {
      const firstVersionId = await createWorkflowDefinitionFixture(request, token, {
        ...payload,
        definition: {
          ...payload.definition,
          triggers: [
            {
              triggerId: 'on-person-created',
              name: `QA person created ${stamp}`,
              eventPattern: 'customers.person.created',
              enabled: true,
              priority: 0,
            },
          ],
        },
      })
      definitionIds.push(firstVersionId)

      const secondVersion = await publishDefinition(request, token, firstVersionId)
      definitionIds.push(secondVersion.id)
      expect(secondVersion.version).toBe(2)

      const firstPersonId = await createPersonFixture(request, token, {
        firstName: `QA${stamp}`,
        lastName: 'WF065A',
        displayName: `QA${stamp} WF065A`,
      })
      personIds.push(firstPersonId)

      const afterFirstPublish = await instancesStartedByNewPerson(request, token, payload.workflowId, firstPersonId)
      expect(afterFirstPublish.map((instance) => instance.version)).toEqual([2])
      expect(afterFirstPublish[0].definitionId).toBe(secondVersion.id)

      const thirdVersion = await publishDefinition(request, token, secondVersion.id)
      definitionIds.push(thirdVersion.id)
      expect(thirdVersion.version).toBe(3)

      const secondPersonId = await createPersonFixture(request, token, {
        firstName: `QA${stamp}`,
        lastName: 'WF065B',
        displayName: `QA${stamp} WF065B`,
      })
      personIds.push(secondPersonId)

      const afterSecondPublish = await instancesStartedByNewPerson(request, token, payload.workflowId, secondPersonId)
      expect(afterSecondPublish.map((instance) => instance.version)).toEqual([3])
      expect(afterSecondPublish[0].definitionId).toBe(thirdVersion.id)
    } finally {
      for (const personId of personIds) {
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      }
      // Switch every version off first: the trigger is tenant-wide, so a row
      // whose delete is refused must not keep starting instances for other specs.
      for (const definitionId of [...definitionIds].reverse()) {
        await disableWorkflowDefinitionIfExists(request, token, definitionId)
      }
      for (const definitionId of [...definitionIds].reverse()) {
        await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      }
    }
  })
})
