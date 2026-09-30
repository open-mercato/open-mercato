/**
 * Admin API — POST /api/forms/submissions/:submissionId/anonymize
 *
 * Phase 2b — irreversible anonymization. Server enforces the typed
 * confirmation `{ confirm: 'DELETE' }` so an API client cannot bypass the
 * UI's typed-confirmation requirement.
 *
 * The anonymize itself walks every revision, replaces every
 * `x-om-sensitive: true` field with the tombstone token, re-encrypts, and
 * stamps `anonymized_at`. Submit metadata (IP/UA) is cleared. Actor rows
 * and audit rows survive — preserving the audit chain while removing
 * sensitive content. See `services/anonymize-service.ts` for the flow.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { AnonymizeService, AnonymizeServiceError } from '../../../../services/anonymize-service'
import {
  FormsAccessAuditLogger,
  type AccessAuditLogger,
} from '../../../../services/access-audit-logger'
import { emitFormsEvent } from '../../../../events'

const anonymizeBodySchema = z.object({
  confirm: z.literal('DELETE'),
})

const anonymizeResponseSchema = z.object({
  submissionId: z.string().uuid(),
  revisionsAnonymized: z.number().int(),
  anonymizedAt: z.string(),
})

const anonymizeErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['forms.submissions.anonymize'] },
}

export async function POST(
  req: NextRequest,
  context: { params: { submissionId: string } | Promise<{ submissionId: string }> },
) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant scope required' }, { status: 403 })
  }
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.submissionId)

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = anonymizeBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'forms.errors.confirmation_required',
        message: 'Body must be { "confirm": "DELETE" }.',
      },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const service = container.resolve('formsAnonymizeService') as AnonymizeService
  const auditor = container.resolve('formsAccessAuditLogger') as AccessAuditLogger
  const em = container.resolve('em') as Parameters<AccessAuditLogger['log']>[0]

  try {
    const result = await service.anonymize(submissionId)
    await auditor.log(em, {
      organizationId: auth.orgId,
      submissionId,
      accessedBy: auth.sub,
      accessPurpose: 'anonymize',
      ip: req.headers.get('x-forwarded-for') ?? null,
      ua: req.headers.get('user-agent') ?? null,
    })
    await emitFormsEvent('forms.submission.anonymized', {
      submissionId,
    })
    return NextResponse.json({
      submissionId,
      revisionsAnonymized: result.revisionsAnonymized,
      anonymizedAt: result.submissionAnonymizedAt.toISOString(),
    })
  } catch (error) {
    if (error instanceof AnonymizeServiceError) {
      const status = error.code === 'SUBMISSION_NOT_FOUND' ? 404 : 422
      return NextResponse.json({ error: error.code, message: error.message }, { status })
    }
    return NextResponse.json(
      { error: 'forms.errors.internal', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

const anonymizeMethodDoc: OpenApiMethodDoc = {
  summary: 'Anonymize a submission (irreversible)',
  description:
    'Tombstones every sensitive field across every revision. Requires body `{ "confirm": "DELETE" }`. Preserves actor rows and access-audit rows. Emits `forms.submission.anonymized`.',
  tags: ['Forms Compliance'],
  requestBody: {
    contentType: 'application/json',
    schema: anonymizeBodySchema,
  },
  responses: [{ status: 200, description: 'Anonymization complete', schema: anonymizeResponseSchema }],
  errors: [
    { status: 404, description: 'Submission not found', schema: anonymizeErrorSchema },
    { status: 422, description: 'Missing typed confirmation or other validation failure', schema: anonymizeErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Anonymize submission',
  methods: { POST: anonymizeMethodDoc },
}
