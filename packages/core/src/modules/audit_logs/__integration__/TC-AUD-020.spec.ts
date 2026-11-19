import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * TC-AUD-020: the access log list returns every row exactly once when walked
 * page by page, even when rows share createdAt, ordered by id within the tie.
 *
 * One CRUD list read writes its access rows in a single batch with one shared
 * created_at, so listing 12 roles produces 12 tied access rows through the real
 * write path. Without a unique tiebreak their relative order depends on the
 * query plan, and a sorted plan can repeat one row on several pages.
 */

const ROW_COUNT = 12
const PAGE_SIZE = 2

type AccessItem = { id?: string; resourceId?: string; createdAt?: string }
type AccessListBody = { items?: AccessItem[]; total?: number }

async function readAccessPage(request: APIRequestContext, token: string, query: string): Promise<AccessListBody> {
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/access?${query}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<AccessListBody>(response)) ?? {}
}

async function waitForTiedRows(
  request: APIRequestContext,
  token: string,
  after: string,
  roleIds: string[],
): Promise<AccessItem[]> {
  const wanted = new Set(roleIds)
  const deadline = Date.now() + 30_000
  let rows: AccessItem[] = []
  while (Date.now() < deadline) {
    const body = await readAccessPage(request, token, `after=${encodeURIComponent(after)}&pageSize=200`)
    rows = (body.items ?? []).filter((item) => typeof item.resourceId === 'string' && wanted.has(item.resourceId))
    if (rows.length >= ROW_COUNT) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return rows
}

async function walkPages(request: APIRequestContext, token: string, windowQuery: string): Promise<string[]> {
  const ids: string[] = []
  for (let page = 1; page <= ROW_COUNT / PAGE_SIZE; page += 1) {
    const body = await readAccessPage(request, token, `${windowQuery}&page=${page}&pageSize=${PAGE_SIZE}`)
    expect(body.total).toBe(ROW_COUNT)
    for (const item of body.items ?? []) {
      if (item.id) ids.push(item.id)
    }
  }
  return ids
}

test.describe('TC-AUD-020: access log pagination stays stable when createdAt ties', () => {
  test('access log pages return every row of one batched read exactly once', async ({ request }) => {
    test.setTimeout(90_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = `qa-aud-020-${Date.now()}`
    const startedAt = new Date(Date.now() - 1_000).toISOString()
    const roleIds: string[] = []
    const accessLogIds: string[] = []
    try {
      for (let index = 0; index < ROW_COUNT; index += 1) {
        roleIds.push(await createRoleFixture(request, token, { name: `${stamp}-${index}` }))
      }

      const rolesResponse = await apiRequest(
        request,
        'GET',
        `/api/auth/roles?search=${encodeURIComponent(stamp)}&pageSize=50`,
        { token },
      )
      expect(rolesResponse.status()).toBe(200)
      const rolesBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(rolesResponse)
      expect((rolesBody?.items ?? []).map((item) => item.id).sort()).toEqual([...roleIds].sort())

      const tiedRows = await waitForTiedRows(request, token, startedAt, roleIds)
      for (const row of tiedRows) {
        if (row.id) accessLogIds.push(row.id)
      }
      expect(tiedRows).toHaveLength(ROW_COUNT)
      const tiedAt = tiedRows[0].createdAt as string
      expect(new Set(tiedRows.map((row) => row.createdAt))).toEqual(new Set([tiedAt]))

      const tiedMs = Date.parse(tiedAt)
      const windowQuery = [
        'resourceKind=auth.role',
        `after=${encodeURIComponent(new Date(tiedMs - 1).toISOString())}`,
        `before=${encodeURIComponent(new Date(tiedMs + 1).toISOString())}`,
      ].join('&')

      const walk = await walkPages(request, token, windowQuery)
      expect(new Set(walk).size).toBe(ROW_COUNT)
      expect(walk).toEqual([...accessLogIds].sort().reverse())
    } finally {
      for (const roleId of roleIds) {
        await deleteRoleIfExists(request, token, roleId)
      }
      if (accessLogIds.length > 0) {
        await withClient(async (client) => {
          await client.query('delete from access_logs where id = any($1::uuid[])', [accessLogIds])
        })
      }
    }
  })
})
