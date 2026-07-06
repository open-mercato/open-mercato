import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  EudrDueDiligenceStatement,
  EudrEvidenceSubmission,
  EudrProductMapping,
} from '../../../../data/entities'
import {
  EUDR_COMMODITIES,
  EUDR_STATEMENT_STATUSES,
  EUDR_SUBMISSION_STATUSES,
} from '../../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.statements.view'] },
}

const uuidSchema = z.string().uuid()

function isSuperAdminAuth(auth: AuthContext): boolean {
  if (!auth) return false
  if (auth.isSuperAdmin === true) return true
  const roles = Array.isArray(auth.roles) ? auth.roles : []
  return roles.some((role) => role.trim().toLowerCase() === 'superadmin')
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function statementPayload(statement: EudrDueDiligenceStatement) {
  return {
    id: statement.id,
    title: statement.title,
    commodity: statement.commodity,
    referenceNumber: statement.referenceNumber ?? null,
    verificationNumber: statement.verificationNumber ?? null,
    status: statement.status,
    quantityKg: statement.quantityKg ?? null,
    orderId: statement.orderId ?? null,
    notes: statement.notes ?? null,
    createdAt: toIsoString(statement.createdAt),
    updatedAt: toIsoString(statement.updatedAt),
  }
}

function submissionPayload(submission: EudrEvidenceSubmission) {
  return {
    id: submission.id,
    supplierEntityId: submission.supplierEntityId,
    supplierSnapshot: submission.supplierSnapshot ?? null,
    commodity: submission.commodity,
    productMappingId: submission.productMappingId ?? null,
    statementId: submission.statementId ?? null,
    originCountry: submission.originCountry ?? null,
    geolocation: submission.geolocation ?? null,
    quantityKg: submission.quantityKg ?? null,
    batchNumber: submission.batchNumber ?? null,
    harvestFrom: toIsoString(submission.harvestFrom),
    harvestTo: toIsoString(submission.harvestTo),
    producerName: submission.producerName ?? null,
    attachmentIds: stringArray(submission.attachmentIds),
    status: submission.status,
    completenessScore: asNumber(submission.completenessScore),
    missingFields: stringArray(submission.missingFields),
    notes: submission.notes ?? null,
    createdAt: toIsoString(submission.createdAt),
    updatedAt: toIsoString(submission.updatedAt),
  }
}

function productMappingPayload(mapping: EudrProductMapping) {
  return {
    id: mapping.id,
    productId: mapping.productId,
    productSnapshot: mapping.productSnapshot ?? null,
    commodity: mapping.commodity,
    hsCode: mapping.hsCode ?? null,
    isInScope: mapping.isInScope,
    notes: mapping.notes ?? null,
    createdAt: toIsoString(mapping.createdAt),
    updatedAt: toIsoString(mapping.updatedAt),
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!uuidSchema.safeParse(id).success) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const auth = await getAuthFromRequest(req)
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const statementFilter: FilterQuery<EudrDueDiligenceStatement> = {
    id,
    deletedAt: null,
  }
  if (auth && !isSuperAdminAuth(auth)) {
    if (auth.tenantId) statementFilter.tenantId = auth.tenantId
    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (Array.isArray(orgScope?.filterIds)) {
      statementFilter.organizationId = { $in: orgScope.filterIds }
    }
  }

  const statement = await em.findOne(EudrDueDiligenceStatement, statementFilter)
  if (!statement) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const recordScope = {
    tenantId: statement.tenantId ?? null,
    organizationId: statement.organizationId ?? null,
  }
  const submissionFilter: FilterQuery<EudrEvidenceSubmission> = {
    statementId: id,
    deletedAt: null,
    tenantId: recordScope.tenantId,
    organizationId: recordScope.organizationId,
  }
  const submissions = await findWithDecryption(
    em,
    EudrEvidenceSubmission,
    submissionFilter,
    {},
    recordScope,
  )

  const productMappingIds = Array.from(
    new Set(
      submissions
        .map((submission) => submission.productMappingId)
        .filter((productMappingId): productMappingId is string => typeof productMappingId === 'string' && productMappingId.length > 0),
    ),
  )
  const productMappings = productMappingIds.length
    ? await em.find(EudrProductMapping, {
        id: { $in: productMappingIds },
        deletedAt: null,
        tenantId: recordScope.tenantId,
        organizationId: recordScope.organizationId,
      } as FilterQuery<EudrProductMapping>)
    : []

  const submissionItems = submissions.map(submissionPayload)
  const gaps = submissionItems
    .filter((submission) => submission.status !== 'verified' || submission.completenessScore !== 100)
    .map((submission) => ({
      submissionId: submission.id,
      status: submission.status,
      completenessScore: submission.completenessScore,
      missingFields: submission.missingFields,
    }))
  const verifiedCount = submissionItems.filter((submission) => submission.status === 'verified').length
  const completeCount = submissionItems.filter((submission) => submission.completenessScore === 100).length

  return Response.json({
    generatedAt: new Date().toISOString(),
    statement: statementPayload(statement),
    submissions: submissionItems,
    productMappings: productMappings.map(productMappingPayload),
    readiness: {
      ready: submissionItems.length > 0 && submissionItems.every((submission) => submission.status === 'verified' && submission.completenessScore === 100),
      submissionCount: submissionItems.length,
      verifiedCount,
      completeCount,
      gaps,
    },
  })
}

const errorSchema = z.object({
  error: z.string(),
})

const exportResponseSchema = z.object({
  generatedAt: z.string(),
  statement: z.object({
    id: z.string().uuid(),
    title: z.string(),
    commodity: z.enum(EUDR_COMMODITIES),
    referenceNumber: z.string().nullable(),
    verificationNumber: z.string().nullable(),
    status: z.enum(EUDR_STATEMENT_STATUSES),
    quantityKg: z.union([z.string(), z.number()]).nullable(),
    orderId: z.string().uuid().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  }),
  submissions: z.array(z.object({
    id: z.string().uuid(),
    supplierEntityId: z.string().uuid(),
    supplierSnapshot: z.object({
      displayName: z.string().nullable().optional(),
    }).nullable(),
    commodity: z.enum(EUDR_COMMODITIES),
    productMappingId: z.string().uuid().nullable(),
    statementId: z.string().uuid().nullable(),
    originCountry: z.string().nullable(),
    geolocation: z.unknown().nullable(),
    quantityKg: z.union([z.string(), z.number()]).nullable(),
    batchNumber: z.string().nullable(),
    harvestFrom: z.string().nullable(),
    harvestTo: z.string().nullable(),
    producerName: z.string().nullable(),
    attachmentIds: z.array(z.string().uuid()),
    status: z.enum(EUDR_SUBMISSION_STATUSES),
    completenessScore: z.number(),
    missingFields: z.array(z.string()),
    notes: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })),
  productMappings: z.array(z.object({
    id: z.string().uuid(),
    productId: z.string().uuid(),
    productSnapshot: z.object({
      name: z.string().nullable().optional(),
      sku: z.string().nullable().optional(),
    }).nullable(),
    commodity: z.enum(EUDR_COMMODITIES),
    hsCode: z.string().nullable(),
    isInScope: z.boolean(),
    notes: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })),
  readiness: z.object({
    ready: z.boolean(),
    submissionCount: z.number(),
    verifiedCount: z.number(),
    completeCount: z.number(),
    gaps: z.array(z.object({
      submissionId: z.string().uuid(),
      status: z.enum(EUDR_SUBMISSION_STATUSES),
      completenessScore: z.number(),
      missingFields: z.array(z.string()),
    })),
  }),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'Export due diligence statement evidence packet',
  methods: {
    GET: {
      summary: 'Export due diligence statement evidence packet',
      description: 'Returns a due diligence statement with decrypted evidence submissions, product mappings, and readiness details.',
      responses: [
        {
          status: 200,
          description: 'Due diligence statement evidence packet',
          schema: exportResponseSchema,
        },
      ],
      errors: [
        {
          status: 404,
          description: 'Statement not found',
          schema: errorSchema,
        },
      ],
    },
  },
}
