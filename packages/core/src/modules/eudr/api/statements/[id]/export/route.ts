import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  EudrDueDiligenceStatement,
  EudrEvidenceSubmission,
  EudrMitigationAction,
  EudrPlot,
  EudrProductMapping,
  EudrRiskAssessment,
} from '../../../../data/entities'
import {
  EUDR_ACTIVITY_TYPES,
  EUDR_ACTOR_ROLES,
  EUDR_COMMODITIES,
  EUDR_MITIGATION_STATUSES,
  EUDR_MITIGATION_TYPES,
  EUDR_RISK_CONCLUSIONS,
  EUDR_RISK_TIERS,
  EUDR_STATEMENT_STATUSES,
  EUDR_SUBMISSION_STATUSES,
} from '../../../../data/validators'
import { hasMissingSpecies } from '../../../../lib/species'
import { EUDR_AMEND_WINDOW_MS } from '../../../../lib/statement-lifecycle'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.statements.view', 'eudr.submissions.view', 'eudr.mappings.view', 'eudr.plots.view', 'eudr.risk.view'] },
}

const uuidSchema = z.string().uuid()
const querySchema = z.object({
  format: z.enum(['json', 'geojson']).optional(),
})

type AuthenticatedContext = Exclude<AuthContext, null>
type Scope = { tenantId: string; organizationId: string }
type GeoJsonGeometry = Record<string, unknown> & { type: string }
type GeoJsonFeature = {
  type: 'Feature'
  geometry: GeoJsonGeometry
  properties: Record<string, unknown>
}

function hasPrivilegedStatementExportAccess(auth: AuthenticatedContext): boolean {
  return auth.isSuperAdmin === true
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

function addMilliseconds(value: Date | null | undefined, milliseconds: number): string | null {
  if (!value) return null
  const time = value.getTime()
  if (Number.isNaN(time)) return null
  return new Date(time + milliseconds).toISOString()
}

function addYears(value: Date | null | undefined, years: number): string | null {
  if (!value) return null
  const time = value.getTime()
  if (Number.isNaN(time)) return null
  const date = new Date(time)
  date.setUTCFullYear(date.getUTCFullYear() + years)
  return date.toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeGeometry(value: unknown): GeoJsonGeometry | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'Feature') {
    return normalizeGeometry(value.geometry)
  }
  if (value.type === 'Point' || value.type === 'Polygon' || value.type === 'MultiPolygon') {
    return value as GeoJsonGeometry
  }
  return null
}

function statementPayload(statement: EudrDueDiligenceStatement) {
  return {
    id: statement.id,
    title: statement.title,
    commodity: statement.commodity,
    referenceNumber: statement.referenceNumber ?? null,
    verificationNumber: statement.verificationNumber ?? null,
    status: statement.status,
    activityType: statement.activityType ?? null,
    actorRole: statement.actorRole ?? null,
    referencedStatements: statement.referencedStatements ?? [],
    quantityKg: statement.quantityKg ?? null,
    supplementaryUnit: statement.supplementaryUnit ?? null,
    supplementaryQuantity: statement.supplementaryQuantity ?? null,
    orderId: statement.orderId ?? null,
    submittedAt: toIsoString(statement.submittedAt),
    referenceIssuedAt: toIsoString(statement.referenceIssuedAt),
    orderSnapshot: statement.orderSnapshot ?? null,
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
    plotIds: stringArray(submission.plotIds),
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
    speciesScientificName: mapping.speciesScientificName ?? null,
    speciesCommonName: mapping.speciesCommonName ?? null,
    isInScope: mapping.isInScope,
    notes: mapping.notes ?? null,
    createdAt: toIsoString(mapping.createdAt),
    updatedAt: toIsoString(mapping.updatedAt),
  }
}

function riskAssessmentPayload(assessment: EudrRiskAssessment | null) {
  if (!assessment) return null
  return {
    id: assessment.id,
    statementId: assessment.statementId,
    countryRisks: assessment.countryRisks,
    overallTier: assessment.overallTier,
    criteria: assessment.criteria,
    conclusion: assessment.conclusion,
    isSimplified: assessment.isSimplified,
    assessedAt: toIsoString(assessment.assessedAt),
    assessedByName: assessment.assessedByName ?? null,
    reviewDueAt: toIsoString(assessment.reviewDueAt),
    notes: assessment.notes ?? null,
    createdAt: toIsoString(assessment.createdAt),
    updatedAt: toIsoString(assessment.updatedAt),
  }
}

