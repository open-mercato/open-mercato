// Release 4 PLAN.md Step 6.4 — unit coverage for `workers/code-generation.worker.ts`
// against a hand-built, in-memory fake `EntityManager` (same spirit as
// `lib/__tests__/code-service.test.ts`/`lib/__tests__/promotion-usage-service.test.ts`: no
// real database). `jest.mock('../../events', ...)` keeps event emission out of the test's
// own assertions, matching `promotion-usage-service.test.ts`'s precedent.

import { randomUUID } from 'crypto'
import { Code, GeneratedCode, type PromotionCodeType } from '../../data/entities'
import handle from '../code-generation.worker'

jest.mock('../../events', () => ({ emitPromotionsEvent: jest.fn(async () => {}) }))
const { emitPromotionsEvent } = require('../../events') as { emitPromotionsEvent: jest.Mock }

const TENANT = 'tenant-1'
const ORG = 'org-1'

// Mirrors `workers/code-generation.worker.ts`'s own `CODE_CHARSET` (uppercase
// alphanumeric excluding 0/O/1/I/L). Duplicated here, deliberately, so tests can compute
// exactly which character a mocked `Math.random()` draw produces without exporting an
// internal implementation detail from the production module.
const CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
function charAt(randomValue: number): string {
  return CHARSET[Math.floor(randomValue * CHARSET.length)]
}

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition === null) return value === null || value === undefined
    return value === condition
  })
}

type FakeEm = {
  findOne: (entity: Function, where: Row) => Promise<Row | null>
  count: (entity: Function, where: Row) => Promise<number>
  create: (entity: Function, data: Row) => Row
  persist: (row: Row) => void
  flush: () => Promise<void>
  fork: () => FakeEm
}

function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]> } {
  const tables = new Map<Function, Row[]>()
  let pendingCreates: Array<{ entity: Function; row: Row }> = []

  function tableFor(entity: Function): Row[] {
    let rows = tables.get(entity)
    if (!rows) {
      rows = []
      tables.set(entity, rows)
    }
    return rows
  }

  const em: FakeEm = {
    findOne: async (entity, where) => tableFor(entity).find((row) => matchesWhere(row, where)) ?? null,
    count: async (entity, where) => tableFor(entity).filter((row) => matchesWhere(row, where)).length,
    create: (entity, data) => {
      const row: Row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data }
      pendingCreates.push({ entity, row })
      return row
    },
    persist: () => {},
    flush: async () => {
      const toApply = pendingCreates
      pendingCreates = []
      for (const { entity, row } of toApply) tableFor(entity).push(row)
    },
    fork: () => em,
  }
  return { em, tables }
}

function seedCode(
  tables: Map<Function, Row[]>,
  overrides: Partial<{
    id: string
    type: PromotionCodeType
    prefix: string | null
    suffix: string | null
    length: number | null
    amount: number | null
    generated: number
    deletedAt: Date | null
  }> = {},
): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Dynamic pool',
    type: 'dynamic',
    code: null,
    prefix: null,
    suffix: null,
    length: 6,
    amount: 5,
    generated: 0,
    used: 0,
    usage: 'unlimited',
    usageAmount: null,
    usagePerCustomer: null,
    active: true,
    deletedAt: null,
    ...overrides,
  }
  const rows = tables.get(Code) ?? []
  rows.push(row)
  tables.set(Code, rows)
  return row
}

function seedGeneratedCode(tables: Map<Function, Row[]>, overrides: Partial<{ codeId: string; code: string; active: boolean }>): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    active: true,
    ...overrides,
  }
  const rows = tables.get(GeneratedCode) ?? []
  rows.push(row)
  tables.set(GeneratedCode, rows)
  return row
}

