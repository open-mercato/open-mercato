import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MarketingCampaign } from '../../../../data/entities.js'
import { campaignDefinitionSchema } from '../../../../data/validators.js'
import { matchesAudience } from '../../../../lib/engine/audience.js'
import { planSteps } from '../../../../lib/engine/chain-planner.js'
import { getMarketingStep } from '../../../../lib/engine/registry.js'
import { loadTierThresholds } from '../../../../lib/tiers.js'
import { buildSubjectDocument } from '../../../../lib/subject-document.js'
import { mayReadSubjectPii, readPathUuid } from '../../../shared.js'

const logger = createLogger('marketing_automation')

/**
 * Dry run: answers "would this subject enter, and what would happen to them" without sending.
 *
 * Gated by its own feature. It reads the same audience evaluation and the same step planner the
 * engine uses, so what it reports is what would actually run — a re-implementation would drift and
 * then lie, which is worse than having no preview at all.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.test_dispatch'] },
}

export const metadata = routeMetadata

const bodySchema = z.object({
  subjectEntityId: z.string().uuid(),
  trigger: z.record(z.string(), z.unknown()).default({}),
})

function readCampaignId(req: Request): string | null {
  return readPathUuid(req, 2)
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = readCampaignId(req)
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const campaign = await em.findOne(MarketingCampaign, { id, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const definition = campaignDefinitionSchema.parse(campaign.definition)
  const now = new Date()
  /**
   * Answering ANYTHING about a named customer needs the grant that protects them.
   *
   * This route exists to answer a question about one person, and answering it means building their
   * decrypted subject document and evaluating the campaign's own audience against it. That audience is
   * an author-controlled predicate over any field in the document, and the same `campaigns.manage`
   * that saves it reads the verdict back — so the single boolean this returns is a one-bit oracle over
   * the whole record. Degrading the response would withhold nothing, and there is nothing to simulate
   * without the customer, so this refuses.
   */
  if (!await mayReadSubjectPii(container, auth)) {
    return NextResponse.json(
      {
        error: 'Reading this customer needs the customers.people.view permission',
        code: 'marketing_automation.errors.subjectReadForbidden',
      },
      { status: 403 },
    )
  }

  const tierThresholds = await loadTierThresholds(container, scope)
  const subject = await buildSubjectDocument(em, parsed.data.subjectEntityId, scope, parsed.data.trigger, now, { tierThresholds })
  const inAudience = matchesAudience(definition.audience, subject, { now, logger, campaignId: campaign.id })

  // The plan is reported even when the audience excludes the subject, because "why did this person
  // not get it" is the question a dry run is usually asked.
  const plan = planSteps(definition.steps).map((planned) => planned.kind === 'pause'
    ? { kind: 'pause' as const, minutes: planned.minutes, resumesAtStep: planned.resumeIndex }
    : {
        kind: 'run' as const,
        stepId: planned.step.id,
        type: planned.step.type,
        known: Boolean(getMarketingStep(planned.step.type)),
        channel: getMarketingStep(planned.step.type)?.channel ?? null,
      })

  // No PII in the response. This route is gated by `test_dispatch`, which depends on
  // `campaigns.manage` and implies NO `customers.*` grant — returning the decrypted address and the
  // tag list would turn a marketing preview into a way to read the CRM without the permission that
  // protects it. What a dry run has to answer is whether the subject enters and what would run, and
  // neither needs the address.
  return NextResponse.json({
    campaignId: campaign.id,
    isEnabled: campaign.isEnabled,
    subject: {
      id: parsed.data.subjectEntityId,
      exists: subject.customer !== null,
      hasEmail: Boolean(subject.customer?.email),
      tagCount: subject.tags.length,
    },
    inAudience,
    wouldRun: inAudience,
    plan,
    sent: false,
  })
}

export const openApi = {
  POST: {
    summary: 'Dry-run a campaign against one subject',
    description:
      'Reports whether the subject matches the audience and what the step plan would be, sending nothing. Uses the same evaluator and planner as the engine.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The dry-run report' }, 404: { description: 'Not found' } },
  },
}
