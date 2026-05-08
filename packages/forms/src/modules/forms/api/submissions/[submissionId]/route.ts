/**
 * Admin API — GET /api/forms/submissions/:submissionId
 *
 * Returns role-filtered current state for an admin viewer. Audit-log writes
 * are stubbed in this phase (no-op `auditAccess` hook); phase 2b replaces
 * the hook with a real writer.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { SubmissionService } from '../../../../services/submission-service'
import { mapSubmissionError, serializeActor, serializeRevision, serializeSubmission } from '../../../runtime-helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
}

export async function GET(
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

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    const view = await service.getCurrent({
      submissionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      viewerRole: 'admin',
      viewerUserId: auth.sub,
    })
    return NextResponse.json({
      submission: serializeSubmission(view.submission),
      revision: serializeRevision(view.revision),
      decoded_data: view.decodedData,
      actors: view.actors.map(serializeActor),
      formVersion: {
        id: view.formVersion.id,
        versionNumber: view.formVersion.versionNumber,
        roles: Array.isArray(view.formVersion.roles) ? view.formVersion.roles : [],
      },
    })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({ error: z.string(), message: z.string().optional() })

const responseSchema = z.object({
  submission: z.record(z.string(), z.unknown()),
  revision: z.record(z.string(), z.unknown()),
  decoded_data: z.record(z.string(), z.unknown()),
  actors: z.array(z.record(z.string(), z.unknown())),
  formVersion: z.record(z.string(), z.unknown()),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Get a submission for the admin inbox',
  description: 'Returns the current submission state for the admin role. Phase 2b will write a form_access_audit row at this call site.',
  tags: ['Forms Admin'],
  responses: [{ status: 200, description: 'Submission state', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Admin submission details',
  methods: { GET: getMethodDoc },
}
