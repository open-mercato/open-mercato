const warnMock = jest.fn()

jest.mock('../../logger', () => {
  const child = () => ({ debug: jest.fn(), info: jest.fn(), warn: warnMock, error: jest.fn(), child })
  return { createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: warnMock, error: jest.fn(), child }) }
})

import { BasicQueryEngine } from '../engine'
import { registerModules } from '../../i18n/server'
import { DECRYPT_REFUSAL_LOG_MESSAGE } from '../../encryption/decryptScope'

registerModules([] as any)

type FakeRow = Record<string, any>

function createFakeDb(rows: FakeRow[]) {
  const columns = ['id', 'tenant_id', 'organization_id', 'deleted_at', 'display_name'].map((column_name) => ({
    table_name: 'customer_entities',
    column_name,
  }))
  const build = (table: string) => {
    const state: any = { table, rows: table === 'customer_entities' ? rows : columns }
    const chain: any = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === 'execute') return async () => state.rows.map((row: FakeRow) => ({ ...row }))
          if (prop === 'executeTakeFirst') return async () => ({ count: String(state.rows.length) })
          if (prop === 'then') return undefined
          return () => chain
        },
      },
    )
    return chain
  }
  return { selectFrom: (table: string) => build(table), fn: { count: () => ({ as: () => ({}) }) } }
}

describe('BasicQueryEngine aggregated decrypt-refusal warning (#5430)', () => {
  beforeEach(() => warnMock.mockClear())

  const engineFor = (rows: FakeRow[]) =>
    new BasicQueryEngine({} as any, () => createFakeDb(rows) as any, () => ({
      isEnabled: () => true,
      getEncryptedFieldNames: async () => ['display_name'],
      decryptEntityPayload: async () => ({ display_name: 'PLAINTEXT' }),
    }))

  const run = (rows: FakeRow[]) =>
    engineFor(rows).query('customers:customer_entity', {
      tenantId: 'tenant-a',
      fields: ['id', 'display_name'],
      page: { page: 1, pageSize: 10 },
    })

  const refusalWarnings = () => warnMock.mock.calls.filter(([message]) => message === DECRYPT_REFUSAL_LOG_MESSAGE)

  test('emits exactly one warning for a page containing several refused rows', async () => {
    await run([
      { id: '1', tenant_id: 'tenant-b', organization_id: 'org1', display_name: 'cipher-1' },
      { id: '2', tenant_id: 'tenant-c', organization_id: 'org1', display_name: 'cipher-2' },
      { id: '3', tenant_id: 'tenant-d', organization_id: 'org1', display_name: 'cipher-3' },
    ])
    const warnings = refusalWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0][1]).toEqual({
      entity: 'customers:customer_entity',
      refusedRows: 3,
      callerTenantId: 'tenant-a',
      rowTenantIds: ['tenant-b', 'tenant-c', 'tenant-d'],
    })
  })

  test('samples at most three distinct row tenant ids while counting them all', async () => {
    await run(
      ['tenant-b', 'tenant-c', 'tenant-d', 'tenant-e', 'tenant-f'].map((tenant, index) => ({
        id: String(index + 1),
        tenant_id: tenant,
        organization_id: 'org1',
        display_name: `cipher-${index}`,
      })),
    )
    const [, context] = refusalWarnings()[0]
    expect(context.refusedRows).toBe(5)
    expect(context.rowTenantIds).toHaveLength(3)
  })

  test('emits no warning when every row matches the caller tenant', async () => {
    await run([
      { id: '1', tenant_id: 'tenant-a', organization_id: 'org1', display_name: 'cipher-1' },
      { id: '2', tenant_id: 'tenant-a', organization_id: 'org1', display_name: 'cipher-2' },
    ])
    expect(refusalWarnings()).toHaveLength(0)
  })

  test('never puts a decrypted or ciphertext field value in the log context', async () => {
    await run([{ id: '1', tenant_id: 'tenant-b', organization_id: 'org1', display_name: 'cipher-secret' }])
    expect(JSON.stringify(refusalWarnings()[0][1])).not.toContain('cipher-secret')
    expect(JSON.stringify(refusalWarnings()[0][1])).not.toContain('PLAINTEXT')
  })
})
