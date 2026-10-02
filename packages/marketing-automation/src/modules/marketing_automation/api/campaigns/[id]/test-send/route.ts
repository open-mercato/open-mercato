import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { reportError } from '@open-mercato/telemetry'
import { MarketingCampaign } from '../../../../data/entities.js'
import { readDefinition } from '../../../../lib/dispatcher.js'
import { locateStep } from '../../../../lib/canvas/step-tree.js'
import { getMarketingStep } from '../../../../lib/engine/registry.js'
import { DEFAULT_RECOMMENDATION_COUNT, renderEmail } from '../../../../steps/send-email.js'
import {
  loadProductUrlTemplate,
  recommendForSubject,
  referencesRecommendations,
  renderRecommendationsHtml,
} from '../../../../lib/recommendations.js'
import { buildSubjectDocument } from '../../../../lib/subject-document.js'
import { renderValuesFromDocument } from '../../../../lib/render-values.js'
import { loadTierThresholds } from '../../../../lib/tiers.js'
import { redactEmails } from '../../../../lib/redact.js'
import { applyContentBlocks, loadContentBlocks, referencedBlockKeys } from '../../../../lib/content-blocks.js'
import type { AutomationContext } from '../../../../lib/engine/types.js'
import { mayReadSubjectPii, readPathUuid } from '../../../shared.js'

/**
 * Sends one real message, to the author, so they can see what they wrote.
 *
 * **It can only ever send to the caller's own address.** The recipient is taken from the authenticated
 * session and the request cannot name one: a "send a test to this address" endpoint is a spam relay with
 * a campaign editor attached, whoever holds the feature.
 *
 * Rendered through the SAME function a real send uses, because the entire value of a test send is that
 * what the author sees is what the customer will get. Untracked, deliberately: a test has no run, and
 * counting the author's own opens as engagement would corrupt the campaign's figures.
 */
