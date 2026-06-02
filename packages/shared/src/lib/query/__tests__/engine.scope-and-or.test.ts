import { BasicQueryEngine } from '../engine'
import { normalizeFilters } from '../join-utils'

type FakeData = Record<string, any[]>

function cloneRows(rows: any[] | undefined): any[] {
  if (!rows) return []
  return rows.map((row) => ({ ...row }))
}

function createFakeKysely(overrides?: FakeData) {
  const calls: any[] = []
  const defaultData: FakeData = { custom_field_defs: [], custom_field_values: [] }
  const sourceData = { ...defaultData, ...(overrides || {}) }
  const data: FakeData = Object.fromEntries(
    Object.entries(sourceData).map(([table, rows]) => [table, cloneRows(rows)]),
  )

  function parseTableSpec(spec: unknown): { table: string; alias: string | null } {
    if (typeof spec !== 'string') return { table: String(spec || ''), alias: null }
    const asMatch = /^(.+?)\s+as\s+(.+)$/i.exec(spec)
    if (asMatch) return { table: asMatch[1].trim(), alias: asMatch[2].trim() }
    return { table: spec, alias: null }
  }

  function createExpressionBuilder() {
    const eb: any = (column: any, op: any, value: any) => ({ kind: 'cmp', column, op, value })
    eb.and = (parts: any[]) => ({ kind: 'and', parts })
    eb.or = (parts: any[]) => ({ kind: 'or', parts })
    eb.not = (part: any) => ({ kind: 'not', part })
    eb.exists = (sub: any) => ({ kind: 'exists', sub })
    eb.val = (value: any) => ({ kind: 'val', value })
    eb.ref = (name: string) => ({ kind: 'ref', name })
    eb.selectFrom = (spec: any) => builderFor(spec)
    return eb
  }

  function normalizeWhereArgs(args: any[]): any[] {
    if (args.length === 1 && typeof args[0] === 'function') {
      const produced = args[0](createExpressionBuilder())
      if (produced && produced.kind === 'or') return ['or', produced.parts]
      if (produced && produced.kind === 'and') return ['and', produced.parts]
      if (produced && produced.kind === 'exists') return ['exists', produced.sub]
      if (produced && produced.kind === 'not' && produced.part?.kind === 'exists') return ['notExists', produced.part.sub]
      return ['expr', produced]
    }
    return args
  }

  function recordJoin(ops: any, type: 'left' | 'inner', spec: any, fn: Function) {
    const parsed = parseTableSpec(spec)
    const aliasObj = parsed.alias ? { [parsed.alias]: parsed.table } : { [parsed.table]: parsed.table }
    const entry: any = { type, aliasObj, conditions: [] as any[] }
    const ctx: any = {}
    ctx.on = (left: any, op?: any, right?: any) => {
      if (typeof left === 'function') {
        const expr = left(createExpressionBuilder())
        entry.conditions.push({ method: 'on', expr })
      } else {
        entry.conditions.push({ method: 'on', args: [left, op, right] })
      }
      return ctx
    }
    ctx.onRef = (left: any, op: any, right: any) => {
      entry.conditions.push({ method: 'on', args: [left, op, right] })
      return ctx
    }
    fn(ctx)
    ops.joins.push(entry)
  }

  function makeBuilder(ops: any, record: boolean): any {
    const b: any = {
      _ops: ops,
      select(this: any, ...cols: any[]) {
        if (cols.length === 1 && Array.isArray(cols[0])) this._ops.selects.push(...cols[0])
        else this._ops.selects.push(...cols)
        return this
      },
      distinct(this: any) { return this },
      where(this: any, ...args: any[]) {
        this._ops.wheres.push(normalizeWhereArgs(args))
        return this
      },
      whereRef(this: any, left: any, op: any, right: any) {
        this._ops.wheres.push(['ref', left, op, right])
        return this
      },
      leftJoin(this: any, spec: any, fn: Function) { recordJoin(this._ops, 'left', spec, fn); return this },
      innerJoin(this: any, spec: any, fn: Function) { recordJoin(this._ops, 'inner', spec, fn); return this },
      groupBy(this: any, arg: any) {
        if (Array.isArray(arg)) this._ops.groups.push(...arg)
        else this._ops.groups.push(arg)
        return this
      },
      having(this: any) { return this },
      orderBy(this: any, col: any, dir?: any) { this._ops.orderBys.push([col, dir]); return this },
      limit(this: any, n: number) { this._ops.limits = n; return this },
      offset(this: any, n: number) { this._ops.offsets = n; return this },
      clearSelect(this: any) {
        const nextOps = { ...this._ops, selects: [] }
        return makeBuilder(nextOps, false)
      },
      clearOrderBy(this: any) {
        const nextOps = { ...this._ops, orderBys: [] }
        return makeBuilder(nextOps, false)
      },
      clearGroupBy(this: any) {
        const nextOps = { ...this._ops, groups: [] }
        return makeBuilder(nextOps, false)
      },
      as(this: any, alias: string) { this._ops.alias = alias; return this },
      async execute(this: any) { return cloneRows(data[this._ops.table]) },
      async executeTakeFirst(this: any) {
        const localOps = this._ops
        if (localOps.table === 'information_schema.columns') {
          const infoRows = data['information_schema.columns']
          if (!Array.isArray(infoRows)) return undefined
          const targetTable = extractEqValue(localOps.wheres, 'table_name')
          const targetColumn = extractEqValue(localOps.wheres, 'column_name')
          return infoRows.find((row: any) =>
            (!targetTable || row.table_name === targetTable) &&
            (!targetColumn || row.column_name === targetColumn)
          )
        }
        if (localOps.table === 'information_schema.tables') {
          const infoRows = data['information_schema.tables']
          if (!Array.isArray(infoRows)) return undefined
          const targetTable = extractEqValue(localOps.wheres, 'table_name')
          return infoRows.find((row: any) => !targetTable || row.table_name === targetTable)
        }
        if (localOps.selects.some((s: any) => s && typeof s === 'object' && (s.__isCount || String(s?.alias || '') === 'count'))) {
          return { count: '0' }
        }
        const rows = data[localOps.table] || []
        if (rows.length === 0) return { count: '0' }
        return rows[0]
      },
    }
    if (record) calls.push(b)
    return b
  }

  function builderFor(tableArg: any): any {
    const parsed = parseTableSpec(tableArg)
    const ops = {
      table: parsed.table,
      alias: parsed.alias,
      wheres: [] as any[],
      joins: [] as any[],
      selects: [] as any[],
      orderBys: [] as any[],
      groups: [] as any[],
      limits: 0,
      offsets: 0,
    }
    return makeBuilder(ops, true)
  }

  function extractEqValue(wheres: any[], column: string): any {
    for (const entry of wheres) {
      if (!Array.isArray(entry)) continue
      if (entry[0] === column && entry[1] === '=') return entry[2]
    }
    return undefined
  }

  const db: any = {
    selectFrom(spec: any) { return builderFor(spec) },
  }
  db._calls = calls
  return db
}

