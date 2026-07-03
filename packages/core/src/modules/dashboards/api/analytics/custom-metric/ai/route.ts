import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateObject } from 'ai'
import { createContainer } from 'awilix'
import type { AwilixContainer } from 'awilix'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { AiModelFactoryError, createModelFactory } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { dashboardsErrorSchema, dashboardsTag } from '../../../openapi'
import { buildAnalyticsCatalogResponse, type AnalyticsCatalogResponse } from '../../catalog/route'
import { aggregateFunctionSchema, dateGranularitySchema } from '../../../widgets/data/schema'
import type { AnalyticsRegistry } from '../../../../services/analyticsRegistry'

const AI_TIMEOUT_MS = 15_000

type AiModel = Parameters<typeof generateObject>[0]['model']

export const customMetricAiConfigSchema = z.object({
  entityType: z.string().min(1),
  metricField: z.string().nullable(),
  aggregate: aggregateFunctionSchema,
  groupByField: z.string().nullable(),
  granularity: dateGranularitySchema.nullable(),
  limit: z.number().int().min(1).max(20),
  visualization: z.enum(['kpi', 'line', 'bar', 'donut', 'table']),
  title: z.string(),
})

type CustomMetricAiConfig = z.infer<typeof customMetricAiConfigSchema>

export const customMetricAiRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
})

const customMetricAiResponseSchema = z.object({
  config: customMetricAiConfigSchema.nullable(),
  aiAvailable: z.boolean(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['dashboards.catalog.view'] },
}

type RbacFeatureService = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string; organizationId?: string | null },
  ) => Promise<boolean>
}

function asAiModel(model: unknown): AiModel {
  return model as AiModel
}

function resolveAiModel(): AiModel | null {
  try {
    const container = createContainer()
    const factory = createModelFactory(container as AwilixContainer)
    return asAiModel(factory.resolveModel({ moduleId: 'dashboards' }).model)
  } catch (err) {
    if (err instanceof AiModelFactoryError && err.code === 'no_provider_configured') return null
    return null
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function buildSystemPrompt(catalog: AnalyticsCatalogResponse): string {
  return [
    'You configure a dashboard metric widget from a natural-language request by a business operator.',
    'You may only use entity types and fields present in the provided catalog. Never invent entity types, fields, aggregates, or visualizations.',
    `Catalog (the only allowed vocabulary): ${JSON.stringify(catalog)}`,
    'Rules:',
    '- entityType MUST be one of the catalog entityType values.',
    '- For aggregate "count", metricField may be any field on the chosen entity (prefer its "id" field). For "sum", "avg", "min", or "max", metricField MUST be a field whose aggregates array includes that aggregate.',
    '- visualization "kpi" has no grouping: set groupByField and granularity to null.',
    '- visualization "line" requires groupByField to be a groupable timestamp field and a granularity (day, week, month, quarter, or year).',
    '- visualization "bar", "donut", or "table" require groupByField to be a groupable non-timestamp field; set granularity to null; limit is between 1 and 20.',
    '- title is a short human-readable label for the metric.',
    'Return only JSON matching the schema.',
  ].join('\n')
}

export function sanitizeAiConfig(raw: unknown, catalog: AnalyticsCatalogResponse): CustomMetricAiConfig | null {
  const parsed = customMetricAiConfigSchema.safeParse(raw)
  if (!parsed.success) return null
  const entity = catalog.entities.find((candidate) => candidate.entityType === parsed.data.entityType)
  if (!entity) return null
  const fieldNames = new Set(entity.fields.map((field) => field.field))
  const metricField = parsed.data.metricField && fieldNames.has(parsed.data.metricField) ? parsed.data.metricField : null
  const groupByField = parsed.data.groupByField && fieldNames.has(parsed.data.groupByField) ? parsed.data.groupByField : null
  return { ...parsed.data, metricField, groupByField }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = customMetricAiRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  const container = await createRequestContainer()
  const analyticsRegistry = container.resolve<AnalyticsRegistry>('analyticsRegistry')
  const rbacService = container.resolve<RbacFeatureService>('rbacService')
  const { translate } = await resolveTranslations()

  const catalog = await buildAnalyticsCatalogResponse(
    analyticsRegistry,
    (features) => {
      if (features.length === 0) return Promise.resolve(true)
      return rbacService.userHasAllFeatures(String(auth.sub ?? ''), features, {
        tenantId: auth.tenantId ?? '',
        organizationId: auth.orgId ?? null,
      })
    },
    translate,
  )

  if (catalog.entities.length === 0) {
    return NextResponse.json({ config: null, aiAvailable: true })
  }

  const model = resolveAiModel()
  if (!model) {
    return NextResponse.json({ config: null, aiAvailable: false })
  }

  try {
    const result = await withTimeout(
      generateObject({
        model,
        schema: customMetricAiConfigSchema,
        system: buildSystemPrompt(catalog),
        prompt: parsed.data.prompt,
        temperature: 0.2,
      }),
      AI_TIMEOUT_MS,
      `[internal] custom-metric AI generation timed out after ${AI_TIMEOUT_MS}ms`,
    )
    return NextResponse.json({ config: sanitizeAiConfig(result.object, catalog), aiAvailable: true })
  } catch (err) {
    console.error('[dashboards/custom-metric/ai] Error:', err)
    return NextResponse.json({ config: null, aiAvailable: true })
  }
}

const customMetricAiPostDoc: OpenApiMethodDoc = {
  summary: 'Generate a custom metric widget configuration from a prompt',
  description:
    'Turns a natural-language request into a proposed Custom Metric widget configuration grounded in the analytics catalog the caller may query. Returns a draft configuration for the wizard to preview and edit; grants nothing beyond what the caller could build manually. Degrades to config:null when no AI provider is configured.',
  tags: [dashboardsTag],
  requestBody: {
    contentType: 'application/json',
    schema: customMetricAiRequestSchema,
    description: 'Natural-language description of the metric to build.',
  },
  responses: [
    {
      status: 200,
      description: 'Proposed configuration (or null when unavailable or not resolvable).',
      schema: customMetricAiResponseSchema,
    },
  ],
  errors: [
    { status: 400, description: 'Invalid payload', schema: dashboardsErrorSchema },
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 403, description: 'Missing dashboards.catalog.view feature', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Dashboard custom metric AI generation endpoint',
  methods: {
    POST: customMetricAiPostDoc,
  },
}
