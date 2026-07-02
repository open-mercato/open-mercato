import type { EntityManager } from '@mikro-orm/core'
import type { AppContainer } from '../di/container'
import type { Module } from '../../modules/registry'

export const PLATFORM_MAP_SCHEMA_VERSION = 1

export type SurfaceTier = 1 | 2 | 3

export type IntrospectionSnapshot = {
  notificationTypes: unknown[]
  aiToolConfigEntries: Array<{ moduleId: string; tools: unknown[] }>
  messageTypes: unknown[]
}

export type IntrospectionContext = {
  modules: Module[]
  container?: AppContainer
  em?: EntityManager
  tenantId?: string | null
  organizationId?: string | null
  snapshot?: IntrospectionSnapshot
}

export type SurfaceRow = Record<string, string | number | boolean | string[] | null>

export type SurfaceProvider = {
  id: string
  title: string
  tier: SurfaceTier
  describe(): { columns: string[] }
  collect(ctx: IntrospectionContext): Promise<SurfaceRow[]> | SurfaceRow[]
}

export type PlatformMap = {
  schemaVersion: number
  generatedAt: string
  scope: { tenantId: string | null; organizationId: string | null } | null
  surfaces: Record<string, { tier: SurfaceTier; rows: SurfaceRow[] }>
}

export type CollectPlatformMapOptions = {
  maxTier?: SurfaceTier
  surfaceIds?: string[]
  generatedAt?: string
}
