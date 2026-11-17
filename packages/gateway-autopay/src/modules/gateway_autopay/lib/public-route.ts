import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { GatewayTransaction } from '@open-mercato/core/modules/payment_gateways/data/entities'
import {
  LAUNCH_PAGE_CONTENT_SECURITY_POLICY,
  NO_STORE_HEADERS,
  renderMessagePage,
} from './launch'

const PROVIDER_KEY = 'autopay'
const MAX_CANDIDATES = 10

const publicRouteRateLimit = {
  points: 60,
  duration: 60,
  keyPrefix: 'gateway_autopay:public',
}

type Resolver = { resolve: (name: string) => unknown }

function tryResolve<T>(container: Resolver, name: string): T | null {
  try {
    return container.resolve(name) as T
  } catch {
    return null
  }
}

export async function limitPublicRequest(
  container: Resolver,
  req: Request,
  route: 'launch' | 'return',
): Promise<Response | null> {
  const rateLimiterService = tryResolve<RateLimiterService>(container, 'rateLimiterService')
  if (!rateLimiterService) return null
  return checkRateLimit(
    rateLimiterService,
    publicRouteRateLimit,
    `${route}:${getClientIp(req, rateLimiterService.trustProxyDepth) ?? 'unknown'}`,
    RATE_LIMIT_ERROR_FALLBACK,
  )
}

/**
 * The launch and return routes are unauthenticated, so tenant scope can only
 * come from the stored transaction the request resolves to — never from the
 * request itself. Callers must still prove possession of a secret (launch
 * token) or a valid signature (return hash) before acting on a candidate.
 */
export async function findAutopayCandidates(em: EntityManager, orderId: string): Promise<GatewayTransaction[]> {
  return findWithDecryption(
    em,
    GatewayTransaction,
    { providerKey: PROVIDER_KEY, providerSessionId: orderId, deletedAt: null },
    { limit: MAX_CANDIDATES, orderBy: { createdAt: 'desc' } },
  )
}

export function readTransactionMetadata(transaction: GatewayTransaction): Record<string, unknown> {
  const metadata = transaction.gatewayMetadata
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

export function htmlResponse(html: string, status: number, contentSecurityPolicy?: string): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...NO_STORE_HEADERS,
      ...(contentSecurityPolicy ? { 'Content-Security-Policy': contentSecurityPolicy } : {}),
    },
  })
}

export function messageResponse(copy: { title: string; message: string }, status: number): Response {
  return htmlResponse(renderMessagePage(copy), status, LAUNCH_PAGE_CONTENT_SECURITY_POLICY)
}

export function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...NO_STORE_HEADERS } })
}
