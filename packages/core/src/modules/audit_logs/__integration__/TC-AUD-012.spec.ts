import { randomInt, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteEntityByPathIfExists,
  deleteGeneralEntityIfExists,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  API_KEYS_PATH,
  createApiKeyForRole,
  createAuditableDictionaryEntry,
  createDictionaryWriterRole,
  listEntryActionLogs,
  patchDictionaryEntryWithApiKey,
  readCausationFrames,
} from './helpers/auditLogsApi'

export const integrationMeta = {
  dependsOnModules: ['audit_logs', 'dictionaries', 'api_keys'],
}

/**
 * TC-AUD-012: A user-created key named like a business-rule loopback key is still an API key
 * Covers:
 *   - POST  /api/api_keys/keys
 *   - PATCH /api/dictionaries/{id}/entries/{entryId} (authenticated by API key)
 *   - GET   /api/audit_logs/audit-logs/actions
 *
 * Business-rule loopback keys were historically recognised by their name
 * (`__business_rule_<ruleId>__`). Causation never parses key names: a key created
 * through the HTTP API with such a name carries no server-stamped origin, so its
 * writes are attributed to `api_key` (the key id), never to `business_rule`.
 */
test.describe('TC-AUD-012: key names cannot impersonate business-rule loopbacks', () => {
  test('records writes of a "__business_rule_<uuid>__" key as api_key', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null
    let roleId: string | null = null
    let apiKeyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const unique = `${Date.now()}_${randomInt(1_000_000)}`
      const impersonatedRuleId = randomUUID()
      const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud012' })
      dictionaryId = created.dictionaryId
      roleId = await createDictionaryWriterRole(request, token, `QA Audit 012 writer ${unique}`)
      const apiKey = await createApiKeyForRole(request, token, {
        name: `__business_rule_${impersonatedRuleId}__`,
        roleId,
      })
      apiKeyId = apiKey.id

      const patchResult = await patchDictionaryEntryWithApiKey(apiKey.secret, {
        dictionaryId,
        entryId: created.entryId,
        headers: { 'X-Business-Rule-Id': impersonatedRuleId },
        data: { label: `Updated by rule-named key ${unique}` },
      })
      expect(patchResult.status, `API-key update should succeed: ${patchResult.text}`).toBe(200)

      const items = await listEntryActionLogs(request, token, created.entryId)
      const keyWrite = items.find((item) => item.commandId === 'dictionaries.entries.update')
      expect(keyWrite, 'the API-key update is audited').toBeTruthy()
      expect(keyWrite!.causeKind, 'the write is attributed to the API key, not a business rule').toBe('api_key')
      expect(keyWrite!.causeId, 'the cause id is the API key id').toBe(apiKey.id)
      expect(keyWrite!.causeId, 'the rule id from the key name is never used').not.toBe(impersonatedRuleId)
      const frameKinds = readCausationFrames(keyWrite!).map((frame) => frame.kind)
      expect(frameKinds, 'no business_rule frame is recorded').not.toContain('business_rule')
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
