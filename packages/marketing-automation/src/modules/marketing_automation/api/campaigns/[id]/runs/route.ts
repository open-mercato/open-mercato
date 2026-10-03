import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { MarketingCampaign, MarketingCampaignRun } from '../../../../data/entities.js'
import type { StepOutcome } from '../../../../lib/engine/types.js'
import { findTrigger } from '../../../../lib/trigger-catalog.js'
import { readPathUuid } from '../../../shared.js'
import { retryDeadRun } from '../../../../lib/runs.js'
import { z } from 'zod'

/**
 * Who is mid-journey in this campaign, and what happened to them.
 *
 * Gated by `marketing_automation.runs.view` rather than `campaigns.view`: seeing the campaign and
 * seeing which named customers it has messaged are different disclosures.
 */
const retryBodySchema = z.object({ runId: z.string().uuid() })

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view'] },
  /**
   * Reviving a dead run is gated behind `campaigns.publish`, not `runs.view` and not a new feature.
   *
   * The retry resumes a journey, which SENDS to a real customer — so it belongs behind the permission this
   * module reserves for exactly that, the one it refuses to give an AI tool. `runs.view` is a disclosure
   * grant and would be far too weak; `campaigns.manage` is authoring, which sends nothing.
   *
   * A new `runs.manage` feature was the alternative and was rejected: `acl.ts` is a contract surface, a new
   * feature reaches existing tenants only after `mercato auth sync-role-acls`, and the operational cost buys
   * a distinction nobody asked for.
   */
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.publish'] },
}

export const metadata = routeMetadata

const MAX_PAGE_SIZE = 100
const RUN_STATUSES = ['running', 'waiting', 'claimed', 'completed', 'failed', 'dead'] as const
type RunStatus = (typeof RUN_STATUSES)[number]

function readCampaignId(req: Request): string | null {
  // .../campaigns/<id>/runs
  return readPathUuid(req, 2)
}

