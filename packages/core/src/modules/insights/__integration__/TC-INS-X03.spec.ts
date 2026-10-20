import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createQaDeal, updateQaDeal, uniqueSuffix } from './helpers/explainApi'
import { DEAL_PROCESS_KEY, putXraySettings, runXrayBackfill } from './helpers/xrayApi'
import {
  DEAL_ACTOR_FEATURES,
  XRAY_ANALYTICS_BASE,
  cleanupXrayAnalyticsFixture,
  countIndividualsAccessRows,
  createXrayAnalyticsFixture,
  createXrayOrganization,
  createXrayRole,
  createXrayUser,
  seedDealProcess,
  xrayCall,
} from './helpers/xrayAnalyticsApi'

type MapBody = {
  n: number
  organizationIds: string[] | null
  incomplete: boolean
  computedThrough: string | null
  kAnonymity: number
  nodes: Array<{ activityKey: string; cases: number }>
  suppressed: { cells: number }
}

type BreakdownBody = { perPerson: boolean; groupBy: string; items: Array<{ group: string }>; n: number }

type ProcessesBody = { items: Array<{ processKey: string; n: number }>; n: number; incomplete: boolean }

/**
 * TC-INS-X03: Process X-Ray analytics RBAC, individuals gate, k-anonymity and access log
 * Covers:
 *   - GET /api/insights/xray/processes, /{processKey}/map, /{processKey}/breakdown?groupBy=user
 *   - PUT /api/insights/xray/settings (individualsEnabled off → on)
 *
 * Six deals (three actors, two each) of an organization created for the test are projected
 * through the real API and a backfill. A viewer without `insights.xray.view` is refused by the
 * route guard; one without the process's `customers.deals.view` gets the shared 404 and an
 * empty process list. Per-person breakdowns need `insights.xray.view_individuals` (granted here
 * through the `insights.*` module wildcard) AND the organization setting: off → 403, on → 200 with
 * an `access_logs` row written first; a viewer without the feature stays 403. A second, small
 * organization (two cases of one actor) shows only suppressed cells.
 */
