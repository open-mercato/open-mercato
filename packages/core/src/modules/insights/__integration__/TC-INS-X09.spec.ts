import { expect, test } from '@playwright/test'
import { ALL_ORGANIZATIONS_SELECTION, createQaDeal, uniqueSuffix } from './helpers/explainApi'
import { DEAL_PROCESS_KEY, putXraySettings, runXrayBackfill } from './helpers/xrayApi'
import {
  DEAL_ACTOR_FEATURES,
  XRAY_ANALYTICS_BASE,
  cleanupXrayAnalyticsFixture,
  countIndividualsAccessRows,
  createTenantWideXrayRole,
  createXrayAnalyticsFixture,
  createXrayOrganization,
  createXrayRole,
  createXrayUser,
  createXrayUserWithRoles,
  seedDealProcess,
  xrayCall,
} from './helpers/xrayAnalyticsApi'

type MapBody = { n: number; organizationIds: string[] | null; nodes: Array<{ activityKey: string; cases: number }> }

type CasesBody = { n: number; items: Array<{ caseId: string; organizationId: string }> }

type BreakdownBody = { perPerson: boolean; n: number; organizationIds: string[] | null; items: Array<{ organizationId: string }> }

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
 *
 * A viewer holding the view features in every organization but `insights.xray.view_individuals`
 * only in the first one gets a per-person breakdown narrowed to the first organization when all
 * organizations are selected (no per-person data or access log of the second one, whose
 * per-person setting is on too), and 403 `individuals_denied` when it selects the second one.
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
      expect(outsiderSelectingMain.status, `map of the restricted user selecting a foreign organization: ${outsiderSelectingMain.text}`).toBe(200)
      expect(outsiderSelectingMain.body, 'selecting a foreign organization falls back to the allowed one and never reads it').toEqual(expect.objectContaining({ n: 1, organizationIds: [otherOrganizationId] }))
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

  test('narrows a per-person breakdown to the organizations where the viewer holds view_individuals', async ({ request }) => {
    test.slow()
    const fixture = createXrayAnalyticsFixture()
    try {
      const organizationId = await createXrayOrganization(request, fixture, 'INS-X09 narrowed main')
      const otherOrganizationId = await createXrayOrganization(request, fixture, 'INS-X09 narrowed other')
      const mainActorRole = await createXrayRole(request, fixture, { label: 'INS-X09 narrowed main actor', features: DEAL_ACTOR_FEATURES, organizations: [organizationId] })
      const otherActorRole = await createXrayRole(request, fixture, { label: 'INS-X09 narrowed other actor', features: DEAL_ACTOR_FEATURES, organizations: [otherOrganizationId] })
      const mainActorTokens: string[] = []
      const otherActorTokens: string[] = []
      for (let index = 0; index < 3; index += 1) {
        mainActorTokens.push((await createXrayUser(request, fixture, { label: `INS-X09 narrowed main actor ${index}`, organizationId, roleId: mainActorRole })).token)
        otherActorTokens.push((await createXrayUser(request, fixture, { label: `INS-X09 narrowed other actor ${index}`, organizationId: otherOrganizationId, roleId: otherActorRole })).token)
      }
      await seedDealProcess(request, fixture, { organizationId, actorTokens: mainActorTokens, dealsPerActor: 2, individualsEnabled: true, label: 'INS-X09 narrowed main' })
      await seedDealProcess(request, fixture, { organizationId: otherOrganizationId, actorTokens: otherActorTokens, dealsPerActor: 1, individualsEnabled: true, label: 'INS-X09 narrowed other' })

      const viewRole = await createTenantWideXrayRole(request, fixture, { label: 'INS-X09 narrowed view', features: ['insights.xray.view', 'customers.deals.view'] })
      const individualsRole = await createXrayRole(request, fixture, {
        label: 'INS-X09 narrowed individuals',
        features: ['insights.xray.view_individuals'],
        organizations: [organizationId],
      })
      const viewer = await createXrayUserWithRoles(request, fixture, { label: 'INS-X09 narrowed viewer', organizationId, roleIds: [viewRole, individualsRole] })

      const breakdownPath = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/breakdown?groupBy=user`
      const mapPath = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/map`

      const otherMap = await xrayCall<MapBody>(request, viewer.token, 'GET', mapPath, { selectedOrgId: otherOrganizationId })
      expect(otherMap.status, `aggregate map of the second organization: ${otherMap.text}`).toBe(200)
      expect(otherMap.body, 'the viewer may read the second organization in aggregate').toEqual(expect.objectContaining({ n: 3, organizationIds: [otherOrganizationId] }))

      const allOrganizations = await xrayCall<BreakdownBody>(request, viewer.token, 'GET', breakdownPath, { selectedOrgId: ALL_ORGANIZATIONS_SELECTION })
      expect(allOrganizations.status, `per-person breakdown over all organizations: ${allOrganizations.text}`).toBe(200)
      expect(allOrganizations.body, 'the per-person scope is narrowed to the organization holding view_individuals').toEqual(expect.objectContaining({ perPerson: true, n: 6, organizationIds: [organizationId] }))
      expect(allOrganizations.body?.items.every((item) => item.organizationId === organizationId)).toBe(true)

      const ownOrganization = await xrayCall<BreakdownBody>(request, viewer.token, 'GET', breakdownPath)
      expect(ownOrganization.status, `per-person breakdown of the own organization: ${ownOrganization.text}`).toBe(200)
      expect(ownOrganization.body).toEqual(expect.objectContaining({ perPerson: true, n: 6, organizationIds: [organizationId] }))

      const selectedOther = await xrayCall(request, viewer.token, 'GET', breakdownPath, { selectedOrgId: otherOrganizationId })
      expect(selectedOther.status, `per-person breakdown of the second organization: ${selectedOther.text}`).toBe(403)
      expect(selectedOther.body).toEqual(expect.objectContaining({ code: 'individuals_denied', hint: null }))

      expect(await countIndividualsAccessRows(otherOrganizationId, viewer.userId), 'no per-person read of the second organization was logged').toBe(0)
      expect(await countIndividualsAccessRows(organizationId, viewer.userId), 'both per-person reads of the first organization were logged').toBe(2)
    } finally {
      await cleanupXrayAnalyticsFixture(request, fixture)
    }
  })
})
