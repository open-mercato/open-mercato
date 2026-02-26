import type { DiRegistrar } from '../di/container'
import type { EntityIds } from '../encryption/entityIds'
import type { EntityFieldsRegistry } from '../encryption/entityFields'
import type { Module, ModuleDashboardWidgetEntry, ModuleInjectionWidgetEntry } from '../../modules/registry'
import type { ModuleInjectionTable } from '../../modules/widgets/injection'
import type { SearchModuleConfig } from '../../modules/search'
import type { AnalyticsModuleConfig } from '../../modules/analytics'
import type { EntityClass, EntityClassGroup } from '@mikro-orm/core'

export type OrmEntity = EntityClass<unknown> | EntityClassGroup<unknown>

export interface InjectionTableEntry {
  moduleId: string
  table: ModuleInjectionTable
}

export interface EnricherBootstrapEntry {
  moduleId: string
  enrichers: import('../../lib/crud/response-enricher').ResponseEnricher[]
}

export interface InterceptorBootstrapEntry {
  moduleId: string
  interceptors: import('../../lib/crud/api-interceptor').ApiInterceptor[]
}

export interface BootstrapData {
  modules: Module[]
  entities: OrmEntity[]
  diRegistrars: (DiRegistrar | undefined)[]
  entityIds: EntityIds
  entityFieldsRegistry?: EntityFieldsRegistry
  dashboardWidgetEntries: ModuleDashboardWidgetEntry[]
  injectionWidgetEntries: ModuleInjectionWidgetEntry[]
  injectionTables: InjectionTableEntry[]
  searchModuleConfigs: SearchModuleConfig[]
  analyticsModuleConfigs?: AnalyticsModuleConfig[]
  enricherEntries?: EnricherBootstrapEntry[]
  interceptorEntries?: InterceptorBootstrapEntry[]
}

export interface BootstrapOptions {
  skipSearchConfigs?: boolean
  onRegistrationComplete?: () => void
}
