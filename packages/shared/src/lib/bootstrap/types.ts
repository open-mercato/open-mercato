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
}

export interface BootstrapOptions {
  skipSearchConfigs?: boolean
  onRegistrationComplete?: () => void
}
