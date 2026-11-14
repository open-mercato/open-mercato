import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolvePrivacyApiContext } from '../../../context'
import { privacyApiError } from '../../../errors'
import { serializeLegalHold } from '../../../serialize'
import { beginPrivacyMutation } from '../../../mutation-guards'

type RouteContext = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid()

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_erasure.manage'] },
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const parsedId = idSchema.safeParse((await routeContext.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid legal hold id' }, { status: 400 })
  try {
    const current = await context.privacyLegalHoldService.get(context.scope, parsedId.data)
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: 'data_erasure.legal_hold',
      resourceId: current.id,
      current: current.updatedAt,
      request,
    })
    const guard = await beginPrivacyMutation(context, request, {
      resourceKind: 'data_erasure.legal_hold',
      resourceId: current.id,
      operation: 'update',
      payload: { released: true },
    })
    if (guard.blockedResponse) return guard.blockedResponse
    const hold = await context.privacyLegalHoldService.release(context.scope, current.id, context.actorId)
    await guard.afterSuccess(hold.id)
    return NextResponse.json(serializeLegalHold(hold))
  } catch (error) {
    return privacyApiError(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Release a legal hold',
  methods: { POST: { summary: 'Release a legal hold' } },
}
