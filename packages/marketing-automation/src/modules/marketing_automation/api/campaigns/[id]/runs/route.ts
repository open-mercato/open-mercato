import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { MarketingCampaign, MarketingCampaignRun } from '../../../../data/entities.js'
import type { StepOutcome } from '../../../../lib/engine/types.js'
import { findTrigger } from '../../../../lib/trigger-catalog.js'
import { readPathUuid } from '../../../shared.js'

/**
 * Who is mid-journey in this campaign, and what happened to them.
 *
 * Gated by `marketing_automation.runs.view` rather than `campaigns.view`: seeing the campaign and
 * seeing which named customers it has messaged are different disclosures.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view'] },
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
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ items: [], total: 0 }, { status: 401 })
  }
  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const url = new URL(req.url)
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1)
  const statusParam = url.searchParams.get('status')
  const status = RUN_STATUSES.includes(statusParam as RunStatus) ? (statusParam as RunStatus) : null

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

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
   * Who these runs are ABOUT, by name.
   *
   * The screen used to print the first eight characters of a subject id, which answers a question nobody
   * asks: an operator looking at this list wants to know which customer is waiting, and `a3fa18cb` is not a
   * customer. One decrypting query for the page — `display_name` is encrypted at rest, so a plain find hands
   * back ciphertext, and a column of ciphertext reads as a column of broken names.
   */
  const subjectIds = [...new Set(runs.map((run) => run.subjectEntityId).filter((id): id is string => !!id))]
  const subjects = subjectIds.length > 0
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
        subjectName: run.subjectEntityId ? subjectById.get(run.subjectEntityId)?.displayName ?? null : null,
        subjectEmail: run.subjectEntityId ? subjectById.get(run.subjectEntityId)?.primaryEmail ?? null : null,
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
