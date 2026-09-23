import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentGuardrailSet } from '../../data/entities'
import { listGroundingSets, guardrailSetVersionFor } from './groundingSets'

/**
 * Sync the code-first grounding guardrail SETS into `agent_guardrail_sets`,
 * CONTENT-HASH idempotent (Wave 3, Phase 4). For each declared set, the row is
 * keyed by `(organizationId, capability, version)` where `version` is the body's
 * content hash:
 *   - re-syncing an UNCHANGED body finds the existing `(org, capability, version)`
 *     row and is a no-op (no new version);
 *   - EDITING a body changes its content hash → a new `version` → a new append-only
 *     row (the prior version is retained for replay/audit).
 *
 * Mirrors the `business_rules` rule-pack sync (version + content-hash, idempotent
 * upsert) and the eval-assertion seed pattern (per-(tenant, org) rows). Returns the
 * number of NEW rows written (0 on an idempotent re-sync).
 */
export async function syncGroundingSets(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<number> {
  let written = 0
  for (const body of listGroundingSets()) {
    const version = guardrailSetVersionFor(body)
    const existing = await em.findOne(AgentGuardrailSet, {
      organizationId: scope.organizationId,
      capability: body.capability,
      version,
    })
    if (existing) continue
    em.persist(
      em.create(AgentGuardrailSet, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        capability: body.capability,
        version,
        body,
      }),
    )
    written += 1
  }
  if (written > 0) await em.flush()
  return written
}

/**
 * Resolve the CURRENT (latest-synced) grounding set for a capability under a scope:
 * the row whose `version` matches the code-declared set's content hash. Returns
 * null when the capability is not factual / not synced — the runtime then runs no
 * grounding gate for it.
 */
export async function resolveCurrentGroundingSet(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  capability: string,
): Promise<{ version: string; body: AgentGuardrailSet['body'] } | null> {
  const declared = listGroundingSets().find((set) => set.capability === capability)
  if (!declared || !declared.factual) return null
  const version = guardrailSetVersionFor(declared)
  const row = await em.findOne(AgentGuardrailSet, {
    organizationId: scope.organizationId,
    capability,
    version,
  })
  if (!row) return null
  return { version: row.version, body: row.body }
}
