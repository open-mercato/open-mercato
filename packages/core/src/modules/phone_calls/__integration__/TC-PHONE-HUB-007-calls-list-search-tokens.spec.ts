import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { deleteIngestedPhoneCallFixture, ingestPhoneCallFixture, phoneCallEntityType } from './helpers/phoneCallsFixtures'

test('TC-PHONE-HUB-007: list search finds an ingested call after token presence cache expiry', async ({ request }) => {
  test.slow()

  const token = await getAuthToken(request, 'superadmin')
  const authScope = getTokenScope(token)
  const stamp = randomUUID()
  const externalCallId = `Caller_${stamp}-ext`
  const externalConversationId = `Session_${stamp}-ext`
  const providerKey = `switch-${stamp}`
  const presenceTtlMs = parseNumberWithDefault(
    process.env.OM_SEARCH_TOKEN_PRESENCE_CACHE_MS, 30_000, { integer: true, min: 0 },
  )
  const organizationId = await createOrganizationFixture(request, token, {
    name: `qa-phone-hub-007-${stamp}`,
    tenantId: authScope.tenantId,
  })
  const scope = { ...authScope, organizationId }
  let ingestedId: string | null = null

  async function search(term: string): Promise<string[]> {
    const query = new URLSearchParams({ q: term, providerKey })
    const response = await apiRequestWithSelectedOrg(request, 'GET', `/api/phone_calls/calls?${query}`, {
      token, selectedOrgId: organizationId,
    })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ items: { id: string }[] }>(response)
    return (body?.items ?? []).map((item) => item.id)
  }

  try {
    expect(await search(externalCallId)).toEqual([])
    const expiresAt = Date.now() + presenceTtlMs
    const ingested = await ingestPhoneCallFixture(scope, {
      externalCallId,
      externalConversationId,
      providerKey,
      direction: 'inbound',
      status: 'completed',
      participants: [],
      rawPayload: { source: 'TC-PHONE-HUB-007' },
    })
    ingestedId = ingested.phoneCallId
    expect(ingested.created).toBe(true)

    await expect.poll(() => withClient(async (client) => {
      const result = await client.query<{ field: string }>(
        `select distinct field from search_tokens
         where entity_type = $1 and entity_id = $2 and tenant_id = $3 and organization_id = $4`,
        [phoneCallEntityType, ingestedId, scope.tenantId, scope.organizationId],
      )
      return result.rows.map(({ field }) => field)
    })).toContain('provider_key')

    await setTimeout(Math.max(0, expiresAt - Date.now()))

    expect(await search(`caller_${stamp}`)).toEqual([ingestedId])
    expect(await search(`session_${stamp}`)).toEqual([ingestedId])
    expect(await search(providerKey.toUpperCase())).toEqual([ingestedId])
    expect(await search(`caller%${stamp}`)).toEqual([])
  } finally {
    try {
      await deleteIngestedPhoneCallFixture(scope, ingestedId)
    } finally {
      await deleteOrganizationIfExists(request, token, organizationId)
    }
  }
})
