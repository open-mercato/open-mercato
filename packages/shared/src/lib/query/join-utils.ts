import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { QueryOptions, QueryJoinEdge } from './types'
import type { FilterOp } from './types'

type AnyBuilder = any

export type NormalizedFilter = { field: string; op: FilterOp; value?: unknown; orGroup?: string; qualified?: string | null }

const VALID_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'like', 'ilike', 'exists'] as const

const normalizeField = (key: string) => (key.startsWith('cf_') ? `cf:${key.slice(3)}` : key)

type LeafClause = { field: string; op: FilterOp; value?: unknown }

/**
 * Cap on DNF disjunct count to prevent adversarial / pathological filters from
 * exploding the in-memory normalization. `validateTreeLimits` already caps
 * editor input at 50 rules / 15 children per group / 3 levels of nesting, but
 * a hand-crafted URL or buggy preset could still bypass that. The cap mirrors
 * the editor's posture: fail loud, refuse to compile.
 */
export const MAX_DNF_DISJUNCTS = 1000

export class AdvancedFilterComplexityError extends Error {
  readonly code = 'ADVANCED_FILTER_TOO_COMPLEX'
  readonly disjunctCount: number
  constructor(disjunctCount: number) {
    super(
      `Advanced filter expanded to ${disjunctCount} disjuncts, exceeding the limit of ${MAX_DNF_DISJUNCTS}. ` +
      `Reduce the number of OR branches or simplify nested groups.`,
    )
    this.name = 'AdvancedFilterComplexityError'
    this.disjunctCount = disjunctCount
  }
}

/**
 * Expand a Mongo-style filter object (with arbitrary nesting of `$and`/`$or` and
 * implicit AND between sibling keys) into Disjunctive Normal Form: `Clause[][]`,
 * where the outer array is OR'd alternatives and each inner array is the AND'd
 * leaves of one alternative.
 *
 * Empty filter -> `[[]]` (one empty disjunct, treated as "no constraint").
 * Throws `AdvancedFilterComplexityError` if any intermediate cartesian product
 * exceeds `MAX_DNF_DISJUNCTS`.
 */
function compileToDnf(filter: unknown): LeafClause[][] {
  if (filter === null || filter === undefined) return [[]]
  if (Array.isArray(filter) || typeof filter !== 'object') return [[]]
  const obj = filter as Record<string, unknown>
  const partialDnfs: LeafClause[][][] = []

  for (const [rawKey, rawVal] of Object.entries(obj)) {
    if (rawKey === '$and' && Array.isArray(rawVal)) {
      partialDnfs.push(cartesianAnd((rawVal as unknown[]).map(compileToDnf)))
      continue
    }
    if (rawKey === '$or' && Array.isArray(rawVal)) {
      const expanded = (rawVal as unknown[]).flatMap(compileToDnf)
      if (expanded.length > MAX_DNF_DISJUNCTS) {
        throw new AdvancedFilterComplexityError(expanded.length)
      }
      partialDnfs.push(expanded)
      continue
    }
    const field = normalizeField(rawKey)
    if (rawVal !== null && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
      const clauses: LeafClause[] = []
      for (const [opKey, opVal] of Object.entries(rawVal as Record<string, unknown>)) {
        const op = (opKey.startsWith('$') ? opKey.slice(1) : opKey) as FilterOp
        if (VALID_OPS.includes(op as (typeof VALID_OPS)[number])) {
          clauses.push({ field, op, value: opVal })
        }
      }
      if (clauses.length > 0) partialDnfs.push([clauses])
    } else {
      partialDnfs.push([[{ field, op: 'eq' as FilterOp, value: rawVal }]])
    }
  }

  return cartesianAnd(partialDnfs)
}

function cartesianAnd(dnfs: LeafClause[][][]): LeafClause[][] {
  if (dnfs.length === 0) return [[]]
  let result: LeafClause[][] = [[]]
  for (const dnf of dnfs) {
    if (dnf.length === 0) {
      // An empty DNF means an unsatisfiable subexpression; the AND becomes unsatisfiable
      // too. Represent that as an empty outer array (no disjuncts).
      return []
    }
    // Predict the next size to fail loud before allocating millions of arrays.
    const projected = result.length * dnf.length
    if (projected > MAX_DNF_DISJUNCTS) {
      throw new AdvancedFilterComplexityError(projected)
    }
    const next: LeafClause[][] = []
    for (const left of result) {
      for (const right of dnf) {
        next.push([...left, ...right])
      }
    }
    result = next
  }
  return result
}

function clauseKey(c: LeafClause): string {
  return JSON.stringify([c.field, c.op, c.value])
}

/**
 * Lift clauses that appear in every disjunct into a "common" set so the engine
 * can treat them as regular ANDed base filters (preserving the search-tokens
 * optimization for like/ilike clauses) instead of duplicating them across OR
 * groups.
 */
