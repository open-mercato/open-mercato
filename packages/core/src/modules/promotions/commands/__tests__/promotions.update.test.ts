// QA F2 regression coverage — `promotions.promotion.update` must not re-apply
// create-time schema defaults onto fields the caller never sent. Before the fix,
// `promotionUpdateSchema` (derived from `promotionBaseShape.partial()`) still carried
// each field's own `.default()`, so Zod filled omitted keys with `active: false` /
// `tags: []` / etc., and the `!== undefined` guards in `commands/promotions.ts`'s
// `execute` phase never skipped them. Same hand-built, in-memory fake `EntityManager`
// style as `commands/__tests__/codes.crud.test.ts`.

import { randomUUID } from 'crypto'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Promotion } from '../../data/entities'
import { updatePromotionCommand } from '../promotions'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

const TENANT = 'tenant-1'
const ORG = 'org-1'

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
  flush: () => Promise<void>
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  isInTransaction: () => boolean
  fork: () => FakeEm
}

function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]> } {
  const tables = new Map<Function, Row[]>()
  let inTransaction = false

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
    flush: async () => {},
    begin: async () => {
      inTransaction = true
    },
    commit: async () => {
      inTransaction = false
    },
    rollback: async () => {
      inTransaction = false
    },
    isInTransaction: () => inTransaction,
    fork: () => em,
  }
  return { em, tables }
}

function seedPromotion(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Launch promo',
    description: null,
    order: 1,
    active: true,
    startsAt: null,
    endsAt: null,
    cumulative: true,
    tags: ['x'],
    excludedTags: [],
    excludeFlags: {},
    eligibleCurrencies: [],
    maxBudget: null,
    budgetCurrency: null,
    ruleGroupId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
  const rows = tables.get(Promotion) ?? []
  rows.push(row)
  tables.set(Promotion, rows)
  return row
}

function fakeCtx(em: FakeEm, dataEngine: { markOrmEntityChange: jest.Mock }): CommandRuntimeContext {
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return dataEngine
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  }
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: null,
    transactionalEm: undefined,
  }
}

describe('promotions.promotion.update command', () => {
  it('leaves active/tags/cumulative/excludedTags/excludeFlags untouched when the PUT body omits them (QA F2 live repro)', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables, {
      active: true,
      tags: ['x'],
      cumulative: true,
      excludedTags: ['legacy'],
      excludeFlags: { gift: true },
      eligibleCurrencies: [],
    })
    const dataEngine = { markOrmEntityChange: jest.fn() }
    const ctx = fakeCtx(em, dataEngine)

    const result = await updatePromotionCommand.execute(
      { id: promotion.id, eligibleCurrencies: ['USD'] } as any,
      ctx,
    )

    expect(result.promotionId).toBe(promotion.id)
    expect(promotion.active).toBe(true)
    expect(promotion.tags).toEqual(['x'])
    expect(promotion.cumulative).toBe(true)
    expect(promotion.excludedTags).toEqual(['legacy'])
    expect(promotion.excludeFlags).toEqual({ gift: true })
    expect(promotion.eligibleCurrencies).toEqual(['USD'])
  })

  it('still applies explicitly sent flags on a partial update', async () => {
    const { em, tables } = createFakeEm()
    const promotion = seedPromotion(tables, { active: true, tags: ['x'] })
    const dataEngine = { markOrmEntityChange: jest.fn() }
    const ctx = fakeCtx(em, dataEngine)

    await updatePromotionCommand.execute({ id: promotion.id, active: false, tags: [] } as any, ctx)

    expect(promotion.active).toBe(false)
    expect(promotion.tags).toEqual([])
  })
})
