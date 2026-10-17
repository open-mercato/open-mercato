import { isUuid } from '../../lib/causation/types'
import { createLogger } from '../../lib/logger'
import { getTelemetryRuntime } from '../../lib/telemetry/runtime'
import type { ExplainScope } from './explain'

export type ExplainOrganizationWhere = { organizationId?: { $in: string[] } }

export type ExplainNullableOrganizationWhere =
  | Record<string, never>
  | { $or: [{ organizationId: null }, { organizationId: { $in: string[] } }] }

export type ExplainDecryptionScope = {
  tenantId: string
  organizationId: string | null
}

function scopedOrganizationIds(scope: ExplainScope): string[] | null {
  if (scope.organizationIds === null) return null
  return Array.from(new Set(scope.organizationIds.filter((organizationId) => isUuid(organizationId))))
}

export function resolveExplainOrganizationWhere(scope: ExplainScope): ExplainOrganizationWhere | null {
  if (!isUuid(scope.tenantId)) return null
  const organizationIds = scopedOrganizationIds(scope)
  if (organizationIds === null) return {}
  if (organizationIds.length === 0) return null
  return { organizationId: { $in: organizationIds } }
}

export function resolveExplainNullableOrganizationWhere(scope: ExplainScope): ExplainNullableOrganizationWhere | null {
  if (!isUuid(scope.tenantId)) return null
  const organizationIds = scopedOrganizationIds(scope)
  if (organizationIds === null) return {}
  if (organizationIds.length === 0) return null
  return { $or: [{ organizationId: null }, { organizationId: { $in: organizationIds } }] }
}

export function resolveExplainDecryptionScope(scope: ExplainScope): ExplainDecryptionScope {
  const organizationIds = scopedOrganizationIds(scope)
  return {
    tenantId: scope.tenantId,
    organizationId: organizationIds && organizationIds.length === 1 ? organizationIds[0] : null,
  }
}

export function normalizeExplainIds(ids: readonly unknown[], options: { uuidOnly?: boolean } = {}): string[] {
  const normalized = new Set<string>()
  for (const candidate of ids) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (!trimmed) continue
    if (options.uuidOnly && !isUuid(trimmed)) continue
    normalized.add(trimmed)
  }
  return Array.from(normalized)
}

export function isExplainRecordId(value: unknown): value is string {
  return isUuid(value)
}

export type ExplainRecordIdListOptions = {
  limit: number
  afterId: string | null
}

export type ExplainRecordIdPage = {
  where: { id?: { $gt: string } }
  limit: number
}

export const EXPLAIN_RECORD_ID_PAGE_MAX = 1000

/**
 * Normalizes `listRecordIds` options into an id keyset (`id > afterId`, ascending) and a
 * bounded limit. Returns null for a malformed `afterId`, so a pager never restarts from
 * the beginning.
 */
export function resolveExplainRecordIdPage(options: ExplainRecordIdListOptions): ExplainRecordIdPage | null {
  const afterId = options.afterId ?? null
  if (afterId !== null && !isUuid(afterId)) return null
  const requested = Number.isFinite(options.limit) ? Math.trunc(options.limit) : 1
  return {
    where: afterId ? { id: { $gt: afterId.toLowerCase() } } : {},
    limit: Math.min(Math.max(requested, 1), EXPLAIN_RECORD_ID_PAGE_MAX),
  }
}

export const EXPLAIN_CUSTOM_FIELD_PREFIX = 'cf:'

function stripCustomFieldPrefix(rawKey: string): string {
  if (rawKey.startsWith('cf_') || rawKey.startsWith(EXPLAIN_CUSTOM_FIELD_PREFIX)) return rawKey.slice(3)
  return rawKey
}

export function flattenExplainCustomFields(values: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const flattened: Record<string, unknown> = {}
  if (!values) return flattened
  for (const [rawKey, value] of Object.entries(values)) {
    const key = stripCustomFieldPrefix(rawKey)
    if (!key) continue
    flattened[`${EXPLAIN_CUSTOM_FIELD_PREFIX}${key}`] = value
  }
  return flattened
}

export function toExplainTimestamp(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.trim()) return value
  return null
}

export type ExplainSafeResolveOptions = {
  module: string
  code: string
  kind: string
}

export async function runExplainResolverSafely<TDetail>(
  options: ExplainSafeResolveOptions,
  resolve: () => Promise<TDetail[]>,
): Promise<TDetail[]> {
  try {
    return await resolve()
  } catch (error) {
    createLogger(options.module)
      .child({ component: 'insights-explain' })
      .error('[internal] insights explain resolver failed', { kind: options.kind, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: options.module,
      code: options.code,
      attributes: { kind: options.kind },
    })
    return []
  }
}
