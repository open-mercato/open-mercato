import type { CauseKind } from '@open-mercato/shared/lib/causation/types'
import type {
  ExplainCauseDetail,
  ExplainLoadContext,
  ExplainReferenceDetail,
} from '@open-mercato/shared/modules/insights/explain'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getExplainCauseResolver, getExplainReferenceResolver } from './explain-registry'
import { isOrganizationInScope, type ExplainFeatureChecker } from './viewer'

const logger = createLogger('insights').child({ component: 'explain-causes' })

export const PRINCIPAL_CAUSE_KINDS: ReadonlySet<CauseKind> = new Set<CauseKind>(['user', 'agent'])
export const LOG_CAUSE_KINDS: ReadonlySet<CauseKind> = new Set<CauseKind>(['undo', 'redo'])
export const CODE_IDENTIFIER_CAUSE_KINDS: ReadonlySet<CauseKind> = new Set<CauseKind>(['subscriber', 'system', 'ai_tool', 'unknown'])

export type CauseReference = {
  kind: CauseKind
  id: string | null
}

export type CauseDetailIndex = {
  registeredKinds: ReadonlySet<CauseKind>
  get: (kind: CauseKind, id: string | null) => ExplainCauseDetail | null
}

function detailKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`
}

export type ExplainDetailScope = {
  viewerOrganizationIds: string[] | null
  recordOrganizationId: string | null
}

/**
 * Decides whether a resolved detail may be shown next to a record. Feature checks are
 * evaluated at the record's organization, so an organization-bound detail must belong to
 * that organization (or, for a tenant-level record, to the viewer's scope). A tenant-level
 * detail (no organization) is shown only to a tenant-wide viewer or on a tenant-level
 * record, unless it names code (`codeIdentifier`, e.g. an AI tool or subscriber id), which
 * is not tenant data.
 */
export function isExplainDetailInScope(
  detailOrganizationId: string | null | undefined,
  scope: ExplainDetailScope,
  options: { codeIdentifier?: boolean } = {},
): boolean {
  if (detailOrganizationId === null || detailOrganizationId === undefined) {
    return options.codeIdentifier === true
      || scope.viewerOrganizationIds === null
      || scope.recordOrganizationId === null
  }
  if (scope.recordOrganizationId !== null) return detailOrganizationId === scope.recordOrganizationId
  return isOrganizationInScope(detailOrganizationId, scope.viewerOrganizationIds)
}

function reportResolverFailure(error: unknown, kind: string, code: string): void {
  logger.error('[internal] Explain resolver failed', { kind, err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'insights', code, attributes: { kind } })
}

/**
 * Resolves cause details with one resolver call per cause kind. A detail is kept only
 * when the resolver's features pass for the viewer (at the record's organization) and
 * the detail passes `isExplainDetailInScope`. Callers pass a load context scoped to the
 * record's organization, so resolvers only query data the checked features cover.
 */
export async function resolveCauseDetails(params: {
  references: readonly CauseReference[]
  checker: ExplainFeatureChecker
  loadContext: ExplainLoadContext
  detailScope: ExplainDetailScope
}): Promise<CauseDetailIndex> {
  const idsByKind = new Map<CauseKind, Set<string>>()
  const registeredKinds = new Set<CauseKind>()
  for (const reference of params.references) {
    if (PRINCIPAL_CAUSE_KINDS.has(reference.kind) || LOG_CAUSE_KINDS.has(reference.kind)) continue
    if (!getExplainCauseResolver(reference.kind)) continue
    registeredKinds.add(reference.kind)
    if (!reference.id) continue
    const ids = idsByKind.get(reference.kind) ?? new Set<string>()
    ids.add(reference.id)
    idsByKind.set(reference.kind, ids)
  }
  const details = new Map<string, ExplainCauseDetail>()
  await Promise.all(Array.from(idsByKind.entries()).map(async ([kind, ids]) => {
    const registered = getExplainCauseResolver(kind)
    if (!registered) return
    if (!(await params.checker.has(registered.resolver.requiredFeatures))) return
    let resolved: ExplainCauseDetail[] = []
    try {
      resolved = await registered.resolver.resolve(params.loadContext, Array.from(ids))
    } catch (error) {
      reportResolverFailure(error, kind, 'insights.cause_resolver_failed')
      return
    }
    for (const detail of Array.isArray(resolved) ? resolved : []) {
      if (!detail || typeof detail.id !== 'string' || !ids.has(detail.id)) continue
      const codeIdentifier = CODE_IDENTIFIER_CAUSE_KINDS.has(kind)
      if (!isExplainDetailInScope(detail.organizationId, params.detailScope, { codeIdentifier })) continue
      details.set(detailKey(kind, detail.id), detail)
    }
  }))
  return {
    registeredKinds,
    get: (kind, id) => (id ? details.get(detailKey(kind, id)) ?? null : null),
  }
}

export type ReferenceDetailIndex = {
  get: (value: unknown) => ExplainReferenceDetail | null
}

export function referenceValueKey(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export const EMPTY_REFERENCE_INDEX: ReferenceDetailIndex = { get: () => null }

/**
 * Resolves display labels for reference/dictionary values with a single resolver call,
 * gated by the resolver's features and the viewer's organization scope.
 */
export async function resolveReferenceDetails(params: {
  kind: string | null
  values: readonly unknown[]
  checker: ExplainFeatureChecker
  loadContext: ExplainLoadContext
  detailScope: ExplainDetailScope
}): Promise<ReferenceDetailIndex> {
  if (!params.kind) return EMPTY_REFERENCE_INDEX
  const registered = getExplainReferenceResolver(params.kind)
  if (!registered) return EMPTY_REFERENCE_INDEX
  const ids = Array.from(new Set(params.values.map(referenceValueKey).filter((value): value is string => value !== null)))
  if (ids.length === 0) return EMPTY_REFERENCE_INDEX
  if (!(await params.checker.has(registered.resolver.requiredFeatures))) return EMPTY_REFERENCE_INDEX
  let resolved: ExplainReferenceDetail[] = []
  try {
    resolved = await registered.resolver.resolve(params.loadContext, ids)
  } catch (error) {
    reportResolverFailure(error, params.kind, 'insights.reference_resolver_failed')
    return EMPTY_REFERENCE_INDEX
  }
  const requested = new Set(ids)
  const details = new Map<string, ExplainReferenceDetail>()
  for (const detail of Array.isArray(resolved) ? resolved : []) {
    if (!detail || typeof detail.id !== 'string' || !requested.has(detail.id)) continue
    if (!isExplainDetailInScope(detail.organizationId, params.detailScope)) continue
    details.set(detail.id, detail)
  }
  return {
    get: (value) => {
      const key = referenceValueKey(value)
      return key ? details.get(key) ?? null : null
    },
  }
}

export async function resolveReferenceKindDetails(params: {
  kind: string
  ids: readonly string[]
  checker: ExplainFeatureChecker
  loadContext: ExplainLoadContext
  detailScope: ExplainDetailScope
}): Promise<ExplainReferenceDetail[]> {
  const index = await resolveReferenceDetails({
    kind: params.kind,
    values: params.ids,
    checker: params.checker,
    loadContext: params.loadContext,
    detailScope: params.detailScope,
  })
  return params.ids
    .map((id) => index.get(id))
    .filter((detail): detail is ExplainReferenceDetail => detail !== null)
}