test.describe('TC-INS-X03: X-Ray analytics RBAC, individuals gate and k-anonymity', () => {
  test('gates processes and per-person reads and suppresses small cells', async ({ request }) => {
    test.slow()
    const fixture = createXrayAnalyticsFixture()
    try {
      const organizationId = await createXrayOrganization(request, fixture, 'INS-X03 big')
      const smallOrganizationId = await createXrayOrganization(request, fixture, 'INS-X03 small')
      const adminToken = fixture.adminToken as string
      const actorRole = await createXrayRole(request, fixture, { label: 'INS-X03 actor', features: DEAL_ACTOR_FEATURES, organizations: [organizationId] })
      const actors: Array<{ token: string; userId: string }> = []
      for (let index = 0; index < 3; index += 1) {
        actors.push(await createXrayUser(request, fixture, { label: `INS-X03 actor ${index}`, organizationId, roleId: actorRole }))
      }
      await seedDealProcess(request, fixture, { organizationId, actorTokens: actors.map((actor) => actor.token), dealsPerActor: 2, label: 'INS-X03' })

      const analystRole = await createXrayRole(request, fixture, { label: 'INS-X03 analyst', features: ['insights.*', 'customers.deals.view'], organizations: [organizationId] })
      const analyst = await createXrayUser(request, fixture, { label: 'INS-X03 analyst', organizationId, roleId: analystRole })
      const viewerRole = await createXrayRole(request, fixture, { label: 'INS-X03 viewer', features: ['insights.xray.view', 'customers.deals.view'], organizations: [organizationId] })
      const viewer = await createXrayUser(request, fixture, { label: 'INS-X03 viewer', organizationId, roleId: viewerRole })
      const blindRole = await createXrayRole(request, fixture, { label: 'INS-X03 blind', features: ['insights.xray.view'], organizations: [organizationId] })
      const blind = await createXrayUser(request, fixture, { label: 'INS-X03 blind', organizationId, roleId: blindRole })
      const noXrayRole = await createXrayRole(request, fixture, { label: 'INS-X03 no xray', features: ['customers.deals.view'], organizations: [organizationId] })
      const noXray = await createXrayUser(request, fixture, { label: 'INS-X03 no xray', organizationId, roleId: noXrayRole })

      const mapPath = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/map`
      const breakdownPath = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/breakdown?groupBy=user`

      const map = await xrayCall<MapBody>(request, viewer.token, 'GET', mapPath)
      expect(map.status, `GET map as the viewer: ${map.text}`).toBe(200)
      expect(map.body).toEqual(expect.objectContaining({ n: 6, organizationIds: [organizationId], incomplete: false, kAnonymity: 5 }))
      expect(map.body?.computedThrough).toBeTruthy()
      expect(map.body?.nodes.map((node) => node.activityKey)).toEqual(expect.arrayContaining(['created', 'status:open', 'status:qa_review', 'status:win']))
      expect(map.body?.nodes.find((node) => node.activityKey === 'status:win')?.cases).toBe(6)

      const processes = await xrayCall<ProcessesBody>(request, viewer.token, 'GET', `${XRAY_ANALYTICS_BASE}/processes`)
      expect(processes.status, `GET processes: ${processes.text}`).toBe(200)
      expect(processes.body?.items.find((item) => item.processKey === DEAL_PROCESS_KEY)?.n).toBe(6)

      expect((await xrayCall(request, noXray.token, 'GET', mapPath)).status, 'insights.xray.view is required').toBe(403)
      const hidden = await xrayCall(request, blind.token, 'GET', mapPath)
      const unknown = await xrayCall(request, blind.token, 'GET', `${XRAY_ANALYTICS_BASE}/customers.ghost/map`)
      expect(hidden.status, 'a process whose features the caller lacks is not found').toBe(404)
      expect(hidden.body, 'invisible and unknown processes answer the same body').toEqual(unknown.body)
      expect((await xrayCall<ProcessesBody>(request, blind.token, 'GET', `${XRAY_ANALYTICS_BASE}/processes`)).body?.items.map((item) => item.processKey) ?? [])
        .not.toContain(DEAL_PROCESS_KEY)
      expect((await xrayCall(request, await getAuthToken(request, 'employee'), 'GET', mapPath)).status).toBe(403)

      const settingOff = await xrayCall(request, analyst.token, 'GET', breakdownPath)
      expect(settingOff.status, `per-person breakdown with the setting off: ${settingOff.text}`).toBe(403)
      expect(settingOff.body).toEqual(expect.objectContaining({ code: 'individuals_denied' }))
      expect(await countIndividualsAccessRows(organizationId, analyst.userId)).toBe(0)

      const enabled = await putXraySettings(request, adminToken, { individualsEnabled: true }, { selectedOrgId: organizationId })
      expect(enabled.status, `PUT individualsEnabled: ${enabled.text}`).toBe(200)
      const perPerson = await xrayCall<BreakdownBody>(request, analyst.token, 'GET', breakdownPath)
      expect(perPerson.status, `per-person breakdown with the setting on: ${perPerson.text}`).toBe(200)
      expect(perPerson.body).toEqual(expect.objectContaining({ perPerson: true, groupBy: 'user', n: 6 }))
      expect(await countIndividualsAccessRows(organizationId, analyst.userId), 'every per-person read writes an access log row first').toBeGreaterThanOrEqual(1)
      const withoutFeature = await xrayCall(request, viewer.token, 'GET', breakdownPath)
      expect(withoutFeature.status, 'the setting alone never grants per-person reads').toBe(403)
      expect(await countIndividualsAccessRows(organizationId, viewer.userId)).toBe(0)

      const smallSettings = await putXraySettings(request, adminToken, { kAnonymity: 5, debounceSeconds: 0 }, { selectedOrgId: smallOrganizationId })
      expect(smallSettings.status).toBe(200)
      for (let index = 0; index < 2; index += 1) {
        const dealId = await createQaDeal(request, adminToken, { title: `QA INS-X03 small ${index} ${uniqueSuffix()}`, status: 'open', selectedOrgId: smallOrganizationId })
        fixture.deals.push({ id: dealId, organizationId: smallOrganizationId })
        await updateQaDeal(request, adminToken, dealId, { status: 'win' }, { selectedOrgId: smallOrganizationId })
      }
      await runXrayBackfill(request, adminToken, { selectedOrgId: smallOrganizationId })
      const small = await xrayCall<MapBody>(request, adminToken, 'GET', mapPath, { selectedOrgId: smallOrganizationId })
      expect(small.status, `GET map of the small organization: ${small.text}`).toBe(200)
      expect(small.body).toEqual(expect.objectContaining({ n: 2, organizationIds: [smallOrganizationId], nodes: [] }))
      expect(small.body?.suppressed.cells ?? 0, 'cells under k cases are suppressed, never shown').toBeGreaterThan(0)
    } finally {
      await cleanupXrayAnalyticsFixture(request, fixture)
    }
  })
})
