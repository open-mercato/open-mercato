import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RateLimitResult } from '@open-mercato/shared/lib/ratelimit/types'

export function declaredStatuses(doc: OpenApiRouteDoc): number[] {
  const method = doc.methods?.GET
  return [...(method?.responses ?? []), ...(method?.errors ?? [])].map((entry) => entry.status)
}

export async function expectMatchesOpenApi(doc: OpenApiRouteDoc, response: Response): Promise<void> {
  const method = doc.methods?.GET
  const declared = [...(method?.responses ?? []), ...(method?.errors ?? [])].find((entry) => entry.status === response.status)
  if (!declared) throw new Error(`[internal] status ${response.status} is not documented in the route's openApi`)
  if (!declared.schema) throw new Error(`[internal] status ${response.status} has no response schema in the route's openApi`)
  const parsed = declared.schema.safeParse(await response.clone().json())
  if (!parsed.success) {
    throw new Error(`[internal] ${response.status} body does not match its documented schema: ${JSON.stringify(parsed.error.issues)}`)
  }
}

export type LimiterStub = {
  trustProxyDepth: number
  consume: jest.Mock<Promise<RateLimitResult>, [string, unknown]>
}

export function createAllowingLimiter(): LimiterStub {
  return {
    trustProxyDepth: 1,
    consume: jest.fn(async () => ({ allowed: true, remainingPoints: 10, msBeforeNext: 60000, consumedPoints: 1 })),
  }
}

export function createExhaustedLimiter(): LimiterStub {
  return {
    trustProxyDepth: 1,
    consume: jest.fn(async () => ({ allowed: false, remainingPoints: 0, msBeforeNext: 30000, consumedPoints: 121 })),
  }
}

export const CLIENT_IP = '203.0.113.7'

export function withClientIp(req: Request, ip: string = CLIENT_IP): Request {
  const headers = new Headers(req.headers)
  headers.set('x-forwarded-for', ip)
  return new Request(req.url, { headers })
}
