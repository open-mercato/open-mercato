/**
 * Admin API — GET /api/submissions/:submissionId/export
 *
 * W5 (DP-5) — single-submission GDPR export. Same structured document shape as
 * the per-subject export, scoped to one submission. Feature-gated
 * (`forms.submissions.export`), tenant-scoped, and audited with one `export`
 * access-audit row.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { ExportService, ExportServiceError } from '../../../../services/export-service'
import {
  FormsAccessAuditLogger,
  type AccessAuditLogger,
} from '../../../../services/access-audit-logger'

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.submissions.export'] },
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

  const localeParam = req.nextUrl.searchParams.get('locale')
  const locale = localeParam && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(localeParam) ? localeParam : undefined

  const container = await createRequestContainer()
  const service = container.resolve('formsExportService') as ExportService
  const auditor = container.resolve('formsAccessAuditLogger') as AccessAuditLogger
  const em = container.resolve('em') as EntityManager

  try {
    const { document, submissionIds } = await service.exportSubmission({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      submissionId,
      locale,
    })
    for (const accessedId of submissionIds) {
      await auditor.log(em, {
        organizationId: auth.orgId,
        submissionId: accessedId,
        accessedBy: auth.sub,
        accessPurpose: 'export',
        ip: req.headers.get('x-forwarded-for') ?? null,
        ua: req.headers.get('user-agent') ?? null,
      })
    }
    const filename = `forms-submission-${submissionId}.json`
    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    if (error instanceof ExportServiceError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'forms.errors.internal', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Export a single submission (GDPR Art. 15/20)',
  description:
    'Returns the structured export document for one submission — decrypted answers keyed by field with labels, signature metadata, attachment references. Writes one `export` access-audit row. Requires `forms.submissions.export`.',
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
    { status: 404, description: 'Submission not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Export submission',
  methods: { GET: getMethodDoc },
}
