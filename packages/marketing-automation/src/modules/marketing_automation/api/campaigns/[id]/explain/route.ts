import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { MarketingCampaign } from '../../../../data/entities.js'
import { readDefinition } from '../../../../lib/dispatcher.js'
import { explainDelivery } from '../../../../lib/engine/explain.js'
import { frequencyWindowStart, preferenceCap } from '../../../../lib/engine/gates.js'
import { buildSubjectDocument, loadSubjectTimeZone } from '../../../../lib/subject-document.js'
import { loadTierThresholds } from '../../../../lib/tiers.js'
import { loadContactPreference } from '../../../../lib/preferences.js'
import { isSuppressedByConsent } from '../../../../lib/consent.js'
import { countSendsSince } from '../../../../lib/runs.js'
import { readPathUuid } from '../../../shared.js'

/**
 * Why this customer would, or would not, receive this campaign right now.
 *
 * The first question support asks — "why didn't they get it?" — and the only one the module had no answer for. The
 * results screen says how many were suppressed and the run list says what happened to a run that STARTED; neither
 * answers the case where nothing happened at all, which is the case people actually ring up about.
 *
 * Every gate involved already runs on the send path. This endpoint reads the same facts the dispatcher reads and
 * asks the same pure functions, so its answer cannot drift from what the engine would do — the module's rule about
 * never explaining the engine with a second implementation applies here more than anywhere.
 *
 * Behind `runs.view`: this is a statement about one named customer's consent, their own frequency preference and
 * their timezone, which is the same class of fact the run list already discloses to the same people.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view'] },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

const bodySchema = z.object({ subjectEntityId: z.string().uuid() })

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const campaignId = readPathUuid(req, 2)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Name the customer to explain', code: 'marketing_automation.validation.invalidPayload' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const now = new Date()

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const customer = await em.findOne(CustomerEntity, { id: parsed.data.subjectEntityId, ...scope, deletedAt: null })
  if (!customer) return NextResponse.json({ error: 'No such customer' }, { status: 404 })

  const definition = readDefinition(campaign)
  const policy = {
    frequencyCap: definition.sendPolicy?.frequencyCap ?? null,
    quietHours: definition.sendPolicy?.quietHours ?? null,
    optimizeSendTime: definition.sendPolicy?.optimizeSendTime ?? false,
    sendHour: definition.sendPolicy?.sendHour ?? null,
  }

  const tierThresholds = await loadTierThresholds(container, scope)
  const [subject, preference, suppressed, timeZone] = await Promise.all([
    buildSubjectDocument(em, customer.id, scope, {}, now, { tierThresholds }),
    loadContactPreference(em, scope, customer.id),
    isSuppressedByConsent(em, customer.id, scope, 'email'),
    loadSubjectTimeZone(em, customer.id, scope),
  ])

  /**
   * Two windows, counted separately and never merged.
   *
   * The campaign's cap and the customer's own weekly limit each have an exact answer only as written — "three a
   * week" and "two a day" cannot be combined into one number without inventing a rule neither of them stated.
   */
  const ownCap = preferenceCap(preference)
  const [sentInCampaignWindow, sentInPreferenceWindow] = await Promise.all([
    policy.frequencyCap
      ? countSendsSince(em, customer.id, scope, frequencyWindowStart(now, policy.frequencyCap))
      : Promise.resolve(0),
    ownCap
      ? countSendsSince(em, customer.id, scope, frequencyWindowStart(now, ownCap))
      : Promise.resolve(0),
  ])

  const explanation = explainDelivery({
    subject,
    audience: (definition.audience ?? null) as ConditionExpression | null,
    policy,
    facts: { suppressed, preference, sentInCampaignWindow, sentInPreferenceWindow, timeZone },
    now,
    logger,
  })

  return NextResponse.json({
    campaign: { id: campaign.id, name: campaign.name, isEnabled: campaign.isEnabled },
    customer: { id: customer.id },
    /**
     * Whether the campaign is even running is part of the answer.
     *
     * A disabled campaign passes every gate below and still sends nothing, which is by far the most common real
     * reason for "they didn't get it" — and a screen that reported six green gates without mentioning it would be
     * technically correct and actively misleading.
     */
    ...explanation,
    wouldSend: explanation.wouldSend && campaign.isEnabled,
    decidedBy: campaign.isEnabled ? explanation.decidedBy : 'campaignDisabled',
  })
}

export const openApi = {
  POST: {
    summary: 'Explain whether a named customer would receive this campaign now',
    description:
      'Asks every send gate the same question the engine asks — audience, consent, the customer\'s pause and their own frequency limit, quiet hours, the campaign cap — in the order the engine applies them, and names the one that decided. Reads the same facts the dispatcher reads and calls the same pure functions, so the answer cannot drift from what a send would do. A disabled campaign is reported as the decisive reason, because it is the commonest one. Requires `runs.view`.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'The verdict, and every gate with its detail' },
      404: { description: 'No such campaign, or no such customer in this organization' },
    },
  },
}
