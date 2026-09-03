import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TC-AGENT-PROCDEF-001 — `/api/agent_orchestrator/process-definitions` CRUD,
 * tenant/organization scoping, and the optimistic-lock 409.
 *
 * Source: `.ai/specs/enterprise/agent-orchestrator/2026-08-11-triggered-process-model.md`
 * §Integration coverage, row 1, and §The rename (this route replaced
 * `/api/agent_orchestrator/tasks`).
 *
 * Self-contained: every record is created here and removed in `finally`; nothing
 * depends on seeded or demo data.
 */

const DEFINITIONS = '/api/agent_orchestrator/process-definitions'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const STALE_EXPECTED_AT = '2020-01-01T00:00:00.000Z'

function resolveUrl(path: string): string {
  const base = process.env.BASE_URL?.trim() || null
  return base ? `${base}${path}` : path
}

type DefinitionListItem = { id?: string; name?: string; enabled?: boolean; updated_at?: string | null }

async function listDefinitions(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<DefinitionListItem[]> {
  const response = await apiRequest(request, 'GET', `${DEFINITIONS}?${query}`, { token })
  expect(response.ok(), 'definition list must succeed').toBeTruthy()
  const body = await readJsonSafe<{ items?: DefinitionListItem[] }>(response)
  return body?.items ?? []
}

async function deleteDefinitionIfExists(
  request: APIRequestContext,
  token: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `${DEFINITIONS}?id=${encodeURIComponent(id)}`, { token }).catch(
    () => undefined,
  )
}

test.describe('TC-AGENT-PROCDEF-001: process-definition CRUD, scoping and locking', () => {
  test('creates, lists, reads, updates and soft-deletes a definition', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `TC-PROCDEF-001 ${Date.now()}`
    let definitionId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', DEFINITIONS, {
        token,
        data: { name, targetType: 'agent', targetAgentId: 'deals.health_check', enabled: false },
      })
      expect(createResponse.status(), 'create returns 201').toBe(201)
      definitionId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(definitionId, 'create response carries the new id').toBeTruthy()

      const listed = await listDefinitions(request, token, `id=${encodeURIComponent(definitionId!)}`)
      expect(listed).toHaveLength(1)
      expect(listed[0].name).toBe(name)
      expect(listed[0].updated_at, 'list must return updatedAt for optimistic locking').toBeTruthy()

      const detailResponse = await apiRequest(
        request,
        'GET',
        `${DEFINITIONS}/${encodeURIComponent(definitionId!)}`,
        { token },
      )
      expect(detailResponse.status(), 'detail returns 200').toBe(200)
      const detail = await readJsonSafe<{ task?: { id?: string; updatedAt?: string } }>(detailResponse)
      expect(detail?.task?.id).toBe(definitionId)
      expect(detail?.task?.updatedAt, 'detail must return updatedAt').toBeTruthy()

      const renamed = `${name} (edited)`
      const updateResponse = await apiRequest(request, 'PUT', DEFINITIONS, {
        token,
        data: {
          id: definitionId,
          name: renamed,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          enabled: false,
        },
      })
      expect(updateResponse.status(), 'update returns 200').toBe(200)

      const afterUpdate = await listDefinitions(request, token, `id=${encodeURIComponent(definitionId!)}`)
      expect(afterUpdate[0].name).toBe(renamed)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${DEFINITIONS}?id=${encodeURIComponent(definitionId!)}`,
        { token },
      )
      expect(deleteResponse.status(), 'delete returns 200').toBe(200)

      const afterDelete = await listDefinitions(request, token, `id=${encodeURIComponent(definitionId!)}`)
      expect(afterDelete, 'a soft-deleted definition leaves the list').toHaveLength(0)
      definitionId = null
    } finally {
      await deleteDefinitionIfExists(request, token, definitionId)
    }
  })

  test('never lists or reads a definition belonging to another organization', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let otherOrgId: string | null = null
    let foreignId: string | null = null

    try {
      otherOrgId = await createOrganizationFixture(request, token, {
        name: `TC-PROCDEF-001 org ${stamp}`,
      })

      const createResponse = await apiRequestWithSelectedOrg(request, 'POST', DEFINITIONS, {
        token,
        selectedOrgId: otherOrgId,
        data: {
          name: `TC-PROCDEF-001 foreign ${stamp}`,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          enabled: false,
        },
      })
      expect(createResponse.status(), 'seed create in the other org must succeed').toBe(201)
      foreignId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(foreignId).toBeTruthy()

      // The caller's own organization scope must not see the foreign row.
      const homeScoped = await listDefinitions(request, token, `id=${encodeURIComponent(foreignId!)}`)
      expect(homeScoped, 'a foreign-org definition must not appear in the home-org list').toHaveLength(0)

      const detailResponse = await apiRequest(
        request,
        'GET',
        `${DEFINITIONS}/${encodeURIComponent(foreignId!)}`,
        { token },
      )
      expect(detailResponse.status(), 'a cross-org id 404s, never leaks the row').toBe(404)
    } finally {
      if (otherOrgId && foreignId) {
        await apiRequestWithSelectedOrg(
          request,
          'DELETE',
          `${DEFINITIONS}?id=${encodeURIComponent(foreignId)}`,
          { token, selectedOrgId: otherOrgId },
        ).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, otherOrgId)
    }
  })

  test('a stale updatedAt header makes the edit a 409, not a silent overwrite', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `TC-PROCDEF-001 lock ${Date.now()}`
    let definitionId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', DEFINITIONS, {
        token,
        data: { name, targetType: 'agent', targetAgentId: 'deals.health_check', enabled: false },
      })
      expect(createResponse.status()).toBe(201)
      definitionId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(definitionId).toBeTruthy()

      const conflictResponse = await request.fetch(resolveUrl(DEFINITIONS), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER]: STALE_EXPECTED_AT,
        },
        data: {
          id: definitionId,
          name: `${name} (stale)`,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          enabled: false,
        },
      })
      expect(conflictResponse.status(), 'a stale expected-version must 409').toBe(409)
      const conflictBody = await readJsonSafe<{ code?: string }>(conflictResponse)
      expect(conflictBody?.code).toBe('optimistic_lock_conflict')

      const unchanged = await listDefinitions(request, token, `id=${encodeURIComponent(definitionId!)}`)
      expect(unchanged[0].name, 'the rejected edit must not have been applied').toBe(name)

      // The CURRENT version in the same header is accepted.
      const currentUpdatedAt = unchanged[0].updated_at
      expect(currentUpdatedAt).toBeTruthy()
      const okResponse = await request.fetch(resolveUrl(DEFINITIONS), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER]: new Date(currentUpdatedAt as string).toISOString(),
        },
        data: {
          id: definitionId,
          name: `${name} (fresh)`,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          enabled: false,
        },
      })
      expect(okResponse.status(), 'the current expected-version is accepted').toBe(200)
    } finally {
      await deleteDefinitionIfExists(request, token, definitionId)
    }
  })
})
