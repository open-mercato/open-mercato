import type { EntityManager } from '@mikro-orm/postgresql'
import type { StorageDriver } from './types'
import { LocalStorageDriver } from './localDriver'
import { LegacyPublicStorageDriver } from './legacyPublicDriver'
import { AttachmentPartition } from '../../data/entities'
import {
  AttachmentStorageConfigurationError,
  assertAttachmentStoragePartitionExists,
  getAttachmentStoragePolicy,
  validateAttachmentStorageConfiguration,
  type AttachmentStorageScope,
  type AttachmentStorageValidationStage,
} from './storageValidation'

type DriverScope = AttachmentStorageScope
type CredentialEnhancer = (config: Record<string, unknown>, scope: DriverScope) => Promise<Record<string, unknown>>
type DriverFactory = (config: Record<string, unknown>) => StorageDriver

type ModuleRegistry = {
  drivers: Map<string, DriverFactory>
  enhancers: Map<string, CredentialEnhancer>
}
const REGISTRY_KEY = Symbol.for('@open-mercato/AttachmentStorageDrivers')

function moduleRegistry(): ModuleRegistry {
  const registry = globalThis as typeof globalThis & { [REGISTRY_KEY]?: ModuleRegistry }
  return registry[REGISTRY_KEY] ??= { drivers: new Map(), enhancers: new Map() }
}

export function registerExternalStorageDriver(key: string, factory: DriverFactory): void {
  moduleRegistry().drivers.set(key, factory)
}

export function registerExternalCredentialEnhancer(key: string, enhancer: CredentialEnhancer): void {
  moduleRegistry().enhancers.set(key, enhancer)
}

export class StorageDriverFactory {
  private readonly cache = new Map<string, StorageDriver>()
  private localDriver?: LocalStorageDriver
  private legacyPublicDriver?: LegacyPublicStorageDriver
  private readonly externalDrivers = new Map<string, DriverFactory>()
  private readonly credentialEnhancers = new Map<string, CredentialEnhancer>()

  constructor(private readonly em: EntityManager) {}

  registerDriver(key: string, factory: DriverFactory): void {
    this.externalDrivers.set(key, factory)
  }

  registerCredentialEnhancer(key: string, enhancer: CredentialEnhancer): void {
    this.credentialEnhancers.set(key, enhancer)
  }

  resolveForAttachment(storageDriver: string, configJson?: Record<string, unknown> | null): StorageDriver {
    const config = configJson ?? {}
    this.validate(storageDriver, config, 'configured')
    this.validate(storageDriver, config, 'resolved')
    return this.resolveValidated(storageDriver, config)
  }

  async resolveForPartition(partitionCode: string, scope?: DriverScope): Promise<StorageDriver> {
    getAttachmentStoragePolicy()
    const partition = await this.em.findOne(AttachmentPartition, { code: partitionCode })
    assertAttachmentStoragePartitionExists(Boolean(partition))
    if (!partition) return this.localDriver ??= new LocalStorageDriver()

    let config: Record<string, unknown> = partition.configJson ?? {}
    this.validate(partition.storageDriver, config, 'configured', partitionCode, scope)
    const driverKey = partition.storageDriver ?? 'local'
    const activeEnhancer = this.credentialEnhancers.get(driverKey) ?? moduleRegistry().enhancers.get(driverKey)
    if (scope && activeEnhancer) {
      try {
        config = await activeEnhancer(config, scope)
      } catch (error) {
        if (getAttachmentStoragePolicy() === 'strict') {
          throw new AttachmentStorageConfigurationError('enhancement_failed')
        }
        throw error
      }
      this.validate(driverKey, config, 'resolved', partitionCode, scope)
      const externalFactory = this.externalDrivers.get(driverKey) ?? moduleRegistry().drivers.get(driverKey)
      if (externalFactory) return externalFactory(config)
    } else {
      this.validate(driverKey, config, 'resolved', partitionCode, scope)
    }
    return this.resolveValidated(driverKey, config)
  }

  private validate(
    driverKey: unknown,
    config: unknown,
    stage: AttachmentStorageValidationStage,
    partitionCode?: string,
    scope?: DriverScope,
  ): void {
    const registered = typeof driverKey === 'string' && (
      driverKey === 'local' || driverKey === 'legacyPublic'
      || this.externalDrivers.has(driverKey) || moduleRegistry().drivers.has(driverKey)
    )
    validateAttachmentStorageConfiguration({ driverKey, config, stage, partitionCode, scope }, registered)
  }

  private resolveValidated(driverKey: string, config: Record<string, unknown>): StorageDriver {
    if (driverKey === 'legacyPublic') return this.legacyPublicDriver ??= new LegacyPublicStorageDriver()
    if (driverKey === 'local') return this.localDriver ??= new LocalStorageDriver()
    const externalFactory = this.externalDrivers.get(driverKey) ?? moduleRegistry().drivers.get(driverKey)
    if (externalFactory) {
      const cacheKey = `${driverKey}:${JSON.stringify(config)}`
      const cached = this.cache.get(cacheKey)
      if (cached) return cached
      const driver = externalFactory(config)
      this.cache.set(cacheKey, driver)
      return driver
    }
    return this.localDriver ??= new LocalStorageDriver()
  }
}
