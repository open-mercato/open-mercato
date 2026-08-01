import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
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
 *  1. a record is findable while its scope has tokens (whichever of the token or
 *     plain-column path serves it), and
 *  2. after the scope's tokens are removed (what a purge does), the same search still
 *     finds the record via the plain-column fallback — the observable difference
 *     between the availability answers `true` and `false`.
 *
 * The second poll allows generous time because the availability answer is cached
 * process-wide for OM_SEARCH_TOKEN_PRESENCE_CACHE_MS (default 30 s): right after the
 * SQL cleanup the server may still route through the (now empty) token path until the
 * cache entry expires, and token writes after record creation are deferred.
 */
test.describe('TC-QIDX-4731: token presence routing', () => {
  test('search falls back to plain-column matching after a scope purge', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const entityId = uniqueEntityId('presence_item')
    const marker = `presenceprobe${Date.now().toString(36)}`
    let recordId: string | null = null

    try {
      const created = await createCustomEntity(request, token, {
        entityId,
        label: 'Presence probe item',
      })
      expect(created.ok(), `entity create failed: ${created.status()}`).toBeTruthy()

      const fields = await saveFieldDefinitions(request, token, entityId, [
        { key: 'title', kind: 'text' },
      ])
      expect(fields.ok(), `field definitions failed: ${fields.status()}`).toBeTruthy()

      const record = await createRecord(request, token, entityId, { title: `The ${marker} record` })
      expect(record.ok(), `record create failed: ${record.status()}`).toBeTruthy()
      const recordBody = await readJsonSafe<{ item?: { recordId?: string } }>(record)
      recordId = expectUuid(recordBody?.item?.recordId, 'record id')

      const hasIndexedTokens = async (): Promise<boolean> => withClient(async (client) => {
        const result = await client.query(
          'select 1 from search_tokens where entity_type = $1 limit 1',
          [entityId],
        )
        return (result.rowCount ?? 0) > 0
      })
      await expect
        .poll(hasIndexedTokens, { timeout: 30_000, message: 'record tokens should be indexed' })
        .toBe(true)

      const searchQuery = `&search=${encodeURIComponent(marker)}&searchFields=title`
      const findRecord = async (): Promise<boolean> => {
        const response = await listRecords(request, token, entityId, searchQuery)
        if (!response.ok()) return false
        const body = (await response.json()) as { items?: Array<{ id?: string }> }
        return (body.items ?? []).some((item) => item.id === recordId)
      }

      await expect
        .poll(findRecord, { timeout: 30_000, message: 'record should be findable after creation' })
        .toBe(true)

      // Simulate what TokenSearchStrategy.purge does for this scope: drop the tokens.
      // From here the availability answer must become `false` (once the process cache
      // expires) and search must keep working via ilike.
      await withClient(async (client) => {
        await client.query('delete from search_tokens where entity_type = $1', [entityId])
      })

      await expect
        .poll(findRecord, {
          timeout: 60_000,
          message: 'record should remain findable via the plain-column fallback after purge',
        })
        .toBe(true)
    } finally {
      await deleteRecordIfExists(request, token, entityId, recordId)
      await deleteCustomEntityIfExists(request, token, entityId)
    }
  })
})
