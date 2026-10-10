import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { createQaDeal, updateQaDeal, uniqueSuffix } from './helpers/explainApi'
import { DEAL_PROCESS_KEY, OPTIMISTIC_LOCK_HEADER, putXraySettings, runXrayBackfill } from './helpers/xrayApi'
import {
  DEAL_ACTOR_FEATURES,
  cleanupXrayAnalyticsFixture,
  createXrayAnalyticsFixture,
  createXrayOrganization,
  createXrayRole,
  createXrayUser,
  xrayCall,
} from './helpers/xrayAnalyticsApi'

export const integrationMeta = {
  description: 'Automation suggestion → disabled workflow draft needs the workflows module (draft validation and creation)',
  dependsOnModules: ['workflows'],
}

const SUGGESTIONS_PATH = '/api/insights/xray/suggestions'
const SUGGESTIONS_QUEUE = 'insights-xray-suggestions'
const TIME_SHIFT_MS = 2 * 60 * 60 * 1000
const MINING_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 1000

/** Moves the organization's last mining pass one minute back, so the next forced pass is not coalesced with it. */
async function ageMiningPass(organizationId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `update insights_process_rollups set computed_at = computed_at - interval '1 minute'
        where organization_id = $1 and process_key = '*' and window_key = '__suggestion_pass__'`,
      [organizationId],
    )
  })
}

async function readMiningPass(organizationId: string): Promise<string | null> {
  return withClient(async (client) => (await client.query<{ at: string }>(
    `select to_char(computed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
       from insights_process_rollups
      where organization_id = $1 and process_key = '*' and window_key = '__suggestion_pass__'`,
    [organizationId],
  )).rows[0]?.at ?? null)
}

/**
 * Requests an on-demand mining pass and waits until a new pass is recorded. The app's own queue
 * worker may consume the job instead of the drain runner, a pass is skipped (no marker) while the
 * projection runs a scan, and forced passes within 30 seconds of the last one are coalesced, so
 * the request is repeated until a new pass marker appears.
 */
async function mineNow(request: APIRequestContext, token: string, organizationId: string): Promise<void> {
  const before = await readMiningPass(organizationId)
  const deadline = Date.now() + MINING_TIMEOUT_MS
  while (Date.now() < deadline) {
    const requested = await xrayCall(request, token, 'POST', `${SUGGESTIONS_PATH}/mine`, { selectedOrgId: organizationId, data: {} })
    expect(requested.status, `POST suggestions/mine: ${requested.text}`).toBe(202)
    await drainIntegrationQueue(SUGGESTIONS_QUEUE)
    const after = await readMiningPass(organizationId)
    if (after && after !== before) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`[internal] no suggestion mining pass was recorded for ${organizationId}`)
}

type SuggestionItem = {
  id: string
  processKey: string
  organizationId: string
  status: string
  trigger: { activityKey: string; activityKind: string; eventId: string | null }
  condition: { field: string; value: string } | null
  followups: Array<{ field: string; value: string; commandId: string | null }>
  windowSeconds: number
  support: number
  triggerCount: number
  confidence: number
  lift: number
  distinctActorCount: number
  draftable: boolean
  notDraftableReason: string | null
  draftedArtifactId: string | null
  updatedAt: string
}

type DraftActivity = { activityType: string; config: { commandId: string; input: Record<string, unknown> } }

type DraftBody = {
  ok: boolean
  persisted: boolean
  draftable: boolean
  reason: string | null
  payload: {
    workflowId: string
    enabled: boolean
    lifecycle: string
    definition: {
      steps: Array<{ stepId: string; stepType: string; activities?: DraftActivity[] }>
      triggers: Array<{ eventPattern: string; config: { contextMapping: Array<{ targetKey: string; sourceExpression: string }>; filterConditions?: unknown[] } }>
    }
  }
  commands: Array<{ commandId: string; requiredFeatures: string[] }>
  workflowIdAvailable: boolean
}

