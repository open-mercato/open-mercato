/**
 * Admin API — GET /api/forms/subjects/:subjectType/:subjectId/consents
 *
 * Phase 3 Track D — per-subject consent history.
 *
 * Returns the subject's `forms_consent_record` projection (active + history)
 * built by the `forms-consent-projector` subscriber from signed `signature`
 * fields. The response is PII-free by construction: clause SHA-256 + signed-at
 * + status timestamps + ids only — never the signature image, typed name, or
 * any answer value.
 *
 * Feature-gated (`forms.view`) and tenant-scoped. Optional filters:
 *   - `?status=active|superseded|revoked` — narrow to one status.
 *   - `?formId=<uuid>` — narrow to one form.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { Form, FormConsentRecord, type FormConsentRecordStatus } from '../../../../../../data/entities'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

const consentItemSchema = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  formName: z.string().nullable(),
  formVersionId: z.string().uuid(),
  versionNumber: z.number().int(),
  submissionId: z.string().uuid(),
  consentFieldKey: z.string(),
  clauseSha256: z.string(),
  signedAt: z.string(),
  status: z.string(),
  supersededAt: z.string().nullable(),
  supersededByRecordId: z.string().uuid().nullable(),
})

const responseSchema = z.object({ items: z.array(consentItemSchema) })

const CONSENT_STATUSES = ['active', 'superseded', 'revoked'] as const

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
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

  const statusParam = req.nextUrl.searchParams.get('status')
  const statusFilter =
    statusParam && (CONSENT_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as FormConsentRecordStatus)
      : null
  if (statusParam && !statusFilter) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', message: 'status must be one of active, superseded, revoked.' },
      { status: 422 },
    )
  }
  const formIdParam = req.nextUrl.searchParams.get('formId')
  if (formIdParam && !UUID_PATTERN.test(formIdParam)) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', message: 'formId must be a UUID.' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  try {
    const where: Record<string, unknown> = {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      subjectType,
      subjectId,
    }
    if (statusFilter) where.status = statusFilter
    if (formIdParam) where.formId = formIdParam

    const records = await em.find(FormConsentRecord, where, {
      orderBy: { signedAt: 'desc' },
    })

    const formIds = Array.from(new Set(records.map((record) => record.formId)))
    const forms = formIds.length
      ? await em.find(Form, {
          id: { $in: formIds },
          organizationId: auth.orgId,
          tenantId: auth.tenantId,
        })
      : []
    const formNameById = new Map(forms.map((form) => [form.id, form.name]))

    const items = records.map((record) => ({
      id: record.id,
      formId: record.formId,
      formName: formNameById.get(record.formId) ?? null,
      formVersionId: record.formVersionId,
      versionNumber: record.versionNumber,
      submissionId: record.submissionId,
      consentFieldKey: record.consentFieldKey,
      clauseSha256: record.clauseSha256,
      signedAt: record.signedAt.toISOString(),
      status: record.status,
      supersededAt: record.supersededAt ? record.supersededAt.toISOString() : null,
      supersededByRecordId: record.supersededByRecordId ?? null,
    }))

    return NextResponse.json({ items }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: 'forms.errors.internal', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'List consent records for a data subject',
  description:
    'Returns the subject\'s consent history projected from signed signature fields — active and superseded records. PII-free: clause SHA-256, signed-at, status timestamps, and ids only. Optional `status` and `formId` query filters. Requires `forms.view`.',
  tags: ['Forms Compliance'],
  responses: [
    {
      status: 200,
      description: 'Consent records for the subject (newest signed first)',
      schema: responseSchema,
    },
  ],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Tenant scope required', schema: errorSchema },
    { status: 422, description: 'Bad subject identifier or filter', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List data-subject consent records',
  methods: { GET: getMethodDoc },
}
