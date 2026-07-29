/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveBaseCurrencyCode } from '../baseCurrency'

type ExecuteMock = jest.Mock<Promise<Array<Record<string, unknown>>>, [string, unknown[]]>

function createEm(execute: ExecuteMock): EntityManager {
  return { getConnection: () => ({ execute }) } as unknown as EntityManager
}

describe('resolveBaseCurrencyCode', () => {
  test('returns the normalized base currency code', async () => {
    const execute = jest.fn(async () => [{ code: ' pln ' }]) as ExecuteMock

    await expect(resolveBaseCurrencyCode(createEm(execute), { tenantId: 'tenant-1' })).resolves.toBe('PLN')
  })

  test('scopes the lookup to the tenant and the requested organizations', async () => {
    const execute = jest.fn(async () => [{ code: 'EUR' }]) as ExecuteMock

    await resolveBaseCurrencyCode(createEm(execute), {
      tenantId: 'tenant-1',
      organizationIds: ['org-1', 'org-2'],
    })

    const [sql, params] = execute.mock.calls[0]
    expect(sql).toContain('tenant_id = ?')
    expect(sql).toContain('is_base = true')
    expect(sql).toContain('deleted_at IS NULL')
    expect(sql).toContain('organization_id = ANY(?::uuid[])')
    expect(params).toEqual(['tenant-1', '{org-1,org-2}', '{org-1,org-2}'])
  })

  test('prefers the first organization in scope order', async () => {
    const execute = jest.fn(async () => [{ code: 'EUR' }]) as ExecuteMock

    await resolveBaseCurrencyCode(createEm(execute), {
      tenantId: 'tenant-1',
      organizationIds: ['org-1', 'org-2'],
    })

    const [sql] = execute.mock.calls[0]
    expect(sql).toContain('ORDER BY array_position(?::uuid[], organization_id) ASC')
  })

  test('omits the organization filter when the scope has none', async () => {
    const execute = jest.fn(async () => [{ code: 'EUR' }]) as ExecuteMock

    await resolveBaseCurrencyCode(createEm(execute), { tenantId: 'tenant-1' })

    const [sql, params] = execute.mock.calls[0]
    expect(sql).not.toContain('organization_id')
    expect(params).toEqual(['tenant-1'])
  })

  test('returns null when no base currency is configured', async () => {
    const execute = jest.fn(async () => []) as ExecuteMock

    await expect(resolveBaseCurrencyCode(createEm(execute), { tenantId: 'tenant-1' })).resolves.toBeNull()
  })

  test('returns null when the currencies module is not installed', async () => {
    const execute = jest.fn(async () => {
      throw new Error('relation "currencies" does not exist')
    }) as ExecuteMock

    await expect(resolveBaseCurrencyCode(createEm(execute), { tenantId: 'tenant-1' })).resolves.toBeNull()
  })

  test('does not query without a tenant', async () => {
    const execute = jest.fn(async () => [{ code: 'EUR' }]) as ExecuteMock

    await expect(resolveBaseCurrencyCode(createEm(execute), { tenantId: '' })).resolves.toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })
})