function liftCommonClauses(dnf: LeafClause[][]): { common: LeafClause[]; remaining: LeafClause[][] } {
  if (dnf.length <= 1) return { common: [], remaining: dnf }
  const counts = new Map<string, { clause: LeafClause; count: number }>()
  for (const disjunct of dnf) {
    const seen = new Set<string>()
    for (const c of disjunct) {
      const key = clauseKey(c)
      if (seen.has(key)) continue // count once per disjunct even if duplicated
      seen.add(key)
      const entry = counts.get(key)
      if (entry) entry.count += 1
      else counts.set(key, { clause: c, count: 1 })
    }
  }
  const total = dnf.length
  const commonKeys = new Set<string>()
  const common: LeafClause[] = []
  for (const [key, { clause, count }] of counts) {
    if (count === total) {
      commonKeys.add(key)
      common.push(clause)
    }
  }
  if (common.length === 0) return { common: [], remaining: dnf }
  const remaining = dnf.map((d) => d.filter((c) => !commonKeys.has(clauseKey(c))))
  return { common, remaining }
}

export function normalizeFilters(filters?: QueryOptions['filters']): NormalizedFilter[] {
  if (!filters) return []
  if (Array.isArray(filters)) {
    return (filters as any[]).map((f) => ({
      ...f,
      field: normalizeField(String((f as any).field)),
    }))
  }
  const dnf = compileToDnf(filters)
  if (dnf.length === 0) return []
  const nonEmpty = dnf.filter((disjunct) => disjunct.length > 0)
  if (nonEmpty.length === 0) return []
  if (nonEmpty.length === 1) {
    return nonEmpty[0].map((c) => ({ field: c.field, op: c.op, value: c.value }))
  }
  const { common, remaining } = liftCommonClauses(nonEmpty)
  const out: NormalizedFilter[] = []
  for (const c of common) out.push({ field: c.field, op: c.op, value: c.value })
  // Drop disjuncts that became empty after lifting (they're already represented in `common`).
  const remainingNonEmpty = remaining.filter((d) => d.length > 0)
  if (remainingNonEmpty.length === 0) return out
  if (remainingNonEmpty.length === 1) {
    for (const c of remainingNonEmpty[0]) out.push({ field: c.field, op: c.op, value: c.value })
    return out
  }
  for (let i = 0; i < remainingNonEmpty.length; i++) {
    for (const c of remainingNonEmpty[i]) {
      out.push({ field: c.field, op: c.op, value: c.value, orGroup: `or_${i}` })
    }
  }
  return out
}

export type ResolvedJoin = {
  alias: string
  table: string
  entityId?: string | null
  fromAlias: string
  fromField: string
  toField: string
  type: 'left' | 'inner'
}

export type BaseFilter = NormalizedFilter & { qualified?: string | null }
export type JoinFilter = { alias: string; column: string; op: FilterOp; value?: unknown }

export function resolveJoins(
  baseTable: string,
  joins: QueryJoinEdge[] | null | undefined,
  resolveTable: (entityId: string) => string | null,
): ResolvedJoin[] {
  if (!joins || joins.length === 0) return []
  const resolved: ResolvedJoin[] = []
  const seen = new Set<string>()
  for (const entry of joins) {
    if (!entry || typeof entry !== 'object') continue
    const alias = typeof entry.alias === 'string' ? entry.alias.trim() : ''
    if (!alias) continue
    if (seen.has(alias)) continue
    const table =
      entry.table ??
      (entry.entityId ? resolveTable(String(entry.entityId)) : null)
    if (!table) continue
    const fromField = entry.from?.field?.trim()
    const toField = entry.to?.field?.trim()
    if (!fromField || !toField) continue
    const fromAliasRaw = entry.from?.alias?.trim()
    const fromAlias = fromAliasRaw && fromAliasRaw.length > 0 ? fromAliasRaw : 'base'
    const type: 'left' | 'inner' = entry.type === 'inner' ? 'inner' : 'left'
    resolved.push({
      alias,
      table,
      entityId: entry.entityId ? String(entry.entityId) : null,
      fromAlias,
      fromField,
      toField,
      type,
    })
    seen.add(alias)
  }
  return resolved
}

export function buildJoinChain(
  alias: string,
  joinMap: Map<string, ResolvedJoin>,
  baseTable: string,
  visited: Set<string> = new Set(),
): ResolvedJoin[] {
  if (visited.has(alias)) {
    throw new Error(`QueryEngine: circular join reference detected for alias ${alias}`)
  }
  const cfg = joinMap.get(alias)
  if (!cfg) return []
  visited.add(alias)
  if (!cfg.fromAlias || cfg.fromAlias === 'base' || cfg.fromAlias === baseTable) {
    return [cfg]
  }
  const parentChain = buildJoinChain(cfg.fromAlias, joinMap, baseTable, visited)
  if (parentChain.length === 0) return []
  return [...parentChain, cfg]
}

