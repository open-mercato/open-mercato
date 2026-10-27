import {
  agentReferenceResolverDiKey,
  type AgentReferenceResolver,
  type ReferenceLookup,
  type ReferenceResolution,
  type ReferenceResolverScope,
} from '@open-mercato/shared/lib/ai/referenceResolver'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { GuardrailCheck, ReferenceExistsRule } from '../../../../data/validators'
import { formatIntegrityPath, parseIntegrityPath, readAll, removeAllAt } from '../paths'
import {
  MAX_EVIDENCE_VIOLATIONS,
  type IntegrityRuleContext,
  type IntegrityRuleOutcome,
  type IntegrityViolation,
} from '../types'

const logger = createLogger('agent_orchestrator').child({ component: 'integrity-reference-exists' })

export type ReferenceExistsViolationReason = 'id_missing' | 'version_missing' | 'not_found' | 'version_mismatch'
export type ReferenceResolverUnavailableReason = 'resolver_missing' | 'resolver_error' | 'scope_missing'

type CollectedReference = { itemPath: string; lookup: ReferenceLookup }

type ResolverOutcome =
  | { kind: 'resolved'; resolutions: Map<string, ReferenceResolution> }
  | { kind: 'unavailable'; reason: ReferenceResolverUnavailableReason }

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readFirst(value: unknown, path: string): unknown {
  return readAll(value, path)[0]?.value
}

function lookupKeyOf(lookup: ReferenceLookup): string {
  return JSON.stringify([lookup.id, lookup.version ?? null])
}

function splitVersioned(raw: string, separator: string): { id: string; version: string | null } {
  const separatorIndex = raw.lastIndexOf(separator)
  if (separatorIndex <= 0 || separatorIndex + separator.length >= raw.length) return { id: raw, version: null }
  return { id: raw.slice(0, separatorIndex), version: raw.slice(separatorIndex + separator.length) }
}

type ExpectedVersion = { ok: true; version: string | null } | { ok: false }

function pinnedVersion(ctx: IntegrityRuleContext, rule: ReferenceExistsRule, item: unknown): ExpectedVersion | null {
  if (!rule.version) return null
  if ('const' in rule.version) return { ok: true, version: rule.version.const }
  const pinned = 'input' in rule.version ? readFirst(ctx.input, rule.version.input) : readFirst(item, rule.version.path)
  const version = nonEmptyString(pinned)
  return version ? { ok: true, version } : { ok: false }
}

function collectReference(
  ctx: IntegrityRuleContext,
  rule: ReferenceExistsRule,
  item: unknown,
): { lookup: ReferenceLookup } | { reason: ReferenceExistsViolationReason } {
  const pinned = pinnedVersion(ctx, rule, item)
  if (pinned && !pinned.ok) return { reason: 'version_missing' }
  if (typeof item === 'string') {
    if (item.length === 0) return { reason: 'id_missing' }
    if (pinned) return { lookup: { id: item, version: pinned.version } }
    return { lookup: splitVersioned(item, rule.versionSeparator) }
  }
  const id = nonEmptyString(readFirst(item, rule.idPath ?? 'id'))
  if (!id) return { reason: 'id_missing' }
  if (pinned) return { lookup: { id, version: pinned.version } }
  const claimed = rule.versionPath ? nonEmptyString(readFirst(item, rule.versionPath)) : null
  return { lookup: { id, version: claimed } }
}

function resolveScope(ctx: IntegrityRuleContext): ReferenceResolverScope | null {
  if (!ctx.scope?.tenantId || !ctx.scope.organizationId) return null
  return { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId }
}

function isReferenceResolver(value: unknown): value is AgentReferenceResolver {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { resolve?: unknown }).resolve === 'function'
  )
}

function lookupResolver(ctx: IntegrityRuleContext, rule: ReferenceExistsRule): AgentReferenceResolver | null {
  if (!ctx.container) return null
  try {
    const resolved: unknown = ctx.container.resolve(agentReferenceResolverDiKey(rule.resolver))
    return isReferenceResolver(resolved) ? resolved : null
  } catch {
    return null
  }
}

async function resolveReferences(
  ctx: IntegrityRuleContext,
  rule: ReferenceExistsRule,
  lookups: ReferenceLookup[],
): Promise<ResolverOutcome> {
  const scope = resolveScope(ctx)
  if (!scope) return { kind: 'unavailable', reason: 'scope_missing' }
  const resolver = lookupResolver(ctx, rule)
  if (!resolver) return { kind: 'unavailable', reason: 'resolver_missing' }
  try {
    const resolutions = await resolver.resolve(lookups, scope)
    if (!(resolutions instanceof Map)) throw new Error('[internal] reference resolver must return a Map')
    return { kind: 'resolved', resolutions }
  } catch (error) {
    logger.warn('reference resolver failed', {
      ruleId: rule.id,
      resolver: rule.resolver,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.integrity_resolver_failed',
      attributes: { ruleId: rule.id, resolver: rule.resolver },
    })
    return { kind: 'unavailable', reason: 'resolver_error' }
  }
}

