/**
 * @jest-environment node
 */
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOptionalBaseCurrencyCode } from '../optionalBaseCurrency'

function createContainer(resolver?: { resolveBaseCurrency: jest.Mock }): AppContainer {
  return {
    resolve: <T>(name: string): T => {
      if (name === 'baseCurrencyService' && resolver) return resolver as unknown as T
      throw new Error(`[internal] Missing DI service: ${name}`)
    },
  } as AppContainer
}

describe('resolveOptionalBaseCurrencyCode', () => {
  test('returns the resolved code from the currencies-owned service', async () => {
    const resolveBaseCurrency = jest.fn(async () => ({ status: 'resolved', code: 'PLN' }))

    await expect(resolveOptionalBaseCurrencyCode(
      createContainer({ resolveBaseCurrency }),
      'tenant-1',
      'org-1',
    )).resolves.toBe('PLN')
    expect(resolveBaseCurrency).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    })
  })

  test('degrades to null when the currencies module is disabled', async () => {
    await expect(resolveOptionalBaseCurrencyCode(
      createContainer(),
      'tenant-1',
      'org-1',
    )).resolves.toBeNull()
  })

  test('degrades non-resolved and failed lookups to null', async () => {
    const missing = jest.fn(async () => ({ status: 'missing' }))
    await expect(resolveOptionalBaseCurrencyCode(
      createContainer({ resolveBaseCurrency: missing }),
      'tenant-1',
      'org-1',
    )).resolves.toBeNull()

    const failed = jest.fn(async () => {
      throw new Error('lookup failed')
    })
    await expect(resolveOptionalBaseCurrencyCode(
      createContainer({ resolveBaseCurrency: failed }),
      'tenant-1',
      'org-1',
    )).resolves.toBeNull()
  })
})
