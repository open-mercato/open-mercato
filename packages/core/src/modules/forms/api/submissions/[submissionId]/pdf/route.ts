/**
 * Admin API — GET /api/forms/submissions/:submissionId/pdf
 *
 * W3 — PDF snapshot download. Streams the immutable signed-PDF snapshot of a
 * submitted form, generating it on first request when the on-submit subscriber
 * has not yet produced it (lazy fallback). Generation is idempotent — once
 * `pdf_snapshot_attachment_id` is set the stored bytes are returned verbatim
 * and never re-rendered (submissions are immutable post-submit).
 *
 * Bytes are encrypted at rest with the per-tenant `EncryptionService` and
 * decrypted here for streaming. Writes an audit row with
 * `access_purpose = 'export'`. Strict tenant isolation: org/tenant come from
 * the authenticated admin session and every query is scoped by them.
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { FormSubmission } from '../../../../data/entities'
import { type AccessAuditLogger } from '../../../../services/access-audit-logger'
import {
  PdfSnapshotService,
  PdfSnapshotServiceError,
} from '../../../../services/pdf-snapshot-service'

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
  const em = container.resolve('em') as EntityManager
  const auditor = container.resolve('formsAccessAuditLogger') as AccessAuditLogger
  const snapshots = container.resolve('formsPdfSnapshotService') as PdfSnapshotService

  const submission = await em.findOne(FormSubmission, {
    id: submissionId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!submission) {
    return NextResponse.json({ error: 'forms.errors.submission_not_found' }, { status: 404 })
  }
  if (submission.status !== 'submitted') {
    return NextResponse.json(
      {
        error: 'forms.errors.snapshot_pending',
        message: 'A PDF snapshot is only available once the form is submitted.',
      },
      { status: 404 },
    )
  }

  let snapshot
  try {
    snapshot = await snapshots.ensureSnapshot({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      submissionId,
    })
  } catch (error) {
    if (error instanceof PdfSnapshotServiceError) {
      return NextResponse.json({ error: 'forms.errors.snapshot_pending', message: error.message }, { status: 404 })
    }
    throw error
  }

  await auditor.log(em, {
    organizationId: auth.orgId,
    submissionId,
    accessedBy: auth.sub,
    accessPurpose: 'export',
    ip: req.headers.get('x-forwarded-for') ?? null,
    ua: req.headers.get('user-agent') ?? null,
  })

  return new NextResponse(snapshot.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': snapshot.contentType,
      'content-disposition': `attachment; filename="${sanitizeFilename(snapshot.filename)}"`,
    },
  })
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, '_') || 'submission.pdf'
}

const pdfMethodDoc: OpenApiMethodDoc = {
  summary: 'Download the PDF snapshot of a submitted form',
  description:
    'Streams the immutable PDF snapshot, generating it on first request when the on-submit job has not produced it yet. Never re-renders an existing snapshot. Writes an audit row with `access_purpose = "export"`.',
  tags: ['Forms Compliance'],
  responses: [{ status: 200, description: 'PDF stream', mediaType: 'application/pdf' }],
  errors: [{ status: 404, description: 'Submission not found or not yet submitted' }],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Submission PDF snapshot',
  methods: { GET: pdfMethodDoc },
}
