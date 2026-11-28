import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityByPathIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DICTIONARY_ENTRY_RESOURCE_KIND,
  createAuditableDictionaryEntry,
  exportActionLogs,
  listActionLogs,
} from './helpers/auditLogsApi'

const UPDATE_COUNT = 3

async function renameEntry(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
  entryId: string,
  label: string,
) {
  const response = await apiRequest(
    request,
    'PATCH',
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId)}`,
    { token, data: { label } },
  )
  expect(response.status(), `renaming the entry to ${label} succeeds`).toBe(200)
}

/**
 * TC-AUD-009: Action log page and limit windows
 * Covers:
 *   - GET   /api/audit_logs/audit-logs/actions
 *   - GET   /api/audit_logs/audit-logs/actions/export
 *   - POST  /api/dictionaries/{id}/entries
 *   - PATCH /api/dictionaries/{id}/entries/{entryId}
 *
 * One dictionary entry is created and renamed three times, which leaves four
 * action logs for that entry. Every list call is scoped to the entry by
 * resourceKind + resourceId, so the windows are deterministic regardless of
 * unrelated logs in the shared database. Each window is compared by id with
 * an unpaginated baseline of the same scope.
 */
test.describe('TC-AUD-009: action log page and limit windows', () => {
  test('page, pageSize, limit and offset select the matching rows', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`
      const originalLabel = `aud009 original ${uniqueSuffix}`
      const labels = Array.from({ length: UPDATE_COUNT }, (_unused, index) => `aud009 rename ${index + 1} ${uniqueSuffix}`)

      const created = await createAuditableDictionaryEntry(request, token, {
        keyPrefix: 'aud009',
        label: originalLabel,
      })
      dictionaryId = created.dictionaryId
      for (const label of labels) {
        await renameEntry(request, token, created.dictionaryId, created.entryId, label)
      }

      const scoped = { resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND, resourceId: created.entryId }
      const expectedTotal = UPDATE_COUNT + 1

      const baseline = await listActionLogs(request, token, { ...scoped, pageSize: 200 })
      expect(baseline.status, 'baseline list returns 200').toBe(200)
      const baselineIds = baseline.body!.items.map((item) => item.id)
      expect(baselineIds.length, 'the entry has one create log and one log per rename').toBe(expectedTotal)
      expect(baseline.body!.total, 'baseline total matches the returned rows').toBe(expectedTotal)
      expect(new Set(baselineIds).size, 'baseline ids are unique').toBe(expectedTotal)

      for (let page = 1; page <= expectedTotal; page += 1) {
        const window = await listActionLogs(request, token, { ...scoped, page, pageSize: 1 })
        expect(window.status, `page ${page} returns 200`).toBe(200)
        expect(
          window.body!.items.map((item) => item.id),
          `page ${page} of size 1 holds row ${page} of the baseline`,
        ).toEqual([baselineIds[page - 1]])
        expect(window.body!.page, `page ${page} is echoed`).toBe(page)
        expect(window.body!.pageSize, 'pageSize is echoed').toBe(1)
        expect(window.body!.total, 'total is independent of the window').toBe(expectedTotal)
        expect(window.body!.totalPages, 'totalPages = ceil(total / pageSize)').toBe(expectedTotal)
      }

      const beyondLastPage = await listActionLogs(request, token, { ...scoped, page: expectedTotal + 1, pageSize: 1 })
      expect(beyondLastPage.status, 'a page past the last one returns 200').toBe(200)
      expect(beyondLastPage.body!.items, 'a page past the last one is empty').toEqual([])
      expect(beyondLastPage.body!.total, 'an empty page still reports the total').toBe(expectedTotal)

      const secondPageOfTwo = await listActionLogs(request, token, { ...scoped, page: 2, pageSize: 2 })
      expect(secondPageOfTwo.status, 'page 2 of size 2 returns 200').toBe(200)
      expect(
        secondPageOfTwo.body!.items.map((item) => item.id),
        'page 2 of size 2 holds rows 3 and 4 of the baseline',
      ).toEqual(baselineIds.slice(2, 4))

      const limited = await listActionLogs(request, token, { ...scoped, limit: 2 })
      expect(limited.status, 'limited list returns 200').toBe(200)
      expect(
        limited.body!.items.map((item) => item.id),
        'limit=2 returns the two newest rows only',
      ).toEqual(baselineIds.slice(0, 2))
      expect(limited.body!.pageSize, 'limit drives the reported page size').toBe(2)
      expect(limited.body!.total, 'limit does not change the total').toBe(expectedTotal)

      const limitedWithOffset = await listActionLogs(request, token, { ...scoped, limit: 2, offset: 1 })
      expect(limitedWithOffset.status, 'limited list with an offset returns 200').toBe(200)
      expect(
        limitedWithOffset.body!.items.map((item) => item.id),
        'limit=2 offset=1 returns rows 2 and 3 of the baseline',
      ).toEqual(baselineIds.slice(1, 3))

      const exported = await exportActionLogs(request, token, { ...scoped, limit: 2 })
      expect(exported.status(), 'limited export returns 200').toBe(200)
      const exportedCsv = await exported.text()
      expect(exportedCsv, 'the limited export holds the newest rename').toContain(labels[2])
      expect(exportedCsv, 'the limited export holds the second newest rename').toContain(labels[1])
      expect(exportedCsv, 'the limited export leaves out the older logs').not.toContain(originalLabel)

      const fullExport = await exportActionLogs(request, token, scoped)
      expect(fullExport.status(), 'full export returns 200').toBe(200)
      expect(await fullExport.text(), 'the full export reaches the oldest rename').toContain(originalLabel)

      const baselineAfter = await listActionLogs(request, token, { ...scoped, pageSize: 200 })
      expect(baselineAfter.status, 'closing baseline list returns 200').toBe(200)
      expect(
        baselineAfter.body!.items.map((item) => item.id),
        'reading windows does not change the log rows',
      ).toEqual(baselineIds)
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
    }
  })
})
