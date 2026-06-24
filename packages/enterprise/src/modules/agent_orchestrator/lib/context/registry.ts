import type { ContextProvenance, ContextSourceKind } from '../../data/validators'

/**
 * Code-first typed `ContextModule` registry (context overlay, Phase 1).
 *
 * A `ContextModule` is an INTERNAL strategy interface selected by capability — NOT
 * a cross-module extension point (the registry lives in code/seed config per the
 * spec). Each module declares the least-privilege source allowlist a capability MAY
 * read, the mandatory-vs-optional tier of each source, and a provenance mapper that
 * stamps `{ factId, sourceKind, sourceRef, locator? }` on each fact as it enters the
 * candidate pool — so guardrails grounding and compliance lineage read the same
 * record.
 *
 * Phase 1 implements `entity` sources (structured records via `queryEngine`/
 * `query_index`) with a mandatory floor. `retrieval` (P2) and `document` (P3) tiers
 * are declared by the same interface and assembled by later phases — the resolver
 * leaves clean seams (`retrieve()` hook, packer interface) for them.
 */

/** A raw candidate record read from a source, before redaction/packing. */
export type ContextSourceHit = {
  /** The record's id (or retrieval hit id) — the stable ref for provenance. */
  ref: string
  /** Optional sub-location within the source (field path, page/region, snippet offset). */
  locator?: string
  /** Retrieval relevance score (optional fill only); undefined for mandatory reads. */
  score?: number
  /** The redacted record payload that becomes the agent-visible fact. */
  record: Record<string, unknown>
}

/**
 * One declared source within a `ContextModule`. `kind` selects the assembly
 * strategy; `tier` partitions determinism (mandatory floor is always routed,
 * optional fill packs the remaining budget); `entityType` is the `query_index`
 * id (`<module>:<entity>`) the capability is allowed to read; `provenance` maps a
 * raw hit to its lineage stamp.
 */
export type ContextSourceDecl = {
  kind: ContextSourceKind
  tier: 'mandatory' | 'optional'
  /** `query_index` entity id (`<module>:<entity>`) — the read allowlist for `entity` sources. */
  entityType: string
  /** Lower runs first within a tier (deterministic order). */
  priority: number
  /** Base fields the capability may read from this source (least-privilege projection). */
  fields: string[]
  /** Maps a raw hit → its provenance stamp (stamped at assembly time, never reconstructed). */
  provenance: (hit: ContextSourceHit) => ContextProvenance
}

/** A per-capability context module: the typed least-privilege source allowlist. */
export type ContextModule = {
  capability: string
  sources: ContextSourceDecl[]
}

/**
 * Build a provenance mapper for an `entity` source with a stable factId of
 * `<entityType>#<ref>` so lineage is reproducible across assemblies.
 */
export function entityProvenance(entityType: string): ContextSourceDecl['provenance'] {
  return (hit: ContextSourceHit): ContextProvenance => ({
    factId: `${entityType}#${hit.ref}`,
    sourceKind: 'entity',
    sourceRef: hit.ref,
    ...(hit.locator ? { locator: hit.locator } : {}),
  })
}

/**
 * The code-first registry. Keyed by capability (the agent id). Phase 1 seeds the
 * example `deals.health_check` capability with a mandatory structured read of the
 * deal record. New capabilities add a declaration here (or via `registerContextModule`).
 */
const REGISTRY = new Map<string, ContextModule>()

export function registerContextModule(module: ContextModule): void {
  REGISTRY.set(module.capability, module)
}

/** Resolve the `ContextModule` for a capability, or null when none is declared. */
export function resolveContextModule(capability: string): ContextModule | null {
  return REGISTRY.get(capability) ?? null
}

/** Test/inspection helper: the declared capabilities. */
export function listContextCapabilities(): string[] {
  return [...REGISTRY.keys()]
}

// ── Seed: the example claims/deals capability ───────────────────────────────
// Mandatory floor = the subject deal record (always routed, never ranked out).
registerContextModule({
  capability: 'deals.health_check',
  sources: [
    {
      kind: 'entity',
      tier: 'mandatory',
      entityType: 'customers:deal',
      priority: 0,
      fields: ['id', 'title', 'stage', 'amount', 'status'],
      provenance: entityProvenance('customers:deal'),
    },
  ],
})
