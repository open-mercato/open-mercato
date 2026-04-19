import type { EntityManager } from '@mikro-orm/postgresql'
import type { StorageDriver } from './types'
import { LocalStorageDriver } from './localDriver'
import { LegacyPublicStorageDriver } from './legacyPublicDriver'
import { AttachmentPartition } from '../../data/entities'

export class StorageDriverFactory {
  private readonly cache = new Map<string, StorageDriver>()
  private readonly localDriver = new LocalStorageDriver()
  private readonly legacyPublicDriver = new LegacyPublicStorageDriver()

  constructor(private readonly em: EntityManager) {}

  resolveForAttachment(
    storageDriver: string,
    configJson?: Record<string, unknown> | null,
  ): StorageDriver {
    switch (storageDriver) {
      case 'legacyPublic':
        return this.legacyPublicDriver

      case 's3': {
        const cacheKey = `s3:${JSON.stringify(configJson ?? {})}`
        const cached = this.cache.get(cacheKey)
        if (cached) return cached
        // S3Driver is lazy-imported so packages/core does not require @aws-sdk/client-s3
        // at module load time — the import only triggers when an s3 partition is actually used.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { S3StorageDriver } = require('./s3Driver') as typeof import('./s3Driver')
        const driver = new S3StorageDriver(configJson ?? {})
        this.cache.set(cacheKey, driver)
        return driver
      }

      case 'local':
      default:
        return this.localDriver
    }
  }

  async resolveForPartition(partitionCode: string): Promise<StorageDriver> {
    const partition = await this.em.findOne(AttachmentPartition, { code: partitionCode })
    if (!partition) return this.localDriver
    return this.resolveForAttachment(partition.storageDriver, partition.configJson)
  }
}
