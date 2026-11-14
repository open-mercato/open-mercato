import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { legalHoldCreateSchema } from '../../data/validators'
import { resolvePrivacyApiContext } from '../context'
import { privacyApiError } from '../errors'
import { serializeLegalHold } from '../serialize'
import { beginPrivacyMutation } from '../mutation-guards'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_erasure.view'] },
  POST: { requireAuth: true, requireFeatures: ['data_erasure.manage'] },
}

export async function GET(request: Request) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const holds = await context.privacyLegalHoldService.list(context.scope)
  return NextResponse.json({ items: holds.map(serializeLegalHold) })
}

export async function POST(request: Request) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const parsed = legalHoldCreateSchema.safeParse(await readJsonSafe(request, {}))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid legal hold', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const guard = await beginPrivacyMutation(context, request, {
      resourceKind: 'data_erasure.legal_hold',
      resourceId: null,
      operation: 'create',
      payload: parsed.data as unknown as Record<string, unknown>,
    })
    if (guard.blockedResponse) return guard.blockedResponse
    const guarded = legalHoldCreateSchema.parse(guard.modifiedPayload)
    const hold = await context.privacyLegalHoldService.create(context.scope, context.actorId, guarded)
    await guard.afterSuccess(hold.id)
    return NextResponse.json(serializeLegalHold(hold), { status: 201 })
  } catch (error) {
    return privacyApiError(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Legal holds',
  methods: {
    GET: { summary: 'List legal holds' },
    POST: { summary: 'Create a legal hold', requestBody: { contentType: 'application/json', schema: legalHoldCreateSchema } },
  },
}
