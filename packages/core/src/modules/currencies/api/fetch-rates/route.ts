import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/core'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { RateFetchingService } from '../../services/rateFetchingService'
import { CurrencyFetchConfig } from '../../data/entities'

const logger = createLogger('currencies').child({ component: 'api/fetch-rates' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['currencies.fetch.manage'] },
}

const fetchRatesRequestSchema = z.object({
  date: z.string().datetime().optional(),
  providers: z.array(z.string().trim().min(1).max(50)).min(1).max(20)
    .refine((providers) => new Set(providers).size === providers.length, 'Providers must be unique')
    .optional(),
}).strict()
const fetchRatesGuardedRequestSchema = fetchRatesRequestSchema.strip()

type FetchRatesRequest = z.infer<typeof fetchRatesRequestSchema>

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = fetchRatesRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid fetch-rates request' }, { status: 400 })
  }

  const container = await createRequestContainer()
  try {
    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
        userId: auth.sub,
      },
      input: {
        resourceKind: 'currencies.fetch_rates',
        resourceId: null,
        operation: 'custom',
        mutationPayload: parsed.data,
      },
    })
    if (!guardResult.ok) {
      return guardResult.response
    }
    const guardedInput = guardResult.modifiedPayload
      ? fetchRatesGuardedRequestSchema.safeParse({ ...parsed.data, ...guardResult.modifiedPayload })
      : { success: true as const, data: parsed.data }
    if (!guardedInput.success) {
      return NextResponse.json({ error: 'Invalid fetch-rates request' }, { status: 400 })
    }
    const input: FetchRatesRequest = guardedInput.data
    const fetchDate = input.date ? new Date(input.date) : new Date()
    if (!Number.isFinite(fetchDate.getTime())) {
      return NextResponse.json({ error: 'Invalid fetch-rates request' }, { status: 400 })
    }

    const em = container.resolve<EntityManager>('em')
    const fetchService = container.resolve<RateFetchingService>('rateFetchingService')

    const result = await fetchService.fetchRatesForDate(
      fetchDate,
      { tenantId: auth.tenantId, organizationId: auth.orgId },
      input.providers ? { providers: input.providers } : {},
    )

    const providerSources = input.providers?.length
      ? input.providers
      : Object.keys(result.byProvider)

    const allConfigs = providerSources.length > 0 ? await em.find(CurrencyFetchConfig, {
      tenantId: auth.tenantId,
      provider: { $in: providerSources },
      organizationId: auth.orgId,
    }) : []
    const configMap = new Map(allConfigs.map((c) => [c.provider, c]))

    for (const providerSource of providerSources) {
      const config = configMap.get(providerSource)

      if (config) {
        const providerData = result.byProvider[providerSource]
        const providerErrors = providerData?.errors || []

        config.lastSyncAt = new Date()
        config.lastSyncCount = providerData?.count || 0
        config.lastSyncStatus =
          providerErrors.length > 0 ? 'error' : 'success'
        config.lastSyncMessage =
          providerErrors.length > 0
            ? providerErrors.join('; ')
            : `Successfully fetched ${config.lastSyncCount} rates`

        em.persist(config)
      }
    }

    await em.flush()
    await guardResult.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    logger.error('Fetch rates request failed', { err })
    return NextResponse.json(
      {
        error: 'Failed to fetch currency rates',
        totalFetched: 0,
        byProvider: {},
        errors: ['Failed to fetch currency rates'],
      },
      { status: 500 }
    )
  } finally {
    await (container as unknown as { dispose?: () => Promise<void> }).dispose?.()
  }
}

const fetchRatesResponseSchema = z.object({
  totalFetched: z.number(),
  byProvider: z.record(
    z.string(),
    z.object({
      count: z.number(),
      errors: z.array(z.string()).optional(),
    })
  ),
  errors: z.array(z.string()),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  summary: 'Fetch currency rates',
  description: 'Trigger on-demand fetching of currency exchange rates from configured providers.',
  methods: {
    POST: {
      operationId: 'fetchCurrencyRates',
      summary: 'Fetch currency rates',
      description: 'Fetches currency exchange rates from configured providers for a specific date.',
      requestBody: {
        schema: fetchRatesRequestSchema,
        contentType: 'application/json',
      },
      responses: [
        {
          status: 200,
          description: 'Currency rates fetched successfully',
          schema: fetchRatesResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Bad request', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 422, description: 'Blocked by a mutation guard', schema: errorSchema },
        { status: 500, description: 'Internal server error', schema: fetchRatesResponseSchema },
      ],
    },
  },
}
