import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
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
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DICTIONARY_ENTRY_RESOURCE_KIND,
  createAuditableDictionaryEntry,
  exportActionLogs,
  listActionLogs,
  parseCsv,
} from './helpers/auditLogsApi'

type DeniedBody = { error?: string }

const AUDIT_FEATURES = ['audit_logs.view_self', 'audit_logs.view_tenant']

/**
 * TC-AUD-021 [P0]: action-log list and export deny an explicitly empty organization scope (#10432)
 *
 * A tenant-wide audit reader whose role stores `organizations: []` sees no organization at
 * all. The list and the CSV export used to drop the organization predicate for that scope
 * and return every organization's action logs in the tenant. Both must answer 403, while a
 * reader scoped to the organization that owns the row still gets it.
 */
test.describe('TC-AUD-021: action-log reads deny an explicitly empty organization scope (#10432)', () => {
  test('denies list and export for a deny-all reader and keeps a scoped reader working', async ({ request }) => {
    test.setTimeout(90_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId: ownerOrganizationId } = getTokenContext(superadminToken)
    expectId(tenantId, 'Superadmin token should carry the actor tenant')
    expectId(ownerOrganizationId, 'Superadmin token should carry the organization that owns the action log')

    const stamp = randomUUID()
    const password = 'StrongSecret123!'
    const denyAllEmail = `qa-tc-aud-021-deny-all-${stamp}@example.com`
    const scopedEmail = `qa-tc-aud-021-scoped-${stamp}@example.com`
    let dictionaryId: string | null = null
    let temporaryHomeOrganizationId: string | null = null
    let denyAllRoleId: string | null = null
    let scopedRoleId: string | null = null
    let denyAllUserId: string | null = null
    let scopedUserId: string | null = null

    try {
      const created = await createAuditableDictionaryEntry(request, superadminToken, { keyPrefix: 'aud021' })
      dictionaryId = created.dictionaryId
      const rowQuery = { resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND, resourceId: created.entryId }

      const ownerList = await listActionLogs(request, superadminToken, rowQuery)
      expect(ownerList.status, 'The action log should exist for the organization that produced it').toBe(200)
      expect(
        (ownerList.body?.items ?? []).map((item) => item.resourceId),
        'The dictionary entry create should have written an action-log row',
      ).toContain(created.entryId)

      scopedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-aud-021-scoped-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: scopedRoleId,
        features: AUDIT_FEATURES,
        organizations: [ownerOrganizationId],
      })
      scopedUserId = await createUserFixture(request, superadminToken, {
        email: scopedEmail,
        password,
        organizationId: ownerOrganizationId,
        roles: [scopedRoleId],
        name: 'QA TC-AUD-021 Scoped Reader',
      })
      const scopedToken = await getAuthToken(request, scopedEmail, password)

      const scopedList = await listActionLogs(request, scopedToken, rowQuery)
      expect(scopedList.status, 'A reader scoped to the owning organization should list its action logs').toBe(200)
      expect(scopedList.body?.canViewTenant, 'The scoped reader should hold the tenant-wide view').toBe(true)
      expect(
        (scopedList.body?.items ?? []).map((item) => item.resourceId),
        'The scoped reader should see the row written by another actor in its organization',
      ).toContain(created.entryId)

      const scopedExport = await exportActionLogs(request, scopedToken, rowQuery)
      expect(scopedExport.status(), 'A reader scoped to the owning organization should export its action logs').toBe(200)
      expect(
        parseCsv(await scopedExport.text()).dataLines.length,
        'The scoped export should contain the action-log row',
      ).toBeGreaterThan(0)

      temporaryHomeOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AUD-021 Temporary home ${stamp}`,
        tenantId,
      })
      denyAllRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-aud-021-deny-all-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: denyAllRoleId,
        features: AUDIT_FEATURES,
        organizations: [],
      })
      denyAllUserId = await createUserFixture(request, superadminToken, {
        email: denyAllEmail,
        password,
        organizationId: temporaryHomeOrganizationId,
        roles: [denyAllRoleId],
        name: 'QA TC-AUD-021 Deny-all Reader',
      })
      const removeHome = await apiRequest(
        request,
        'DELETE',
        `/api/directory/organizations?id=${encodeURIComponent(temporaryHomeOrganizationId)}`,
        { token: superadminToken },
      )
      expect(removeHome.status(), 'Temporary home organization should be soft-deleted').toBe(200)
      const denyAllToken = await getAuthToken(request, denyAllEmail, password)

      const deniedList = await apiRequest(
        request,
        'GET',
        `/api/audit_logs/audit-logs/actions?resourceKind=${encodeURIComponent(DICTIONARY_ENTRY_RESOURCE_KIND)}&resourceId=${encodeURIComponent(created.entryId)}`,
        { token: denyAllToken },
      )
      const deniedListBody = await readJsonSafe<DeniedBody & { items?: unknown[] }>(deniedList)
      expect(deniedList.status(), 'organizations=[] must not list any action log').toBe(403)
      expect(deniedListBody?.items, 'A denied list must not carry rows').toBeUndefined()

      const deniedUnfilteredList = await listActionLogs(request, denyAllToken)
      expect(deniedUnfilteredList.status, 'organizations=[] must not list the tenant-wide action log').toBe(403)

      const deniedExport = await exportActionLogs(request, denyAllToken, rowQuery)
      const deniedExportText = await deniedExport.text()
      expect(deniedExport.status(), 'organizations=[] must not export any action log').toBe(403)
      expect(deniedExportText, 'A denied export must not carry the row').not.toContain(created.entryId)
    } finally {
      await deleteUserIfExists(request, superadminToken, denyAllUserId)
      await deleteUserIfExists(request, superadminToken, scopedUserId)
      await deleteRoleIfExists(request, superadminToken, denyAllRoleId)
      await deleteRoleIfExists(request, superadminToken, scopedRoleId)
      await deleteOrganizationIfExists(request, superadminToken, temporaryHomeOrganizationId)
      await deleteEntityByPathIfExists(
        request,
        superadminToken,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
    }
  })
})