function mitigationActionPayload(action: EudrMitigationAction) {
  return {
    id: action.id,
    riskAssessmentId: action.riskAssessmentId,
    actionType: action.actionType,
    title: action.title,
    description: action.description ?? null,
    status: action.status,
    dueDate: toIsoString(action.dueDate),
    completedAt: toIsoString(action.completedAt),
    notes: action.notes ?? null,
    createdAt: toIsoString(action.createdAt),
    updatedAt: toIsoString(action.updatedAt),
  }
}

function plotPayload(plot: EudrPlot) {
  return {
    id: plot.id,
    supplierEntityId: plot.supplierEntityId,
    supplierSnapshot: plot.supplierSnapshot ?? null,
    name: plot.name,
    externalId: plot.externalId ?? null,
    description: plot.description ?? null,
    originCountry: plot.originCountry,
    plotType: plot.plotType,
    geometry: plot.geometry ?? null,
    areaHa: plot.areaHa ?? null,
    validationWarnings: stringArray(plot.validationWarnings),
    producerName: plot.producerName ?? null,
    isActive: plot.isActive,
    createdAt: toIsoString(plot.createdAt),
    updatedAt: toIsoString(plot.updatedAt),
  }
}

function lifecyclePayload(statement: EudrDueDiligenceStatement) {
  const retentionBase = statement.submittedAt ?? statement.createdAt
  return {
    activityType: statement.activityType ?? null,
    actorRole: statement.actorRole ?? null,
    submittedAt: toIsoString(statement.submittedAt),
    referenceIssuedAt: toIsoString(statement.referenceIssuedAt),
    amendWindowEndsAt: addMilliseconds(statement.referenceIssuedAt, EUDR_AMEND_WINDOW_MS),
    retainUntil: addYears(retentionBase, 5),
  }
}

