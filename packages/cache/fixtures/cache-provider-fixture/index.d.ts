import type { CacheProviderDefinition, CacheProviderSettingsSchema } from '@open-mercato/cache/provider'

export type FixtureFsSettingsInput = {
  directory: string
  maxBatch?: number
}

export type FixtureFsConfig = {
  directory: string
  maxBatch: number
}

export declare const PROVIDER_ID: 'acme/fixture-fs'
export declare const DEFAULT_MAX_BATCH: number
export declare const settings: CacheProviderSettingsSchema<FixtureFsConfig>
export declare const provider: CacheProviderDefinition<FixtureFsConfig>
export declare function fixtureEntryPath(directory: string, namespace: string, physicalKey: string): string
export default provider
