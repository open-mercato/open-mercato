/**
 * Admin API — GET /api/forms/submissions/:submissionId/access-audit
 *
 * Phase 2b — lists the access-audit rows for one submission so the drawer's
 * AccessAuditPanel can render who/when/purpose. The rows carry no payload
 * content — only metadata (accessor, purpose, IP, UA, optional revision id),
 * preserving the R-2b-6 posture. Reading the audit list does NOT itself write
 * a new audit row (it is the audit surface, not a submission read).
 *
 * Strict tenant isolation: the submission is resolved by org/tenant from the
 * authenticated admin session before any audit row is returned.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { FormAccessAudit, FormSubmission } from '../../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
}

const MAX_AUDIT_ROWS = 100

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
  const em = container.resolve('em') as EntityManager

  const submission = await em.findOne(FormSubmission, {
    id: submissionId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!submission) {
    return NextResponse.json({ error: 'forms.errors.submission_not_found' }, { status: 404 })
  }

  const rows = await em.find(
    FormAccessAudit,
    { submissionId, organizationId: auth.orgId },
    { orderBy: { accessedAt: 'DESC' }, limit: MAX_AUDIT_ROWS },
  )

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      accessedBy: row.accessedBy,
      accessedAt: row.accessedAt.toISOString(),
      accessPurpose: row.accessPurpose,
      ip: row.ip ?? null,
      revisionId: row.revisionId ?? null,
    })),
  })
}

const auditRowSchema = z.object({
  id: z.string().uuid(),
  accessedBy: z.string().uuid(),
  accessedAt: z.string(),
  accessPurpose: z.enum(['view', 'export', 'revert', 'anonymize', 'reopen']),
  ip: z.string().nullable(),
  revisionId: z.string().uuid().nullable(),
})

const responseSchema = z.object({ items: z.array(auditRowSchema) })
const errorSchema = z.object({ error: z.string(), message: z.string().optional() })

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'List submission access-audit rows',
  description:
    'Returns the access-audit trail for a submission (who/when/purpose/IP). Carries no payload content. Reading the list does not write a new audit row.',
  tags: ['Forms Compliance'],
  responses: [{ status: 200, description: 'Access-audit rows', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Submission access audit',
  methods: { GET: getMethodDoc },
}
