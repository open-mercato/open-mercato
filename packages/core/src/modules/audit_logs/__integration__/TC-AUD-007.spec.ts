import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityByPathIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DICTIONARY_ENTRY_RESOURCE_KIND,
  createAuditableDictionaryEntry,
  exportActionLogs,
  parseCsv,
} from './helpers/auditLogsApi'

const EXPECTED_HEADER = 'When,User,Action,Field,Old Value,New Value,Source'

/**
 * TC-AUD-007: Export action logs as CSV with filters
 * Covers:
 *   - GET  /api/audit_logs/audit-logs/actions/export
 *   - POST /api/dictionaries/{id}/entries
 *
 * The export streams a CSV attachment with a fixed column set. Scoping the
 * export to a single created entry (by resourceKind + resourceId) yields a
 * deterministic one-row body, which lets us assert filter behavior precisely
 * without depending on unrelated logs in the shared database.
 */
test.describe('TC-AUD-007: Export action logs as CSV', () => {
  test('exports a well-formed CSV and honors actionType / resource filters', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null
    let secondDictionaryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud007' })
      dictionaryId = created.dictionaryId
      // A second entry so the unfiltered export carries more than one row.
      const second = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud007b' })
      secondDictionaryId = second.dictionaryId

      // Unfiltered export: correct content type, headers, and at least one row.
      const unfiltered = await exportActionLogs(request, token)
      expect(unfiltered.status(), 'export returns 200').toBe(200)
      expect(unfiltered.headers()['content-type'] ?? '', 'export content-type is CSV').toContain('csv')
      expect(
        unfiltered.headers()['content-disposition'] ?? '',
        'export is served as an attachment',
      ).toContain('attachment')
      const unfilteredCsv = parseCsv(await unfiltered.text())
      expect(unfilteredCsv.header, 'CSV header columns are in the expected order').toBe(EXPECTED_HEADER)
      expect(unfilteredCsv.dataLines.length, 'unfiltered export has data rows').toBeGreaterThan(0)

      // Scoped to a single created entry → exactly one "Create" row.
      const scoped = await exportActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: created.entryId,
      })
      expect(scoped.status(), 'scoped export returns 200').toBe(200)
      const scopedCsv = parseCsv(await scoped.text())
      expect(scopedCsv.header, 'scoped export keeps the CSV header').toBe(EXPECTED_HEADER)
      expect(scopedCsv.dataLines.length, 'scoped export has exactly one row for the entry').toBe(1)
      expect(scopedCsv.dataLines[0], 'the row records a Create action').toContain('Create')

      // actionType filter excludes non-matching action types.
      const editFiltered = await exportActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: created.entryId,
        actionType: 'edit',
      })
      expect(editFiltered.status(), 'edit-filtered export returns 200').toBe(200)
      const editCsv = parseCsv(await editFiltered.text())
      expect(editCsv.header, 'edit-filtered export keeps the CSV header').toBe(EXPECTED_HEADER)
      expect(editCsv.dataLines.length, 'a create entry is excluded by the edit filter').toBe(0)

      // actionType=create includes the create row.
      const createFiltered = await exportActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: created.entryId,
        actionType: 'create',
      })
      expect(createFiltered.status(), 'create-filtered export returns 200').toBe(200)
      const createCsv = parseCsv(await createFiltered.text())
      expect(createCsv.dataLines.length, 'the create filter includes the entry').toBe(1)
      expect(createCsv.dataLines[0], 'the included row is a Create action').toContain('Create')
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
