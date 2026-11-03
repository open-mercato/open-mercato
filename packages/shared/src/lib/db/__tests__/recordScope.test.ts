jest.mock('../../query/engine', () => ({
  resolveEntityTableName: jest.fn((_em: unknown, entityType: string) => entityType.split(':')[1] ?? entityType),
}))

import {
  loadEntityRecordScope,
  resetEntityScopeColumnsCacheForTests,
  resolveEntityScopeColumns,
} from '../recordScope'

type Row = Record<string, string | null>

function buildEm(options: {
  metadata?: Array<{ tableName: string; properties: Record<string, { fieldNames: string[] }> }>
  row?: Row
  probeColumns?: string[]
  probeError?: Error
}) {
  const selects: Array<{ table: string; columns: unknown }> = []
  const db = {
    selectFrom: jest.fn((table: string) => {
      const builder = {
        select: jest.fn((columns: unknown) => {
          selects.push({ table, columns })
          return builder
        }),
        where: jest.fn(() => builder),
        execute: jest.fn(async () => {
          if (options.probeError) throw options.probeError
          return (options.probeColumns ?? []).map((column_name) => ({ column_name }))
        }),
        executeTakeFirst: jest.fn(async () => options.row),
      }
      return builder
    }),
  }
  const em = {
    getKysely: jest.fn(() => db),
    getMetadata: jest.fn(() => ({ getAll: () => options.metadata ?? [] })),
  }
  return { em: em as never, db, selects }
}

const scopedProperties = {
  id: { fieldNames: ['id'] },
  organizationId: { fieldNames: ['organization_id'] },
  tenantId: { fieldNames: ['tenant_id'] },
}

describe('recordScope', () => {
  beforeEach(() => resetEntityScopeColumnsCacheForTests())

  it('does not query a global table that has no scope columns', async () => {
    const { em, db } = buildEm({
      metadata: [{ tableName: 'feature_toggles', properties: { id: { fieldNames: ['id'] } } }],
    })

    await expect(loadEntityRecordScope(em, 'feature_toggles:feature_toggles', 'toggle-1')).resolves.toBeNull()
    expect(db.selectFrom).not.toHaveBeenCalled()
  })

  it('reads both scope columns for a fully scoped table', async () => {
    const { em, selects } = buildEm({
      metadata: [{ tableName: 'customer_people', properties: scopedProperties }],
      row: { organization_id: 'org-1', tenant_id: 'tenant-1' },
    })

    await expect(loadEntityRecordScope(em, 'customers:customer_people', 'p1'))
      .resolves.toEqual({ organizationId: 'org-1', tenantId: 'tenant-1' })
    expect(selects).toEqual([{ table: 'customer_people', columns: ['organization_id', 'tenant_id'] }])
  })

  it('selects only tenant_id for a tenant-level table', async () => {
    const { em, selects } = buildEm({
      metadata: [{ tableName: 'tenant_things', properties: { tenantId: { fieldNames: ['tenant_id'] } } }],
      row: { tenant_id: 'tenant-1' },
    })

    await expect(loadEntityRecordScope(em, 'mod:tenant_things', 't1'))
      .resolves.toEqual({ organizationId: null, tenantId: 'tenant-1' })
    expect(selects).toEqual([{ table: 'tenant_things', columns: ['tenant_id'] }])
  })

  it('returns null when the row is missing', async () => {
    const { em } = buildEm({ metadata: [{ tableName: 'customer_people', properties: scopedProperties }] })
    await expect(loadEntityRecordScope(em, 'customers:customer_people', 'missing')).resolves.toBeNull()
  })

  it('probes information_schema when the table has no ORM metadata', async () => {
    const { em, selects } = buildEm({ probeColumns: ['tenant_id'], row: { tenant_id: 'tenant-1' } })

    await expect(resolveEntityScopeColumns(em, 'mod:unregistered'))
      .resolves.toEqual({ table: 'unregistered', organizationColumn: null, tenantColumn: 'tenant_id' })
    expect(selects[0]).toEqual({ table: 'information_schema.columns', columns: ['column_name'] })
  })

  it('skips the row lookup when the column probe fails', async () => {
    const { em, selects } = buildEm({ probeError: new Error('boom') })

    await expect(loadEntityRecordScope(em, 'mod:unregistered', 'r1')).resolves.toBeNull()
    expect(selects).toEqual([{ table: 'information_schema.columns', columns: ['column_name'] }])
  })
})
