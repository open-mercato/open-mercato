/**
 * Admin API — GET /api/forms/submissions/:submissionId/pdf
 *
 * Phase 2b — PDF snapshot download. The actual snapshot generation is
 * decoupled from this endpoint:
 *
 *   - At submit time (phase 1c -> phase 2b's after-commit hook), a worker
 *     renders the PDF and stores it in `forms_form_attachment` with
 *     `kind = 'snapshot'` and `field_key = '__snapshot__'`. The submission
 *     row's `pdf_snapshot_attachment_id` is set after success.
 *   - This endpoint streams whatever bytes are stored. It NEVER re-renders.
 *     If the snapshot has not been generated yet, returns 404 with a typed
 *     error code so clients can show "PDF generation pending".
 *
 * The PDF generator itself (puppeteer/pdfkit/etc.) is intentionally a
 * pluggable concern — the entity supports both a `file_id` (for
 * files-module-backed deployments) and `payload_inline` (for self-contained
 * deployments). This minimal handler accepts either.
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  FormAttachment,
  FormSubmission,
} from '../../../../data/entities'
import {
  type AccessAuditLogger,
} from '../../../../services/access-audit-logger'

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

  const submission = await em.findOne(FormSubmission, {
    id: submissionId,
    organizationId: auth.orgId,
  })
  if (!submission) {
    return NextResponse.json({ error: 'forms.errors.submission_not_found' }, { status: 404 })
  }
  if (!submission.pdfSnapshotAttachmentId) {
    return NextResponse.json(
      {
        error: 'forms.errors.snapshot_pending',
        message:
          'PDF snapshot has not been generated yet. The post-submit job has not completed or is not configured.',
      },
      { status: 404 },
    )
  }

  const attachment = await em.findOne(FormAttachment, {
    id: submission.pdfSnapshotAttachmentId,
    organizationId: auth.orgId,
  })
  if (!attachment) {
    return NextResponse.json({ error: 'forms.errors.snapshot_missing' }, { status: 404 })
  }

  await auditor.log(em, {
    organizationId: auth.orgId,
    submissionId,
    accessedBy: auth.sub,
    accessPurpose: 'export',
    ip: req.headers.get('x-forwarded-for') ?? null,
    ua: req.headers.get('user-agent') ?? null,
  })

  if (attachment.payloadInline) {
    return new NextResponse(attachment.payloadInline as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': attachment.contentType ?? 'application/pdf',
        'content-disposition': `attachment; filename="${attachment.filename ?? `submission-${submissionId}.pdf`}"`,
      },
    })
  }

  return NextResponse.json(
    {
      error: 'forms.errors.snapshot_storage_unconfigured',
      message:
        'Snapshot bytes are not inline. Configure a files-module integration to stream from external storage.',
      attachmentId: attachment.id,
      fileId: attachment.fileId,
    },
    { status: 501 },
  )
}

const pdfMethodDoc: OpenApiMethodDoc = {
  summary: 'Download the PDF snapshot of a submitted form',
  description:
    'Streams the immutable PDF snapshot generated at submit time. Never re-renders. Writes an audit row with `access_purpose = "export"`.',
  tags: ['Forms Compliance'],
  responses: [{ status: 200, description: 'PDF stream', mediaType: 'application/pdf' }],
  errors: [
    { status: 404, description: 'Submission not found or snapshot not yet generated' },
    {
      status: 501,
      description: 'Snapshot is referenced by `file_id` and the deployment lacks a files-module storage adapter',
    },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Submission PDF snapshot',
  methods: { GET: pdfMethodDoc },
}
