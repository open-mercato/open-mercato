/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (em: { flush: () => Promise<void> }, phases: (() => unknown)[]) => {
    for (const phase of phases) {
      await phase()
      await em.flush()
    }
  },
}))

import { ensureFallbackProjectAndRule, resolveContainerProjectCodeGenerator, seedSupportDefaults } from '../seedDefaults'
import { seedSupportTicketCategories } from '../dictionaries'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const translate = (_key: string, fallback: string) => fallback

type Row = Record<string, unknown> & { id: string }

class FakeUniqueViolation extends Error {
  code = '23505'
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (expected === null) return actual === null
    return actual === expected
  })
}

function makeEm(options: { beforeFlush?: (pending: { table: string; row: Row }[]) => void } = {}) {
  const tables = new Map<string, Row[]>()
  let pending: { table: string; row: Row }[] = []
  let sequence = 0
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name) as Row[]
  }
  const em: Record<string, unknown> = {
    create: (cls: { name: string }, data: Record<string, unknown>) => {
      sequence += 1
      const row = { id: `${cls.name}-${sequence}`, ...data } as Row
      Object.defineProperty(row, '__table', { value: cls.name, enumerable: false })
      return row
    },
    persist: (row: Row) => {
      pending.push({ table: (row as unknown as { __table: string }).__table, row })
    },
    flush: async () => {
      options.beforeFlush?.(pending)
      for (const entry of pending) table(entry.table).push(entry.row)
      pending = []
    },
    find: async (cls: { name: string }, where: Record<string, unknown>) => table(cls.name).filter((row) => matches(row, where)),
    findOne: async (cls: { name: string }, where: Record<string, unknown>) => table(cls.name).find((row) => matches(row, where)) ?? null,
  }
  em.fork = () => em
  return { em: em as unknown as EntityManager, table }
}

describe('seedSupportTicketCategories', () => {
  it('creates the dictionary and the default categories once', async () => {
    const { em, table } = makeEm()

    await seedSupportTicketCategories(em, SCOPE)
    await seedSupportTicketCategories(em, SCOPE)

    expect(table('Dictionary')).toHaveLength(1)
    expect(table('DictionaryEntry').map((entry) => entry.value)).toEqual([
      'general-question',
      'technical-issue',
      'change-request',
      'billing',
    ])
  })

  it('reports whether this call seeded the dictionary', async () => {
    const { em } = makeEm()
    await expect(seedSupportTicketCategories(em, SCOPE)).resolves.toBe(true)
    await expect(seedSupportTicketCategories(em, SCOPE)).resolves.toBe(false)
  })

  it('never re-adds a default category an admin deleted', async () => {
    const { em, table } = makeEm()
    await seedSupportTicketCategories(em, SCOPE)
    const entries = table('DictionaryEntry')
    entries.splice(entries.findIndex((entry) => entry.value === 'billing'), 1)

    await seedSupportTicketCategories(em, SCOPE)

    expect(table('DictionaryEntry').map((entry) => entry.value)).not.toContain('billing')
    expect(table('DictionaryEntry')).toHaveLength(3)
  })

  it('leaves an emptied dictionary empty', async () => {
    const { em, table } = makeEm()
    await seedSupportTicketCategories(em, SCOPE)
    table('DictionaryEntry').length = 0

    await seedSupportTicketCategories(em, SCOPE)

    expect(table('DictionaryEntry')).toHaveLength(0)
  })

  it('does not seed next to a soft-deleted dictionary', async () => {
    const { em, table } = makeEm()
    table('Dictionary').push({ id: 'old', ...SCOPE, key: 'staff.support_ticket_category', deletedAt: new Date() })

    await expect(seedSupportTicketCategories(em, SCOPE)).resolves.toBe(false)

    expect(table('Dictionary')).toHaveLength(1)
    expect(table('DictionaryEntry')).toHaveLength(0)
  })

  it('treats a lost creation race as already seeded', async () => {
    const { em, table } = makeEm({
      beforeFlush: (pending) => {
        if (pending.some((entry) => entry.table === 'Dictionary')) throw new FakeUniqueViolation('duplicate key')
      },
    })

    await expect(seedSupportTicketCategories(em, SCOPE)).resolves.toBe(false)
    expect(table('DictionaryEntry')).toHaveLength(0)
  })
})

