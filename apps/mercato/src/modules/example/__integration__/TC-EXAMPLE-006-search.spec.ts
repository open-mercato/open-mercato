import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

export const integrationMeta = {
  dependsOnModules: ['example', 'search', 'query_index'],
}

type SearchResponse = { results?: Array<{ entityId?: unknown; recordId?: unknown }> }

async function searchRaw(
  request: APIRequestContext,
  token: string,
  query: string,
  selectedOrgId?: string,
): Promise<{ ok: boolean; body: string; hits: string[] }> {
  const params = new URLSearchParams({
    q: query,
    limit: '20',
    strategies: 'tokens',
    entityTypes: 'example:todo',
  })
  const path = `/api/search/search?${params.toString()}`
  const response = selectedOrgId
    ? await apiRequestWithSelectedOrg(request, 'GET', path, { token, selectedOrgId })
    : await apiRequest(request, 'GET', path, { token })
  if (!response.ok()) return { ok: false, body: '', hits: [] }
  const raw = await response.text()
  const parsed = JSON.parse(raw) as SearchResponse
  const hits = (parsed.results ?? [])
    .filter((result) => result.entityId === 'example:todo')
    .map((result) => String(result.recordId))
  // Only the results are checked for leakage. The envelope echoes the caller's own `query`
  // back, so asserting against the whole body would fail on the search term the test itself
  // supplied — which proves nothing about what the index stored.
  return { ok: true, body: JSON.stringify(parsed.results ?? []), hits }
}

async function findsTodo(
  request: APIRequestContext,
  token: string,
  query: string,
  todoId: string,
  selectedOrgId?: string,
): Promise<boolean> {
  const { hits } = await searchRaw(request, token, query, selectedOrgId)
  return hits.includes(todoId)
}

/**
 * Milestone B coverage for the module's search surface.
 *
 * `example/search.ts` declares the entity's searchable whitelist and deliberately excludes
 * `notes`, which `encryption.ts` encrypts at rest. The two decisions have to hold together:
 * the token index is built from plaintext hashes, so a note stays *findable* without ever being
 * *readable* from a search response. This test proves the whole index lifecycle — create,
 * rename, delete — and both halves of that exclusion, in two organization scopes.
 */
test.describe('TC-EXAMPLE-006: todo search indexes the record lifecycle without leaking the encrypted field', () => {
  test('indexes on create, follows a rename, drops on delete, and never returns note plaintext', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const firstToken = `tcsixa${suffix}`
    const renamedToken = `tcsixb${suffix}`
    const secretNote = `tcsixsecret${suffix}`
    let todoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        data: {
          title: `TC-EXAMPLE-006 ${firstToken}`,
          notes: `note body ${secretNote}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(created.ok(), `create todo failed: ${created.status()}`).toBeTruthy()
      todoId = (await created.json() as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      await expect
        .poll(() => findsTodo(request, token, firstToken, todoId!), { timeout: 20_000 })
        .toBe(true)

      // The encrypted field is indexed as hashed tokens, so it stays findable...
      await expect
        .poll(() => findsTodo(request, token, secretNote, todoId!), { timeout: 20_000 })
        .toBe(true)
      // ...but the plaintext must never appear in a search response body.
      const secretSearch = await searchRaw(request, token, secretNote)
      expect(secretSearch.ok).toBe(true)
      expect(secretSearch.body).not.toContain(secretNote)

      const renamed = await apiRequest(request, 'PUT', '/api/example/todos', {
        token,
        data: { id: todoId, title: `TC-EXAMPLE-006 ${renamedToken}` },
      })
      expect(renamed.ok(), `rename todo failed: ${renamed.status()}`).toBeTruthy()

      await expect
        .poll(
          async () => ({
            old: await findsTodo(request, token, firstToken, todoId!),
            next: await findsTodo(request, token, renamedToken, todoId!),
          }),
          { timeout: 20_000 },
        )
        .toEqual({ old: false, next: true })

      const removed = await apiRequest(request, 'DELETE', '/api/example/todos', {
        token,
        data: { id: todoId },
      })
      expect(removed.ok(), `delete todo failed: ${removed.status()}`).toBeTruthy()

      await expect
        .poll(() => findsTodo(request, token, renamedToken, todoId!), { timeout: 20_000 })
        .toBe(false)
      todoId = null
    } finally {
      await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
    }
  })

  test('never returns another organization index entry to the wrong scope', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const scopedToken = `tcsixscope${suffix}`
    let otherOrgId: string | null = null
    let otherTodoId: string | null = null

    try {
      otherOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-006 org ${suffix}`,
        tenantId,
      })

      const created = await apiRequestWithSelectedOrg(request, 'POST', '/api/example/todos', {
        token,
        selectedOrgId: otherOrgId,
        data: { title: `TC-EXAMPLE-006 ${scopedToken}`, cf_priority: 2, cf_severity: 'low' },
      })
      expect(created.ok(), `create other-org todo failed: ${created.status()}`).toBeTruthy()
      otherTodoId = (await created.json() as { id?: string }).id ?? null
      expect(otherTodoId).toBeTruthy()

      // It is indexed and findable in its own organization...
      await expect
        .poll(() => findsTodo(request, token, scopedToken, otherTodoId!, otherOrgId!), { timeout: 20_000 })
        .toBe(true)

      // ...and never surfaces in the caller's home organization, even though both share a tenant
      // and the query matches exactly.
      const homeSearch = await searchRaw(request, token, scopedToken)
      expect(homeSearch.ok).toBe(true)
      expect(homeSearch.hits).not.toContain(otherTodoId)
    } finally {
      if (otherTodoId && otherOrgId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', '/api/example/todos', {
          token,
          selectedOrgId: otherOrgId,
          data: { id: otherTodoId },
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, otherOrgId)
    }
  })
})
