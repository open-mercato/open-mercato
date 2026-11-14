import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { retentionPolicyCreateSchema } from '../../data/validators'
import { resolvePrivacyApiContext } from '../context'
import { privacyApiError } from '../errors'
import { serializePolicy } from '../serialize'
import { beginPrivacyMutation } from '../mutation-guards'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_erasure.view'] },
  POST: { requireAuth: true, requireFeatures: ['data_erasure.manage'] },
}

export async function GET(request: Request) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const policies = await context.privacyPolicyService.list(context.scope)
  return NextResponse.json({ items: policies.map(serializePolicy) })
}

export async function POST(request: Request) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const parsed = retentionPolicyCreateSchema.safeParse(await readJsonSafe(request, {}))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid retention policy', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const guard = await beginPrivacyMutation(context, request, {
      resourceKind: 'data_erasure.retention_policy',
      resourceId: null,
      operation: 'create',
      payload: parsed.data,
    })
    if (guard.blockedResponse) return guard.blockedResponse
    const guarded = retentionPolicyCreateSchema.parse(guard.modifiedPayload)
    const policy = await context.privacyPolicyService.create(context.scope, context.actorId, guarded)
    await guard.afterSuccess(policy.id)
    return NextResponse.json(serializePolicy(policy), { status: 201 })
  } catch (error) {
    return privacyApiError(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Retention policies',
  methods: {
    GET: { summary: 'List retention policies' },
    POST: { summary: 'Create a retention policy', requestBody: { contentType: 'application/json', schema: retentionPolicyCreateSchema } },
  },
}
