import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { subjectResolutionSchema } from '../../../data/validators'
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
  const parsed = subjectResolutionSchema.safeParse(await readJsonSafe(request, {}))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid subject resolution request', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const guard = await beginPrivacyMutation(context, request, {
      resourceKind: 'data_erasure.operation',
      resourceId: null,
      operation: 'create',
      payload: parsed.data,
    })
    if (guard.blockedResponse) return guard.blockedResponse
    const guarded = subjectResolutionSchema.parse(guard.modifiedPayload)
    const result = await context.privacyGovernanceService.resolveSubjects(
      context.scope,
      context.actorId,
      guarded,
    )
    await guard.afterSuccess(result.operation.id)
    return NextResponse.json({
      operation: serializeOperation(result.operation),
      subjects: result.subjects,
    })
  } catch (error) {
    return privacyApiError(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Resolve data-subject references',
  methods: {
    POST: {
      summary: 'Resolve an email address, phone number, or name to tenant-scoped subject references',
      requestBody: { contentType: 'application/json', schema: subjectResolutionSchema },
    },
  },
}
