import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import { runApiInterceptorsAfter, runApiInterceptorsBefore, type RunInterceptorsBeforeResult } from '@open-mercato/shared/lib/crud/interceptor-runner'
import { applyResponseEnrichers, applyResponseEnricherToRecord } from '@open-mercato/shared/lib/crud/enricher-runner'
import type { ApiInterceptorMethod, InterceptorRequest } from '@open-mercato/shared/lib/crud/api-interceptor'

export const integrationApiRoutePaths = {
  list: 'integrations',
  detail: 'integrations/detail',
  logs: 'integrations/logs',
} as const

type ReadRouteFieldConfig = {
  targetEntity: string
  recordKeys?: string[]
  listKeys?: string[]
}

type ReadRouteContext = {
  routePath: string
  request: Request
  auth: {
    tenantId: string | null
    orgId: string | null
    sub?: string | null
    features?: unknown
  }
  container: AwilixContainer
}

function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

function searchParamsToObject(url: URL): Record<string, string> {
  const entries: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    entries[key] = value
  })
  return entries
}

function toUserFeatures(features: unknown): string[] {
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

function mergeAdditiveRecord<T extends Record<string, unknown>>(base: T, candidate: T): T {
  const additions = Object.fromEntries(
    Object.entries(candidate).filter(([key]) => !(key in base)),
  ) as Partial<T>

  return {
    ...base,
    ...additions,
  }
}

function mergeAdditiveBody(
  baseBody: Record<string, unknown>,
  candidateBody: Record<string, unknown>,
): Record<string, unknown> {
  return mergeAdditiveRecord(baseBody, candidateBody)
}

function getEnricherContext(input: ReadRouteContext) {
  return {
    organizationId: input.auth.orgId as string,
    tenantId: input.auth.tenantId as string,
    userId: input.auth.sub ?? '',
    em: input.container.resolve('em') as EntityManager,
    container: input.container,
    userFeatures: toUserFeatures(input.auth.features),
  }
}

export async function runIntegrationsReadBeforeInterceptors(
  input: ReadRouteContext,
): Promise<RunInterceptorsBeforeResult> {
  const url = new URL(input.request.url)

  return runApiInterceptorsBefore({
    routePath: input.routePath,
    method: 'GET',
    request: {
      method: 'GET',
      url: input.request.url,
      headers: headersToObject(input.request.headers),
      query: searchParamsToObject(url),
    },
    context: getEnricherContext(input),
  })
}

async function applySafeRecordEnrichment(
  record: Record<string, unknown>,
  targetEntity: string,
  context: ReturnType<typeof getEnricherContext>,
): Promise<Record<string, unknown>> {
  const enriched = await applyResponseEnricherToRecord(record, targetEntity, context)
  return mergeAdditiveRecord(record, enriched.record)
}

async function applySafeListEnrichment(
  items: Record<string, unknown>[],
  targetEntity: string,
  context: ReturnType<typeof getEnricherContext>,
): Promise<Record<string, unknown>[]> {
  const enriched = await applyResponseEnrichers(items, targetEntity, context)
  return items.map((item, index) => {
    const enrichedItem = enriched.items[index]
    if (!enrichedItem) return item
    return mergeAdditiveRecord(item, enrichedItem)
  })
}

export async function finalizeIntegrationsReadResponse(
  input: ReadRouteContext & {
    interceptorRequest: InterceptorRequest
    body: Record<string, unknown>
    enrich?: ReadRouteFieldConfig
    method?: ApiInterceptorMethod
    beforeMetadata?: Record<string, Record<string, unknown> | undefined>
  },
): Promise<NextResponse> {
  const method = input.method ?? 'GET'
  const baseBody = input.body
  const context = getEnricherContext(input)

  const intercepted = await runApiInterceptorsAfter({
    routePath: input.routePath,
    method,
    request: input.interceptorRequest,
    response: {
      statusCode: 200,
      body: baseBody,
      headers: {},
    },
    context,
    metadataByInterceptor: input.beforeMetadata,
  })

  if (!intercepted.ok) {
    return NextResponse.json(intercepted.body, { status: intercepted.statusCode, headers: intercepted.headers })
  }

  let responseBody = mergeAdditiveBody(baseBody, intercepted.body)

  if (input.enrich) {
    const { targetEntity, recordKeys = [], listKeys = [] } = input.enrich

    for (const key of recordKeys) {
      const current = responseBody[key]
      if (!current || typeof current !== 'object' || Array.isArray(current)) continue
      responseBody = {
        ...responseBody,
        [key]: await applySafeRecordEnrichment(current as Record<string, unknown>, targetEntity, context),
      }
    }

    for (const key of listKeys) {
      const current = responseBody[key]
      if (!Array.isArray(current)) continue
      const records = current.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item),
      )
      if (records.length !== current.length) continue
      responseBody = {
        ...responseBody,
        [key]: await applySafeListEnrichment(records, targetEntity, context),
      }
    }
  }

  return NextResponse.json(responseBody, { headers: intercepted.headers })
}