async function loadExportData(req: NextRequest, id: string) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return { response: Response.json({ error: translate('eudr.errors.unauthorized', 'Unauthorized') }, { status: 401 }) }
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const privileged = hasPrivilegedStatementExportAccess(auth)

  const statementFilter: FilterQuery<EudrDueDiligenceStatement> = {
    id,
    deletedAt: null,
  }
  // Tenant-bound sessions always keep tenant scoping. Only a global super-admin
  // without tenant context may look up across tenants, and only super-admins
  // bypass organization scoping.
  if (auth.tenantId) {
    statementFilter.tenantId = auth.tenantId
  } else if (!auth.isSuperAdmin) {
    return { response: Response.json({ error: translate('eudr.errors.unauthorized', 'Unauthorized') }, { status: 401 }) }
  }
  if (!privileged) {
    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (Array.isArray(orgScope?.filterIds)) {
      statementFilter.organizationId = { $in: orgScope.filterIds }
    } else {
      const organizationId = orgScope?.selectedId ?? auth.orgId
      if (!organizationId) {
        return { response: Response.json({ error: translate('eudr.errors.forbidden', 'Forbidden') }, { status: 403 }) }
      }
      statementFilter.organizationId = organizationId
    }
  }

  const statement = await em.findOne(EudrDueDiligenceStatement, statementFilter)
  if (!statement) {
    return { response: Response.json({ error: translate('eudr.errors.statement_not_found', 'Statement not found') }, { status: 404 }) }
  }

  const scope: Scope = {
    tenantId: statement.tenantId,
    organizationId: statement.organizationId,
  }

  const submissions = await findWithDecryption(
    em,
    EudrEvidenceSubmission,
    {
      statementId: id,
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    {},
    scope,
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
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<EudrProductMapping>)
    : []

  const riskAssessments = await findWithDecryption(
    em,
    EudrRiskAssessment,
    {
      statementId: id,
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { orderBy: { assessedAt: 'DESC', createdAt: 'DESC' } },
    scope,
  )
  const latestRiskAssessment = riskAssessments[0] ?? null

  const mitigationActions = latestRiskAssessment
    ? await findWithDecryption(
        em,
        EudrMitigationAction,
        {
          riskAssessmentId: latestRiskAssessment.id,
          deletedAt: null,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        { orderBy: { createdAt: 'ASC' } },
        scope,
      )
    : []

  const plotIds = Array.from(
    new Set(
      submissions
        .flatMap((submission) => stringArray(submission.plotIds))
        .filter((plotId) => plotId.length > 0),
    ),
  )
  const plots = plotIds.length
    ? await findWithDecryption(
        em,
        EudrPlot,
        {
          id: { $in: plotIds },
          deletedAt: null,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        {},
        scope,
      )
    : []

  const supplierNames = await loadSupplierNames(container.resolve('queryEngine') as QueryEngine, scope, plots)

  return {
    statement,
    submissions,
    productMappings,
    latestRiskAssessment,
    mitigationActions,
    plots,
    supplierNames,
  }
}

async function loadSupplierNames(
  queryEngine: QueryEngine,
  scope: Scope,
  plots: EudrPlot[],
): Promise<Map<string, string>> {
  const supplierIds = Array.from(
    new Set(
      plots
        .filter((plot) => !plot.supplierSnapshot?.displayName)
        .map((plot) => plot.supplierEntityId)
        .filter((supplierId): supplierId is string => typeof supplierId === 'string' && supplierId.length > 0),
    ),
  )
  if (!supplierIds.length) return new Map()
  // Soft cross-module read (FK-id convention) via the query engine — no direct
  // customers entity import; degrades to an empty map when the peer is absent.
  try {
    const customersEntityId = (E as Record<string, Record<string, string>>).customers?.customer_entity
    if (!customersEntityId) return new Map()
    const result = await queryEngine.query<Record<string, unknown>>(customersEntityId, {
      fields: ['id', 'display_name'],
      filters: { id: { $in: supplierIds } },
      page: { page: 1, pageSize: Math.min(supplierIds.length, 100) },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? undefined,
    })
    const names = new Map<string, string>()
    for (const item of result.items) {
      const supplierId = typeof item.id === 'string' ? item.id : null
      const rawName = item.display_name ?? item.displayName
      const displayName = typeof rawName === 'string' && rawName.length ? rawName : null
      if (supplierId && displayName) names.set(supplierId, displayName)
    }
    return names
  } catch {
    return new Map()
  }
}

function buildJsonPacket(data: Exclude<Awaited<ReturnType<typeof loadExportData>>, { response: Response }>) {
  const submissionItems = data.submissions.map(submissionPayload)
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

  return {
    generatedAt: new Date().toISOString(),
    statement: statementPayload(data.statement),
    submissions: submissionItems,
    productMappings: data.productMappings.map(productMappingPayload),
    readiness: {
      ready: submissionItems.length > 0 && submissionItems.every((submission) => submission.status === 'verified' && submission.completenessScore === 100),
      submissionCount: submissionItems.length,
      verifiedCount,
      completeCount,
      gaps,
      warnings: data.productMappings.some((mapping) => hasMissingSpecies(mapping))
        ? ['eudr.warnings.speciesMissing']
        : [],
    },
    riskAssessment: riskAssessmentPayload(data.latestRiskAssessment),
    mitigationActions: data.mitigationActions.map(mitigationActionPayload),
    plots: data.plots.map(plotPayload),
    lifecycle: lifecyclePayload(data.statement),
    referencedStatements: data.statement.referencedStatements ?? [],
  }
}

function buildGeoJsonPacket(data: Exclude<Awaited<ReturnType<typeof loadExportData>>, { response: Response }>) {
  const features: GeoJsonFeature[] = []
  for (const plot of data.plots) {
    const geometry = normalizeGeometry(plot.geometry)
    if (!geometry) continue
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        plotId: plot.id,
        plotName: plot.name,
        supplierName: plot.supplierSnapshot?.displayName ?? data.supplierNames.get(plot.supplierEntityId) ?? null,
        producerName: plot.producerName ?? null,
        originCountry: plot.originCountry,
        areaHa: plot.areaHa ?? null,
      },
    })
  }

  for (const submission of data.submissions) {
    const geometry = normalizeGeometry(submission.geolocation)
    if (!geometry) continue
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        submissionId: submission.id,
        source: 'submission_geolocation',
      },
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!uuidSchema.safeParse(id).success) {
    const { translate } = await resolveTranslations()
    return Response.json({ error: translate('eudr.errors.statement_not_found', 'Statement not found') }, { status: 404 })
  }

  const parsedQuery = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsedQuery.success) {
    const { translate } = await resolveTranslations()
    return Response.json({ error: translate('eudr.errors.invalid_query', 'Invalid query'), details: parsedQuery.error.flatten() }, { status: 400 })
  }

  const data = await loadExportData(req, id)
  if ('response' in data) return data.response

  if (parsedQuery.data.format === 'geojson') {
    return new Response(JSON.stringify(buildGeoJsonPacket(data)), {
      status: 200,
      headers: {
        'Content-Type': 'application/geo+json',
      },
    })
  }

  return Response.json(buildJsonPacket(data))
}