async function patchSuggestion(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  id: string,
  data: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ status: number; body: Record<string, unknown> | null; text: string }> {
  const response = await apiRequest(request, 'PATCH', `${SUGGESTIONS_PATH}/${id}`, {
    token,
    data,
    headers: { Cookie: `om_selected_org=${organizationId}`, [OPTIMISTIC_LOCK_HEADER]: expectedUpdatedAt },
  })
  const text = await response.text()
  let body: Record<string, unknown> | null = null
  try {
    body = text ? JSON.parse(text) as Record<string, unknown> : null
  } catch {
    body = null
  }
  return { status: response.status(), body, text }
}

/**
 * TC-INS-X04: Process X-Ray automation suggestion → disabled workflow draft
 * Covers:
 *   - PUT  /api/insights/xray/settings (k = 5, no debounce, `suggestionMinSupport` = 5)
 *   - POST /api/insights/xray/suggestions/mine (on-demand pass, drained from `insights-xray-suggestions`, repeated until a pass is recorded)
 *   - GET  /api/insights/xray/suggestions
 *   - GET  /api/insights/xray/suggestions/{id}/draft
 *   - POST /api/workflows/definitions, GET /api/workflows/definitions/{id}
 *   - PATCH /api/insights/xray/suggestions/{id} (drafted with the created definition; stale version → 409)
 *
 * In an organization created for the test, three actors each create three deals through the
 * real API and immediately set their status to `qa_review` by hand (the repeated manual
 * follow-up), then hand the deal over twice (owner changes: other activities, so the follow-up is
 * specific to the creation). After the backfill, the organization's projected activity is moved
 * two hours into the past (a direct update of the throwaway organization's projection rows only):
 * mining counts a trigger only once its follow-up window (10 minutes) has elapsed, and waiting in
 * the test would make it needlessly slow (for the same reason the second on-demand pass moves the
 * last pass marker one minute back: forced passes within 30 s are coalesced). The suggestion
 * "created → status qa_review" is mined
 * (support 9 of 9, three actors, no identities), its draft is a validated disabled workflow
 * (`customers.deal.created` trigger, one UPDATE_ENTITY of `customers.deals.update`) that the
 * workflows API stores disabled (the response says the tenant has not enabled the command yet),
 * marking it drafted uses the optimistic lock, and a later pass never undoes the draft.
 */
