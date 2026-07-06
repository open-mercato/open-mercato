import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  ENTITY_TYPE,
  buildValidMapping,
  readJson,
  startImport,
  type JsonRecord,
} from './helpers/syncExcel'

/**
 * TC-SX-008: Import endpoint validates the payload and mapping schema.
 *
 * Source: GitHub issue #2493 (sync_excel coverage expansion).
 *
 * `syncExcelImportRequestSchema` enforces a UUID `uploadId`, an enum
 * `entityType`, a structurally valid `mapping`, and a bounded `batchSize`.
 * Any violation returns 422 'Invalid import payload.' before scope resolution
 * or any lookup. A structurally valid payload that references a missing upload
 * passes schema validation and returns 404.
 *
 * Note: `syncExcelEntityTypes` currently has a single member
 * (`customers.person`), so the route's explicit "Upload entity type does not
 * match" / "Mapping entity type does not match" 422 branches are unreachable
 * through the public API — Zod constrains both `entityType` and
 * `mapping.entityType` to the same enum value before those checks run. This
 * spec therefore asserts the reachable schema-level rejection (an out-of-enum
 * `mapping.entityType` fails validation) rather than the dead comparison.
 */
const VALID_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

test.describe('TC-SX-008: sync_excel import payload validation', () => {
  test('rejects malformed import payloads with 422', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const invalidPayloads: Array<{ label: string; payload: JsonRecord }> = [
      { label: 'missing uploadId', payload: { entityType: ENTITY_TYPE, mapping: buildValidMapping() } },
      { label: 'malformed uploadId', payload: { uploadId: 'not-a-uuid', entityType: ENTITY_TYPE, mapping: buildValidMapping() } },
      { label: 'unsupported entityType', payload: { uploadId: VALID_UUID, entityType: 'customers.company', mapping: buildValidMapping() } },
      { label: 'missing mapping', payload: { uploadId: VALID_UUID, entityType: ENTITY_TYPE } },
      {
        label: 'mapping missing matchStrategy',
        payload: {
          uploadId: VALID_UUID,
          entityType: ENTITY_TYPE,
          mapping: { entityType: ENTITY_TYPE, fields: [], unmappedColumns: [] },
        },
      },
      {
        label: 'mapping entityType out of enum',
        payload: {
          uploadId: VALID_UUID,
          entityType: ENTITY_TYPE,
          mapping: { ...buildValidMapping(), entityType: 'customers.company' },
        },
      },
      {
        label: 'batchSize below minimum',
        payload: { uploadId: VALID_UUID, entityType: ENTITY_TYPE, mapping: buildValidMapping(), batchSize: 0 },
      },
    ]

    for (const { label, payload } of invalidPayloads) {
      const response = await startImport(request, token, payload)
      expect(response.status(), `${label} must be rejected with 422`).toBe(422)
      expect(String((await readJson(response)).error)).toContain('Invalid import payload')
    }
  })

  test('returns 404 for a schema-valid payload referencing a non-existent upload', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await startImport(request, token, {
      uploadId: VALID_UUID,
      entityType: ENTITY_TYPE,
      mapping: buildValidMapping(),
    })

    expect(response.status()).toBe(404)
    expect(String((await readJson(response)).error)).toContain('Upload preview not found')
  })
})
