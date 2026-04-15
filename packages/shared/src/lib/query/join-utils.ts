import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { QueryOptions, QueryJoinEdge } from './types'
import type { FilterOp } from './types'

type AnyBuilder = any

export type NormalizedFilter = { field: string; op: FilterOp; value?: unknown; orGroup?: string; qualified?: string | null }

export function normalizeFilters(filters?: QueryOptions['filters']): NormalizedFilter[] {
  if (!filters) return []
  const normalizeField = (key: string) => (key.startsWith('cf_') ? `cf:${key.slice(3)}` : key)
  if (Array.isArray(filters)) {
    return (filters as any[]).map((f) => ({
      ...f,
      field: normalizeField(String((f as any).field)),
    }))
  }
  const out: NormalizedFilter[] = []
  const obj = filters as Record<string, unknown>
  const push = (field: string, op: FilterOp, value?: unknown, orGroup?: string) => {
    out.push({ field, op, value, orGroup })
  }
  // Handle $or at top level
  if (Array.isArray(obj.$or)) {
    const orGroupId = `or_${Date.now()}`
    for (const clause of obj.$or as Record<string, unknown>[]) {
      if (clause && typeof clause === 'object') {
        for (const [rawKey, rawVal] of Object.entries(clause)) {
          const field = normalizeField(rawKey)
          if (rawVal !== null && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
            for (const [opKey, opVal] of Object.entries(rawVal as Record<string, unknown>)) {
              const op = opKey.replace('$', '') as FilterOp
              if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'like', 'ilike', 'exists'].includes(op)) {
                push(field, op, opVal, orGroupId)
              }
            }
          } else {
            push(field, 'eq', rawVal, orGroupId)
          }
        }
      }
    }
  }
  for (const [rawKey, rawVal] of Object.entries(obj)) {
    if (rawKey === '$or') continue
    const field = normalizeField(rawKey)
    if (rawVal !== null && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
      for (const [opKey, opVal] of Object.entries(rawVal as Record<string, unknown>)) {
        switch (opKey) {
          case '$eq':
            push(field, 'eq', opVal)
            break
          case '$ne':
            push(field, 'ne', opVal)
            break
          case '$gt':
            push(field, 'gt', opVal)
            break
          case '$gte':
            push(field, 'gte', opVal)
            break
          case '$lt':
            push(field, 'lt', opVal)
            break
          case '$lte':
            push(field, 'lte', opVal)
            break
          case '$in':
            push(field, 'in', opVal)
            break
          case '$nin':
            push(field, 'nin', opVal)
            break
          case '$like':
            push(field, 'like', opVal)
            break
          case '$ilike':
            push(field, 'ilike', opVal)
            break
          case '$exists':
            push(field, 'exists', opVal)
            break
        }
      }
    } else {
      push(field, 'eq', rawVal)
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
