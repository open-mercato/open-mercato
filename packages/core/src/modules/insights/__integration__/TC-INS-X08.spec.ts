import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationInDb, deleteOrganizationInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createQaDeal, deleteQaDealIfExists, updateQaDeal, uniqueSuffix } from './helpers/explainApi'
import {
  DEAL_PROCESS_KEY,
  deleteProjectedCases,
  deleteXrayOrganizationState,
  getXraySettings,
  getXrayStatus,
  putXraySettings,
  readProjectedEvents,
  runXrayBackfill,
} from './helpers/xrayApi'

/**
 * TC-INS-X08: Process X-Ray is isolated per organization
 * Covers:
 *   - POST /api/insights/xray/backfill for two organizations of one tenant
 *   - GET  /api/insights/xray/status and /settings with a selected organization
 *   - PUT  /api/insights/xray/settings in one organization only
 *
 * A backfill projects only the selected organization's audit rows: a deal of another
 * organization gets no events until that organization is backfilled, and its events then
 * carry its own organization id. Status counts and settings are per organization.
 */
test.describe('TC-INS-X08: X-Ray tenant and organization isolation', () => {
  test('keeps cursors, events and settings per organization', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let otherOrgId: string | null = null
    let homeDealId: string | null = null
    let otherDealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const { tenantId, organizationId: homeOrgId } = getTokenScope(token)
      const suffix = uniqueSuffix()
      otherOrgId = await createOrganizationInDb({ name: `QA INS-X08 Org ${suffix}`, tenantId })
      homeDealId = await createQaDeal(request, token, { title: `QA INS-X08 home ${suffix}`, status: 'open' })
      otherDealId = await createQaDeal(request, token, { title: `QA INS-X08 other ${suffix}`, status: 'open', selectedOrgId: otherOrgId })
      await updateQaDeal(request, token, otherDealId, { status: 'qa_isolated' }, { selectedOrgId: otherOrgId })

      const otherBefore = await getXrayStatus(request, token, { selectedOrgId: otherOrgId })
      expect(otherBefore.status, `GET status for the other organization: ${otherBefore.text}`).toBe(200)
      expect(otherBefore.body?.organizationId).toBe(otherOrgId)
      expect(otherBefore.body?.cursor, 'the other organization was never ingested').toBeNull()

      await runXrayBackfill(request, token)
      expect((await readProjectedEvents(homeDealId)).map((event) => event.activity_key)).toContain('created')
      expect(await readProjectedEvents(otherDealId), 'a home backfill never projects another organization').toEqual([])
      expect((await getXrayStatus(request, token, { selectedOrgId: otherOrgId })).body?.processes ?? []).toEqual([])

      await runXrayBackfill(request, token, { selectedOrgId: otherOrgId })
      const otherEvents = await readProjectedEvents(otherDealId)
      expect(otherEvents.map((event) => event.activity_key)).toEqual(expect.arrayContaining(['created', 'status:open', 'status:qa_isolated']))
      for (const event of otherEvents) {
        expect(event.organization_id).toBe(otherOrgId)
        expect(event.tenant_id).toBe(tenantId)
      }
      for (const event of await readProjectedEvents(homeDealId)) expect(event.organization_id).toBe(homeOrgId)
      const otherStatus = await getXrayStatus(request, token, { selectedOrgId: otherOrgId })
      const otherDeals = otherStatus.body?.processes.find((process) => process.processKey === DEAL_PROCESS_KEY)
      expect(otherDeals?.cases, 'the other organization counts only its own case').toBe(1)

      const disabled = await putXraySettings(request, token, { enabled: false }, { selectedOrgId: otherOrgId })
      expect(disabled.status, `PUT settings in the other organization: ${disabled.text}`).toBe(200)
      expect((await getXraySettings(request, token, { selectedOrgId: otherOrgId })).body?.result.enabled).toBe(false)
      expect((await getXraySettings(request, token)).body?.result.enabled, 'the home organization keeps its own settings').toBe(true)
    } finally {
      await deleteQaDealIfExists(request, token, homeDealId)
      await deleteQaDealIfExists(request, token, otherDealId, otherOrgId ? { selectedOrgId: otherOrgId } : {})
      await deleteProjectedCases([homeDealId])
      await deleteXrayOrganizationState(otherOrgId)
      await deleteOrganizationInDb(otherOrgId)
    }
  })
})
