import type { CommandRuntimeContext } from './types'

const MAX_CORRELATION_ID_LENGTH = 200

function normalizeCorrelationId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.slice(0, MAX_CORRELATION_ID_LENGTH)
}

export function resolveCommandCorrelationId(ctx: CommandRuntimeContext): string | null {
  return normalizeCorrelationId(ctx.correlationId)
    ?? normalizeCorrelationId(ctx.request?.headers.get('x-request-id'))
}

export function mergeCommandCorrelationContext(
  context: unknown,
  ctx: CommandRuntimeContext,
): Record<string, unknown> | null {
  const correlationId = resolveCommandCorrelationId(ctx)
  const base = context && typeof context === 'object' && !Array.isArray(context)
    ? context as Record<string, unknown>
    : {}
  const existing = normalizeCorrelationId(base.correlationId)
  if (existing) return base
  if (!correlationId) return Object.keys(base).length > 0 ? base : null
  return { ...base, correlationId }
}