test.describe('TC-INS-X04: X-Ray automation suggestion → disabled workflow draft', () => {
  test('mines a repeated manual follow-up and turns it into a disabled draft workflow', async ({ request }) => {
    test.slow()
    const fixture = createXrayAnalyticsFixture()
    let definitionId: string | null = null
    let organizationId: string | null = null
    try {
      organizationId = await createXrayOrganization(request, fixture, 'INS-X04')
      const orgId = organizationId
      const adminToken = fixture.adminToken as string
      const actorRole = await createXrayRole(request, fixture, { label: 'INS-X04 actor', features: DEAL_ACTOR_FEATURES, organizations: [orgId] })
      const actors: Array<{ token: string; userId: string }> = []
      for (let index = 0; index < 3; index += 1) {
        actors.push(await createXrayUser(request, fixture, { label: `INS-X04 actor ${index}`, organizationId: orgId, roleId: actorRole }))
      }
      const settings = await putXraySettings(request, adminToken, { kAnonymity: 5, debounceSeconds: 0, suggestionMinSupport: 5 }, { selectedOrgId: orgId })
      expect(settings.status, `PUT X-Ray settings: ${settings.text}`).toBe(200)
      expect(settings.body?.result).toEqual(expect.objectContaining({ suggestionMinSupport: 5 }))

      for (const [actorIndex, actor] of actors.entries()) {
        for (let index = 0; index < 3; index += 1) {
          const dealId = await createQaDeal(request, actor.token, { title: `QA INS-X04 ${actorIndex}-${index} ${uniqueSuffix()}`, status: 'open' })
          fixture.deals.push({ id: dealId, organizationId: orgId })
          await updateQaDeal(request, actor.token, dealId, { status: 'qa_review' })
          await updateQaDeal(request, actor.token, dealId, { ownerUserId: actors[(actorIndex + 1) % actors.length].userId })
          await updateQaDeal(request, actor.token, dealId, { ownerUserId: actors[(actorIndex + 2) % actors.length].userId })
        }
      }
      await runXrayBackfill(request, adminToken, { selectedOrgId: orgId })
      await withClient(async (client) => {
        await client.query(
          `update insights_process_events set occurred_at = occurred_at - ($2::bigint * interval '1 millisecond') where organization_id = $1`,
          [orgId, TIME_SHIFT_MS],
        )
        await client.query(
          `update insights_process_cases
              set started_at = started_at - ($2::bigint * interval '1 millisecond'),
                  last_activity_at = last_activity_at - ($2::bigint * interval '1 millisecond'),
                  ended_at = ended_at - ($2::bigint * interval '1 millisecond')
            where organization_id = $1`,
          [orgId, TIME_SHIFT_MS],
        )
      })

      await mineNow(request, adminToken, orgId)

      const listed = await xrayCall<{ items: SuggestionItem[]; total: number }>(
        request, adminToken, 'GET', `${SUGGESTIONS_PATH}?processKey=${DEAL_PROCESS_KEY}&status=open`, { selectedOrgId: orgId },
      )
      expect(listed.status, `GET suggestions: ${listed.text}`).toBe(200)
      const suggestion = listed.body?.items.find((item) => item.trigger.activityKey === 'created'
        && item.followups.some((followup) => followup.field === 'status' && followup.value === 'qa_review'))
      expect(suggestion, `the repeated follow-up is suggested: ${listed.text}`).toBeTruthy()
      const item = suggestion as SuggestionItem
      expect(item).toEqual(expect.objectContaining({
        processKey: DEAL_PROCESS_KEY,
        organizationId: orgId,
        status: 'open',
        condition: null,
        windowSeconds: 600,
        support: 9,
        triggerCount: 9,
        distinctActorCount: 3,
        draftable: true,
        notDraftableReason: null,
        draftedArtifactId: null,
      }))
      expect(item.trigger.eventId).toBe('customers.deal.created')
      expect(item.confidence).toBeGreaterThanOrEqual(0.6)
      expect(item.lift).toBeGreaterThanOrEqual(2)
      expect(item.followups).toEqual([expect.objectContaining({ field: 'status', value: 'qa_review', commandId: 'customers.deals.update' })])
      for (const actor of actors) expect(listed.text, 'no actor identity is stored or returned').not.toContain(actor.userId)
      expect(listed.text).not.toMatch(/tk1:|pk1:/)

      const workflowId = `xray.qa.x04.${uniqueSuffix()}`.replace(/_/g, '-')
      const draft = await xrayCall<DraftBody>(request, adminToken, 'GET', `${SUGGESTIONS_PATH}/${item.id}/draft?workflowId=${encodeURIComponent(workflowId)}`, { selectedOrgId: orgId })
      expect(draft.status, `GET suggestion draft: ${draft.text}`).toBe(200)
      const body = draft.body as DraftBody
      expect(body).toEqual(expect.objectContaining({ ok: true, persisted: false, draftable: true, reason: null, workflowIdAvailable: true }))
      expect(body.payload).toEqual(expect.objectContaining({ workflowId, enabled: false, lifecycle: 'draft' }))
      const activities = body.payload.definition.steps.flatMap((step) => step.activities ?? [])
      expect(activities).toEqual([expect.objectContaining({
        activityType: 'UPDATE_ENTITY',
        config: { commandId: 'customers.deals.update', input: { id: '{{context.recordId}}', status: 'qa_review' } },
      })])
      expect(body.payload.definition.triggers).toEqual([expect.objectContaining({
        eventPattern: 'customers.deal.created',
        config: expect.objectContaining({ contextMapping: [{ targetKey: 'recordId', sourceExpression: 'id' }] }),
      })])
      expect(body.commands, 'the tenant has not enabled the command for workflows yet: the draft is valid, its runs need it enabled').toEqual([
        { commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'], enabled: false },
      ])
      const persisted = await withClient(async (client) => (await client.query('select id from workflow_definitions where workflow_id = $1', [workflowId])).rows)
      expect(persisted, 'the draft route persists nothing').toEqual([])

      const created = await xrayCall<{ data?: { id?: string } }>(request, adminToken, 'POST', '/api/workflows/definitions', { selectedOrgId: orgId, data: body.payload })
      expect(created.status, `POST /api/workflows/definitions: ${created.text}`).toBe(201)
      definitionId = created.body?.data?.id ?? null
      expect(definitionId).toBeTruthy()
      const stored = await xrayCall<{ data?: { enabled?: boolean; workflowId?: string } }>(request, adminToken, 'GET', `/api/workflows/definitions/${definitionId}`, { selectedOrgId: orgId })
      expect(stored.status, `GET the created definition: ${stored.text}`).toBe(200)
      expect(stored.body?.data).toEqual(expect.objectContaining({ workflowId, enabled: false }))

      const unknownArtifact = await patchSuggestion(request, adminToken, orgId, item.id, { status: 'drafted', draftedArtifactId: '00000000-0000-4000-8000-000000000000' }, item.updatedAt)
      expect(unknownArtifact.status, `a definition outside the organization: ${unknownArtifact.text}`).toBe(422)
      expect(unknownArtifact.body?.code).toBe('drafted_artifact_not_found')

      const drafted = await patchSuggestion(request, adminToken, orgId, item.id, { status: 'drafted', draftedArtifactId: definitionId }, item.updatedAt)
      expect(drafted.status, `PATCH drafted: ${drafted.text}`).toBe(200)
      const result = drafted.body?.result as SuggestionItem
      expect(result).toEqual(expect.objectContaining({ id: item.id, status: 'drafted', draftedArtifactId: definitionId }))
      expect(result.updatedAt).not.toBe(item.updatedAt)

      const stale = await patchSuggestion(request, adminToken, orgId, item.id, { status: 'dismissed' }, item.updatedAt)
      expect(stale.status, `a stale version: ${stale.text}`).toBe(409)
      expect(stale.body).toEqual(expect.objectContaining({ code: 'optimistic_lock_conflict', currentUpdatedAt: result.updatedAt }))
      const afterConflict = await xrayCall<{ items: SuggestionItem[] }>(request, adminToken, 'GET', `${SUGGESTIONS_PATH}?processKey=${DEAL_PROCESS_KEY}&status=drafted`, { selectedOrgId: orgId })
      expect(afterConflict.body?.items.map((entry) => entry.id)).toContain(item.id)

      await ageMiningPass(orgId)
      await mineNow(request, adminToken, orgId)
      const stillDrafted = await xrayCall<{ items: SuggestionItem[] }>(request, adminToken, 'GET', `${SUGGESTIONS_PATH}?processKey=${DEAL_PROCESS_KEY}&status=drafted`, { selectedOrgId: orgId })
      expect(stillDrafted.body?.items.find((entry) => entry.id === item.id), 'mining never undoes a draft').toEqual(expect.objectContaining({ status: 'drafted', draftedArtifactId: definitionId }))

      const forbidden = await xrayCall(request, actors[0].token, 'GET', SUGGESTIONS_PATH)
      expect(forbidden.status, 'an actor without insights.xray.view is refused').toBe(403)
      const hidden = await xrayCall(request, actors[0].token, 'GET', `${SUGGESTIONS_PATH}/${item.id}/draft`)
      expect(hidden.status).toBe(403)
    } finally {
      if (definitionId && organizationId && fixture.adminToken) {
        await apiRequest(request, 'DELETE', `/api/workflows/definitions/${encodeURIComponent(definitionId)}`, {
          token: fixture.adminToken,
          headers: { Cookie: `om_selected_org=${organizationId}` },
        }).catch(() => undefined)
      }
      if (definitionId) {
        await withClient(async (client) => {
          await client.query('delete from workflow_definitions where id = $1', [definitionId])
        }).catch(() => undefined)
      }
      if (organizationId) {
        await withClient(async (client) => {
          await client.query('delete from insights_automation_suggestions where organization_id = $1', [organizationId])
        }).catch(() => undefined)
      }
      await cleanupXrayAnalyticsFixture(request, fixture)
    }
  })
})
