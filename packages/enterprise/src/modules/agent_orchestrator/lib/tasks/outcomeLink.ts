import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { outcomeEntityName, outcomeModuleId, type ProcessRunOutcome } from './outcome'

/**
 * Resolves the backend record route for a run outcome — the "link where the
 * target module is present" half of spec `2026-08-11-triggered-process-model.md`
 * §Outcome.
 *
 * The module that owns the produced record is an OPTIONAL PEER this module
 * never requires: a deployment without it must still show the outcome, by its
 * label snapshot. Resolution therefore goes through the local `tryResolve`
 * below, in try/catch, per `packages/core/AGENTS.md` § Cross-Module Coupling —
 * never a hard `requires`, never an unconditional `container.resolve`, and
 * never a cross-module ORM relation.
 *
 * SERVER-ONLY by construction: it reads the module registry, which is populated
 * at server bootstrap. The client receives the already-resolved href from the
 * process-runs API; `outcome.ts` stays the client-safe half.
 */

type OutcomeRouteLike = { pattern?: string; path?: string }
export type OutcomeModuleLike = { id: string; backendRoutes?: OutcomeRouteLike[] }

/**
 * Local `tryResolve` for the outcome's owning module. Returns null — never
 * throws — when the module is absent, when the registry has not been
 * bootstrapped (route unit tests), or when the lookup fails for any other
 * reason. Every one of those cases means the same thing to a reader: no link.
 */
function tryResolveOutcomeModule(
  moduleId: string,
  modules?: OutcomeModuleLike[] | null,
): OutcomeModuleLike | null {
  try {
    const registered = modules ?? (tryGetModules() as OutcomeModuleLike[] | null)
    if (!registered) return null
    return registered.find((module) => module.id === moduleId) ?? null
  } catch {
    return null
  }
}

const ID_SEGMENT = '[id]'

/** A record route names its entity in the segment before `[id]`, singular or simply pluralized. */
function segmentNamesEntity(segment: string, entity: string): boolean {
  if (segment === entity) return true
  if (segment === `${entity}s`) return true
  if (segment === `${entity}es`) return true
  if (entity.endsWith('y') && segment === `${entity.slice(0, -1)}ies`) return true
  return false
}

function recordRouteFor(owner: OutcomeModuleLike, entity: string): string | null {
  const patterns = (owner.backendRoutes ?? [])
    .map((route) => route.pattern ?? route.path ?? '')
    .filter((pattern) => pattern.length > 0)
    // Deterministic: the shortest matching record route wins, so the resolved
    // href never depends on module-registry ordering.
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
  for (const pattern of patterns) {
    const segments = pattern.split('/')
    if (segments[segments.length - 1] !== ID_SEGMENT) continue
    if (segments.some((segment) => segment.startsWith('[...') || segment.startsWith('[[...'))) continue
    const entitySegment = segments[segments.length - 2]
    if (!entitySegment || !segmentNamesEntity(entitySegment, entity)) continue
    return segments.slice(0, -1).join('/')
  }
  return null
}

/**
 * The backend href for an outcome, or null when a reader should see the label
 * snapshot alone: the type carries no `<module>:<entity>` prefix, the owning
 * module is not part of this deployment, or it declares no record route this
 * outcome maps to. Declining to link is always preferred over guessing a URL
 * that would 404.
 */
export function resolveOutcomeHref(
  outcome: ProcessRunOutcome,
  modules?: OutcomeModuleLike[] | null,
): string | null {
  const moduleId = outcomeModuleId(outcome.type)
  const entity = outcomeEntityName(outcome.type)
  if (!moduleId || !entity) return null
  const owner = tryResolveOutcomeModule(moduleId, modules)
  if (!owner) return null
  const base = recordRouteFor(owner, entity)
  if (!base) return null
  return `${base}/${encodeURIComponent(outcome.id)}`
}
