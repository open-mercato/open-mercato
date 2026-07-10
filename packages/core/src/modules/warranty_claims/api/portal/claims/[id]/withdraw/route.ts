import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TransitionClaimInput, WarrantyClaimStatus } from '../../../../../data/validators'
import {
  loadOwnedClaim,
  resolvePortalActionContext,
  resolvePortalClaimId,
  runPortalClaimActionGuard,
  type PortalClaimActionRouteContext,
} from '../shared'

export const metadata = {
  POST: { requireAuth: false },
}

const PORTAL_WITHDRAWABLE_STATUSES = new Set<WarrantyClaimStatus>(['draft', 'submitted'])

export async function POST(req: Request, ctx: PortalClaimActionRouteContext) {
  const contextOrResponse = await resolvePortalActionContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  const claimId = await resolvePortalClaimId(ctx)
  if (!claimId) {
    return NextResponse.json({ ok: false, error: 'Claim not found' }, { status: 404 })
  }
  const claim = await loadOwnedClaim(context, claimId)
  if (!claim) {
    return NextResponse.json({ ok: false, error: 'Claim not found' }, { status: 404 })
  }
  if (!PORTAL_WITHDRAWABLE_STATUSES.has(claim.status)) {
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { ok: false, error: translate('warranty_claims.errors.invalidTransition', 'That status change is not allowed.') },
      { status: 400 },
    )
  }

  const guarded = await runPortalClaimActionGuard(req, context, claim.id, {
    id: claim.id,
    action: 'withdraw',
    toStatus: 'cancelled',
  })
  if (!guarded.ok) {
    return guarded.response
  }

  const commandBus = context.commandCtx.container.resolve('commandBus') as CommandBus
  try {
    await commandBus.execute<TransitionClaimInput, { claimId: string }>(
      'warranty_claims.claim.transition',
      {
        input: { id: claim.id, toStatus: 'cancelled', actorCustomerId: context.customerId },
        ctx: context.commandCtx,
      },
    )
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  await guarded.runAfterSuccess()

  return NextResponse.json({ ok: true, claimId: claim.id, status: 'cancelled' })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim withdraw action',
  methods: {
    POST: {
      summary: 'Withdraw (cancel) an owned claim while it is draft or submitted',
      responses: [
        {
          status: 200,
          description: 'Claim withdrawn',
          schema: z.object({ ok: z.boolean(), claimId: z.string().uuid(), status: z.literal('cancelled') }),
        },
      ],
    },
  },
}
