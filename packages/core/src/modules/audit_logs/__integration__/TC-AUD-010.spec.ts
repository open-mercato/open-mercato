import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteEntityByPathIfExists,
  deleteGeneralEntityIfExists,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  API_KEYS_PATH,
  DICTIONARY_ENTRY_RESOURCE_KIND,
  createApiKeyForRole,
  createAuditableDictionaryEntry,
  createDictionaryWriterRole,
  listActionLogs,
  listEntryActionLogs,
  patchDictionaryEntryWithApiKey,
  readCausationFrames,
} from './helpers/auditLogsApi'

export const integrationMeta = {
  dependsOnModules: ['audit_logs', 'dictionaries', 'api_keys'],
}

/**
 * TC-AUD-010: API-key writes are attributed to the API key
 * Covers:
 *   - POST  /api/api_keys/keys
 *   - PATCH /api/dictionaries/{id}/entries/{entryId} (authenticated by API key)
 *   - GET   /api/audit_logs/audit-logs/actions (causeKind, causeId filters and fields)
 *
 * A write authenticated by an API key is recorded with `causeKind = 'api_key'`
 * and `causeId` = the key id, and the cause filters find it.
 */
test.describe('TC-AUD-010: API-key writes record the api_key cause', () => {
  test('records an API-key update as api_key with the key id', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null
    let roleId: string | null = null
    let apiKeyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const unique = `${Date.now()}_${randomInt(1_000_000)}`
      const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud010' })
      dictionaryId = created.dictionaryId
      roleId = await createDictionaryWriterRole(request, token, `QA Audit 010 writer ${unique}`)
      const apiKey = await createApiKeyForRole(request, token, { name: `QA Audit 010 key ${unique}`, roleId })
      apiKeyId = apiKey.id

      const patchResult = await patchDictionaryEntryWithApiKey(apiKey.secret, {
        dictionaryId,
        entryId: created.entryId,
        data: { label: `Updated by key ${unique}` },
      })
      expect(patchResult.status, `API-key update should succeed: ${patchResult.text}`).toBe(200)

      const items = await listEntryActionLogs(request, token, created.entryId)
      const keyWrite = items.find((item) => item.commandId === 'dictionaries.entries.update')
      expect(keyWrite, 'the API-key update is audited').toBeTruthy()
      expect(keyWrite!.causeKind, 'the write is attributed to an API key').toBe('api_key')
      expect(keyWrite!.causeId, 'the cause id is the API key id').toBe(apiKey.id)
      expect(readCausationFrames(keyWrite!).at(-1), 'the innermost frame names the key').toEqual(
        expect.objectContaining({ kind: 'api_key', id: apiKey.id }),
      )

      const userWrite = items.find((item) => item.commandId !== 'dictionaries.entries.update')
      expect(userWrite?.causeKind, 'the admin create stays a user write').toBe('user')

      const byKey = await listActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: created.entryId,
        causeKind: 'api_key',
        causeId: apiKey.id,
      })
      expect(byKey.status, 'cause filters are accepted').toBe(200)
      expect(byKey.body?.items.map((item) => item.id), 'cause filters find only the API-key write').toEqual([keyWrite!.id])

      const missingKind = await listActionLogs(request, token, { causeId: apiKey.id })
      expect(missingKind.status, 'causeId without causeKind is rejected').toBe(400)
    } finally {
      await deleteGeneralEntityIfExists(request, token, API_KEYS_PATH, apiKeyId)
      await deleteRoleIfExists(request, token, roleId)
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
    }
  })
})
