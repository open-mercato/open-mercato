import {
  ACCESS_CHANGE_KINDS,
  ACCESS_DECISIONS,
  ACCESS_REASONS,
  ACCESS_SOURCES,
  type AccessChangeKind,
  type AccessChangeView,
  type AccessDecision,
  type AccessDetailView,
  type AccessExplanationView,
  type AccessReason,
  type AccessRequirementView,
  type AccessRoleView,
  type AccessSource,
  type AccessSummaryView,
} from './types'

const CONFIDENCES = ['proven', 'inferred', 'unknown'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isOneOf<TValue extends string>(values: readonly TValue[], value: unknown): value is TValue {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function normalizeRole(value: unknown): AccessRoleView | null {
  if (!isRecord(value)) return null
  const id = readText(value.id)
  if (!id) return null
  return { id, name: readText(value.name), appliesToOrganization: value.appliesToOrganization !== false }
}

function normalizeChange(value: unknown): AccessChangeView | null {
  if (!isRecord(value)) return null
  const logId = readText(value.logId)
  const at = readText(value.at)
  if (!logId || !at || !isOneOf<AccessChangeKind>(ACCESS_CHANGE_KINDS, value.kind)) return null
  return { logId, at, kind: value.kind, actionLabel: readText(value.actionLabel) }
}

function normalizeList<TValue>(value: unknown, normalize: (entry: unknown) => TValue | null): TValue[] {
  if (!Array.isArray(value)) return []
  return value.map(normalize).filter((entry): entry is TValue => entry !== null)
}

function normalizeDetail(value: unknown): AccessDetailView | null {
  if (!isRecord(value)) return null
  return {
    source: isOneOf<AccessSource>(ACCESS_SOURCES, value.source) ? value.source : null,
    organizationAllowed: typeof value.organizationAllowed === 'boolean' ? value.organizationAllowed : null,
    roles: normalizeList(value.roles, normalizeRole),
    grantingRoles: normalizeList(value.rolesThatWouldGrant, normalizeRole),
    recentChanges: Array.isArray(value.recentChanges) ? normalizeList(value.recentChanges, normalizeChange) : null,
  }
}

function normalizeRequirement(value: unknown): AccessRequirementView | null {
  if (!isRecord(value)) return null
  const feature = readText(value.feature)
  if (!feature) return null
  return { feature, granted: value.granted === true }
}

function normalizeSummary(value: unknown): AccessSummaryView | null {
  if (!isRecord(value)) return null
  const key = readText(value.key)
  if (!key) return null
  const params: AccessSummaryView['params'] = {}
  if (isRecord(value.params)) {
    for (const [name, param] of Object.entries(value.params)) {
      if (param === null || typeof param === 'string' || typeof param === 'number' || typeof param === 'boolean') {
        params[name] = param
      }
    }
  }
  return { key, params }
}

export function normalizeAccessExplanation(body: unknown): AccessExplanationView | null {
  if (!isRecord(body) || !isOneOf<AccessDecision>(ACCESS_DECISIONS, body.decision)) return null
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.filter((reason): reason is AccessReason => isOneOf<AccessReason>(ACCESS_REASONS, reason))
    : []
  return {
    decision: body.decision,
    required: normalizeList(body.required, normalizeRequirement),
    reasons: Array.from(new Set(reasons)),
    summary: normalizeSummary(body.summary),
    detail: normalizeDetail(body.detail),
    confidence: isOneOf(CONFIDENCES, body.confidence) ? body.confidence : 'unknown',
  }
}