function readStepLog(value: unknown): StepOutcome[] {
  return Array.isArray(value) ? (value as StepOutcome[]) : []
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ items: [], total: 0 }, { status: 401 })
  }
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const url = new URL(req.url)
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1)
  const statusParam = url.searchParams.get('status')
  const status = RUN_STATUSES.includes(statusParam as RunStatus) ? (statusParam as RunStatus) : null

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  // Scoped through the campaign so a run id from another organization cannot be reached by
  // guessing a campaign id.
  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [runs, total] = await em.findAndCount(
    MarketingCampaignRun,
    { campaignId: campaign.id, ...scope, ...(status ? { status } : {}) },
    { orderBy: { startedAt: 'DESC' }, limit: pageSize, offset: (page - 1) * pageSize },
  )

  /**
   * Who these runs are ABOUT, by name — and only for a reader allowed to know.
   *
   * The screen used to print the first eight characters of a subject id, which answers a question nobody
   * asks: an operator looking at this list wants to know which customer is waiting. Adding the name and the
   * address made this route hand out CRM data, and `display_name` and `primary_email` are GDPR-encrypted at
   * rest precisely because `customers.people.view` is the feature that protects them. Four routes in this
   * module already demand it alongside their own; the segment members route says why in one line — the
   * answer NAMES people.
   *
   * The check is a second one inside the handler, because `requireFeatures` is all-or-nothing per method.
   * Demanding both features outright would be simpler and would take the screen away from a marketing-only
   * role that could use it before, so the list stays readable at `runs.view` — a run, its status and its step
   * log are marketing facts — and only the two CRM fields are withheld. Nothing is even decrypted for a
   * caller who may not read the result.
   *
   * The response already types both fields nullable, so such a caller sees exactly what a deleted customer
   * looks like, which the screen already has words for.
   */
  const rbac = container.resolve<RbacService>('rbacService')
  const mayReadContactDetails = await rbac.userHasAllFeatures(
    auth.sub,
    ['customers.people.view'],
    { tenantId: auth.tenantId ?? null, organizationId },
  )

  const subjectIds = [...new Set(runs.map((run) => run.subjectEntityId).filter((id): id is string => !!id))]
  const subjects = subjectIds.length > 0 && mayReadContactDetails
    ? (await findWithDecryption(
        em,
        CustomerEntity,
        { id: { $in: subjectIds }, ...scope, deletedAt: null },
        undefined,
        scope,
      )) as Array<{ id: string; displayName?: string | null; primaryEmail?: string | null }>
    : []
  const subjectById = new Map(subjects.map((row) => [row.id, row]))
  return NextResponse.json({
    campaign: { id: campaign.id, name: campaign.name, isEnabled: campaign.isEnabled },
    // A curated shape, not the stored row. The context blob holds whatever scalars a trigger
    // contributed and is not something to hand to a client wholesale.
    items: runs.map((run) => {
      const stepLog = readStepLog(run.stepLog)
      return {
        id: run.id,
        subjectEntityId: run.subjectEntityId ?? null,
        /**
         * Null when the customer is gone — erased under GDPR, or deleted — and the screen says so rather
         * than falling back to the id. A run outliving its subject is a real state, not a lookup failure.
         */
        subjectName: mayReadContactDetails && run.subjectEntityId
          ? subjectById.get(run.subjectEntityId)?.displayName ?? null
          : null,
        subjectEmail: mayReadContactDetails && run.subjectEntityId
          ? subjectById.get(run.subjectEntityId)?.primaryEmail ?? null
          : null,
        triggerEventId: run.triggerEventId,
        /**
         * Resolved HERE rather than on the screen: the catalogue imports ORM entities, so pulling it into a
         * client component would drag the sales entities into the browser bundle. Null for an id the
         * catalogue does not know — a campaign saved before a trigger was renamed — and the screen then
         * shows the raw id, which is the only honest thing left to show.
         */
        triggerLabelKey: findTrigger(run.triggerEventId)?.labelKey ?? null,
        status: run.status,
        currentStepIndex: run.currentStepIndex,
        attempts: run.attempts,
        lastError: run.lastError ?? null,
        startedAt: run.startedAt.toISOString(),
        resumeAt: run.resumeAt ? run.resumeAt.toISOString() : null,
        completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        stepsDone: stepLog.filter((entry) => entry.status === 'done').length,
        stepsSkipped: stepLog.filter((entry) => entry.status === 'skipped').length,
        stepLog: stepLog.map((entry) => ({
          stepId: entry.stepId,
          type: entry.type,
          status: entry.status,
          at: entry.at,
          detail: entry.detail ?? null,
        })),
      }
    }),
    total,
    page,
    pageSize,
  })
}

export const openApi = {
  GET: {
    summary: 'List runs of a campaign',
    description:
      'Who entered the campaign, where each run is, and what each step did. Gated by `marketing_automation.runs.view`, separately from seeing the campaign itself. Returns a curated row rather than the stored context blob.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'A page of runs' }, 404: { description: 'Not found' } },
  },
}

/**
 * Puts one dead run back in the queue.
 *
 * `{ runId }` in the body rather than a nested route, because a retry is an action ON this collection and the
 * module has no other per-run endpoint to sit beside.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  /**
   * A scope that cannot be resolved is a 400, never a 401 — `apiFetch` reads 401 as an expired session and
   * loops for ever on a refresh that keeps succeeding.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = retryBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', code: 'marketing_automation.validation.invalidPayload' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  /**
   * The run is checked to belong to THIS campaign before anything is written.
   *
   * The id arrives in a body, so without this a caller holding `campaigns.publish` could revive a run of any
   * campaign in their organization by naming it here — the route's path would say one thing and the write do
   * another.
   */
  const run = await em.findOne(MarketingCampaignRun, {
    id: parsed.data.runId,
    campaignId,
    ...scope,
  })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const revived = await retryDeadRun(em, scope, parsed.data.runId, new Date())
  /**
   * A run that was not dead is a 409, not a silent success.
   *
   * Two operators pressing the button together, or one pressing it on a stale list, must not be told something
   * happened that did not — the conditional update is what makes only one of them the winner.
   */
  if (!revived) {
    return NextResponse.json(
      { error: 'This run is not dead, so there is nothing to retry', code: 'marketing_automation.runs.notDead' },
      { status: 409 },
    )
  }
  return NextResponse.json({ retried: true })
}
