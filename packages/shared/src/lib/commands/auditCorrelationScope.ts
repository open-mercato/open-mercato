import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Keyed off globalThis so duplicated bundle chunks of this module share one
 * AsyncLocalStorage; otherwise a scope entered through one copy would be
 * invisible to the command bus reading another (same fix as the cache tenant
 * context).
 */
const AUDIT_CORRELATION_STORAGE_KEY = Symbol.for('@open-mercato/shared/commands/audit-correlation')

type AuditCorrelation = Readonly<Record<string, string>>

type GlobalWithAuditCorrelationStorage = typeof globalThis & {
  [AUDIT_CORRELATION_STORAGE_KEY]?: AsyncLocalStorage<AuditCorrelation>
}

function resolveAuditCorrelationStorage(): AsyncLocalStorage<AuditCorrelation> {
  const scope = globalThis as GlobalWithAuditCorrelationStorage
  if (!scope[AUDIT_CORRELATION_STORAGE_KEY]) {
    scope[AUDIT_CORRELATION_STORAGE_KEY] = new AsyncLocalStorage<AuditCorrelation>()
  }
  return scope[AUDIT_CORRELATION_STORAGE_KEY]
}

const auditCorrelationStorage = resolveAuditCorrelationStorage()

function sanitizeCorrelation(correlation: Record<string, unknown> | null | undefined): Record<string, string> {
  const sanitized: Record<string, string> = {}
  if (!correlation || typeof correlation !== 'object' || Array.isArray(correlation)) return sanitized
  for (const [key, value] of Object.entries(correlation)) {
    if (typeof value === 'string' && value.length > 0) sanitized[key] = value
  }
  return sanitized
}

/**
 * Runs `fn` with an ambient audit correlation that the command bus merges into
 * every action log written inside the async scope. Nested scopes merge, with
 * the inner scope winning for the same key. Explicit `ctx.auditCorrelation`
 * and existing log context keys always take precedence over the ambient value.
 */
export function withAuditCorrelation<T>(correlation: Record<string, string>, fn: () => T): T
export function withAuditCorrelation<T>(correlation: Record<string, string>, fn: () => Promise<T>): Promise<T>
export function withAuditCorrelation<T>(correlation: Record<string, string>, fn: () => T | Promise<T>): T | Promise<T> {
  const merged = { ...(auditCorrelationStorage.getStore() ?? {}), ...sanitizeCorrelation(correlation) }
  return auditCorrelationStorage.run(Object.freeze(merged), fn)
}

export function getAmbientAuditCorrelation(): Record<string, string> | null {
  const current = auditCorrelationStorage.getStore()
  if (!current || Object.keys(current).length === 0) return null
  return { ...current }
}
