import type { Knex } from 'knex'
import type { QueryOptions, QueryJoinEdge } from './types'
import type { FilterOp } from './types'

export type NormalizedFilter = { field: string; op: FilterOp; value?: unknown }

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
  const push = (field: string, op: FilterOp, value?: unknown) => {
    out.push({ field, op, value })
  }
  for (const [rawKey, rawVal] of Object.entries(obj)) {
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
  fromAlias: string
  fromField: string
  toField: string
  type: 'left' | 'inner'
}

export type BaseFilter = NormalizedFilter & { qualified?: string }
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
    resolved.push({ alias, table, fromAlias, fromField, toField, type })
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
  knex: Knex
  baseTable: string
  builder: Knex.QueryBuilder
  joinMap: Map<string, ResolvedJoin>
  joinFilters: Map<string, JoinFilter[]>
  aliasTables: Map<string, string>
  qualifyBase: (column: string) => string
  applyAliasScope: (builder: Knex.QueryBuilder, alias: string, table: string) => Promise<void> | void
  applyFilterOp: (builder: Knex.QueryBuilder, column: string, op: FilterOp, value?: unknown) => void
  columnExists?: (table: string, column: string) => Promise<boolean> | boolean
}

export async function applyJoinFilters({
  knex,
  baseTable,
  builder,
  joinMap,
  joinFilters,
  aliasTables,
  qualifyBase,
  applyAliasScope,
  applyFilterOp,
  columnExists,
}: ApplyJoinFiltersOptions): Promise<Knex.QueryBuilder> {
  const resolveAliasName = (aliasName?: string | null) => {
    if (!aliasName || aliasName === 'base') return baseTable
    return aliasName
  }

  for (const [alias, filtersForAlias] of joinFilters.entries()) {
    const chain = buildJoinChain(alias, joinMap, baseTable)
    if (!chain.length) continue
    const first = chain[0]
    const sub = knex({ [first.alias]: first.table }).select(1)
    await applyAliasScope(sub, first.alias, first.table)
    const parentAlias = resolveAliasName(first.fromAlias)
    if (parentAlias === baseTable) {
      sub.whereRaw('?? = ??', [`${first.alias}.${first.toField}`, qualifyBase(first.fromField)])
    } else {
      sub.whereRaw('?? = ??', [`${first.alias}.${first.toField}`, `${parentAlias}.${first.fromField}`])
    }
    for (const cfg of chain.slice(1)) {
      const joinArgs = { [cfg.alias]: cfg.table }
      const parent = resolveAliasName(cfg.fromAlias)
      const joinFn = function (this: Knex.QueryBuilder) {
        if (parent === baseTable) {
          this.on(`${cfg.alias}.${cfg.toField}`, '=', knex.raw('??', [qualifyBase(cfg.fromField)]))
        } else {
          this.on(`${cfg.alias}.${cfg.toField}`, '=', knex.raw('??', [`${parent}.${cfg.fromField}`]))
        }
      }
      if (cfg.type === 'inner') sub.join(joinArgs, joinFn)
      else sub.leftJoin(joinArgs, joinFn)
      await applyAliasScope(sub, cfg.alias, cfg.table)
    }
    let existsDirective: boolean | null = null
    for (const filter of filtersForAlias) {
      if (filter.op === 'exists') {
        if (filter.value === false) existsDirective = false
        else if (existsDirective === null) existsDirective = true
        continue
      }
      const targetTable = aliasTables.get(filter.alias)
      if (!targetTable) continue
      if (columnExists) {
        const exists = await columnExists(targetTable, filter.column)
        if (!exists) continue
      }
      const qualified = `${filter.alias}.${filter.column}`
      applyFilterOp(sub, qualified, filter.op, filter.value)
    }
    if (existsDirective === false) builder = builder.whereNotExists(sub)
    else builder = builder.whereExists(sub)
  }
  return builder
}
