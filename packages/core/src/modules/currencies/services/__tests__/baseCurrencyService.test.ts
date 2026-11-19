/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { BaseCurrencyService } from '../baseCurrencyService'

function createService(rowsOrError: Array<Record<string, unknown>> | Error) {
  const execute = jest.fn(async () => {
    if (rowsOrError instanceof Error) throw rowsOrError
    return rowsOrError
  })
  const getConnection = jest.fn(() => {
    throw new Error('getConnection must not be used: it bypasses the ambient transaction')
  })
  const em = { execute, getConnection } as unknown as EntityManager
  return { service: new BaseCurrencyService(em), execute, getConnection }
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

  test('queries through the entity manager so an ambient transaction connection is reused', async () => {
    const { service, execute, getConnection } = createService([
      { organization_id: 'org-1', code: 'EUR' },
    ])

    await expect(service.resolveBaseCurrency({
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    })).resolves.toEqual({ status: 'resolved', code: 'EUR' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(getConnection).not.toHaveBeenCalled()
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
