import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { claimReferral } from '../../../lib/referrals.js'

/**
 * Records that a customer arrived on somebody else's referral code.
 *
 * Authenticated, and that is a deliberate limit. A public endpoint here would let anybody attach any customer
 * to any code, which is a reward-fraud machine — so a storefront claims through its own backend, or an
 * inbound hook does, and both already hold a credential. When a storefront lands in the platform this is the
 * endpoint it calls.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const bodySchema = z.object({
  code: z.string().trim().min(1).max(40),
  customerId: z.string().uuid(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // The customer is checked in THIS tenant before anything is written against them.
  const customer = await em.findOne(CustomerEntity, { id: parsed.data.customerId, ...scope, deletedAt: null })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const outcome = await claimReferral(em, scope, {
    code: parsed.data.code,
    referredEntityId: customer.id,
  })

  if (outcome.status === 'claimed') {
    // The REFERRER is deliberately not returned. The caller does not need to know whose code it was, and
    // telling them turns a code somebody shared into a way to look up who shared it.
    return NextResponse.json({ claimed: true })
  }

  const status = outcome.status === 'unknown_code' ? 404 : 409
  return NextResponse.json(
    { claimed: false, code: `marketing_automation.referral.${outcome.status}` },
    { status },
  )
}

export const openApi = {
  POST: {
    summary: 'Claim a referral code for a customer',
    description:
      'Records a pending referral. It converts on its own when that customer places their first order, which is what fires the referral trigger for the REFERRER. Refuses a self-referral and a second claim for the same customer, each with its own code.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'Claimed' },
      404: { description: 'No such customer, or no such code' },
      409: { description: 'Already referred, or the code belongs to this customer' },
    },
  },
}
