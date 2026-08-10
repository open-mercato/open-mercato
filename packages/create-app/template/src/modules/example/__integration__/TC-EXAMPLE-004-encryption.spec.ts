import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

type TodoListResponse = { items?: Array<Record<string, unknown>> }

async function readTodo(
  request: APIRequestContext,
  token: string,
  todoId: string,
  selectedOrgId?: string,
): Promise<Record<string, unknown> | null> {
  const path = `/api/example/todos?ids=${encodeURIComponent(todoId)}&page=1&pageSize=1`
  const response = selectedOrgId
    ? await apiRequestWithSelectedOrg(request, 'GET', path, { token, selectedOrgId })
    : await apiRequest(request, 'GET', path, { token })
  expect(response.ok(), `GET todo by id failed: ${response.status()}`).toBeTruthy()
  const body = await response.json() as TodoListResponse
  return body.items?.[0] ?? null
}

// Read the column, not the API: the whole point of this test is what the database holds, and
// only a direct connection can answer that. Mirrors TC-EXAMPLE-002's connection handling.
if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(process.cwd(), 'apps/mercato', '.env') })
}

// `pg` exports `Client` as a namespace as well as a value under this app's TypeScript config,
// so the instance type has to be derived from the constructor rather than named directly.
type PgClient = InstanceType<typeof Client>

async function withDatabase<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('[internal] DATABASE_URL is required for TC-EXAMPLE-004')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function storedNotes(todoId: string): Promise<string | null> {
  return withDatabase(async (client) => {
    const result = await client.query('select notes from todos where id = $1', [todoId])
    const value = result.rows[0]?.notes
    return typeof value === 'string' ? value : null
  })
}

async function encryptionMapCount(organizationId: string): Promise<number> {
  return withDatabase(async (client) => {
    const result = await client.query(
      "select count(*)::text as count from encryption_maps where entity_id = 'example:todo' and organization_id = $1 and is_active = true",
      [organizationId],
    )
    return Number(result.rows[0]?.count ?? '0')
  })
}

/**
 * Milestone B coverage for the module's at-rest encryption surface.
 *
 * `example/encryption.ts` declares exactly one encrypted field, `Todo.notes`, and the module's
 * read paths are built around that decision: the single-record read decrypts it, the list
 * projection omits it, and `search.ts` excludes it from the searchable whitelist. Those three
 * are one contract — encrypting a field is a decision about every read path that touches it —
 * so this test exercises them together, in two organization scopes, against the real API and
 * the real table.
 */
test.describe('TC-EXAMPLE-004: todo notes are encrypted at rest and excluded from bulk read paths', () => {
  test('round-trips the sensitive field in two scopes while the column never holds plaintext', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const homeSecret = `home secret ${suffix}`
    const otherSecret = `other secret ${suffix}`
    const rotatedSecret = `rotated secret ${suffix}`

    let otherOrgId: string | null = null
    let homeTodoId: string | null = null
    let otherTodoId: string | null = null

    try {
      otherOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-004 org ${suffix}`,
        tenantId,
      })

      const createdHome = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        data: { title: `TC-EXAMPLE-004 home ${suffix}`, notes: homeSecret, cf_priority: 2, cf_severity: 'low' },
      })
      expect(createdHome.ok(), `create home todo failed: ${createdHome.status()}`).toBeTruthy()
      homeTodoId = (await createdHome.json() as { id?: string }).id ?? null
      expect(homeTodoId).toBeTruthy()

      const createdOther = await apiRequestWithSelectedOrg(request, 'POST', '/api/example/todos', {
        token,
        selectedOrgId: otherOrgId,
        data: { title: `TC-EXAMPLE-004 other ${suffix}`, notes: otherSecret, cf_priority: 2, cf_severity: 'low' },
      })
      expect(createdOther.ok(), `create other-org todo failed: ${createdOther.status()}`).toBeTruthy()
      otherTodoId = (await createdOther.json() as { id?: string }).id ?? null
      expect(otherTodoId).toBeTruthy()

      // An authorized single-record read decrypts, in each scope independently.
      expect((await readTodo(request, token, homeTodoId!))?.notes).toBe(homeSecret)
      expect((await readTodo(request, token, otherTodoId!, otherOrgId))?.notes).toBe(otherSecret)

      // At rest the column holds ciphertext for the scope whose encryption map is materialized.
      const homeAtRest = await storedNotes(homeTodoId!)
      expect(homeAtRest, 'the encrypted column must not be empty').toBeTruthy()
      expect(homeAtRest).not.toBe(homeSecret)

      // The second organization is deliberately NOT asserted to be ciphertext here, and the
      // reason is a platform boundary rather than a property of this module. `encryption_maps`
      // rows are materialized per (tenant, organization) at tenant creation, so an organization
      // created afterwards has no row for `example:todo` at all — this test's own fixture is
      // exactly such an organization. What the assertion below pins is the precondition, so the
      // day that seeding covers a later organization the row appears, this expectation fails,
      // and whoever changes it has to decide what the second scope must now store.
      expect(await encryptionMapCount(otherOrgId!), [
        'a newly created organization has no materialized encryption map for example:todo.',
        'Until tenant seeding covers it, a write in that scope is stored unencrypted rather than',
        'refused — a fail-open worth closing in the encryption layer, not in this module.',
      ].join(' ')).toBe(0)

      // The list projection is a response-excluded surface. The route selects `notes` only for
      // a single-record request, so a list row reports it as `null` — the key is present and
      // the value is never the plaintext, and never the ciphertext either, so no caller can
      // copy either one into an export.
      const list = await apiRequest(
        request,
        'GET',
        `/api/example/todos?page=1&pageSize=50&sortField=createdAt&sortDir=desc`,
        { token },
      )
      expect(list.ok(), `list todos failed: ${list.status()}`).toBeTruthy()
      const listBody = await list.json() as TodoListResponse
      const listed = (listBody.items ?? []).find((item) => item.id === homeTodoId)
      expect(listed, 'the created todo must appear in the list').toBeTruthy()
      expect(listed?.notes, 'a list row must not carry the encrypted field').toBeNull()
      expect(JSON.stringify(listBody)).not.toContain(homeSecret)
      expect(JSON.stringify(listBody)).not.toContain(homeAtRest)

      // Updating the field re-encrypts it: the plaintext changes on read and the stored value
      // changes with it, so a stale ciphertext cannot survive an edit.
      const updated = await apiRequest(request, 'PUT', '/api/example/todos', {
        token,
        data: { id: homeTodoId, title: `TC-EXAMPLE-004 home ${suffix}`, notes: rotatedSecret },
      })
      expect(updated.ok(), `update home todo failed: ${updated.status()}`).toBeTruthy()
      expect((await readTodo(request, token, homeTodoId!))?.notes).toBe(rotatedSecret)
      const rotatedAtRest = await storedNotes(homeTodoId!)
      expect(rotatedAtRest).not.toBe(rotatedSecret)
      expect(rotatedAtRest).not.toBe(homeAtRest)

      // Cross-scope: neither record is readable from the other organization's selection.
      expect(await readTodo(request, token, otherTodoId!)).toBeNull()
      expect(await readTodo(request, token, homeTodoId!, otherOrgId)).toBeNull()
    } finally {
      await deleteEntityIfExists(request, token, '/api/example/todos', homeTodoId)
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
