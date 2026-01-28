import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'

export type TenantSetupScope = {
  tenantId: string
  organizationId: string
}

export type TenantSetupContext = TenantSetupScope & {
  em: EntityManager
}

export type InitSetupContext = TenantSetupContext & {
  container: AwilixContainer
}

export type DefaultRoleFeatures = {
  superadmin?: string[]
  admin?: string[]
  employee?: string[]
}

export type ModuleSetupConfig = {
  /**
   * Called inside setupInitialTenant() right after the tenant/org is created.
   * For lightweight structural defaults: settings rows, numbering sequences, configs.
   * Must be idempotent. Always runs (not gated by --no-examples).
   */
  onTenantCreated?: (ctx: TenantSetupContext) => Promise<void>

  /**
   * Called during `mercato init` after tenant exists.
   * For reference/structural data: dictionaries, tax rates, statuses, units,
   * shipping/payment methods, etc.
   * Always runs (not gated by --no-examples).
   * Modules are called in dependency order (based on ModuleInfo.requires).
   */
  seedDefaults?: (ctx: InitSetupContext) => Promise<void>

  /**
   * Called during `mercato init` ONLY when --no-examples is NOT passed.
   * For demo/example data: sample products, customers, orders, etc.
   * Modules are called in dependency order (based on ModuleInfo.requires).
   */
  seedExamples?: (ctx: InitSetupContext) => Promise<void>

  /**
   * Declarative default role-feature assignments.
   * Merged into role ACLs during tenant setup.
   */
  defaultRoleFeatures?: DefaultRoleFeatures
}
