import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { subjectRequestSchema } from '../../data/validators'
import { resolvePrivacyApiContext } from '../context'
import { privacyApiError } from '../errors'
import { serializeOperation } from '../serialize'
import { beginPrivacyMutation } from '../mutation-guards'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_erasure.manage'] },
}

export async function POST(request: Request) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const parsed = subjectRequestSchema.safeParse(await readJsonSafe(request, {}))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid subject request', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const guard = await beginPrivacyMutation(context, request, {
      resourceKind: 'data_erasure.operation',
      resourceId: null,
      operation: 'create',
      payload: parsed.data,
    })
    if (guard.blockedResponse) return guard.blockedResponse
    const guarded = subjectRequestSchema.parse(guard.modifiedPayload)
    const result = await context.privacyGovernanceService.runSubjectRequest(
      context.scope,
      context.actorId,
      guarded,
      context.commandContext,
    )
    await guard.afterSuccess(result.operation.id)
    return NextResponse.json({
      operation: serializeOperation(result.operation),
      ...(result.exports ? { exports: result.exports } : {}),
    })
  } catch (error) {
    return privacyApiError(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Data-subject request',
  methods: {
    POST: { summary: 'Discover, export, erase, or anonymize a subject', requestBody: { contentType: 'application/json', schema: subjectRequestSchema } },
  },
}
