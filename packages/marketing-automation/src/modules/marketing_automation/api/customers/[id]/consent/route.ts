import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { loadConsentState, recordConsent } from '../../../../lib/consent.js'
import { readPathUuid } from '../../../shared.js'

/**
 * Records a marketing consent decision a customer gave to a PERSON.
 *
 * The most ordinary compliance task there is — "they phoned and asked to be taken off the list" — and until this
 * endpoint existed it had no path at all: consent could be written by the customer through the portal or the
 * unsubscribe link, and by nobody else. An operator's only option was the database, which is not an option.
 *
 * **Gated by its own feature, not by campaign management.** Whoever answers the phone should be able to honour
 * that request without also being able to author campaigns that message everybody; and somebody who authors
 * campaigns has no particular business editing consent. Two different jobs, two different grants.
 *
 * **The source is recorded as `operator`**, which is the point of the field: "provably first-party" is a claim
 * somebody may one day have to substantiate, and a decision relayed by staff is a different fact from one the
 * customer entered themselves. The actor's id goes in the log rather than on the row — the consent tables carry
 * no actor column, and inventing one for a value the audit log already holds would be a migration for nothing.
 */
const routeMetadata = {
  PUT: { requireAuth: true, requireFeatures: ['marketing_automation.consent.manage'] },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

const bodySchema = z.object({
  channel: z.literal('email'),
  /**
   * Only the two answers a person can relay.
   *
   * There is deliberately no way to set consent back to "nothing on record": that state means "never asked",
   * and pretending a customer was never asked after they answered is the one edit that would make the trail
   * dishonest.
   */
  state: z.enum(['subscribed', 'unsubscribed']),
  /** Why, in the operator's words — "asked on the phone", "bounced repeatedly", "wrote to support". */
  reason: z.string().trim().min(1).max(200),
})

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const customerId = readPathUuid(req, 2)
  if (!customerId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  // Scoped through the customer, so an id from another organization answers 404 rather than writing a consent
  // row for somebody this caller cannot see.
  const customer = await em.findOne(CustomerEntity, { id: customerId, ...scope, deletedAt: null })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await recordConsent(em, {
    scope,
    subjectEntityId: customerId,
    channel: parsed.data.channel,
    state: parsed.data.state,
    reason: parsed.data.reason,
    source: 'operator',
    campaignId: null,
    now: new Date(),
  })

  /**
   * Logged deliberately, and with `sub`.
   *
   * An unsubscribe recorded on somebody's behalf is the one marketing action a person may later have to account
   * for — "who took this customer off the list, and when" is a question with a real answer only if it was
   * written down. `sub` rather than `userId` because the latter is optional on a session context.
   */
  logger.info('marketing consent recorded by an operator', {
    subjectEntityId: customerId,
    channel: parsed.data.channel,
    state: parsed.data.state,
    actor: auth.sub,
  })

  return NextResponse.json({ channel: parsed.data.channel, state: await loadConsentState(em, customerId, scope, 'email') })
}

export const openApi = {
  PUT: {
    summary: 'Record a consent decision on a customer\'s behalf',
    description:
      'For the request a customer makes to a person rather than through a link — "take me off the list". Records the change with source `operator`, appends to the consent trail, and logs who did it. Cannot set consent back to "nothing on record", because that state means "never asked". Requires `marketing_automation.consent.manage`.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'The consent state now on record' },
      400: { description: 'Unusable payload' },
      404: { description: 'No such customer in this organization' },
    },
  },
}