const errorSchema = z.object({
  error: z.string(),
})

const referencedStatementResponseSchema = z.object({
  referenceNumber: z.string(),
  verificationNumber: z.string().nullable().optional(),
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
    activityType: z.enum(EUDR_ACTIVITY_TYPES).nullable(),
    actorRole: z.enum(EUDR_ACTOR_ROLES).nullable(),
    referencedStatements: z.array(referencedStatementResponseSchema),
    quantityKg: z.union([z.string(), z.number()]).nullable(),
    supplementaryUnit: z.string().nullable(),
    supplementaryQuantity: z.union([z.string(), z.number()]).nullable(),
    orderId: z.string().uuid().nullable(),
    submittedAt: z.string().nullable(),
    referenceIssuedAt: z.string().nullable(),
    orderSnapshot: z.object({
      orderNumber: z.string().nullable().optional(),
    }).nullable(),
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
    plotIds: z.array(z.string().uuid()),
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
    speciesScientificName: z.string().nullable(),
    speciesCommonName: z.string().nullable(),
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
    warnings: z.array(z.string()),
    gaps: z.array(z.object({
      submissionId: z.string().uuid(),
      status: z.enum(EUDR_SUBMISSION_STATUSES),
      completenessScore: z.number(),
      missingFields: z.array(z.string()),
    })),
  }),
  riskAssessment: z.object({
    id: z.string().uuid(),
    statementId: z.string().uuid(),
    countryRisks: z.array(z.object({
      country: z.string(),
      tier: z.string(),
    })),
    overallTier: z.enum(EUDR_RISK_TIERS),
    criteria: z.record(z.string(), z.unknown()),
    conclusion: z.enum(EUDR_RISK_CONCLUSIONS),
    isSimplified: z.boolean(),
    assessedAt: z.string().nullable(),
    assessedByName: z.string().nullable(),
    reviewDueAt: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  }).nullable(),
  mitigationActions: z.array(z.object({
    id: z.string().uuid(),
    riskAssessmentId: z.string().uuid(),
    actionType: z.enum(EUDR_MITIGATION_TYPES),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(EUDR_MITIGATION_STATUSES),
    dueDate: z.string().nullable(),
    completedAt: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })),
  plots: z.array(z.object({
    id: z.string().uuid(),
    supplierEntityId: z.string().uuid(),
    supplierSnapshot: z.object({
      displayName: z.string().nullable().optional(),
    }).nullable(),
    name: z.string(),
    externalId: z.string().nullable(),
    description: z.string().nullable(),
    originCountry: z.string(),
    plotType: z.string(),
    geometry: z.unknown().nullable(),
    areaHa: z.union([z.string(), z.number()]).nullable(),
    validationWarnings: z.array(z.string()),
    producerName: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })),
  lifecycle: z.object({
    activityType: z.enum(EUDR_ACTIVITY_TYPES).nullable(),
    actorRole: z.enum(EUDR_ACTOR_ROLES).nullable(),
    submittedAt: z.string().nullable(),
    referenceIssuedAt: z.string().nullable(),
    amendWindowEndsAt: z.string().nullable(),
    retainUntil: z.string().nullable(),
  }),
  referencedStatements: z.array(referencedStatementResponseSchema),
})

const geoJsonResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    geometry: z.unknown(),
    properties: z.record(z.string(), z.unknown()),
  })),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'Export due diligence statement evidence packet',
  methods: {
    GET: {
      summary: 'Export due diligence statement evidence packet',
      description: 'Returns a due diligence statement with decrypted evidence submissions, product mappings, readiness details, lifecycle fields, latest risk assessment, mitigation actions, and referenced plots. Use `format=geojson` to export referenced plot and legacy submission geolocations.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Due diligence statement evidence packet',
          schema: exportResponseSchema,
        },
        {
          status: 200,
          description: 'GeoJSON plot and legacy submission geolocation export',
          mediaType: 'application/geo+json',
          schema: geoJsonResponseSchema,
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
