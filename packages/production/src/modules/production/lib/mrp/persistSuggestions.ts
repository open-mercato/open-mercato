import type { EntityManager } from '@mikro-orm/postgresql'
import { MrpSuggestion as MrpSuggestionEntity } from '../../data/entities.js'
import type { MrpSuggestion as EngineSuggestion } from './types.js'
import { computeCarryOverDecisions, buildDemandSourceKey, type PriorResolvedSuggestion } from './carryOver.js'
import type { MrpPeggingRef } from './types.js'

export interface PersistMrpSuggestionsParams {
  em: EntityManager
  runId: string
  tenantId: string
  organizationId: string
  suggestions: EngineSuggestion[]
}

export interface PersistMrpSuggestionsSummary {
  /** Total rows inserted for this run (== `suggestions.length`). */
  inserted: number
  /** Of the inserted rows, how many were `status: 'open'` (new/unresolved). */
  openCount: number
  /** Of the inserted rows, how many carried a prior accepted/dismissed status forward as `'superseded'`. */
  carriedCount: number
  /** Prior-run `'open'` rows superseded by this run's output. */
  supersededPriorOpenCount: number
}

/**
 * Persists a run's computed suggestions with carry-over (spec § MRP engine,
 * point 3 + task 5.2 DoD: "a second run does not duplicate accepted/
 * dismissed suggestions").
 *
 * Idempotent-rerun contract (spec § MRP engine, point 4: "re-running a
 * failed run recomputes from scratch and supersedes partial output"): any
 * rows already inserted under THIS SAME `runId` (a partial write from a
 * crashed prior attempt of the same run) are deleted before inserting the
 * freshly computed set — a retry of a failed run always ends up with
 * exactly the rows this call computes, never a mix of old+new partial rows.
 *
 * Cross-run carry-over: separately from the same-run wipe above, every
 * `'open'` suggestion belonging to an EARLIER run in this tenant/org scope
 * is marked `'superseded'` — the new run's suggestion set fully replaces
 * the previous run's open suggestions. Suggestions already resolved
 * (`'accepted'`/`'dismissed'`) are left untouched; they are the ones a new
 * matching suggestion carries forward via `carryOver.ts`.
 */
export async function persistMrpSuggestions(
  params: PersistMrpSuggestionsParams,
): Promise<PersistMrpSuggestionsSummary> {
  const { em, runId, tenantId, organizationId, suggestions } = params
  const scope = { tenantId, organizationId, deletedAt: null }

  // Idempotent retry of THIS run: wipe any partial output from a crashed
  // prior attempt before inserting the freshly computed set.
  await em.nativeDelete(MrpSuggestionEntity, { ...scope, runId })

  // Cross-run carry-over source: the latest resolved (accepted/dismissed)
  // suggestion per match key, across ALL prior runs in scope.
  const priorResolvedRows = await em.find(MrpSuggestionEntity, {
    ...scope,
    status: { $in: ['accepted', 'dismissed'] },
  })
  const priorResolved: PriorResolvedSuggestion[] = priorResolvedRows.map((row) => {
    const pegging = Array.isArray(row.demandSource) ? (row.demandSource as MrpPeggingRef[]) : []
    return {
      id: row.id,
      suggestionType: row.suggestionType,
      productId: row.productId,
      variantId: row.variantId ?? null,
      demandSourceKey: buildDemandSourceKey(pegging),
      createdAt: row.createdAt,
    }
  })

  // Every OPEN suggestion from a prior run is replaced by this run's output.
  const priorOpenIds = (
    await em.find(MrpSuggestionEntity, { ...scope, status: 'open' }, { fields: ['id'] as never })
  ).map((row: { id: string }) => row.id)
  if (priorOpenIds.length) {
    await em.nativeUpdate(MrpSuggestionEntity, { id: { $in: priorOpenIds } }, { status: 'superseded' })
  }

  const decisions = computeCarryOverDecisions(suggestions, priorResolved)

  let openCount = 0
  let carriedCount = 0
  const rows = decisions.map(({ suggestion, status, carriedFromSuggestionId }) => {
    if (status === 'open') openCount += 1
    else carriedCount += 1
    return em.create(MrpSuggestionEntity, {
      tenantId,
      organizationId,
      runId,
      suggestionType: suggestion.type,
      productId: suggestion.productId,
      variantId: suggestion.variantId,
      qty: String(suggestion.qty),
      uom: suggestion.uom,
      dueDate: new Date(suggestion.dueDate),
      // Sorted by `${type}:${id}` before persisting (belt-and-braces with
      // `buildDemandSourceKey`'s own sort): keeps the stored pegging array
      // itself order-independent, not just the derived match key.
      demandSource: [...suggestion.pegging].sort((a, b) => {
        const keyA = `${a.source.type}:${a.source.id ?? ''}`
        const keyB = `${b.source.type}:${b.source.id ?? ''}`
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
      }),
      status,
      carriedFromSuggestionId,
    } as never)
  })

  if (rows.length) em.persist(rows)
  await em.flush()

  return {
    inserted: rows.length,
    openCount,
    carriedCount,
    supersededPriorOpenCount: priorOpenIds.length,
  }
}
