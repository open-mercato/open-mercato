import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import type {
  BottlenecksResult,
  BreakdownResult,
  CaseListResult,
  ConformanceResult,
  ReworkResult,
} from '../lib/analytics/types'
import { uniqueSuffix } from './helpers/explainApi'
import { DEAL_PROCESS_KEY, getXraySettings, putXraySettings } from './helpers/xrayApi'
import {
  DEAL_ACTOR_FEATURES,
  DEAL_STATUS_PATH,
  XRAY_ANALYTICS_BASE,
  cleanupXrayAnalyticsFixture,
  createXrayAnalyticsFixture,
  createXrayOrganization,
  createXrayRole,
  createXrayUser,
  xrayCall,
} from './helpers/xrayAnalyticsApi'
import {
  DEAL_ACTIVITY_STEP_MAP,
  DEAL_MODEL_STEPS,
  buildDealConformanceWorkflowPayload,
  cleanupXrayModelFixture,
  createStaffTeamInOrganization,
  createStaffTeamMemberInOrganization,
  createWorkflowDefinitionInOrganization,
  createXrayModelFixture,
  seedDealVariants,
  type DealVariant,
} from './helpers/xrayModelApi'

export const integrationMeta = {
  description: 'Conformance against a stored workflow definition needs the workflows module; the team breakdown needs staff teams',
  dependsOnModules: ['workflows', 'staff'],
}

type XrayErrorBody = { error: string; code: string; hint: string | null }

type ConformanceOk = Extract<ConformanceResult, { status: 'ok' }>

type ConformanceRefused = Extract<ConformanceResult, { status: 'refused' }>

type BreakdownItem = BreakdownResult['items'][number]

const PROCESS_PATH = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}`
const K_ANONYMITY = 5
const ACTOR_COUNT = 3
const MIN_COVERAGE = 0.6

const DEAL_VARIANTS: ReadonlyArray<DealVariant<'conforming' | 'rework' | 'open'>> = [
  { key: 'conforming', statuses: DEAL_STATUS_PATH, dealsPerActor: 2 },
  { key: 'rework', statuses: ['open', 'qa_review', 'open', 'win'], dealsPerActor: 2 },
  { key: 'open', statuses: ['open'], dealsPerActor: 1 },
]

const MAPPED_KEYS_PER_CONFORMING_CASE = 4
const MAPPED_KEYS_PER_REWORK_CASE = 5

function sortedIds(ids: readonly string[]): string[] {
  return ids.map((id) => id.toLowerCase()).sort()
}

function expectConformanceOk(result: { status: number; text: string; body: ConformanceResult | null }, label: string): ConformanceOk {
  expect(result.status, `${label}: ${result.text}`).toBe(200)
  expect(result.body?.status, `${label} compares the cases: ${result.text}`).toBe('ok')
  return result.body as ConformanceOk
}

function expectConformanceRefused(result: { status: number; text: string; body: ConformanceResult | null }, label: string): ConformanceRefused {
  expect(result.status, `${label}: ${result.text}`).toBe(200)
  expect(result.body?.status, `${label} is refused: ${result.text}`).toBe('refused')
  return result.body as ConformanceRefused
}

function expectXrayError(result: { status: number; text: string; body: XrayErrorBody | null }, status: number, code: string): void {
  expect(result.status, `expected ${status} ${code}: ${result.text}`).toBe(status)
  expect(result.body?.code).toBe(code)
  expect(result.body, 'error bodies never disclose counts').not.toHaveProperty('n')
}

/** The single visible group of a breakdown whose actors all share one role / team. */
function expectSingleGroup(body: BreakdownResult | null, organizationId: string, group: string, cases: number): BreakdownItem {
  expect(body?.items, 'one group holds every actor').toHaveLength(1)
  const item = body?.items[0] as BreakdownItem
  expect(item.organizationId.toLowerCase()).toBe(organizationId.toLowerCase())
  expect(item.group).toBe(group.toLowerCase())
  expect(item.cases).toBe(cases)
  expect(item.actors).toBe(ACTOR_COUNT)
  expect(item.raw, 'nothing collapses without debounce').toBe(item.collapsed)
  expect(item.causes).toEqual({ human: item.collapsed, automated: 0, legacy: 0, other: 0, byKind: { user: item.collapsed } })
  expect(item.stepWait.n, 'every step but the first of each case has a measured wait').toBe(item.collapsed - cases)
  return item
}

/** Follows `nextCursor` through every page of a case listing. */
async function listEveryCase(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  query: string,
): Promise<{ totals: number[]; pageSizes: number[]; ids: string[] }> {
  const totals: number[] = []
  const pageSizes: number[] = []
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const path: string = `${PROCESS_PATH}/cases?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const page = await xrayCall<CaseListResult>(request, token, 'GET', path, { selectedOrgId: organizationId })
    expect(page.status, `GET ${path}: ${page.text}`).toBe(200)
    const body = page.body as CaseListResult
    expect(body.items.every((item) => item.organizationId.toLowerCase() === organizationId.toLowerCase())).toBe(true)
    totals.push(body.n)
    pageSizes.push(body.items.length)
    ids.push(...body.items.map((item) => item.caseId))
    cursor = body.nextCursor
    expect(pageSizes.length, 'the keyset pagination terminates').toBeLessThanOrEqual(20)
  } while (cursor)
  return { totals, pageSizes, ids }
}