describe('ensureFallbackProjectAndRule', () => {
  it('creates the project, its board and the fallback rule, then is a no-op', async () => {
    const { em, table } = makeEm()

    const first = await ensureFallbackProjectAndRule(em, SCOPE, { translate })
    const second = await ensureFallbackProjectAndRule(em, SCOPE, { translate })

    expect(first.created).toBe(true)
    expect(first.taskStatusIds.length).toBeGreaterThan(0)
    expect(second).toEqual({ ruleId: first.ruleId, timeProjectId: first.timeProjectId, created: false, taskStatusIds: [] })
    expect(table('StaffTimeProject')).toHaveLength(1)
    expect(table('StaffSupportRoutingRule')).toHaveLength(1)
    expect(table('StaffTimeTaskStatus').filter((status) => status.isDefault === true)).toHaveLength(1)
  })

  it('uses the injected code generator', async () => {
    const { em, table } = makeEm()
    await ensureFallbackProjectAndRule(em, SCOPE, { translate, generateCode: () => 'HELP' })
    expect(table('StaffTimeProject')[0].code).toBe('HELP')
  })

  it('returns the concurrent winner instead of failing on a unique violation', async () => {
    let raced = false
    const { em, table } = makeEm({
      beforeFlush: (pending) => {
        if (raced || pending.length === 0) return
        raced = true
        table('StaffSupportRoutingRule').push({
          id: 'winner-rule',
          tenantId: SCOPE.tenantId,
          organizationId: SCOPE.organizationId,
          categoryValue: null,
          timeProjectId: 'winner-project',
          deletedAt: null,
        })
        throw new FakeUniqueViolation('duplicate key value violates unique constraint')
      },
    })

    await expect(ensureFallbackProjectAndRule(em, SCOPE, { translate })).resolves.toEqual({
      ruleId: 'winner-rule',
      timeProjectId: 'winner-project',
      created: false,
      taskStatusIds: [],
    })
  })

  it('rethrows a unique violation when no fallback rule exists afterwards', async () => {
    const { em } = makeEm({
      beforeFlush: (pending) => {
        if (pending.length > 0) throw new FakeUniqueViolation('duplicate key')
      },
    })
    await expect(ensureFallbackProjectAndRule(em, SCOPE, { translate })).rejects.toBeInstanceOf(FakeUniqueViolation)
  })
})

describe('seedSupportDefaults', () => {
  it('is idempotent across repeated runs', async () => {
    const { em, table } = makeEm()
    await seedSupportDefaults(em, SCOPE, { translate })
    await seedSupportDefaults(em, SCOPE, { translate })
    expect(table('StaffTimeProject')).toHaveLength(1)
    expect(table('StaffSupportRoutingRule')).toHaveLength(1)
    expect(table('DictionaryEntry')).toHaveLength(4)
  })
})

describe('resolveContainerProjectCodeGenerator', () => {
  it('wraps the DI code resolver', () => {
    const generate = jest.fn(() => 'CS')
    const generator = resolveContainerProjectCodeGenerator({ resolve: () => ({ generate }) })
    expect(generator?.('Customer support', new Set(['XX']))).toBe('CS')
    expect(generate).toHaveBeenCalledWith('Customer support', new Set(['XX']))
  })

  it('falls back to the built-in generator when the resolver is missing', () => {
    expect(resolveContainerProjectCodeGenerator(null)).toBeUndefined()
    expect(resolveContainerProjectCodeGenerator({ resolve: () => { throw new Error('[internal] missing') } })).toBeUndefined()
  })
})
