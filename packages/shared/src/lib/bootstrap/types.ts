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

export interface ComponentOverrideBootstrapEntry {
  moduleId: string
  componentOverrides: import('../../modules/widgets/component-registry').ComponentOverride[]
}

export interface GuardBootstrapEntry {
  moduleId: string
  guards: import('../../lib/crud/mutation-guard-registry').MutationGuard[]
}

export interface CommandInterceptorBootstrapEntry {
  moduleId: string
  interceptors: import('../../lib/commands/command-interceptor').CommandInterceptor[]
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
  componentOverrideEntries?: ComponentOverrideBootstrapEntry[]
  guardEntries?: GuardBootstrapEntry[]
  commandInterceptorEntries?: CommandInterceptorBootstrapEntry[]
}

export interface BootstrapOptions {
  skipSearchConfigs?: boolean
  onRegistrationComplete?: () => void
}