type Cmp = { kind: 'cmp'; column: string; op: string; value: unknown }
type And = { kind: 'and'; parts: Node[] }
type Or = { kind: 'or'; parts: Node[] }
type Node = Cmp | And | Or | { kind: string; [k: string]: any }

function flattenCmps(node: Node | unknown, out: Cmp[] = []): Cmp[] {
  if (!node || typeof node !== 'object') return out
  const n = node as Node
  if (n.kind === 'cmp') out.push(n as Cmp)
  else if (n.kind === 'and' || n.kind === 'or') {
    for (const p of (n as And | Or).parts) flattenCmps(p, out)
  }
  return out
}

describe('normalizeFilters $or clause grouping', () => {
  test('assigns distinct orGroup ids per disjunct; lifts clauses common to every disjunct out of the OR', () => {
    const normalized = normalizeFilters({
      $or: [
        { organization_id: { $eq: 'org-1' }, tenant_id: { $eq: 't1' } },
        { organization_id: { $eq: null }, tenant_id: { $eq: 't1' }, scope_type: { $eq: 'tenant' } },
      ],
    })

    // tenant_id appears in every disjunct, so it's lifted out for SQL efficiency
    // (preserves the search-tokens optimization on common ANDed predicates).
    const ungrouped = normalized.filter((f) => !f.orGroup).map((f) => f.field).sort()
    expect(ungrouped).toEqual(['tenant_id'])

    const byGroup = new Map<string, typeof normalized>()
    for (const f of normalized.filter((f) => f.orGroup)) {
      const key = f.orGroup!
      const list = byGroup.get(key) ?? []
      list.push(f)
      byGroup.set(key, list)
    }
    expect(byGroup.size).toBe(2)
    const groupFields = Array.from(byGroup.values()).map((group) => group.map((f) => f.field).sort())
    expect(groupFields).toEqual(
      expect.arrayContaining([
        ['organization_id'],
        ['organization_id', 'scope_type'].sort(),
      ]),
    )
  })

  test('top-level non-$or filters remain un-grouped (ANDed) alongside $or disjuncts', () => {
    const normalized = normalizeFilters({
      $or: [{ a: 1 }, { b: 2 }],
      is_enabled: true,
    })
    const withoutGroup = normalized.filter((f) => !f.orGroup).map((f) => f.field)
    const withGroup = normalized.filter((f) => f.orGroup).map((f) => f.field)
    expect(withoutGroup).toEqual(['is_enabled'])
    expect(withGroup.sort()).toEqual(['a', 'b'])
  })
})