export function partitionFilters(
  baseTable: string,
  filters: NormalizedFilter[],
  joinMap: Map<string, ResolvedJoin>,
): { baseFilters: BaseFilter[]; joinFilters: Map<string, JoinFilter[]> } {
  const baseFilters: BaseFilter[] = []
  const joinFilters = new Map<string, JoinFilter[]>()
  for (const filter of filters) {
    const field = String(filter.field)
    if (field.startsWith('cf:')) continue
    const parts = field.split('.')
    if (parts.length === 2) {
      const [aliasNameRaw, column] = parts
      const aliasName = aliasNameRaw || ''
      if (joinMap.has(aliasName)) {
        const list = joinFilters.get(aliasName) ?? []
        list.push({ alias: aliasName, column, op: filter.op, value: filter.value })
        joinFilters.set(aliasName, list)
        continue
      }
      if (aliasName === baseTable || aliasName === 'base') {
        baseFilters.push({
          field: column,
          op: filter.op,
          value: filter.value,
          qualified: `${baseTable}.${column}`,
        })
        continue
      }
    }
    baseFilters.push({ ...filter })
  }
  return { baseFilters, joinFilters }
}

type ApplyJoinFiltersOptions = {
  db: Kysely<any>
  baseTable: string
  builder: AnyBuilder
  joinMap: Map<string, ResolvedJoin>
  joinFilters: Map<string, JoinFilter[]>
  aliasTables: Map<string, string>
  qualifyBase: (column: string) => string
  applyAliasScope: (builder: AnyBuilder, alias: string, table: string) => Promise<AnyBuilder> | AnyBuilder
  applyFilterOp: (builder: AnyBuilder, column: string, op: FilterOp, value?: unknown) => AnyBuilder
  applyJoinFilterOp?: (builder: AnyBuilder, filter: JoinFilter, qualified: string, join: ResolvedJoin, table: string) => Promise<{ applied: boolean; builder: AnyBuilder }> | { applied: boolean; builder: AnyBuilder }
  columnExists?: (table: string, column: string) => Promise<boolean> | boolean
}

export async function applyJoinFilters({
  db,
  baseTable,
  builder,
  joinMap,
  joinFilters,
  aliasTables,
  qualifyBase,
  applyAliasScope,
  applyFilterOp,
  applyJoinFilterOp,
  columnExists,
}: ApplyJoinFiltersOptions): Promise<AnyBuilder> {
  const resolveAliasName = (aliasName?: string | null) => {
    if (!aliasName || aliasName === 'base') return baseTable
    return aliasName
  }

  let nextBuilder = builder
  for (const [alias, filtersForAlias] of joinFilters.entries()) {
    const chain = buildJoinChain(alias, joinMap, baseTable)
    if (!chain.length) continue
    const first = chain[0]
    let sub: AnyBuilder = db.selectFrom(`${first.table} as ${first.alias}` as any).select(sql`1`.as('one'))
    sub = await applyAliasScope(sub, first.alias, first.table)
    const parentAlias = resolveAliasName(first.fromAlias)
    const parentRef = parentAlias === baseTable ? qualifyBase(first.fromField) : `${parentAlias}.${first.fromField}`
    sub = sub.whereRef(`${first.alias}.${first.toField}`, '=', parentRef)
    for (const cfg of chain.slice(1)) {
      const parent = resolveAliasName(cfg.fromAlias)
      const rightRef = parent === baseTable ? qualifyBase(cfg.fromField) : `${parent}.${cfg.fromField}`
      const joinFn = cfg.type === 'inner' ? 'innerJoin' : 'leftJoin'
      sub = (sub as any)[joinFn](`${cfg.table} as ${cfg.alias}`, (jb: any) =>
        jb.onRef(`${cfg.alias}.${cfg.toField}`, '=', rightRef))
      sub = await applyAliasScope(sub, cfg.alias, cfg.table)
    }
    let existsDirective: boolean | null = null
    for (const filter of filtersForAlias) {
      if (filter.op === 'exists') {
        if (filter.value === false) existsDirective = false
        else if (existsDirective === null) existsDirective = true
        continue
      }
      const join = joinMap.get(filter.alias)
      if (!join) continue
      const targetTable = aliasTables.get(filter.alias)
      if (!targetTable) continue
      if (columnExists) {
        const exists = await columnExists(targetTable, filter.column)
        if (!exists) continue
      }
      const qualified = `${filter.alias}.${filter.column}`
      if (applyJoinFilterOp) {
        const result = await applyJoinFilterOp(sub, filter, qualified, join, targetTable)
        if (result && result.applied) {
          sub = result.builder
          continue
        }
        if (result && result.builder) {
          sub = result.builder
        }
      }
      sub = applyFilterOp(sub, qualified, filter.op, filter.value)
    }
    if (existsDirective === false) {
      const capturedSub = sub
      nextBuilder = nextBuilder.where((eb: any) => eb.not(eb.exists(capturedSub)))
    } else {
      const capturedSub = sub
      nextBuilder = nextBuilder.where((eb: any) => eb.exists(capturedSub))
    }
  }
  return nextBuilder
}
