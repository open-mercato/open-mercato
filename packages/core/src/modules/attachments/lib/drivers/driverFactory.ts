import type { EntityManager } from '@mikro-orm/postgresql'
import type { StorageDriver } from './types'
import { LocalStorageDriver } from './localDriver'
import { LegacyPublicStorageDriver } from './legacyPublicDriver'
import { AttachmentPartition } from '../../data/entities'

export class StorageDriverFactory {
  private readonly cache = new Map<string, StorageDriver>()
  private readonly localDriver = new LocalStorageDriver()
  private readonly legacyPublicDriver = new LegacyPublicStorageDriver()
  private readonly externalDrivers = new Map<string, (config: Record<string, unknown>) => StorageDriver>()

  constructor(private readonly em: EntityManager) {}

  registerDriver(key: string, factory: (config: Record<string, unknown>) => StorageDriver): void {
    this.externalDrivers.set(key, factory)
  }

  resolveForAttachment(
    storageDriver: string,
    configJson?: Record<string, unknown> | null,
  ): StorageDriver {
    switch (storageDriver) {
      case 'legacyPublic':
        return this.legacyPublicDriver

      case 'local':
        return this.localDriver

      default: {
        const externalFactory = this.externalDrivers.get(storageDriver)
        if (externalFactory) {
          const cacheKey = `${storageDriver}:${JSON.stringify(configJson ?? {})}`
          const cached = this.cache.get(cacheKey)
          if (cached) return cached
          const driver = externalFactory(configJson ?? {})
          this.cache.set(cacheKey, driver)
          return driver
        }
        return this.localDriver
      }
    }
  }

  async resolveForPartition(partitionCode: string): Promise<StorageDriver> {
    const partition = await this.em.findOne(AttachmentPartition, { code: partitionCode })
    if (!partition) return this.localDriver
    return this.resolveForAttachment(partition.storageDriver, partition.configJson)
  }
}