describe('BasicQueryEngine — null equality', () => {
  test('$eq null compiles to where(col, "is", null)', async () => {
    const fakeDb = createFakeKysely({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'organization_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: { organization_id: { $eq: null } },
    })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall).toBeTruthy()
    const wheres: any[] = baseCall._ops.wheres
    const hasIsNullOrgId = wheres.some(
      (w: any) => Array.isArray(w) && String(w[0]).endsWith('organization_id') && w[1] === 'is' && w[2] === null,
    )
    expect(hasIsNullOrgId).toBe(true)
    const hasEqualsLiteralNull = wheres.some(
      (w: any) => Array.isArray(w) && String(w[0]).endsWith('organization_id') && w[1] === '=' && w[2] === null,
    )
    expect(hasEqualsLiteralNull).toBe(false)
  })

  test('$ne null compiles to where(col, "is not", null)', async () => {
    const fakeDb = createFakeKysely({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'organization_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: { organization_id: { $ne: null } },
    })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall).toBeTruthy()
    const wheres: any[] = baseCall._ops.wheres
    const hasIsNotNullOrgId = wheres.some(
      (w: any) => Array.isArray(w) && String(w[0]).endsWith('organization_id') && w[1] === 'is not' && w[2] === null,
    )
    expect(hasIsNotNullOrgId).toBe(true)
  })
})