function judge(lookup: ReferenceLookup, resolution: ReferenceResolution | undefined): ReferenceExistsViolationReason | null {
  if (!resolution || resolution.status === 'not_found') return 'not_found'
  const expected = lookup.version ?? null
  const current = resolution.status === 'exists' ? resolution.version ?? null : resolution.currentVersion ?? null
  if (expected !== null && current !== null) return expected === current ? null : 'version_mismatch'
  return resolution.status === 'version_mismatch' ? 'version_mismatch' : null
}

function dropTarget(concretePath: string): string | null {
  const segments = parseIntegrityPath(concretePath)
  let lastIndex = segments.length - 1
  while (lastIndex >= 0 && segments[lastIndex].type !== 'index') lastIndex -= 1
  return lastIndex >= 0 ? formatIntegrityPath(segments.slice(0, lastIndex + 1)) : null
}

/**
 * The `reference_exists` rule: every id at `ids` must resolve, at the pinned
 * version when one is declared, through the DI-registered
 * `agentReferenceResolver:<resolver>`. All references go to the resolver in ONE
 * batched call. The resolver's map is keyed by id, so when one batch asks for
 * the same id at several versions the reported (current) version decides each
 * item. A missing or failing resolver (or a run without an organization
 * scope) leaves the references unverified and applies `onResolverMissing` —
 * `block` by default, fail closed. `drop` removes the nearest enclosing array
 * item. Evidence is redacted: item paths and reason codes only, never id values.
 */
export async function evaluateReferenceExists(
  ctx: IntegrityRuleContext,
  rule: ReferenceExistsRule,
): Promise<IntegrityRuleOutcome> {
  const items = readAll(ctx.output, rule.ids)
  const violations: IntegrityViolation[] = []
  const references: CollectedReference[] = []
  const uniqueLookups = new Map<string, ReferenceLookup>()

  for (const { value: item, concretePath } of items) {
    const collected = collectReference(ctx, rule, item)
    if ('reason' in collected) {
      violations.push({ itemPath: concretePath, reason: collected.reason })
      continue
    }
    const lookupKey = lookupKeyOf(collected.lookup)
    references.push({ itemPath: concretePath, lookup: collected.lookup })
    if (!uniqueLookups.has(lookupKey)) uniqueLookups.set(lookupKey, collected.lookup)
  }

  let unavailable: ReferenceResolverUnavailableReason | null = null
  if (uniqueLookups.size > 0) {
    const outcome = await resolveReferences(ctx, rule, Array.from(uniqueLookups.values()))
    if (outcome.kind === 'unavailable') {
      unavailable = outcome.reason
    } else {
      for (const reference of references) {
        const reason = judge(reference.lookup, outcome.resolutions.get(reference.lookup.id))
        if (reason) violations.push({ itemPath: reference.itemPath, reason })
      }
    }
  }

  const blockedByResolver = unavailable !== null && rule.onResolverMissing === 'block'
  const blocked = blockedByResolver || (violations.length > 0 && rule.onViolation === 'block')
  const dropPaths = rule.onViolation === 'drop' && !blocked
    ? violations.flatMap((violation) => {
        const target = dropTarget(violation.itemPath)
        return target ? [target] : []
      })
    : []
  const droppedViolations = dropPaths.length
  const output = dropPaths.length > 0 ? removeAllAt(ctx.output, dropPaths) : ctx.output
  const holdsAutoApproval = !blocked && (violations.length > droppedViolations || unavailable !== null)
  const result: GuardrailCheck['result'] = blocked
    ? 'block'
    : violations.length > 0 || unavailable !== null
      ? 'warn'
      : 'pass'
  const check: GuardrailCheck = {
    kind: 'reference_exists',
    result,
    guardrailSetVersion: ctx.guardrailSetVersion,
    evidence: {
      ruleId: rule.id,
      items: items.length,
      violations: violations.slice(0, MAX_EVIDENCE_VIOLATIONS),
      dropped: droppedViolations,
      repaired: 0,
      ambiguous: 0,
      ...(unavailable ? { detail: unavailable } : {}),
      ...(holdsAutoApproval ? { holdsAutoApproval: true } : {}),
    },
  }
  if (blocked) return { output: ctx.output, check, changed: false, blocked: true }
  return { output, check, changed: output !== ctx.output, blocked: false }
}
