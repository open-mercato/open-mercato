import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { retentionPolicyUpdateSchema } from '../../../data/validators'
import { resolvePrivacyApiContext } from '../../context'
import { privacyApiError } from '../../errors'
import { serializePolicy } from '../../serialize'
import { beginPrivacyMutation } from '../../mutation-guards'

type RouteContext = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid()

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_erasure.view'] },
  PUT: { requireAuth: true, requireFeatures: ['data_erasure.manage'] },
}

export async function GET(request: Request, routeContext: RouteContext) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const parsedId = idSchema.safeParse((await routeContext.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid policy id' }, { status: 400 })
  try {
    return NextResponse.json(serializePolicy(await context.privacyPolicyService.get(context.scope, parsedId.data)))
  } catch (error) {
    return privacyApiError(error)
  }
}

export async function PUT(request: Request, routeContext: RouteContext) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const parsedId = idSchema.safeParse((await routeContext.params).id)
  const parsed = retentionPolicyUpdateSchema.safeParse(await readJsonSafe(request, {}))
  if (!parsedId.success || !parsed.success) {
    return NextResponse.json({ error: 'Invalid retention policy', details: parsed.success ? undefined : parsed.error.flatten() }, { status: 400 })
  }
  try {
    const current = await context.privacyPolicyService.get(context.scope, parsedId.data)
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: 'data_erasure.retention_policy',
      resourceId: current.id,
      current: current.updatedAt,
      request,
    })
    const guard = await beginPrivacyMutation(context, request, {
      resourceKind: 'data_erasure.retention_policy',
      resourceId: current.id,
      operation: 'update',
      payload: parsed.data,
    })
    if (guard.blockedResponse) return guard.blockedResponse
    const guarded = retentionPolicyUpdateSchema.parse(guard.modifiedPayload)
    const policy = await context.privacyPolicyService.update(context.scope, current.id, guarded)
    await guard.afterSuccess(policy.id)
    return NextResponse.json(serializePolicy(policy))
  } catch (error) {
    return privacyApiError(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Retention policy',
  methods: {
    GET: { summary: 'Get a retention policy' },
    PUT: { summary: 'Update a retention policy', requestBody: { contentType: 'application/json', schema: retentionPolicyUpdateSchema } },
  },
}
