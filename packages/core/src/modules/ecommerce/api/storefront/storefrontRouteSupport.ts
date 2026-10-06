import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isStorefrontResolutionError } from '../../lib/storeContext'
import { isStorefrontQueryError, type StorefrontQueryError } from '../../lib/storefrontQuery'
import type { StoreContext } from '../../lib/types'

export const STOREFRONT_VARY_HEADER = 'Cookie, Authorization, X-Locale, Accept-Language'
export const STOREFRONT_PRIVATE_CACHE_CONTROL = 'private, no-store'
export const STOREFRONT_ERROR_CACHE_CONTROL = 'no-store'

export const storefrontErrorSchema = z.object({ error: z.string() })

export const storefrontInvalidQueryErrorSchema = z.object({
  error: z.literal('invalid_query'),
  fields: z.record(z.string(), z.string()),
})

const logger = createLogger('ecommerce').child({ component: 'storefront-route' })

export function storefrontErrorResponse(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': STOREFRONT_ERROR_CACHE_CONTROL, Vary: STOREFRONT_VARY_HEADER },
  })
}

export function storefrontInvalidQueryResponse(error: StorefrontQueryError): NextResponse {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    if (!(issue.parameter in fields)) fields[issue.parameter] = issue.message
  }
  return storefrontErrorResponse(400, { error: 'invalid_query', fields })
}

/**
 * Authenticated responses are never stored by a browser or CDN (`private, no-store`); anonymous
 * ones may be, for the given policy. The server-side cache applies to both, keyed on the digest.
 */
export function storefrontSuccessHeaders(context: StoreContext, anonymousCacheControl: string): Record<string, string> {
  return {
    'Cache-Control': context.buyer.isAuthenticated ? STOREFRONT_PRIVATE_CACHE_CONTROL : anonymousCacheControl,
    Vary: STOREFRONT_VARY_HEADER,
  }
}

export type StorefrontRouteFailure = { message: string; code: string }

/** Query grammar → 400, store resolution → its status with `{ error: code }`, anything else → reported 500. */
export function storefrontRouteErrorResponse(error: unknown, failure: StorefrontRouteFailure): NextResponse {
  if (isStorefrontQueryError(error)) return storefrontInvalidQueryResponse(error)
  if (isStorefrontResolutionError(error)) return storefrontErrorResponse(error.status, { error: error.code })
  logger.error(failure.message, { err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'ecommerce', code: failure.code })
  return storefrontErrorResponse(500, { error: 'internal_error' })
}
