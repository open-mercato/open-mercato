import type { EntityManager } from '@mikro-orm/postgresql'
import type { StorageDriver } from './types'
import { LocalStorageDriver } from './localDriver'
import { LegacyPublicStorageDriver } from './legacyPublicDriver'
import { AttachmentPartition } from '../../data/entities'

type DriverScope = { tenantId: string; organizationId: string }
type CredentialEnhancer = (config: Record<string, unknown>, scope: DriverScope) => Promise<Record<string, unknown>>

type DriverRegistration = { factory: (config: Record<string, unknown>) => StorageDriver }
type EnhancerRegistration = { enhancer: CredentialEnhancer }

const moduleDriverRegistry = new Map<string, DriverRegistration>()
const moduleEnhancerRegistry = new Map<string, EnhancerRegistration>()

export function registerExternalStorageDriver(
  key: string,
  factory: (config: Record<string, unknown>) => StorageDriver,
): void {
  moduleDriverRegistry.set(key, { factory })
}

export function registerExternalCredentialEnhancer(key: string, enhancer: CredentialEnhancer): void {
  moduleEnhancerRegistry.set(key, { enhancer })
}

export class StorageDriverFactory {
  private readonly cache = new Map<string, StorageDriver>()
  private readonly localDriver = new LocalStorageDriver()
  private readonly legacyPublicDriver = new LegacyPublicStorageDriver()
  private readonly externalDrivers = new Map<string, (config: Record<string, unknown>) => StorageDriver>()
  private readonly credentialEnhancers = new Map<string, CredentialEnhancer>()

  constructor(private readonly em: EntityManager) {}

  registerDriver(key: string, factory: (config: Record<string, unknown>) => StorageDriver): void {
    this.externalDrivers.set(key, factory)
  }

  registerCredentialEnhancer(key: string, enhancer: CredentialEnhancer): void {
    this.credentialEnhancers.set(key, enhancer)
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
        const externalFactory =
          this.externalDrivers.get(storageDriver) ?? moduleDriverRegistry.get(storageDriver)?.factory
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

  async resolveForPartition(partitionCode: string, scope?: DriverScope): Promise<StorageDriver> {
    const partition = await this.em.findOne(AttachmentPartition, { code: partitionCode })
    if (!partition) return this.localDriver

    const driverKey = partition.storageDriver ?? 'local'
    console.log(`[storageDriverFactory] resolveForPartition: partition=${partitionCode} driverKey=${driverKey} moduleDrivers=${[...moduleDriverRegistry.keys()].join(',')} instanceDrivers=${[...this.externalDrivers.keys()].join(',')}`)
    let config: Record<string, unknown> = partition.configJson ?? {}

    const activeEnhancer =
      this.credentialEnhancers.get(driverKey) ?? moduleEnhancerRegistry.get(driverKey)?.enhancer
    if (scope && activeEnhancer) {
      config = await activeEnhancer(config, scope)
      // Skip shared cache for scope-enhanced configs (credentials are per-tenant)
      const externalFactory =
        this.externalDrivers.get(driverKey) ?? moduleDriverRegistry.get(driverKey)?.factory
      if (externalFactory) return externalFactory(config)
    }

    return this.resolveForAttachment(driverKey, config)
  }
}
