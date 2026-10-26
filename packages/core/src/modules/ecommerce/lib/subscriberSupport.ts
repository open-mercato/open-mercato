export type EcommerceSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  eventName?: string
  tenantId?: string | null
  organizationId?: string | null
}

export type EventScope = { tenantId: string | null; organizationId: string | null }

export function asPayloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}
}

export function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Trusted emitter scope first (events AGENTS.md), payload fields only as a fallback. */
export function readEventScope(payload: Record<string, unknown>, ctx: EcommerceSubscriberContext): EventScope {
  return {
    tenantId: ctx.tenantId ?? readPayloadString(payload, 'tenantId'),
    organizationId: ctx.organizationId ?? readPayloadString(payload, 'organizationId'),
  }
}

export function eventAction(eventName: string | undefined): string | null {
  if (!eventName) return null
  const segments = eventName.split('.')
  return segments.length > 0 ? segments[segments.length - 1] : null
}

export function tryResolveService<T>(ctx: Pick<EcommerceSubscriberContext, 'resolve'>, name: string): T | null {
  try {
    return ctx.resolve<T | null | undefined>(name) ?? null
  } catch {
    return null
  }
}
