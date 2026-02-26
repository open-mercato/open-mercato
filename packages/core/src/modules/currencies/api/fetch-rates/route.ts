import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/core'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { RateFetchingService } from '../../services/rateFetchingService'
import { CurrencyFetchConfig } from '../../data/entities'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.fetch.manage'],
}

export async function POST(req: NextRequest) {
  const container = await createRequestContainer()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId || !auth.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const em = container.resolve<EntityManager>('em')
    const fetchService = container.resolve<RateFetchingService>('rateFetchingService')

    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { date, providers } = body

    const fetchDate = date ? new Date(date) : new Date()

    const result = await fetchService.fetchRatesForDate(
      fetchDate,
      { tenantId: auth.tenantId, organizationId: auth.orgId },
      { providers }
    )

    // Update last sync info for each provider
    const providerSources = providers?.length
      ? providers
      : Object.keys(result.byProvider)

    // Fetch all configs at once to avoid N+1 queries
    const configFilter: Record<string, unknown> = {
      tenantId: auth.tenantId,
      provider: { $in: providerSources },
      organizationId: auth.orgId,
    }
    const allConfigs = await em.find(CurrencyFetchConfig, configFilter)
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

    // Flush all config updates at once
    await em.flush()

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json(
      {
        error: err.message,
        totalFetched: 0,
        byProvider: {},
        errors: [err.message],
      },
      { status: 500 }
    )
  } finally {
    await (container as any).dispose?.()
  }
}

const fetchRatesRequestSchema = z.object({
  date: z.string().datetime().optional(),
  providers: z.array(z.string()).optional(),
})

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
        { status: 500, description: 'Internal server error', schema: fetchRatesResponseSchema },
      ],
    },
  },
}
