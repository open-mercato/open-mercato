import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteEntityByPathIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  ACTIONS_PATH,
  DICTIONARY_ENTRY_RESOURCE_KIND,
  EXPORT_PATH,
  createAuditableDictionaryEntry,
  exportActionLogs,
  listActionLogs,
  parseCsv,
  type ActionLogListResponse,
} from './helpers/auditLogsApi'

const ACCESS_PATH = '/api/audit_logs/audit-logs/access'

type AccessLogListResponse = { canViewTenant?: boolean }

function apiKeyRequest(request: APIRequestContext, secret: string, path: string) {
  return apiRequest(request, 'GET', path, { token: '', headers: { Authorization: `ApiKey ${secret}` } })
}

/**
 * TC-AUD-022 [P0]: `audit_logs.view_tenant` applies to the organization being read
 *
 * A reader holds `view_self` for every organization and `view_tenant` for one organization
 * only. Rows written by other actors are visible in that organization and nowhere else:
 * selecting another organization, or reading without one, returns the reader's own rows.
 */
test.describe('TC-AUD-022: view_tenant applies to the organization being read', () => {
  test('limits other-actor rows to the organizations the grant covers', async ({ request }) => {
    test.setTimeout(120_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId: ownerOrganizationId } = getTokenScope(superadminToken)
    expectId(tenantId, 'Superadmin token should carry the actor tenant')
    expectId(ownerOrganizationId, 'Superadmin token should carry the organization that owns the action log')

    const stamp = randomUUID()
    const password = 'StrongSecret123!'
    const outsideEmail = `qa-tc-aud-022-outside-${stamp}@example.com`
    const insideEmail = `qa-tc-aud-022-inside-${stamp}@example.com`
    let dictionaryId: string | null = null
    let homeOrganizationId: string | null = null
    let selfRoleId: string | null = null
    let tenantHomeRoleId: string | null = null
    let tenantOwnerRoleId: string | null = null
    let outsideUserId: string | null = null
    let insideUserId: string | null = null
    let apiKeyId: string | null = null

    try {
      const created = await createAuditableDictionaryEntry(request, superadminToken, { keyPrefix: 'aud022' })
      dictionaryId = created.dictionaryId
      const rowQuery = { resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND, resourceId: created.entryId }
      const rowQueryString = `resourceKind=${encodeURIComponent(DICTIONARY_ENTRY_RESOURCE_KIND)}&resourceId=${encodeURIComponent(created.entryId)}`

      homeOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AUD-022 Home ${stamp}`,
        tenantId,
      })
      selfRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-aud-022-self-${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, { roleId: selfRoleId, features: ['audit_logs.view_self'] })
      tenantHomeRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-aud-022-tenant-home-${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: tenantHomeRoleId,
        features: ['audit_logs.view_tenant'],
        organizations: [homeOrganizationId],
      })
      tenantOwnerRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-aud-022-tenant-owner-${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: tenantOwnerRoleId,
        features: ['audit_logs.view_tenant'],
        organizations: [ownerOrganizationId],
      })

      outsideUserId = await createUserFixture(request, superadminToken, {
        email: outsideEmail,
        password,
        organizationId: homeOrganizationId,
        roles: [selfRoleId, tenantHomeRoleId],
        name: 'QA TC-AUD-022 Outside Reader',
      })
      const outsideToken = await getAuthToken(request, outsideEmail, password)

      const outsideList = await listActionLogs(request, outsideToken, { ...rowQuery, organizationId: ownerOrganizationId })
      expect(outsideList.status, 'The read itself stays allowed').toBe(200)
      expect(outsideList.body?.canViewTenant, 'view_tenant is not held for the organization being read').toBe(false)
      expect(
        (outsideList.body?.items ?? []).map((item) => item.resourceId),
        'A row written by another actor in an organization the grant does not cover must not be listed',
      ).not.toContain(created.entryId)

      const outsideExport = await exportActionLogs(request, outsideToken, { ...rowQuery, organizationId: ownerOrganizationId })
      expect(outsideExport.status(), 'The export itself stays allowed').toBe(200)
      expect(
        parseCsv(await outsideExport.text()).dataLines,
        'The export must not carry a row written by another actor in that organization',
      ).toHaveLength(0)

      const outsideAccess = await apiRequest(
        request,
        'GET',
        `${ACCESS_PATH}?actorScope=all&organizationId=${encodeURIComponent(ownerOrganizationId)}`,
        { token: outsideToken },
      )
      const outsideAccessBody = await readJsonSafe<AccessLogListResponse>(outsideAccess)
      expect(outsideAccess.status(), 'The access-log read itself stays allowed').toBe(200)
      expect(
        outsideAccessBody?.canViewTenant,
        'view_tenant is not held for the organization the access log reads',
      ).toBe(false)

      insideUserId = await createUserFixture(request, superadminToken, {
        email: insideEmail,
        password,
        organizationId: homeOrganizationId,
        roles: [selfRoleId, tenantOwnerRoleId],
        name: 'QA TC-AUD-022 Inside Reader',
      })
      const insideToken = await getAuthToken(request, insideEmail, password)

      const insideList = await listActionLogs(request, insideToken, { ...rowQuery, organizationId: ownerOrganizationId })
      expect(insideList.status, 'A reader whose grant covers the organization should list it').toBe(200)
      expect(insideList.body?.canViewTenant, 'view_tenant is held for the organization being read').toBe(true)
      expect(
        (insideList.body?.items ?? []).map((item) => item.resourceId),
        'The reader should see the row written by another actor in the covered organization',
      ).toContain(created.entryId)

      const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: superadminToken,
        data: { name: `qa-tc-aud-022-${stamp}`, roles: [selfRoleId, tenantHomeRoleId], organizationId: null },
      })
      const keyBody = await readJsonSafe<{ id?: string; secret?: string }>(keyResponse)
      expect(keyResponse.status(), 'API key fixture should be created').toBe(201)
      apiKeyId = keyBody?.id ?? null
      const secret = keyBody?.secret ?? ''
      expect(secret.length, 'API key fixture should return its secret').toBeGreaterThan(0)

      const keyList = await apiKeyRequest(request, secret, `${ACTIONS_PATH}?${rowQueryString}`)
      const keyListBody = await readJsonSafe<ActionLogListResponse>(keyList)
      expect(keyList.status(), 'The tenant-level key may read its own rows').toBe(200)
      expect(keyListBody?.canViewTenant, 'A grant limited to one organization does not cover a tenant-wide read').toBe(false)
      expect(
        (keyListBody?.items ?? []).map((item) => item.resourceId),
        'A tenant-wide read must not list a row written by another actor',
      ).not.toContain(created.entryId)

      const keyExport = await apiKeyRequest(request, secret, `${EXPORT_PATH}?${rowQueryString}`)
      expect(keyExport.status(), 'The tenant-level key may export its own rows').toBe(200)
      expect(
        parseCsv(await keyExport.text()).dataLines,
        'A tenant-wide export must not carry a row written by another actor',
      ).toHaveLength(0)
    } finally {
      if (apiKeyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(apiKeyId)}`, { token: superadminToken }).catch(() => {})
      }
      await deleteUserIfExists(request, superadminToken, insideUserId)
      await deleteUserIfExists(request, superadminToken, outsideUserId)
      await deleteRoleIfExists(request, superadminToken, tenantOwnerRoleId)
      await deleteRoleIfExists(request, superadminToken, tenantHomeRoleId)
      await deleteRoleIfExists(request, superadminToken, selfRoleId)
      await deleteOrganizationIfExists(request, superadminToken, homeOrganizationId)
      await deleteEntityByPathIfExists(
        request,
        superadminToken,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
    }
  })
})
