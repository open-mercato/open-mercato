jest.mock('../../telemetry/runtime', () => ({ getTelemetryRuntime: jest.fn() }))

jest.mock('../../query/engine', () => ({
  resolveEntityTableName: jest.fn((_em: unknown, entityType: string) => entityType.split(':')[1] ?? entityType),
}))

import {
  loadEntityRecordScope,
  resetEntityScopeColumnsCacheForTests,
  resolveEntityScopeColumns,
} from '../recordScope'

import { getTelemetryRuntime } from '../../telemetry/runtime'

type Row = Record<string, unknown>

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
  beforeEach(() => {
    jest.clearAllMocks()
    resetEntityScopeColumnsCacheForTests()
  })

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
    const error = new Error('boom')
    const reportError = jest.fn()
    jest.mocked(getTelemetryRuntime).mockReturnValue({ reportError } as never)
    const { em, selects } = buildEm({ probeError: error })

    await expect(loadEntityRecordScope(em, 'mod:unregistered', 'r1')).resolves.toBeNull()
    expect(selects).toEqual([{ table: 'information_schema.columns', columns: ['column_name'] }])
    expect(reportError).toHaveBeenCalledWith(error, {
      module: 'shared', code: 'shared.scope_column_probe_failed', attributes: { table: 'unregistered' },
    })
  })

  it('keeps the safe probe fallback when the telemetry backend throws', async () => {
    jest.mocked(getTelemetryRuntime).mockReturnValue({
      reportError: () => { throw new Error('[internal] telemetry unavailable') },
    } as never)
    const { em, db } = buildEm({ probeError: new Error('[internal] catalog unavailable') })
    await expect(loadEntityRecordScope(em, 'mod:unregistered', 'r1')).resolves.toBeNull()
    expect(db.selectFrom).toHaveBeenCalledTimes(1)
  })

  it('rejects non-string scope values from the database boundary', async () => {
    const { em } = buildEm({
      metadata: [{ tableName: 'customer_people', properties: scopedProperties }],
      row: { tenant_id: 123, organization_id: {} },
    })
    await expect(loadEntityRecordScope(em, 'customers:customer_people', 'p1'))
      .resolves.toEqual({ tenantId: null, organizationId: null })
  })
  it('keeps probed columns isolated between database clients', async () => {
    const first = buildEm({ probeColumns: ['tenant_id'] })
    const second = buildEm({ probeColumns: ['organization_id'] })

    await expect(resolveEntityScopeColumns(first.em, 'mod:unregistered'))
      .resolves.toEqual({ table: 'unregistered', organizationColumn: null, tenantColumn: 'tenant_id' })
    await expect(resolveEntityScopeColumns(second.em, 'mod:unregistered'))
      .resolves.toEqual({ table: 'unregistered', organizationColumn: 'organization_id', tenantColumn: null })
    expect(first.db.selectFrom).toHaveBeenCalledTimes(1)
    expect(second.db.selectFrom).toHaveBeenCalledTimes(1)
  })

})
