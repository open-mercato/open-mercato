/**
 * Admin API — GET /api/forms/subjects/:subjectType/:subjectId/export
 *
 * W5 (DP-5) — GDPR data-subject export (Art. 15 access / Art. 20 portability).
 *
 * Returns a structured, machine-readable JSON document containing every
 * submission for the supplied subject, each with form key/name, version
 * number, status, lifecycle timestamps, and the DECRYPTED current-revision
 * answers keyed by field with human labels + types. Signature answers carry
 * structured metadata (signed-at, consent-clause SHA, mode); large blobs /
 * uploads are referenced by attachment id, never inlined.
 *
 * Feature-gated (`forms.submissions.export`), tenant-scoped, and audited: one
 * `export` access-audit row is written per submission accessed.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { ExportService } from '../../../../../../services/export-service'
import {
  FormsAccessAuditLogger,
  type AccessAuditLogger,
} from '../../../../../../services/access-audit-logger'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.submissions.export'] },
}

export async function GET(
  req: NextRequest,
  context: {
    params:
      | { subjectType: string; subjectId: string }
      | Promise<{ subjectType: string; subjectId: string }>
  },
) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant scope required' }, { status: 403 })
  }
  const params = await Promise.resolve(context.params)
  const subjectType = String(params.subjectType)
  const subjectId = String(params.subjectId)
  if (!subjectType || subjectType.length > 64) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', message: 'subjectType is required.' },
      { status: 422 },
    )
  }
  if (!UUID_PATTERN.test(subjectId)) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', message: 'subjectId must be a UUID.' },
      { status: 422 },
    )
  }

  const localeParam = req.nextUrl.searchParams.get('locale')
  const locale = localeParam && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(localeParam) ? localeParam : undefined

  const container = await createRequestContainer()
  const service = container.resolve('formsExportService') as ExportService
  const auditor = container.resolve('formsAccessAuditLogger') as AccessAuditLogger
  const em = container.resolve('em') as EntityManager

  try {
    const { document, submissionIds } = await service.exportSubject({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      subjectType,
      subjectId,
      locale,
    })
    for (const submissionId of submissionIds) {
      await auditor.log(em, {
        organizationId: auth.orgId,
        submissionId,
        accessedBy: auth.sub,
        accessPurpose: 'export',
        ip: req.headers.get('x-forwarded-for') ?? null,
        ua: req.headers.get('user-agent') ?? null,
      })
    }
    const filename = `forms-export-${subjectType}-${subjectId}.json`
    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'forms.errors.internal', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Export all submissions for a data subject (GDPR Art. 15/20)',
  description:
    'Returns a structured JSON document with every submission for the subject — form key/name, version, status, timestamps, decrypted answers keyed by field with labels, and signature metadata. Attachments are referenced by id. Writes one `export` access-audit row per submission. Requires `forms.submissions.export`.',
  tags: ['Forms Compliance'],
  responses: [
    {
      status: 200,
      description: 'Export document (downloaded as an attachment)',
      schema: z.record(z.string(), z.unknown()),
    },
  ],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Tenant scope required', schema: errorSchema },
    { status: 422, description: 'Bad subject identifier', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Export data-subject submissions',
  methods: { GET: getMethodDoc },
}
