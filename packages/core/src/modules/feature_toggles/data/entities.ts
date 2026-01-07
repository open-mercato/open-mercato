import {
  Entity,
  Index,
  ManyToOne,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core'

export type FeatureToggleFailMode = 'fail_open' | 'fail_closed'
export type FeatureToggleOverrideState = 'enabled' | 'disabled'

@Entity({ tableName: 'feature_toggles' })
@Unique({ name: 'feature_toggles_identifier_unique', properties: ['identifier'] })
@Index({ name: 'feature_toggles_category_idx', properties: ['category'] })
@Index({ name: 'feature_toggles_name_idx', properties: ['name'] })
export class FeatureToggle {
  [OptionalProps]?: 'description' | 'category' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  identifier!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', nullable: true })
  category?: string | null

  @Property({ name: 'default_state', type: 'boolean' })
  defaultState!: boolean

  @Property({ name: 'fail_mode', type: 'text', default: 'fail_closed' })
  failMode: FeatureToggleFailMode = 'fail_closed'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'feature_toggle_overrides' })
@Unique({
  name: 'feature_toggle_overrides_toggle_tenant_unique',
  properties: ['toggle', 'tenantId'],
})
@Index({ name: 'feature_toggle_overrides_tenant_idx', properties: ['tenantId'] })
@Index({ name: 'feature_toggle_overrides_toggle_idx', properties: ['toggle'] })
export class FeatureToggleOverride {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => FeatureToggle, { fieldName: 'toggle_id' })
  toggle!: FeatureToggle

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  state!: FeatureToggleOverrideState

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}