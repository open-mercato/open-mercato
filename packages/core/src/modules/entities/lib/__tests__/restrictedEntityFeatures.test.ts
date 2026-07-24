/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  getModules: jest.fn(),
}))

import { synthesizeRestrictedEntityFeatures } from '@open-mercato/core/modules/entities/lib/restrictedEntityFeatures'
import { getModules } from '@open-mercato/shared/lib/i18n/server'

const mockGetModules = getModules as jest.Mock

// Minimal kysely stub: records the where() calls and returns the seeded rows.
function makeEm(rows: Array<{ entity_id: string; label?: string }>) {
  const calls: Array<[string, string, unknown]> = []
  const builder: any = {
    select: () => builder,
    where: (col: unknown, op?: unknown, val?: unknown) => {
      if (typeof col === 'string') calls.push([col, String(op), val])
      // support the eb(...)/eb.or(...) callback form used for tenant scope
      if (typeof col === 'function') {
        const eb: any = (...args: unknown[]) => { calls.push(['eb', String(args[0]), args[2]]); return eb }
        eb.or = () => builder
        eb.and = () => builder
        ;(col as (eb: unknown) => unknown)(eb)
      }
      return builder
    },
    execute: async () => rows,
  }
  const kysely = { selectFrom: () => builder }
  return { em: { getKysely: () => kysely }, calls }
}

describe('synthesizeRestrictedEntityFeatures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetModules.mockReturnValue([])
  })

  it('returns nothing without a tenant', async () => {
    const { em } = makeEm([])
    expect(await synthesizeRestrictedEntityFeatures(em, null)).toEqual([])
  })

  it('synthesizes view+manage features for a registered restricted entity', async () => {
    const { em } = makeEm([{ entity_id: 'hr:salaries', label: 'Salaries' }])
    const items = await synthesizeRestrictedEntityFeatures(em, 't1')
    expect(items).toEqual([
      {
        id: 'entities.records.hr:salaries.view',
        title: 'View records: Salaries',
        module: 'entities',
        dependsOn: ['entities.records.view'],
      },
      {
        id: 'entities.records.hr:salaries.manage',
        title: 'Manage records: Salaries',
        module: 'entities',
        dependsOn: ['entities.records.hr:salaries.view', 'entities.records.manage'],
      },
    ])
  })

  it('includes module-declared (ce.ts) restricted entities', async () => {
    mockGetModules.mockReturnValue([
      { customEntities: [{ id: 'board:minutes', label: 'Board Minutes', accessRestricted: true }, { id: 'crm:vendors', label: 'Vendors' }] },
    ])
    const { em } = makeEm([])
    const items = await synthesizeRestrictedEntityFeatures(em, 't1')
    const ids = items.map((i) => i.id)
    expect(ids).toContain('entities.records.board:minutes.view')
    expect(ids).not.toContain('entities.records.crm:vendors.view') // not flagged
  })

  it('dedupes when an entity is both declared and registered', async () => {
    mockGetModules.mockReturnValue([{ customEntities: [{ id: 'hr:salaries', label: 'Salaries', accessRestricted: true }] }])
    const { em } = makeEm([{ entity_id: 'hr:salaries', label: 'Salaries (registered)' }])
    const items = await synthesizeRestrictedEntityFeatures(em, 't1')
    expect(items.filter((i) => i.id === 'entities.records.hr:salaries.view')).toHaveLength(1)
  })

  it('never throws — returns declared features even if the DB read fails', async () => {
    mockGetModules.mockReturnValue([{ customEntities: [{ id: 'hr:salaries', label: 'Salaries', accessRestricted: true }] }])
    const em = { getKysely: () => { throw new Error('db down') } }
    const items = await synthesizeRestrictedEntityFeatures(em, 't1')
    expect(items.map((i) => i.id)).toContain('entities.records.hr:salaries.view')
  })
})
