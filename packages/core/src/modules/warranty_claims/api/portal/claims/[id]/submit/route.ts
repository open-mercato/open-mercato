import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  loadOwnedClaim,
  loadOwnedClaimFresh,
  resolvePortalActionContext,
  resolvePortalClaimId,
  runPortalClaimActionGuard,
  type PortalClaimActionRouteContext,
} from '../shared'

export const metadata = {
  POST: { requireAuth: false },
}

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
  if (claim.status !== 'draft') {
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { ok: false, error: translate('warranty_claims.errors.invalidTransition', 'That status change is not allowed.') },
      { status: 400 },
    )
  }

  const guarded = await runPortalClaimActionGuard(req, context, claim.id, {
    id: claim.id,
    action: 'submit',
  })
  if (!guarded.ok) {
    return guarded.response
  }

  const commandBus = context.commandCtx.container.resolve('commandBus') as CommandBus
  try {
    await commandBus.execute<{ id: string; actorCustomerId: string }, { claimId: string }>(
      'warranty_claims.claim.submit',
      { input: { id: claim.id, actorCustomerId: context.customerId }, ctx: context.commandCtx },
    )
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  await guarded.runAfterSuccess()

  const updated = await loadOwnedClaimFresh(context, claim.id)
  return NextResponse.json({ ok: true, claimId: claim.id, status: updated?.status ?? 'submitted' })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim submit action',
  methods: {
    POST: {
      summary: 'Submit an owned draft claim from the customer portal',
      responses: [
        {
          status: 200,
          description: 'Claim submitted',
          schema: z.object({ ok: z.boolean(), claimId: z.string().uuid(), status: z.string() }),
        },
      ],
    },
  },
}