describe('BasicQueryEngine — omitAutomaticTenantOrgScope', () => {
  test('skips automatic tenant and organization guards when flag is set', async () => {
    const fakeDb = createFakeKysely({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'id' },
        { table_name: 'scheduled_jobs', column_name: 'organization_id' },
        { table_name: 'scheduled_jobs', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      organizationId: 'org-1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: { id: { $eq: '11111111-1111-1111-1111-111111111111' } },
    })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall).toBeTruthy()
    const wheres: any[] = baseCall._ops.wheres

    const hasTenantGuard = wheres.some(
      (w: any) => Array.isArray(w) && w[0] === 'scheduled_jobs.tenant_id' && w[1] === '=' && w[2] === 't1',
    )
    expect(hasTenantGuard).toBe(false)

    const allCmps = wheres.flatMap((w: any) => {
      if (!Array.isArray(w)) return []
      if (w[0] === 'expr' || w[0] === 'and' || w[0] === 'or') {
        const payload = w[0] === 'expr' ? w[1] : { kind: w[0], parts: w[1] }
        return flattenCmps(payload)
      }
      if (w.length >= 3 && typeof w[0] === 'string' && typeof w[1] === 'string') {
        return [{ kind: 'cmp', column: w[0], op: w[1], value: w[2] } as Cmp]
      }
      return []
    })
    const hasOrgGuard = allCmps.some(
      (c) => String(c.column).endsWith('organization_id') && c.op === 'in' && Array.isArray(c.value) && (c.value as any[]).includes('org-1'),
    )
    expect(hasOrgGuard).toBe(false)

    const hasIdFilter = wheres.some(
      (w: any) => Array.isArray(w) && w[0] === 'scheduled_jobs.id' && w[1] === '=' && w[2] === '11111111-1111-1111-1111-111111111111',
    )
    expect(hasIdFilter).toBe(true)
  })

  test('applies automatic tenant guard when flag is absent (baseline)', async () => {
    const fakeDb = createFakeKysely({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
    })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall).toBeTruthy()
    const wheres: any[] = baseCall._ops.wheres
    const hasTenantGuard = wheres.some(
      (w: any) => Array.isArray(w) && w[0] === 'scheduled_jobs.tenant_id' && w[1] === '=' && w[2] === 't1',
    )
    expect(hasTenantGuard).toBe(true)
  })
})

describe('BasicQueryEngine — multi-field $or grouping', () => {
  test('AND within each $or clause, OR between clauses', async () => {
    const fakeDb = createFakeKysely({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'organization_id' },
        { table_name: 'scheduled_jobs', column_name: 'tenant_id' },
        { table_name: 'scheduled_jobs', column_name: 'scope_type' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: {
        $or: [
          { organization_id: { $eq: 'org-1' }, tenant_id: { $eq: 't1' } },
          { organization_id: { $eq: null }, tenant_id: { $eq: null }, scope_type: { $eq: 'system' } },
        ],
      },
    })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall).toBeTruthy()

    const orEntry = baseCall._ops.wheres.find((w: any) => Array.isArray(w) && w[0] === 'or')
    expect(orEntry).toBeTruthy()
    const orParts: Node[] = orEntry[1]
    expect(Array.isArray(orParts)).toBe(true)
    expect(orParts.length).toBe(2)

    const groupOne = orParts[0] as And
    expect(groupOne.kind).toBe('and')
    const groupOneCmps = flattenCmps(groupOne)
    const groupOneCols = groupOneCmps
      .map((c) => String(c.column))
      .filter((col) => col.endsWith('organization_id') || col.endsWith('tenant_id'))
    expect(groupOneCols.length).toBeGreaterThanOrEqual(2)
    const groupOneHasOrgEq = groupOneCmps.some(
      (c) => String(c.column).endsWith('organization_id') && c.op === '=' && c.value === 'org-1',
    )
    const groupOneHasTenantEq = groupOneCmps.some(
      (c) => String(c.column).endsWith('tenant_id') && c.op === '=' && c.value === 't1',
    )
    expect(groupOneHasOrgEq).toBe(true)
    expect(groupOneHasTenantEq).toBe(true)

    const groupTwo = orParts[1] as And
    expect(groupTwo.kind).toBe('and')
    const groupTwoCmps = flattenCmps(groupTwo)
    const hasSystemScope = groupTwoCmps.some(
      (c) => String(c.column).endsWith('scope_type') && c.op === '=' && c.value === 'system',
    )
    const hasNullOrg = groupTwoCmps.some(
      (c) => String(c.column).endsWith('organization_id') && c.op === 'is' && c.value === null,
    )
    const hasNullTenant = groupTwoCmps.some(
      (c) => String(c.column).endsWith('tenant_id') && c.op === 'is' && c.value === null,
    )
    expect(hasSystemScope).toBe(true)
    expect(hasNullOrg).toBe(true)
    expect(hasNullTenant).toBe(true)
  })
})
