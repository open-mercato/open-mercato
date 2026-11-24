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
  [customRole: string]: string[] | undefined
}

export type DefaultCustomerRoleFeatures = {
  portal_admin?: string[]
  buyer?: string[]
  viewer?: string[]
  [roleSlug: string]: string[] | undefined
}

export type InstanceConfigDefaultEntry = {
  /** Configuration key name within the owning module's namespace. */
  name: string
  /** Finite JSON-serializable default value restored at instance scope. */
  value: unknown
  /**
   * Optional legacy storage namespace reserved strictly for compatibility exceptions
   * validated by Configs (currently only `vector` for `search`'s `auto_index_enabled`).
   */
  legacyStorageNamespace?: string
}

export type InstanceConfigDefaultsProvider = () => readonly InstanceConfigDefaultEntry[]

export type ModuleSetupConfig = {
  /**
   * Synchronous server-only provider returning instance-level module configuration defaults
   * restored by `yarn mercato configs restore-defaults` before tenant setup.
   * Providers may read environment policy at invocation time and must run without an
   * EntityManager, tenant, credentials, or network I/O.
   */
  instanceConfigDefaults?: InstanceConfigDefaultsProvider

  /**
   * Called inside setupInitialTenant() right after the tenant/org is created.
   * For lightweight structural defaults: settings rows, numbering sequences, configs.
   * Must be idempotent. Always runs (not gated by --no-examples).
   */
  onTenantCreated?: (ctx: TenantSetupContext) => Promise<void>

  /**
   * Called after an organization is created in an existing tenant.
   * For organization-scoped structural defaults that must exist for every
   * organization, including organizations added after `mercato init`.
   * Must be idempotent. Runs from a persistent organization-created subscriber.
   */
  onOrganizationCreated?: (ctx: InitSetupContext) => Promise<void>

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

  /**
   * Declarative default customer role-feature assignments.
   * Merged into CustomerRoleAcl records during tenant setup.
   * Keys are customer role slugs (portal_admin, buyer, viewer, or custom).
   */
  defaultCustomerRoleFeatures?: DefaultCustomerRoleFeatures
}
