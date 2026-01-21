import { Entity, PrimaryKey, Property, Index, OneToMany, ManyToOne, Collection, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'resources_resource_types' })
@Index({ name: 'resources_resource_types_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class ResourcesResourceType {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'resources_resources' })
@Index({ name: 'resources_resources_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class ResourcesResource {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'resource_type_id', type: 'uuid', nullable: true })
  resourceTypeId?: string | null

  @Property({ type: 'int', nullable: true })
  capacity?: number | null

  @Property({ name: 'capacity_unit_value', type: 'text', nullable: true })
  capacityUnitValue?: string | null

  @Property({ name: 'capacity_unit_name', type: 'text', nullable: true })
  capacityUnitName?: string | null

  @Property({ name: 'capacity_unit_color', type: 'text', nullable: true })
  capacityUnitColor?: string | null

  @Property({ name: 'capacity_unit_icon', type: 'text', nullable: true })
  capacityUnitIcon?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'availability_rule_set_id', type: 'uuid', nullable: true })
  availabilityRuleSetId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'resources_resource_tags' })
@Index({ name: 'resources_resource_tags_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'resources_resource_tags_slug_unique', properties: ['organizationId', 'tenantId', 'slug'] })
export class ResourcesResourceTag {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  color?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => ResourcesResourceTagAssignment, (assignment) => assignment.tag)
  assignments = new Collection<ResourcesResourceTagAssignment>(this)
}

@Entity({ tableName: 'resources_resource_tag_assignments' })
@Index({ name: 'resources_resource_tag_assignments_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'resources_resource_tag_assignments_unique',
  properties: ['tag', 'resource'],
})
export class ResourcesResourceTagAssignment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => ResourcesResourceTag, { fieldName: 'tag_id' })
  tag!: ResourcesResourceTag

  @ManyToOne(() => ResourcesResource, { fieldName: 'resource_id' })
  resource!: ResourcesResource

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