const routeMetadata = {
  /**
   * The DECLARED send-level feature, not a `campaigns.`-namespaced one.
   *
   * Feature matching is by prefix, so `marketing_automation.campaigns.*` — a plausible grant for somebody who
   * authors campaigns — satisfied `campaigns.test_dispatch` while never satisfying the declared
   * `marketing_automation.test_dispatch`. The typo therefore handed the "sends a real message" level to the
   * authoring level, which is exactly the separation `acl.ts` states it is keeping.
   */
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.test_dispatch'] },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

const bodySchema = z.object({
  stepId: z.string().min(1),
  /** Optional: render with a real customer's data rather than with an empty context. */
  subjectEntityId: z.string().uuid().optional(),
})

function readCampaignId(req: Request): string | null {
  // .../campaigns/<id>/test-send
  return readPathUuid(req, 2)
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const recipient = typeof auth.email === 'string' ? auth.email.trim() : ''
  if (!recipient) {
    // Without an address on the session there is nowhere safe to send: the request is not allowed to
    // supply one.
    return NextResponse.json({ error: 'Your account has no email address', code: 'marketing_automation.errors.noTestRecipient' }, { status: 400 })
  }

  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const now = new Date()

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const definition = readDefinition(campaign)
  // Found through the step tree, so a step inside an A/B lane can be tested too.
  const located = locateStep(definition.steps, parsed.data.stepId)
  if (!located) return NextResponse.json({ error: 'Step not found' }, { status: 404 })

  const handler = getMarketingStep(located.step.type)
  if (handler?.channel !== 'email') {
    return NextResponse.json(
      { error: 'Only email steps can be test sent', code: 'marketing_automation.errors.testSendNotEmail' },
      { status: 400 },
    )
  }

  const params = handler.paramsSchema.safeParse(located.step.params)
  if (!params.success) {
    return NextResponse.json(
      { error: 'This step is not filled in yet', code: 'marketing_automation.validation.invalidStepParams' },
      { status: 400 },
    )
  }

  /**
   * Rendering FOR a named customer needs the grant that protects them.
   *
   * `marketing_automation.test_dispatch` says somebody may send a test message; `customers.people.view`
   * says they may read the CRM. Without this gate, holding the first alone was enough to have the module
   * build any customer's subject document, interpolate it and mail the result to the caller's own address.
   * What the copy can actually pull is bounded by `renderValuesFromDocument`, which projects a whitelist:
   * the decrypted display name and email, order aggregates, the score and tier, the latest NPS answer.
   * Narrower than the whole document, and still the CRM read this grant exists to protect. The sibling
   * `render` route already closed exactly this hole; this one was the inconsistency.
   *
   * The subject is dropped rather than the request refused, matching `render`: the author still gets their
   * own copy back with the placeholders unfilled.
   */
  const mayReadSubject = parsed.data.subjectEntityId ? await mayReadSubjectPii(container, auth) : false

  const tierThresholds = await loadTierThresholds(container, scope)
  const subject = parsed.data.subjectEntityId && mayReadSubject
    ? await buildSubjectDocument(em, parsed.data.subjectEntityId, scope, {}, now, { tierThresholds })
    : null

  const context: AutomationContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    eventId: 'marketing_automation.test_send',
    occurredAt: now.toISOString(),
    dispatchDepth: 1,
    subjectEntityId: subject?.customer?.id ?? null,
    campaignId: campaign.id,
    trigger: {},
  }

  // The same blocks the real send would resolve: a test that skipped them would show the author a different
  // message from the one their customers receive, which is the one thing a test send must not do.
  const stepParams = params.data as { subject: string; bodyHtml: string; bodyText?: string }
  const blocks = await loadContentBlocks(em, scope, referencedBlockKeys(stepParams.bodyHtml))

  /**
   * The recommendations the real send would compute, for the caller as the subject.
   *
   * Without a subject there is nothing personal to compute from, and the block falls back to best sellers —
   * which is exactly what a real send to a brand-new customer would show, so the test stays honest.
   */
  const bodyWithBlocks = applyContentBlocks(stepParams.bodyHtml, blocks)
  let recommendationsHtml = ''
  if (referencesRecommendations(bodyWithBlocks)) {
    const [items, urlTemplate] = await Promise.all([
      recommendForSubject(em, scope, context.subjectEntityId ?? null, DEFAULT_RECOMMENDATION_COUNT),
      loadProductUrlTemplate(container, scope),
    ])
    recommendationsHtml = renderRecommendationsHtml(items, { urlTemplate })
  }

  const rendered = renderEmail(
    // `track: false` regardless of the step's own setting: a test send has no run to attribute opens to.
    { ...stepParams, track: false },
    context,
    /**
     * The customer's own values, from the document already built above.
     *
     * Without them a test send renders `{{customer.displayName}}` literally — the same defect a real send had
     * until the values were loaded at send time. This route's whole purpose is that what the author sees is
     * what the customer gets, so the two paths take their values from one shared mapper rather than each
     * assembling a shape of its own.
     */
    { blocks, recommendationsHtml, values: renderValuesFromDocument(subject) },
  )

  try {
    await sendEmail({
      to: recipient,
      ...rendered,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch (error) {
    const original = error instanceof Error ? error.message : String(error)

    /**
     * A missing email channel is CONFIGURATION, not a rejected message.
     *
     * Collapsing the two into one 502 tells the author "the transport refused it" when the truth is
     * that nothing was ever asked to send — and the two have completely different remedies. This is
     * also the state a fresh installation is in, so it is the error an author is most likely to see.
     */
    if (original.includes('SYSTEM_EMAIL_CHANNEL_NOT_CONFIGURED')) {
      logger.warn('marketing test send has no email channel to use', { campaignId: campaign.id })
      return NextResponse.json(
        { error: 'No email channel is configured', code: 'marketing_automation.errors.emailChannelMissing' },
        { status: 400 },
      )
    }

    logger.error('[internal] marketing test send failed', { campaignId: campaign.id, stepId: parsed.data.stepId, error: original })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.test_send_failed',
      attributes: { campaignId: campaign.id },
    })
    return NextResponse.json(
      // Redacted for the same reason a run's failure text is: the transport quotes the address.
      { error: redactEmails(original), code: 'marketing_automation.errors.testSendFailed' },
      { status: 502 },
    )
  }

  // The address is echoed back so the author knows WHERE it went, and it is their own address — the one
  // piece of PII this module may safely return to the person it belongs to.
  return NextResponse.json({ sent: true, to: recipient, stepId: parsed.data.stepId, subject: rendered.subject })
}

export const openApi = {
  POST: {
    summary: 'Send one real test message for a step',
    description:
      'Renders the step through the same function a real send uses and delivers it to the CALLER\'s own address, taken from the session — the request cannot name a recipient. Untracked and unrecorded. Gated by `marketing_automation.test_dispatch`; interpolating a named subject\'s data additionally requires `customers.people.view`, without which the placeholders are left unfilled.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'Sent' },
      400: { description: 'The step is not an email step, is not filled in, or the account has no address' },
      404: { description: 'No such campaign or step' },
      502: { description: 'The transport rejected the message' },
    },
  },
}
