import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AgentGuardrailSet } from '../../../data/entities'
import { integritySetBodySchema, type IntegrityRule, type IntegritySetBody } from '../../../data/validators'

const logger = createLogger('agent_orchestrator').child({ component: 'integrity-sets' })

export const AGENT_INTEGRITY_ENV = 'OM_AGENT_INTEGRITY'

export type IntegritySetSource = { id: string; integrity?: IntegrityRule[] }

export type ResolvedIntegritySet = { body: IntegritySetBody; version: string }

type SyncScope = { tenantId: string; organizationId: string }

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .filter((key) => record[key] !== undefined)
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = canonicalize(record[key])
        return sorted
      }, {})
  }
  return value
}

/**
 * Canonical-JSON content hash of an integrity set body: object keys are sorted at
 * every depth (rule order is kept — it is the pipeline order), so the version is
 * stable across declaration key order. Mirrors the grounding `g1-` scheme.
 */
export function integritySetVersionFor(body: IntegritySetBody): string {
  const canonical = JSON.stringify(canonicalize(body))
  return `i1-${createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`
}

export function integritySetBodyFor(entry: IntegritySetSource & { integrity: IntegrityRule[] }): IntegritySetBody {
  return integritySetBodySchema.parse({
    kind: 'integrity',
    capability: entry.id,
    rules: entry.integrity,
    untrustedInputs: [],
  })
}

const resolvedCache = new WeakMap<IntegrityRule[], ResolvedIntegritySet>()

/**
 * The integrity set of an agent registry entry, or null when it declares no
 * rules. Pure and cached per declared rule list, so the hash is computed once.
 */
export function resolveIntegritySet(entry: IntegritySetSource): ResolvedIntegritySet | null {
  const rules = entry.integrity
  if (!rules || rules.length === 0) return null
  const cached = resolvedCache.get(rules)
  if (cached && cached.body.capability === entry.id) return cached
  const body = integritySetBodyFor({ id: entry.id, integrity: rules })
  const resolved = { body, version: integritySetVersionFor(body) }
  resolvedCache.set(rules, resolved)
  return resolved
}

async function ensureRow(em: EntityManager, scope: SyncScope, resolved: ResolvedIntegritySet): Promise<boolean> {
  const existing = await em.findOne(AgentGuardrailSet, {
    organizationId: scope.organizationId,
    capability: resolved.body.capability,
    version: resolved.version,
  })
  if (existing) return false
  em.persist(
    em.create(AgentGuardrailSet, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      capability: resolved.body.capability,
      version: resolved.version,
      body: resolved.body,
    }),
  )
  return true
}

/**
 * Sync the integrity sets of the given agents into `agent_guardrail_sets`,
 * append-only per `(organizationId, capability, version)`: an unchanged rule set
 * is a no-op, a changed one appends a new version. Returns the rows written.
 */
export async function syncIntegritySets(
  em: EntityManager,
  scope: SyncScope,
  entries: readonly IntegritySetSource[],
): Promise<number> {
  let written = 0
  for (const entry of entries) {
    const resolved = resolveIntegritySet(entry)
    if (!resolved) continue
    if (await ensureRow(em, scope, resolved)) written += 1
  }
  if (written > 0) await em.flush()
  return written
}

/**
 * Integrity is enforced unless `OM_AGENT_INTEGRITY=off`. Off is shadow mode:
 * rules are evaluated and their checks recorded, but nothing is dropped,
 * repaired or blocked.
 */
export function isAgentIntegrityEnforced(): boolean {
  return (process.env[AGENT_INTEGRITY_ENV] ?? 'on').trim().toLowerCase() !== 'off'
}

let bootWarningEmitted = false

export function warnIfAgentIntegrityShadowMode(): void {
  if (bootWarningEmitted || isAgentIntegrityEnforced()) return
  bootWarningEmitted = true
  logger.warn('agent output integrity runs in shadow mode; rule checks are recorded but never drop, repair or block', {
    env: AGENT_INTEGRITY_ENV,
  })
}
