import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveDictionaryRouteContext } from '../dictionaries/context'
import { createDictionaryCacheTags, DICTIONARY_CACHE_TTL_MS } from '../dictionaries/cache'
import {
  resolveBaselineCalendarEventTypes,
  resolveScopedCalendarEventTypes,
} from '../../lib/calendar/eventTypeResolver'
import { calendarEventTypeBehaviorSchema } from '../../calendar-event-types'

const logger = createLogger('customers')

function reportActivityTypeError(error: unknown, code: string, attributes?: Record<string, string>): void {
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'customers', code, attributes })
  } catch {}
}

const querySchema = z.object({ organizationId: z.string().uuid().optional() })
const responseSchema = z.object({
  fallbackKey: z.literal('meeting'),
  items: z.array(z.object({
    key: z.string(),
    label: z.string(),
    labelKey: z.string().optional(),
    icon: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    behavior: calendarEventTypeBehaviorSchema,
    selectable: z.boolean(),
    panelKey: z.string().optional(),
    source: z.string(),
    provenance: z.record(z.string(), z.unknown()),
    historical: z.boolean(),
    fallbackReason: z.enum(['tombstoned', 'module-unavailable', 'unknown']).optional(),
    adminConfigurable: z.boolean(),
    isInherited: z.boolean(),
    isLocalOverride: z.boolean(),
    updatedAt: z.string().nullable(),
    missingCustomFieldsetIds: z.array(z.string()),
  })),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.interactions.view'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse({ organizationId: url.searchParams.get('organizationId') ?? undefined })
    const context = await resolveDictionaryRouteContext(req, { selectedId: query.organizationId })
    if (!context.organizationId) {
      return NextResponse.json({ error: context.translate('customers.errors.organization_required', 'Organization context is required') }, { status: 400 })
    }
    const organizationId = context.organizationId
    const scopeIds = Array.from(new Set([organizationId, ...context.readableOrganizationIds]))
    const cacheKey = `customers:activity-types:${context.tenantId}:org=${organizationId}:scope=${scopeIds.join('|')}`
    const cached = await context.cache?.get(cacheKey)
    if (cached) return NextResponse.json(cached)

    let catalog
    try {
      catalog = await resolveScopedCalendarEventTypes({
        em: context.em,
        tenantId: context.tenantId,
        organizationId,
        readableOrganizationIds: scopeIds,
      })
    } catch (err) {
      logger.error('customers.activity_types.resolve failed', {
        err,
        tenantId: context.tenantId,
        organizationId,
      })
      reportActivityTypeError(err, 'customers.activity_type_catalog_resolution_failed', {
        tenantId: context.tenantId,
        organizationId,
      })
      catalog = resolveBaselineCalendarEventTypes()
    }
    if (context.cache) {
      await context.cache.set(cacheKey, catalog, {
        ttl: DICTIONARY_CACHE_TTL_MS,
        tags: createDictionaryCacheTags({
          tenantId: context.tenantId,
          mappedKind: 'activity_type',
          organizationIds: scopeIds,
        }),
      }).catch((err) => {
        logger.warn('customers.activity_types cache write failed', { err })
        reportActivityTypeError(err, 'customers.activity_type_catalog_cache_write_failed', {
          tenantId: context.tenantId,
          organizationId,
        })
      })
    }
    return NextResponse.json(catalog)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customers.activity_types request failed', { err })
    reportActivityTypeError(err, 'customers.activity_type_catalog_request_failed')
    const { translate } = await resolveTranslations()
    return NextResponse.json({
      error: translate('customers.calendar.activityTypes.errors.loadFailed', 'Failed to load activity types'),
    }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Effective calendar activity types',
  methods: {
    GET: {
      summary: 'List effective calendar activity types',
      description: 'Returns the tenant and organization scoped calendar activity-type catalog.',
      responses: [{ status: 200, description: 'Effective activity-type catalog', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Organization scope is required', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
