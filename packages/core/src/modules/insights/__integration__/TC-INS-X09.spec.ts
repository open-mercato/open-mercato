import { expect, test } from '@playwright/test'
import { createQaDeal, uniqueSuffix } from './helpers/explainApi'
import { DEAL_PROCESS_KEY, putXraySettings, runXrayBackfill } from './helpers/xrayApi'
import {
  DEAL_ACTOR_FEATURES,
  XRAY_ANALYTICS_BASE,
  cleanupXrayAnalyticsFixture,
  createXrayAnalyticsFixture,
  createXrayOrganization,
  createXrayRole,
  createXrayUser,
  seedDealProcess,
  xrayCall,
} from './helpers/xrayAnalyticsApi'

type MapBody = { n: number; organizationIds: string[] | null; nodes: Array<{ activityKey: string; cases: number }> }

type CasesBody = { n: number; items: Array<{ caseId: string; organizationId: string }> }

/**
 * TC-INS-X09: Process X-Ray results are isolated between users and organizations
 * Covers:
 *   - GET /api/insights/xray/{processKey}/map, /breakdown?groupBy=user, /cases
 *
 * In an organization created for the test (six deals, per-person breakdowns enabled), a user
 * holding `insights.xray.view_individuals` reads the per-person breakdown while a user without it
 * gets 403 — before and right after the first user's result was computed and cached, so the
 * analytics cache never hands one viewer's result to another. Both see the same aggregate map. A
 * user restricted to a second organization only ever reads that organization (its own single
 * case), also when it selects the first organization explicitly.
 */
test.describe('TC-INS-X09: X-Ray user and organization isolation', () => {
  test('never shares per-person results or another organization\'s data', async ({ request }) => {
    test.slow()
    const fixture = createXrayAnalyticsFixture()
    try {
      const organizationId = await createXrayOrganization(request, fixture, 'INS-X09 main')
      const otherOrganizationId = await createXrayOrganization(request, fixture, 'INS-X09 other')
      const adminToken = fixture.adminToken as string
      const actorRole = await createXrayRole(request, fixture, { label: 'INS-X09 actor', features: DEAL_ACTOR_FEATURES, organizations: [organizationId] })
      const actorTokens: string[] = []
      for (let index = 0; index < 3; index += 1) {
        actorTokens.push((await createXrayUser(request, fixture, { label: `INS-X09 actor ${index}`, organizationId, roleId: actorRole })).token)
      }
      await seedDealProcess(request, fixture, { organizationId, actorTokens, dealsPerActor: 2, individualsEnabled: true, label: 'INS-X09' })

      const otherSettings = await putXraySettings(request, adminToken, { kAnonymity: 5, debounceSeconds: 0, individualsEnabled: true }, { selectedOrgId: otherOrganizationId })
      expect(otherSettings.status).toBe(200)
      const otherDeal = await createQaDeal(request, adminToken, { title: `QA INS-X09 other ${uniqueSuffix()}`, status: 'open', selectedOrgId: otherOrganizationId })
      fixture.deals.push({ id: otherDeal, organizationId: otherOrganizationId })
      await runXrayBackfill(request, adminToken, { selectedOrgId: otherOrganizationId })

      const individualsRole = await createXrayRole(request, fixture, {
        label: 'INS-X09 individuals',
        features: ['insights.xray.view', 'insights.xray.view_individuals', 'customers.deals.view'],
        organizations: [organizationId],
      })
      const individuals = await createXrayUser(request, fixture, { label: 'INS-X09 individuals', organizationId, roleId: individualsRole })
      const aggregateRole = await createXrayRole(request, fixture, { label: 'INS-X09 aggregate', features: ['insights.xray.view', 'customers.deals.view'], organizations: [organizationId] })
      const aggregate = await createXrayUser(request, fixture, { label: 'INS-X09 aggregate', organizationId, roleId: aggregateRole })
      const outsiderRole = await createXrayRole(request, fixture, {
        label: 'INS-X09 outsider',
        features: ['insights.xray.view', 'insights.xray.view_individuals', 'customers.deals.view'],
        organizations: [otherOrganizationId],
      })
      const outsider = await createXrayUser(request, fixture, { label: 'INS-X09 outsider', organizationId: otherOrganizationId, roleId: outsiderRole })

      const breakdownPath = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/breakdown?groupBy=user`
      const mapPath = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/map`

      const deniedBefore = await xrayCall(request, aggregate.token, 'GET', breakdownPath)
      expect(deniedBefore.status, `per-person breakdown without the feature: ${deniedBefore.text}`).toBe(403)
      const allowed = await xrayCall<{ perPerson: boolean; n: number }>(request, individuals.token, 'GET', breakdownPath)
      expect(allowed.status, `per-person breakdown with the feature: ${allowed.text}`).toBe(200)
      expect(allowed.body).toEqual(expect.objectContaining({ perPerson: true, n: 6 }))
      const allowedAgain = await xrayCall<{ perPerson: boolean; n: number }>(request, individuals.token, 'GET', breakdownPath)
      expect(allowedAgain.body).toEqual(expect.objectContaining({ perPerson: true, n: 6 }))
      const deniedAfter = await xrayCall(request, aggregate.token, 'GET', breakdownPath)
      expect(deniedAfter.status, 'a cached per-person result is never served to a viewer without the feature').toBe(403)

      const individualsMap = await xrayCall<MapBody>(request, individuals.token, 'GET', mapPath)
      const aggregateMap = await xrayCall<MapBody>(request, aggregate.token, 'GET', mapPath)
      expect(individualsMap.status).toBe(200)
      expect(aggregateMap.status).toBe(200)
      expect(aggregateMap.body).toEqual(expect.objectContaining({ n: 6, organizationIds: [organizationId] }))
      expect(aggregateMap.body?.nodes, 'the aggregate map is the same for both viewers').toEqual(individualsMap.body?.nodes)

      const outsiderMap = await xrayCall<MapBody>(request, outsider.token, 'GET', mapPath)
      expect(outsiderMap.status, `map of the restricted user: ${outsiderMap.text}`).toBe(200)
      expect(outsiderMap.body).toEqual(expect.objectContaining({ n: 1, organizationIds: [otherOrganizationId] }))
      const outsiderSelectingMain = await xrayCall<MapBody>(request, outsider.token, 'GET', mapPath, { selectedOrgId: organizationId })
      expect(outsiderSelectingMain.status === 404 || outsiderSelectingMain.body?.organizationIds?.includes(organizationId) !== true, 'selecting a foreign organization never reads it').toBe(true)
      expect(outsiderSelectingMain.body?.n ?? 0).not.toBe(6)
      const outsiderCases = await xrayCall<CasesBody>(request, outsider.token, 'GET', `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/cases`)
      expect(outsiderCases.status).toBe(200)
      expect(outsiderCases.body?.items.map((item) => item.organizationId)).toEqual([otherOrganizationId])
      expect(outsiderCases.body?.items.map((item) => item.caseId)).toEqual([otherDeal])
      const mainCases = await xrayCall<CasesBody>(request, aggregate.token, 'GET', `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/cases?pageSize=100`)
      expect(mainCases.body?.n).toBe(6)
      expect(mainCases.body?.items.every((item) => item.organizationId === organizationId)).toBe(true)
      expect(mainCases.body?.items.map((item) => item.caseId)).not.toContain(otherDeal)
    } finally {
      await cleanupXrayAnalyticsFixture(request, fixture)
    }
  })
})
