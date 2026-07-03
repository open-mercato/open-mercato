import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AnalyticsEntityConfig, AnalyticsFieldType } from '@open-mercato/shared/modules/analytics'
import { dashboardsErrorSchema, dashboardsTag } from '../../openapi'
import type { AnalyticsRegistry } from '../../../services/analyticsRegistry'

const catalogAggregateSchema = z.enum(['sum', 'avg', 'count', 'min', 'max'])
const catalogFieldKindSchema = z.enum(['numeric', 'text', 'uuid', 'timestamp', 'jsonb'])

export const analyticsCatalogFieldSchema = z.object({
  field: z.string(),
  label: z.string(),
  kind: catalogFieldKindSchema,
  aggregates: z.array(catalogAggregateSchema),
  groupable: z.boolean(),
})

export const analyticsCatalogEntitySchema = z.object({
  entityType: z.string(),
  label: z.string(),
  dateField: z.string().nullable(),
  fields: z.array(analyticsCatalogFieldSchema),
})

export const analyticsCatalogResponseSchema = z.object({
  entities: z.array(analyticsCatalogEntitySchema),
})

type CatalogAggregate = z.infer<typeof catalogAggregateSchema>
export type AnalyticsCatalogResponse = z.infer<typeof analyticsCatalogResponseSchema>

type FeatureChecker = (features: string[]) => Promise<boolean>
type TranslateWithFallback = (key: string, fallback?: string) => string

const NUMERIC_AGGREGATES: readonly CatalogAggregate[] = ['sum', 'avg', 'count', 'min', 'max']
const COUNT_AGGREGATE: readonly CatalogAggregate[] = ['count']

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.catalog.view'] },
}

function humanize(value: string): string {
  const spaced = value
    .replace(/[:._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()

  if (!spaced) return value

  return spaced
    .split(/\s+/)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower
    })
    .join(' ')
}

function deriveAggregates(kind: AnalyticsFieldType): CatalogAggregate[] {
  return kind === 'numeric' ? [...NUMERIC_AGGREGATES] : [...COUNT_AGGREGATE]
}

function isGroupable(kind: AnalyticsFieldType): boolean {
  return kind === 'text' || kind === 'uuid' || kind === 'timestamp'
}

function resolveDateField(config: AnalyticsEntityConfig): string | null {
  const configured = config.entityConfig.dateField
  if (config.fieldMappings[configured]) return configured

  const matchingField = Object.entries(config.fieldMappings).find(
    ([, mapping]) => mapping.dbColumn === configured,
  )?.[0]

  return matchingField ?? null
}

function deriveEntityCatalog(
  config: AnalyticsEntityConfig,
  translate: TranslateWithFallback,
): AnalyticsCatalogResponse['entities'][number] {
  const entityType = config.entityId

  return {
    entityType,
    label: translate(`dashboards.catalog.entities.${entityType}`, humanize(entityType)),
    dateField: resolveDateField(config),
    fields: Object.entries(config.fieldMappings)
      .map(([field, mapping]) => ({
        field,
        label: humanize(field),
        kind: mapping.type,
        aggregates: deriveAggregates(mapping.type),
        groupable: isGroupable(mapping.type),
      }))
      .sort((a, b) => a.field.localeCompare(b.field)),
  }
}

function isCatalogEntity(
  value: AnalyticsCatalogResponse['entities'][number] | null,
): value is AnalyticsCatalogResponse['entities'][number] {
  return value !== null
}

export async function buildAnalyticsCatalogResponse(
  registry: AnalyticsRegistry,
  checkFeatures: FeatureChecker,
  translate: TranslateWithFallback = (_key, fallback) => fallback ?? _key,
): Promise<AnalyticsCatalogResponse> {
  const entities = await Promise.all(
    registry.getAllEntityConfigs().map(async (config) => {
      const requiredFeatures = config.requiredFeatures ?? []
      if (requiredFeatures.length > 0 && !(await checkFeatures(requiredFeatures))) {
        return null
      }
      return deriveEntityCatalog(config, translate)
    }),
  )

  return {
    entities: entities.filter(isCatalogEntity).sort((a, b) => a.entityType.localeCompare(b.entityType)),
  }
}

type RbacFeatureService = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string; organizationId?: string | null },
  ) => Promise<boolean>
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const analyticsRegistry = container.resolve<AnalyticsRegistry>('analyticsRegistry')
  const rbacService = container.resolve<RbacFeatureService>('rbacService')
  const { translate } = await resolveTranslations()

  const response = await buildAnalyticsCatalogResponse(
    analyticsRegistry,
    (features) =>
      rbacService.userHasAllFeatures(String(auth.sub ?? ''), features, {
        tenantId: auth.tenantId ?? '',
        organizationId: auth.orgId ?? null,
      }),
    translate,
  )

  return NextResponse.json(response)
}

const analyticsCatalogGetDoc: OpenApiMethodDoc = {
  summary: 'List dashboard analytics catalog entities',
  description:
    'Returns the analytics entities and fields exposed by registered modules for self-serve dashboard metric configuration. Entries are filtered by the caller feature grants.',
  tags: [dashboardsTag],
  responses: [
    {
      status: 200,
      description: 'Analytics catalog available to the caller.',
      schema: analyticsCatalogResponseSchema,
    },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 403, description: 'Missing dashboards.catalog.view feature', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Dashboard analytics catalog endpoint',
  methods: {
    GET: analyticsCatalogGetDoc,
  },
}
