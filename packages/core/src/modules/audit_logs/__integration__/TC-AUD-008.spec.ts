import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityByPathIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DICTIONARY_ENTRY_RESOURCE_KIND,
  createAuditableDictionaryEntry,
  findActionLog,
  listActionLogs,
} from './helpers/auditLogsApi'

/**
 * TC-AUD-008: Action log date-range filtering and pagination
 * Covers:
 *   - GET  /api/audit_logs/audit-logs/actions
 *   - POST /api/dictionaries/{id}/entries
 *
 * `before` / `after` filter on createdAt; pagination echoes page/pageSize and
 * derives total/totalPages. Date assertions are scoped to a single created
 * entry so they are deterministic; pagination assertions are structural and
 * hold regardless of how many unrelated logs the shared database contains.
 */
test.describe('TC-AUD-008: date-range filtering and pagination', () => {
  test('filters by before/after and paginates with consistent metadata', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null
    let secondDictionaryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      const tBeforeCreation = new Date(Date.now() - 60_000).toISOString()
      const tFarFuture = new Date(Date.now() + 3_600_000).toISOString()

      const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud008' })
      dictionaryId = created.dictionaryId
      const log = await findActionLog(request, token, { resourceId: created.entryId })
      expect(log, 'action log for the created entry should exist').not.toBeNull()

      // A second log so the list holds at least two rows for the offset checks,
      // independent of any seeded/other data.
      const second = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud008b' })
      secondDictionaryId = second.dictionaryId

      const scoped = { resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND, resourceId: created.entryId }

      // after: keeps logs created after the timestamp.
      const afterPast = await listActionLogs(request, token, { ...scoped, after: tBeforeCreation })
      expect(
        afterPast.body!.items.some((item) => item.id === log!.id),
        'after=<past> includes a log created after that timestamp',
      ).toBe(true)

      // before: excludes logs created after the timestamp.
      const beforePast = await listActionLogs(request, token, { ...scoped, before: tBeforeCreation })
      expect(beforePast.body!.items.length, 'before=<past> excludes a newer log').toBe(0)

      // before: keeps logs created before a future timestamp.
      const beforeFuture = await listActionLogs(request, token, { ...scoped, before: tFarFuture })
      expect(
        beforeFuture.body!.items.some((item) => item.id === log!.id),
        'before=<future> includes the log',
      ).toBe(true)

      // after: excludes logs created before a future timestamp.
      const afterFuture = await listActionLogs(request, token, { ...scoped, after: tFarFuture })
      expect(afterFuture.body!.items.length, 'after=<future> excludes the log').toBe(0)

      // Pagination is driven by `offset` (the route always applies an offset,
      // defaulting to 0, so `pageSize` + `offset` define the window). A window of
      // size 1 returns a single row with consistent total/totalPages metadata.
      const firstWindow = await listActionLogs(request, token, { pageSize: 1, offset: 0 })
      expect(firstWindow.status, 'paginated list returns 200').toBe(200)
      const firstBody = firstWindow.body!
      expect(firstBody.pageSize, 'pageSize echoes the requested size').toBe(1)
      expect(firstBody.items.length, 'pageSize caps the window to one row').toBe(1)
      expect(firstBody.total, 'total counts at least the two logs created here').toBeGreaterThanOrEqual(2)
      expect(firstBody.totalPages, 'totalPages = ceil(total / pageSize)').toBe(firstBody.total)

      // Advancing the offset returns a different row.
      const secondWindow = await listActionLogs(request, token, { pageSize: 1, offset: 1 })
      expect(secondWindow.body!.items.length, 'the second window returns a row').toBe(1)
      expect(
        secondWindow.body!.items[0].id,
        'advancing the offset moves to a different row',
      ).not.toBe(firstBody.items[0].id)

      // pageSize is capped server-side at 200.
      const cappedPage = await listActionLogs(request, token, { pageSize: 500, offset: 0 })
      expect(cappedPage.body!.pageSize, 'pageSize is clamped to the 200 maximum').toBe(200)

      // An offset past the last record returns no items.
      const beyondLast = await listActionLogs(request, token, { pageSize: 1, offset: 100_000_000 })
      expect(beyondLast.body!.items.length, 'an offset past the last record returns no items').toBe(0)
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
      await deleteEntityByPathIfExists(
        request,
        token,
        secondDictionaryId ? `/api/dictionaries/${encodeURIComponent(secondDictionaryId)}` : null,
      )
    }
  })
})
