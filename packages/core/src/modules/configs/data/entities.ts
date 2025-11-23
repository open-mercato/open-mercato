import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'module_configs' })
@Unique({ name: 'module_configs_module_name_unique', properties: ['moduleId', 'name'] })
export class ModuleConfig {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'module_id', type: 'text' })
  moduleId!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'value_json', type: 'json', nullable: true })
  valueJson!: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'upgrade_action_runs' })
@Index({ name: 'upgrade_action_runs_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'upgrade_action_runs_action_scope_unique', properties: ['version', 'actionId', 'organizationId', 'tenantId'] })
export class UpgradeActionRun {
  [OptionalProps]?: 'createdAt' | 'completedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'version', type: 'text' })
  version!: string

  @Property({ name: 'action_id', type: 'text' })
  actionId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'completed_at', type: Date, onCreate: () => new Date() })
  completedAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
