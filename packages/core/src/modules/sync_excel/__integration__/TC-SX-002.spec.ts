import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  ENTITY_TYPE,
  SAMPLE_CSV,
  csvFilePart,
  readJson,
  uploadMultipart,
} from './helpers/syncExcel'

/**
 * TC-SX-002: Upload endpoint rejects non-CSV file types and MIME types.
 *
 * Source: GitHub issue #2493 (sync_excel coverage expansion).
 *
 * The upload route (`packages/core/src/modules/sync_excel/api/upload/route.ts`)
 * accepts a file when it is CSV *by MIME type* OR *by `.csv` extension*
 * (`!isCsvByMime && !isCsvByName` => reject). The original issue assumed an
 * AND rule (reject a `.csv` name with a non-CSV MIME); this spec asserts the
 * real OR semantics:
 *   - a file that is neither CSV-by-name nor CSV-by-MIME => 422
 *   - a `.csv`-named file with a non-CSV MIME => accepted (200)
 *   - a CSV-MIME file with a non-`.csv` name => accepted (200)
 */
test.describe('TC-SX-002: sync_excel upload rejects non-CSV files', () => {
  test('rejects files that are neither CSV by name nor by MIME type', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const nonCsvCases = [
      { name: 'data.json', mimeType: 'application/json', content: '{"lead":"Ada"}' },
      { name: 'data.txt', mimeType: 'text/plain', content: 'Record Id,Lead Name\nsx-1,Ada\n' },
      { name: 'report.pdf', mimeType: 'application/pdf', content: '%PDF-1.4 not really a pdf' },
    ]

    for (const file of nonCsvCases) {
      const response = await uploadMultipart(request, token, {
        entityType: ENTITY_TYPE,
        file: csvFilePart(file),
      })

      expect(response.status(), `${file.name} (${file.mimeType}) must be rejected`).toBe(422)
      const body = await readJson(response)
      expect(String(body.error)).toContain('Only CSV uploads are supported')
    }
  })

  test('accepts CSV detected by extension or MIME even when the other signal is off', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // `.csv` extension but a non-CSV MIME — accepted (extension is sufficient).
    const byExtension = await uploadMultipart(request, token, {
      entityType: ENTITY_TYPE,
      file: csvFilePart({ name: 'leads.csv', mimeType: 'application/json', content: SAMPLE_CSV }),
    })
    expect(byExtension.status()).toBe(200)
    expect(String((await readJson(byExtension)).entityType)).toBe(ENTITY_TYPE)

    // CSV MIME but a non-`.csv` name — accepted (MIME is sufficient).
    const byMime = await uploadMultipart(request, token, {
      entityType: ENTITY_TYPE,
      file: csvFilePart({ name: 'leads.dat', mimeType: 'text/csv', content: SAMPLE_CSV }),
    })
    expect(byMime.status()).toBe(200)
    expect(String((await readJson(byMime)).entityType)).toBe(ENTITY_TYPE)
  })
})