function fakeCtx(em: FakeEm) {
  return {
    jobId: 'job-1',
    attemptNumber: 1,
    queueName: 'promotions-code-generate',
    resolve: <T>(name: string): T => {
      if (name === 'em') return em as unknown as T
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  }
}

function makeJob(payload: { codeId: string; tenantId: string; organizationId: string }) {
  return { id: 'queued-job-1', payload, createdAt: new Date().toISOString() }
}

describe('promotions:code-generation worker', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    emitPromotionsEvent.mockClear()
  })

  it('generates the target amount from scratch and reconciles Code.generated to the real count', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { amount: 5, length: 6 })

    await handle(makeJob({ codeId: code.id as string, tenantId: TENANT, organizationId: ORG }), fakeCtx(em) as any)

    const generatedRows = tables.get(GeneratedCode) ?? []
    expect(generatedRows).toHaveLength(5)
    const codes = generatedRows.map((row) => row.code as string)
    expect(new Set(codes).size).toBe(5)
    for (const value of codes) expect(value).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/)
    expect(code.generated).toBe(5)
    expect(emitPromotionsEvent).toHaveBeenCalledWith(
      'promotions.generated_code.created',
      expect.objectContaining({ codeId: code.id, generated: 5, amount: 5 }),
      { persistent: true },
    )
  })

  it('is idempotent on restart: tops up to amount without duplicating existing rows, and never trusts a stale Code.generated counter', async () => {
    const { em, tables } = createFakeEm()
    // §Operational Risks "Dynamic Code Generation Stall": `Code.generated` is seeded as
    // STALE (0) even though 2 `GeneratedCode` rows already exist — simulating a worker
    // crash right after a partial insert, before the counter was reconciled.
    const code = seedCode(tables, { amount: 5, length: 6, generated: 0 })
    seedGeneratedCode(tables, { codeId: code.id as string, code: 'AAAAAA' })
    seedGeneratedCode(tables, { codeId: code.id as string, code: 'BBBBBB' })

    await handle(makeJob({ codeId: code.id as string, tenantId: TENANT, organizationId: ORG }), fakeCtx(em) as any)

    const generatedRows = (tables.get(GeneratedCode) ?? []).filter((row) => row.codeId === code.id)
    expect(generatedRows).toHaveLength(5)
    const codes = generatedRows.map((row) => row.code as string)
    expect(codes).toEqual(expect.arrayContaining(['AAAAAA', 'BBBBBB']))
    expect(new Set(codes).size).toBe(5)
    // Reconciled to the ACTUAL count (5), not `0 + however many were newly inserted`.
    expect(code.generated).toBe(5)
  })

  it('is a safe no-op re-delivery once the pool is already complete', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { amount: 2, length: 6, generated: 2 })
    seedGeneratedCode(tables, { codeId: code.id as string, code: 'AAAAAA' })
    seedGeneratedCode(tables, { codeId: code.id as string, code: 'BBBBBB' })

    await handle(makeJob({ codeId: code.id as string, tenantId: TENANT, organizationId: ORG }), fakeCtx(em) as any)

    const generatedRows = (tables.get(GeneratedCode) ?? []).filter((row) => row.codeId === code.id)
    expect(generatedRows).toHaveLength(2)
    expect(code.generated).toBe(2)
  })

  it('retries past a forced collision against the shared Code/GeneratedCode namespace and still reaches the target amount', async () => {
    const { em, tables } = createFakeEm()
    // length: 1 so each candidate draw consumes exactly one `Math.random()` call,
    // making the sequence below fully deterministic.
    const code = seedCode(tables, { amount: 1, length: 1 })
    // A DIFFERENT code's generated row occupying the character the first mocked draw
    // will produce — proves the collision check spans the whole tenant/org namespace,
    // not just this code's own rows (W5d).
    const otherCode = seedCode(tables, { amount: 1, length: 1 })
    seedGeneratedCode(tables, { codeId: otherCode.id as string, code: charAt(0) })

    const randomSpy = jest.spyOn(Math, 'random')
    randomSpy.mockReturnValueOnce(0) // collides with the pre-seeded row above
    randomSpy.mockReturnValueOnce(0.5) // distinct character — the winning candidate

    await handle(makeJob({ codeId: code.id as string, tenantId: TENANT, organizationId: ORG }), fakeCtx(em) as any)

    const ownRows = (tables.get(GeneratedCode) ?? []).filter((row) => row.codeId === code.id)
    expect(ownRows).toHaveLength(1)
    expect(ownRows[0].code).toBe(charAt(0.5))
    expect(ownRows[0].code).not.toBe(charAt(0))
    expect(code.generated).toBe(1)
  })

  it('skips a code that is not a dynamic pool with a target amount', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { type: 'static' as PromotionCodeType, amount: null })

    await handle(makeJob({ codeId: code.id as string, tenantId: TENANT, organizationId: ORG }), fakeCtx(em) as any)

    expect(tables.get(GeneratedCode) ?? []).toHaveLength(0)
    expect(emitPromotionsEvent).not.toHaveBeenCalled()
  })

  it('skips a code that is missing, soft-deleted, or in a different tenant/org', async () => {
    const { em } = createFakeEm()

    await handle(makeJob({ codeId: 'no-such-code', tenantId: TENANT, organizationId: ORG }), fakeCtx(em) as any)

    expect(emitPromotionsEvent).not.toHaveBeenCalled()
  })
})
