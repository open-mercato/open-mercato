import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { retentionRunSchema } from '../../../data/validators'
import { resolvePrivacyApiContext } from '../../context'
import { privacyApiError } from '../../errors'
import { serializeOperation } from '../../serialize'
import { beginPrivacyMutation } from '../../mutation-guards'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_erasure.manage'] },
}

export async function POST(request: Request) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const parsed = retentionRunSchema.safeParse(await readJsonSafe(request, {}))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid retention request', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const guard = await beginPrivacyMutation(context, request, {
      resourceKind: 'data_erasure.operation',
      resourceId: null,
      operation: 'create',
      payload: parsed.data,
    })
    if (guard.blockedResponse) return guard.blockedResponse
    const guarded = retentionRunSchema.parse(guard.modifiedPayload)
    const operation = await context.privacyGovernanceService.runRetention(context.scope, context.actorId, guarded)
    await guard.afterSuccess(operation.id)
    return NextResponse.json(serializeOperation(operation))
  } catch (error) {
    return privacyApiError(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Run retention',
  methods: {
    POST: { summary: 'Run or preview a retention policy', requestBody: { contentType: 'application/json', schema: retentionRunSchema } },
  },
}
