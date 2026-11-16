/**
 * Public/anonymous PDF snapshot download —
 * GET /api/forms/public/submissions/:id/pdf
 *
 * Streams the participant's copy of the submission PDF, so they can download
 * it from the completion screen. The copy holds only the answers the
 * principal's role can read (same set as the JSON read): the immutable
 * canonical snapshot when that role reads every field, otherwise an uncached
 * role-filtered render. Responses are `private, no-store`. Authorized via
 * `resolveRuntimePrincipal` (submission access token OR portal customer
 * session); org/tenant are re-derived from the persisted
 * submission (R-2d-4). Cross-tenant ids return 404 (no enumeration).
 *
 * The canonical snapshot is generated lazily on first request when the
 * on-submit subscriber has not yet produced it; generation is idempotent.
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  PdfSnapshotService,
  PdfSnapshotServiceError,
} from '../../../../../services/pdf-snapshot-service'
import { resolveRuntimePrincipal } from '../../../../../lib/runtime-principal'
import { SANDBOXED_DOWNLOAD_HEADERS } from '../../../../attachment-helpers'
import { buildPublicRateLimitKey, enforcePublicRateLimit } from '../../../rate-limit'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)

  const limited = await enforcePublicRateLimit(
    req,
    buildPublicRateLimitKey('submission-pdf', submissionId),
  )
  if (limited) return limited

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const snapshots = container.resolve('formsPdfSnapshotService') as PdfSnapshotService

  const principal = await resolveRuntimePrincipal({ req, submissionId, em })
  if (!principal) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  try {
    const snapshot = await snapshots.readSnapshotForViewer({
      organizationId: principal.organizationId,
      tenantId: principal.tenantId,
      submissionId,
      viewerRole: principal.role,
    })
    return new NextResponse(snapshot.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': snapshot.contentType,
        'content-disposition': `attachment; filename="${sanitizeFilename(snapshot.filename)}"`,
        'cache-control': 'private, no-store',
        ...SANDBOXED_DOWNLOAD_HEADERS,
      },
    })
  } catch (error) {
    if (error instanceof PdfSnapshotServiceError) {
      const status = error.code === 'NOT_FOUND' ? 404 : 409
      return NextResponse.json({ error: error.code, message: error.message }, { status })
    }
    getTelemetryRuntime()?.reportError(error, { module: 'forms', code: 'forms.submission_pdf_failed' })
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, '_') || 'submission.pdf'
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Download a submission PDF snapshot (public/anonymous)',
  description:
    "Streams the participant's copy of the submission PDF. Authorized via access token or portal session. The copy contains only the answers the principal's role can read: the immutable canonical snapshot (generated on first request when missing) when the role can read every field, otherwise an uncached role-filtered copy.",
  tags: ['Forms Public Runtime'],
  responses: [{ status: 200, description: 'PDF stream', mediaType: 'application/pdf' }],
  errors: [
    { status: 401, description: 'Missing or invalid access token / session' },
    { status: 404, description: 'Submission not found' },
    { status: 409, description: 'Submission not yet submitted' },
    { status: 429, description: 'Rate limit exceeded' },
    { status: 503, description: 'Rate limiting unavailable' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public submission PDF snapshot',
  methods: { GET: getMethodDoc },
}
