import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import {
  createCustomEntity,
  createRecord,
  deleteCustomEntityIfExists,
  deleteRecordIfExists,
  expectUuid,
  listRecords,
  saveFieldDefinitions,
  uniqueEntityId,
} from '../../entities/__integration__/helpers/entitiesApi'

/**
 * Search token availability routing (.ai/specs/2026-07-31-search-token-probe-index.md).
 *
 * The records list API's server-side search builds an $or of $ilike clauses that route
 * through the query engine's token-availability decision. This exercises both routings:
 *  1. while the first record has indexed tokens, search finds it through
 *     the token-backed route, and
 *  2. after the second scope's tokens are removed (what a purge does), search still
 *     finds that record via the plain-column fallback — the observable difference
 *     between the availability answers `true` and `false`.
 *
 * The two independent entity scopes avoid coupling this routing test to the process-wide
 * availability cache. Tokens are seeded explicitly because custom-entity record writes
 * use document storage directly and do not own the query-index token pipeline.
 */
test.describe('TC-QIDX-4731: token presence routing', () => {
  test('search uses tokens when present and plain columns after a scope purge', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tokenEntityId = uniqueEntityId('token_presence_item')
    const fallbackEntityId = uniqueEntityId('fallback_presence_item')
    const tokenMarker = `tokenpresence${Date.now().toString(36)}`
    const fallbackMarker = `fallbackpresence${Date.now().toString(36)}`
    let tokenRecordId: string | null = null
    let fallbackRecordId: string | null = null

    try {
      for (const entity of [
        { id: tokenEntityId, label: 'Token presence probe item' },
        { id: fallbackEntityId, label: 'Fallback presence probe item' },
      ]) {
        const created = await createCustomEntity(request, token, {
          entityId: entity.id,
          label: entity.label,
        })
        expect(created.ok(), `entity create failed: ${created.status()}`).toBeTruthy()

        const fields = await saveFieldDefinitions(request, token, entity.id, [
          { key: 'title', kind: 'text' },
        ])
        expect(fields.ok(), `field definitions failed: ${fields.status()}`).toBeTruthy()
      }

      const tokenRecord = await createRecord(request, token, tokenEntityId, {
        title: 'The token-routed record',
      })
      expect(tokenRecord.ok(), `token record create failed: ${tokenRecord.status()}`).toBeTruthy()
      const tokenRecordBody = await readJsonSafe<{ item?: { recordId?: string } }>(tokenRecord)
      tokenRecordId = expectUuid(tokenRecordBody?.item?.recordId, 'token record id')

      const fallbackRecord = await createRecord(request, token, fallbackEntityId, {
        title: `The ${fallbackMarker} record`,
      })
      expect(fallbackRecord.ok(), `fallback record create failed: ${fallbackRecord.status()}`).toBeTruthy()
      const fallbackRecordBody = await readJsonSafe<{ item?: { recordId?: string } }>(fallbackRecord)
      fallbackRecordId = expectUuid(fallbackRecordBody?.item?.recordId, 'fallback record id')

      const seedTokens = async (entityId: string, recordId: string, marker: string): Promise<void> => {
        const hashes = tokenizeText(marker).hashes
        expect(hashes.length, 'marker should produce search-token hashes').toBeGreaterThan(0)
        await withClient(async (client) => {
          const inserted = await client.query(
            `insert into search_tokens
               (id, entity_type, entity_id, organization_id, tenant_id, field, token_hash, token, created_at)
             select gen_random_uuid(), storage.entity_type, storage.entity_id,
                    storage.organization_id, storage.tenant_id, 'title', hash.token_hash, null, now()
             from custom_entities_storage storage
             cross join unnest($3::text[]) as hash(token_hash)
             where storage.entity_type = $1 and storage.entity_id = $2`,
            [entityId, recordId, hashes],
          )
          expect(inserted.rowCount, 'fixture should seed every marker hash').toBe(hashes.length)
        })
      }

      await seedTokens(tokenEntityId, tokenRecordId, tokenMarker)
      await seedTokens(fallbackEntityId, fallbackRecordId, fallbackMarker)

      const findRecord = async (entityId: string, marker: string, recordId: string): Promise<boolean> => {
        const searchQuery = `&search=${encodeURIComponent(marker)}&searchFields=title`
        const response = await listRecords(request, token, entityId, searchQuery)
        if (!response.ok()) return false
        const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response)
        return (body?.items ?? []).some((item) => item.id === recordId)
      }

      expect(
        await findRecord(tokenEntityId, tokenMarker, tokenRecordId),
        'record should be found through its seeded search tokens',
      ).toBe(true)

      await withClient(async (client) => {
        await client.query('delete from search_tokens where entity_type = $1', [fallbackEntityId])
      })

      expect(
        await findRecord(fallbackEntityId, fallbackMarker, fallbackRecordId),
        'record should remain findable via the plain-column fallback after purge',
      ).toBe(true)
    } finally {
      await withClient(async (client) => {
        await client.query(
          'delete from search_tokens where entity_type = any($1::text[])',
          [[tokenEntityId, fallbackEntityId]],
        )
      }).catch(() => undefined)
      await deleteRecordIfExists(request, token, tokenEntityId, tokenRecordId)
      await deleteRecordIfExists(request, token, fallbackEntityId, fallbackRecordId)
      await deleteCustomEntityIfExists(request, token, tokenEntityId)
      await deleteCustomEntityIfExists(request, token, fallbackEntityId)
    }
  })
})
