import type { EntityManager } from '@mikro-orm/postgresql'
import { MetadataStorage } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { seedCatalogExamples } from '../examples'

describe('Catalog examples with Sales disabled', () => {
  it('skips the commerce dataset without reading or writing unregistered entities', async () => {
    const findOne = jest.fn().mockRejectedValue(new Error('[internal] No database reads are allowed without Sales'))
    const persist = jest.fn()
    const flush = jest.fn()
    const metadata = new MetadataStorage()
    const em = {
      getMetadata: () => metadata,
      findOne,
      persist,
      flush,
    } as unknown as EntityManager
    const resolve = jest.fn()
    const container = { resolve } as unknown as AwilixContainer

    await expect(seedCatalogExamples(em, container, {
      tenantId: '0c13072d-351b-4fdc-a6f1-bd65fb297132',
      organizationId: '8f723c79-7db9-4b60-a2e0-965d91a06c63',
    })).resolves.toBe(false)

    expect(findOne).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })
})