/**
 * TC-INS-X11: Process X-Ray conformance, bottlenecks, rework, cases and breakdowns
 * Covers:
 *   - GET /api/insights/xray/{processKey}/conformance (configured workflow and ad-hoc `sequence`)
 *   - GET /api/insights/xray/{processKey}/bottlenecks, /rework, /cases, /breakdown?groupBy=role|team
 *   - PUT /api/insights/xray/settings (`conformanceWorkflowId` + `activityStepMap`, optimistic lock)
 *   - POST /api/workflows/definitions, POST /api/staff/teams, POST /api/staff/team-members
 *
 * In an organization created for the test, three actors (one role, members of one staff team
 * created before any deal) each create five deals through the API: two walk
 * `open → qa_review → win` (conforming), two `open → qa_review → open → win` (rework, deviating)
 * and one stays `open`; one backfill projects them (k = 5, no debounce). Every reported cell holds
 * at least five cases of all three actors, so nothing is suppressed and every count is exact.
 * Without a model conformance answers 422 `conformance_model_missing`; a `conformanceWorkflowId`
 * that is not a definition of the organization is refused (422
 * `conformance_workflow_not_found`); a disabled workflow definition (START → open → QA review →
 * unmapped automated step → won → END, plus an error route open → won) with the activity map is
 * saved under the optimistic lock. Conformance through the stored definition and through the
 * equivalent ad-hoc sequence reports six conforming of twelve completed cases with the two
 * deviations of the rework variant (the error route is not designed flow); an unmapped sequence
 * and a map covering only `status:win` fall under the 60 % coverage threshold and are refused.
 */
