import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign } from '../../../../data/entities.js'
import { readDefinition } from '../../../../lib/dispatcher.js'
import { locateStep } from '../../../../lib/canvas/step-tree.js'
import { getMarketingStep } from '../../../../lib/engine/registry.js'
import { DEFAULT_RECOMMENDATION_COUNT, renderEmail } from '../../../../steps/send-email.js'
import { applyContentBlocks, loadContentBlocks, referencedBlockKeys } from '../../../../lib/content-blocks.js'
import {
  loadProductUrlTemplate,
  recommendForSubject,
  referencesRecommendations,
  renderRecommendationsHtml,
} from '../../../../lib/recommendations.js'
import { buildSubjectDocument } from '../../../../lib/subject-document.js'
import { loadTierThresholds } from '../../../../lib/tiers.js'
import type { AutomationContext } from '../../../../lib/engine/types.js'
import { readPathUuid } from '../../../shared.js'

/**
 * Renders one message exactly as a send would, and returns it instead of sending it.
 *
 * The gap it closes: to see their own copy with the placeholders filled in, an author had to TEST SEND it to
 * themselves and go and look at their inbox. The journey preview shows which steps run and when, and the AI
 * drafting shows proposed copy, but neither shows the finished message — so the one thing an author most wants to
 * check before publishing was the one thing that needed an email round trip.
 *
 * **The same code path as a real send**, deliberately: `renderEmail` is shared with the sender and the test send,
 * because a second renderer would drift and a preview is trusted precisely where nobody can check it. Content
 * blocks and the recommendation block are resolved the way a real send resolves them, so what is shown includes
 * what those would insert.
 *
 * **Tracking is off.** There is no run to attribute an open to, and minting tracking URLs for a run that does not
 * exist would both lie in the markup and leave tokens pointing at nothing.
 *
 * Behind `campaigns.manage`, like the journey preview and for the same reason: choosing a customer and reading
 * their name and their recommendations off the rendered page is a disclosure, even though every value in it is
 * one the campaign would have sent them anyway.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const bodySchema = z.object({
  stepId: z.string().min(1).max(128),
  /** Whose data to fill in. Optional: without one the placeholders resolve to nothing, which is also worth seeing. */
  subjectEntityId: z.string().uuid().nullish(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const campaignId = readPathUuid(req, 2)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', code: 'marketing_automation.validation.invalidPayload' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const now = new Date()

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const definition = readDefinition(campaign)
  const located = locateStep(definition.steps, parsed.data.stepId)
  if (!located) return NextResponse.json({ error: 'No such step' }, { status: 404 })

  const handler = getMarketingStep(located.step.type)
  if (handler?.channel !== 'email') {
    return NextResponse.json(
      { error: 'Only email steps can be rendered', code: 'marketing_automation.errors.renderNotEmail' },
      { status: 400 },
    )
  }

  const params = handler.paramsSchema.safeParse(located.step.params)
  if (!params.success) {
    // The same answer the test send gives, and for the same reason: "not filled in yet" is a state an author can
    // act on, while a rendering failure is not.
    return NextResponse.json(
      { error: 'This step is not filled in yet', code: 'marketing_automation.validation.invalidStepParams' },
      { status: 400 },
    )
  }

  const tierThresholds = await loadTierThresholds(container, scope)
  const subject = parsed.data.subjectEntityId
    ? await buildSubjectDocument(em, parsed.data.subjectEntityId, scope, {}, now, { tierThresholds })
    : null

  const context: AutomationContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    eventId: 'marketing_automation.render_preview',
    occurredAt: now.toISOString(),
    dispatchDepth: 1,
    subjectEntityId: subject?.customer?.id ?? null,
    campaignId: campaign.id,
    trigger: {},
    ...(subject ? { customer: subject.customer, orders: subject.orders, score: subject.score, survey: subject.survey } : {}),
  } as AutomationContext

  const stepParams = params.data as { subject: string; bodyHtml: string; bodyText?: string }
  const blocks = await loadContentBlocks(em, scope, referencedBlockKeys(stepParams.bodyHtml))
  const bodyWithBlocks = applyContentBlocks(stepParams.bodyHtml, blocks)

  let recommendationsHtml = ''
  if (referencesRecommendations(bodyWithBlocks)) {
    const [items, urlTemplate] = await Promise.all([
      recommendForSubject(em, scope, context.subjectEntityId ?? null, DEFAULT_RECOMMENDATION_COUNT),
      loadProductUrlTemplate(container, scope),
    ])
    recommendationsHtml = renderRecommendationsHtml(items, { urlTemplate })
  }

  const rendered = renderEmail({ ...stepParams, track: false }, context, { blocks, recommendationsHtml })

  return NextResponse.json({
    stepId: located.step.id,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text ?? null,
    /**
     * Whether a customer's data went into it.
     *
     * Without a subject every placeholder resolves to nothing, and a screen that did not say so would let an
     * author conclude their interpolation is broken when they simply have not chosen anybody.
     */
    personalised: Boolean(subject?.customer),
  })
}

export const openApi = {
  POST: {
    summary: 'Render a message exactly as a send would, without sending it',
    description:
      'Runs the same `renderEmail` a real send and a test send use, with content blocks and the recommendation block resolved the same way, and answers with the finished subject and body. Tracking is off, because there is no run to attribute an open to. Requires `campaigns.manage`.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'The rendered message' },
      400: { description: 'Not an email step, or not filled in yet' },
      404: { description: 'No such campaign or step' },
    },
  },
}
