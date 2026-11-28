/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { BaseCurrencyService } from '../baseCurrencyService'

function createService(
  rowsOrError: Array<Record<string, unknown>> | Error,
  options: { inTransaction?: boolean } = {},
) {
  const execute = jest.fn(async () => {
    if (rowsOrError instanceof Error) throw rowsOrError
    return rowsOrError
  })
  const getConnection = jest.fn(() => {
    throw new Error('getConnection must not be used: it always takes a separate pooled connection')
  })
  const savepointEm = { execute }
  const transactional = jest.fn(async (callback: (tem: typeof savepointEm) => Promise<unknown>) => callback(savepointEm))
  const getTransactionContext = jest.fn(() => (options.inTransaction ? {} : undefined))
  const em = { execute, getConnection, transactional, getTransactionContext } as unknown as EntityManager
  return { service: new BaseCurrencyService(em), execute, getConnection, transactional }
}

describe('BaseCurrencyService', () => {
  test('resolves one shared base currency for every organization in scope', async () => {
    const { service, execute } = createService([
      { organization_id: 'org-1', code: ' pln ' },
      { organization_id: 'org-2', code: 'PLN' },
    ])

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: ['org-1', 'org-2', 'org-1'],
    })).resolves.toEqual({ status: 'resolved', code: 'PLN' })
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('is_base = true'), [
      'tenant-1',
      '{org-1,org-2}',
    ])
  })

  test('queries through em.execute so a transaction bound to the given em is reused', async () => {
    const { service, execute, getConnection, transactional } = createService([
      { organization_id: 'org-1', code: 'EUR' },
    ])

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    })).resolves.toEqual({ status: 'resolved', code: 'EUR' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(getConnection).not.toHaveBeenCalled()
    expect(transactional).not.toHaveBeenCalled()
  })

  test('runs the lookup in a clear savepoint when the given em carries a transaction', async () => {
    const { service, execute, transactional } = createService(
      [{ organization_id: 'org-1', code: 'EUR' }],
      { inTransaction: true },
    )

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    })).resolves.toEqual({ status: 'resolved', code: 'EUR' })
    expect(transactional).toHaveBeenCalledTimes(1)
    expect(transactional).toHaveBeenCalledWith(expect.any(Function), { clear: true })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test('fails soft inside a transaction through the savepoint that rolls the lookup back', async () => {
    const { service, transactional } = createService(
      new Error('invalid input syntax for type uuid'),
      { inTransaction: true },
    )

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    })).resolves.toEqual({ status: 'unavailable' })
    expect(transactional).toHaveBeenCalledTimes(1)
  })

  test('represents differing organization currencies as ambiguous', async () => {
    const { service } = createService([
      { organization_id: 'org-1', code: 'PLN' },
      { organization_id: 'org-2', code: 'EUR' },
    ])

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: ['org-1', 'org-2'],
    })).resolves.toEqual({ status: 'ambiguous' })
  })

  test('represents a missing organization base currency explicitly', async () => {
    const { service } = createService([{ organization_id: 'org-1', code: 'PLN' }])

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: ['org-1', 'org-2'],
    })).resolves.toEqual({ status: 'missing' })
  })

  test('fails soft when the currencies table is unavailable', async () => {
    const { service } = createService(new Error('relation "currencies" does not exist'))

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    })).resolves.toEqual({ status: 'unavailable' })
  })

  test('does not pick a currency for an unbounded organization scope', async () => {
    const { service, execute } = createService([])

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: [],
    })).resolves.toEqual({ status: 'ambiguous' })
    expect(execute).not.toHaveBeenCalled()
  })
})