test.describe('TC-INS-X11: X-Ray conformance, bottlenecks, rework, cases and breakdowns', () => {
  test('compares the cases with the configured workflow and reports bottlenecks, rework, cases and breakdowns', async ({ request }) => {
    test.slow()
    const fixture = createXrayAnalyticsFixture()
    const model = createXrayModelFixture()
    try {
      const organizationId = await createXrayOrganization(request, fixture, 'INS-X11')
      const adminToken = fixture.adminToken as string
      const scoped = { selectedOrgId: organizationId }
      const actorRole = await createXrayRole(request, fixture, { label: 'INS-X11 actor', features: DEAL_ACTOR_FEATURES, organizations: [organizationId] })
      const actors: Array<{ token: string; userId: string }> = []
      for (let index = 0; index < ACTOR_COUNT; index += 1) {
        actors.push(await createXrayUser(request, fixture, { label: `INS-X11 actor ${index}`, organizationId, roleId: actorRole }))
      }
      const teamId = await createStaffTeamInOrganization(request, adminToken, model, { organizationId, name: `QA INS-X11 team ${uniqueSuffix()}` })
      for (const [index, actor] of actors.entries()) {
        await createStaffTeamMemberInOrganization(request, adminToken, model, {
          organizationId,
          teamId,
          userId: actor.userId,
          displayName: `QA INS-X11 member ${index}`,
        })
      }
      const deals = await seedDealVariants(request, fixture, {
        organizationId,
        actorTokens: actors.map((actor) => actor.token),
        variants: DEAL_VARIANTS,
        label: 'INS-X11',
      })
      const conformingCases = deals.conforming.length
      const reworkCases = deals.rework.length
      const completedIds = [...deals.conforming, ...deals.rework]
      const allIds = [...completedIds, ...deals.open]
      expect(conformingCases).toBe(6)
      expect(reworkCases).toBe(6)
      expect(deals.open).toHaveLength(ACTOR_COUNT)

      const conformancePath = `${PROCESS_PATH}/conformance?window=30d`
      expectXrayError(await xrayCall<XrayErrorBody>(request, adminToken, 'GET', conformancePath, scoped), 422, 'conformance_model_missing')

      const workflowId = `xray.qa.x11.${uniqueSuffix()}`.replace(/_/g, '-')
      const definitionId = await createWorkflowDefinitionInOrganization(request, adminToken, model, {
        organizationId,
        payload: buildDealConformanceWorkflowPayload(workflowId),
      })

      const current = await getXraySettings(request, adminToken, scoped)
      expect(current.status, `GET X-Ray settings: ${current.text}`).toBe(200)
      const seededVersion = current.body?.result.updatedAt ?? null
      expect(seededVersion, 'the seeded settings carry a version token').toBeTruthy()
      const unknownWorkflow = await putXraySettings(request, adminToken, {
        conformanceWorkflowId: randomUUID(),
        activityStepMap: DEAL_ACTIVITY_STEP_MAP,
      }, { ...scoped, expectedUpdatedAt: seededVersion })
      expect(unknownWorkflow.status, `a workflow that is not a definition of the organization: ${unknownWorkflow.text}`).toBe(422)
      expect(unknownWorkflow.body?.code).toBe('conformance_workflow_not_found')
      const saved = await putXraySettings(request, adminToken, {
        conformanceWorkflowId: definitionId,
        activityStepMap: DEAL_ACTIVITY_STEP_MAP,
      }, { ...scoped, expectedUpdatedAt: seededVersion })
      expect(saved.status, `PUT conformance settings: ${saved.text}`).toBe(200)
      const savedSettings = saved.body?.result
      expect(savedSettings?.conformanceWorkflowId?.toLowerCase()).toBe(definitionId.toLowerCase())
      expect(savedSettings?.activityStepMap).toEqual(DEAL_ACTIVITY_STEP_MAP)
      expect(savedSettings).toEqual(expect.objectContaining({ kAnonymity: K_ANONYMITY, debounceSeconds: 0 }))
      expect(savedSettings?.updatedAt, 'a save issues a new version token').toBeTruthy()
      expect(savedSettings?.updatedAt).not.toBe(seededVersion)
      const reread = await getXraySettings(request, adminToken, scoped)
      expect(reread.body?.result.conformanceWorkflowId?.toLowerCase()).toBe(definitionId.toLowerCase())
      expect(reread.body?.result.activityStepMap).toEqual(DEAL_ACTIVITY_STEP_MAP)
      expect(reread.body?.result.updatedAt).toBe(savedSettings?.updatedAt)

      const designed = expectConformanceOk(await xrayCall<ConformanceResult>(request, adminToken, 'GET', conformancePath, scoped), 'conformance with the stored workflow')
      expect(designed).toEqual(expect.objectContaining({
        processKey: DEAL_PROCESS_KEY,
        organizationIds: [organizationId],
        n: completedIds.length,
        kAnonymity: K_ANONYMITY,
        minCoverage: MIN_COVERAGE,
        unresolvedCases: 0,
        truncatedCases: 0,
      }))
      expect(designed.suppressed.cells, 'every conformance cell passes k and the three-actor rule').toBe(0)
      expect(designed.models).toEqual([{
        key: `workflow:${definitionId.toLowerCase()}`,
        source: { kind: 'workflow', definitionId, version: 1 },
        n: completedIds.length,
        conformingCases,
        fitness: 0.5,
        fitnessLowerBound: expect.any(Number),
        lowConfidence: true,
        transitions: { total: 2 * conformingCases + 3 * reworkCases, allowed: 2 * conformingCases + reworkCases },
        deviations: [
          { kind: 'invalid_transition', from: DEAL_MODEL_STEPS.open, to: DEAL_MODEL_STEPS.win, cases: reworkCases },
          { kind: 'invalid_transition', from: DEAL_MODEL_STEPS.review, to: DEAL_MODEL_STEPS.open, cases: reworkCases },
        ],
      }])
      const designedLowerBound = designed.models[0].fitnessLowerBound as number
      expect(designedLowerBound).toBeGreaterThan(0)
      expect(designedLowerBound).toBeLessThan(0.5)
      const mappedKeys = Object.keys(DEAL_ACTIVITY_STEP_MAP)
      expect(designed.unmappedActivities.filter((activity) => mappedKeys.includes(activity.activityKey) || activity.activityKey.startsWith('status:'))).toEqual([])
      const mappedEvents = MAPPED_KEYS_PER_CONFORMING_CASE * conformingCases + MAPPED_KEYS_PER_REWORK_CASE * reworkCases
      const unmappedEvents = designed.unmappedActivities.reduce((total, activity) => total + activity.events, 0)
      expect(designed.coverage).toBeGreaterThanOrEqual(MIN_COVERAGE)
      expect(designed.coverage).toBeCloseTo(mappedEvents / (mappedEvents + unmappedEvents), 10)

      const sequence = ['created', 'status:open', 'status:qa_review', 'status:win'].join(',')
      const adHoc = expectConformanceOk(
        await xrayCall<ConformanceResult>(request, adminToken, 'GET', `${conformancePath}&sequence=${encodeURIComponent(sequence)}`, scoped),
        'conformance with an ad-hoc sequence',
      )
      expect(adHoc).toEqual(expect.objectContaining({ n: completedIds.length, unresolvedCases: 0, minCoverage: MIN_COVERAGE }))
      expect(adHoc.coverage, 'the sequence maps the same activities as the stored workflow').toBe(designed.coverage)
      expect(adHoc.models).toEqual([{
        key: 'sequence',
        source: { kind: 'sequence', definitionId: null, version: null },
        n: completedIds.length,
        conformingCases,
        fitness: 0.5,
        fitnessLowerBound: designedLowerBound,
        lowConfidence: true,
        transitions: { total: 3 * conformingCases + 4 * reworkCases, allowed: 3 * conformingCases + 2 * reworkCases },
        deviations: [
          { kind: 'invalid_transition', from: 'status:open', to: 'status:win', cases: reworkCases },
          { kind: 'invalid_transition', from: 'status:qa_review', to: 'status:open', cases: reworkCases },
        ],
      }])
      const unmappedSequence = expectConformanceRefused(
        await xrayCall<ConformanceResult>(request, adminToken, 'GET', `${conformancePath}&sequence=${encodeURIComponent('status:lost')}`, scoped),
        'conformance with a sequence no case touches',
      )
      expect(unmappedSequence).toEqual(expect.objectContaining({ reason: 'insufficient_coverage', coverage: 0, minCoverage: MIN_COVERAGE, n: completedIds.length }))

      const bottlenecks = await xrayCall<BottlenecksResult>(request, adminToken, 'GET', `${PROCESS_PATH}/bottlenecks?window=30d`, scoped)
      expect(bottlenecks.status, `GET bottlenecks: ${bottlenecks.text}`).toBe(200)
      const waits = bottlenecks.body as BottlenecksResult
      expect(waits).toEqual(expect.objectContaining({
        processKey: DEAL_PROCESS_KEY,
        organizationIds: [organizationId],
        n: allIds.length,
        kAnonymity: K_ANONYMITY,
        includeSyncRun: false,
        incomplete: false,
        omitted: 0,
      }))
      expect(waits.computedThrough).toBeTruthy()
      expect(waits.suppressed.cells).toBe(0)
      const transition = (from: string, to: string) => waits.items.find((item) => item.from === from && item.to === to)
      expect(transition('created', 'status:open'), 'a creation and its initial status share one audit row').toEqual({
        from: 'created',
        to: 'status:open',
        transitions: allIds.length,
        rawTransitions: allIds.length,
        cases: allIds.length,
        wait: { n: allIds.length, medianMs: 0, p90Ms: null, lowConfidence: true },
        totalWaitMs: 0,
      })
      for (const [from, to, cases] of [
        ['status:qa_review', 'status:win', conformingCases],
        ['status:qa_review', 'status:open', reworkCases],
        ['status:open', 'status:win', reworkCases],
      ] as const) {
        const item = transition(from, to)
        expect(item, `bottleneck ${from} → ${to}`).toEqual(expect.objectContaining({ transitions: cases, rawTransitions: cases, cases }))
        expect(item?.wait).toEqual(expect.objectContaining({ n: cases, p90Ms: null, lowConfidence: true }))
        expect(typeof item?.wait.medianMs, 'a median is reported from five measured waits').toBe('number')
        expect(typeof item?.totalWaitMs).toBe('number')
      }
      expect(waits.items.every((item) => item.cases >= K_ANONYMITY)).toBe(true)
      const itemTransitions = waits.items.reduce((total, item) => total + item.transitions, 0)
      expect(waits.transitions).toEqual({ raw: itemTransitions, collapsed: itemTransitions, measured: itemTransitions, excludedSyncRun: 0 })

      const reworkResult = await xrayCall<ReworkResult>(request, adminToken, 'GET', `${PROCESS_PATH}/rework?window=30d`, scoped)
      expect(reworkResult.status, `GET rework: ${reworkResult.text}`).toBe(200)
      const rework = reworkResult.body as ReworkResult
      expect(rework).toEqual(expect.objectContaining({
        processKey: DEAL_PROCESS_KEY,
        organizationIds: [organizationId],
        n: allIds.length,
        rework: reworkCases,
        reworkRaw: reworkCases,
        corrections: 0,
        debounced: 0,
        casesWithRework: reworkCases,
        casesWithReworkRaw: reworkCases,
        truncatedCases: 0,
        byStage: [{ activityKey: 'status:open', rework: reworkCases, reworkRaw: reworkCases, corrections: 0, cases: reworkCases }],
      }))
      expect(rework.suppressed.cells).toBe(0)
      expect(rework.reworkRate).toBeCloseTo(reworkCases / allIds.length, 10)
      expect(rework.reworkRateLowerBound).toBeGreaterThan(0)
      expect(rework.reworkRateLowerBound as number).toBeLessThan(rework.reworkRate as number)

      const everyCase = await listEveryCase(request, adminToken, organizationId, 'window=30d&pageSize=100')
      expect(everyCase.totals).toEqual([allIds.length])
      expect(sortedIds(everyCase.ids)).toEqual(sortedIds(allIds))
      const completed = await listEveryCase(request, adminToken, organizationId, 'window=30d&status=completed&pageSize=5')
      expect(completed.totals, 'n is the size of the whole filtered population on every page').toEqual([completedIds.length, completedIds.length, completedIds.length])
      expect(completed.pageSizes).toEqual([5, 5, completedIds.length - 10])
      expect(sortedIds(completed.ids), 'pages neither repeat nor skip a case').toEqual(sortedIds(completedIds))
      const open = await listEveryCase(request, adminToken, organizationId, 'window=30d&status=open&pageSize=100')
      expect(open.totals).toEqual([deals.open.length])
      expect(sortedIds(open.ids)).toEqual(sortedIds(deals.open))
      const won = await listEveryCase(request, adminToken, organizationId, `window=30d&activityKey=${encodeURIComponent('status:win')}&pageSize=100`)
      expect(won.totals).toEqual([completedIds.length])
      expect(sortedIds(won.ids)).toEqual(sortedIds(completedIds))
      const byUsers = await listEveryCase(request, adminToken, organizationId, 'window=30d&causeKinds=user&pageSize=100')
      expect(byUsers.totals, 'every seeded step was taken by a signed-in user').toEqual([allIds.length])
      expect(sortedIds(byUsers.ids)).toEqual(sortedIds(allIds))
      const byWorkflows = await listEveryCase(request, adminToken, organizationId, 'window=30d&causeKinds=workflow&pageSize=100')
      expect(byWorkflows).toEqual({ totals: [0], pageSizes: [0], ids: [] })
      const byTeam = await listEveryCase(request, adminToken, organizationId, `window=30d&actorTeamIds=${teamId}&pageSize=100`)
      expect(sortedIds(byTeam.ids), 'the team filter passes k and the three-actor rule').toEqual(sortedIds(allIds))
      const byRoleWon = await listEveryCase(request, adminToken, organizationId, `window=30d&actorRoleIds=${actorRole}&activityKey=${encodeURIComponent('status:win')}&pageSize=100`)
      expect(sortedIds(byRoleWon.ids)).toEqual(sortedIds(completedIds))
      expectXrayError(
        await xrayCall<XrayErrorBody>(request, adminToken, 'GET', `${PROCESS_PATH}/cases?window=30d&actorTeamIds=${randomUUID()}`, scoped),
        422,
        'filter_too_narrow',
      )

      const byRole = await xrayCall<BreakdownResult>(request, adminToken, 'GET', `${PROCESS_PATH}/breakdown?window=30d&groupBy=role`, scoped)
      expect(byRole.status, `GET breakdown by role: ${byRole.text}`).toBe(200)
      expect(byRole.body).toEqual(expect.objectContaining({ groupBy: 'role', perPerson: false, overlapping: true, includeSyncRun: false, n: allIds.length }))
      expect(byRole.body?.suppressed.cells).toBe(0)
      const roleItem = expectSingleGroup(byRole.body, organizationId, actorRole, allIds.length)
      const byTeamBreakdown = await xrayCall<BreakdownResult>(request, adminToken, 'GET', `${PROCESS_PATH}/breakdown?window=30d&groupBy=team`, scoped)
      expect(byTeamBreakdown.status, `GET breakdown by team: ${byTeamBreakdown.text}`).toBe(200)
      expect(byTeamBreakdown.body).toEqual(expect.objectContaining({ groupBy: 'team', perPerson: false, overlapping: false, includeSyncRun: false, n: allIds.length }))
      expect(byTeamBreakdown.body?.suppressed.cells).toBe(0)
      const teamItem = expectSingleGroup(byTeamBreakdown.body, organizationId, teamId, allIds.length)
      expect(teamItem.collapsed, 'the role and the team group count the same steps').toBe(roleItem.collapsed)

      const partialMap = { 'status:win': DEAL_MODEL_STEPS.win, 'status:qa_review': 'ghost-step' }
      const partial = await putXraySettings(request, adminToken, { activityStepMap: partialMap }, { ...scoped, expectedUpdatedAt: savedSettings?.updatedAt ?? null })
      expect(partial.status, `PUT a map covering only status:win: ${partial.text}`).toBe(200)
      expect(partial.body?.result.activityStepMap).toEqual(partialMap)
      const underCovered = expectConformanceRefused(
        await xrayCall<ConformanceResult>(request, adminToken, 'GET', conformancePath, scoped),
        'conformance with a map below the coverage threshold',
      )
      expect(underCovered).toEqual(expect.objectContaining({ reason: 'insufficient_coverage', minCoverage: MIN_COVERAGE, n: completedIds.length }))
      expect(underCovered.coverage, 'one mapped status per completed case (the unknown step id is dropped)')
        .toBeCloseTo(designed.coverage * completedIds.length / mappedEvents, 10)
      expect(underCovered.coverage as number).toBeLessThan(MIN_COVERAGE)
    } finally {
      await cleanupXrayModelFixture(request, fixture.adminToken, model)
      await cleanupXrayAnalyticsFixture(request, fixture)
    }
  })
})
