import { Entity, PrimaryKey, Property, Index, Enum, OneToMany, ManyToOne, Collection, Unique } from '@mikro-orm/core'

export type BookingCapacityModel = 'one_to_one' | 'one_to_many' | 'many_to_many'
export type BookingEventStatus = 'draft' | 'negotiation' | 'confirmed' | 'cancelled'
export type BookingConfirmationMode = 'all_members' | 'any_member' | 'by_role'
export type BookingConfirmationStatus = 'pending' | 'accepted' | 'declined'
export type BookingAvailabilitySubjectType = 'member' | 'resource'

export type BookingRoleRequirement = { roleId: string; qty: number }
export type BookingMemberRequirement = { memberId: string; qty?: number }
export type BookingResourceRequirement = { resourceId: string; qty: number }
export type BookingResourceTypeRequirement = { resourceTypeId: string; qty: number }

@Entity({ tableName: 'booking_services' })
@Index({ name: 'booking_services_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingService {
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

  @Property({ name: 'duration_minutes', type: 'int' })
  durationMinutes!: number

  @Enum({ items: ['one_to_one', 'one_to_many', 'many_to_many'], type: 'text', name: 'capacity_model' })
  capacityModel!: BookingCapacityModel

  @Property({ name: 'max_attendees', type: 'int', nullable: true })
  maxAttendees?: number | null

  @Property({ name: 'required_roles', type: 'jsonb', default: [] })
  requiredRoles: BookingRoleRequirement[] = []

  @Property({ name: 'required_members', type: 'jsonb', default: [] })
  requiredMembers: BookingMemberRequirement[] = []

  @Property({ name: 'required_resources', type: 'jsonb', default: [] })
  requiredResources: BookingResourceRequirement[] = []

  @Property({ name: 'required_resource_types', type: 'jsonb', default: [] })
  requiredResourceTypes: BookingResourceTypeRequirement[] = []

  @Property({ type: 'jsonb', default: [] })
  tags: string[] = []

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_team_roles' })
@Index({ name: 'booking_team_roles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingTeamRole {
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

@Entity({ tableName: 'booking_team_members' })
@Index({ name: 'booking_team_members_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingTeamMember {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'role_ids', type: 'jsonb', default: [] })
  roleIds: string[] = []

  @Property({ type: 'jsonb', default: [] })
  tags: string[] = []

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_resource_types' })
@Index({ name: 'booking_resource_types_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingResourceType {
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

@Entity({ tableName: 'booking_resources' })
@Index({ name: 'booking_resources_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingResource {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

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

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'is_available_by_default', type: 'boolean', default: true })
  isAvailableByDefault: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_resource_tags' })
@Index({ name: 'booking_resource_tags_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'booking_resource_tags_slug_unique', properties: ['organizationId', 'tenantId', 'slug'] })
export class BookingResourceTag {
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

  @OneToMany(() => BookingResourceTagAssignment, (assignment) => assignment.tag)
  assignments = new Collection<BookingResourceTagAssignment>(this)
}

@Entity({ tableName: 'booking_resource_tag_assignments' })
@Index({ name: 'booking_resource_tag_assignments_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'booking_resource_tag_assignments_unique',
  properties: ['tag', 'resource'],
})
export class BookingResourceTagAssignment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => BookingResourceTag, { fieldName: 'tag_id' })
  tag!: BookingResourceTag

  @ManyToOne(() => BookingResource, { fieldName: 'resource_id' })
  resource!: BookingResource

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'booking_availability_rules' })
@Index({ name: 'booking_availability_rules_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'booking_availability_rules_subject_idx', properties: ['subjectType', 'subjectId', 'tenantId', 'organizationId'] })
export class BookingAvailabilityRule {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Enum({ items: ['member', 'resource'], type: 'text', name: 'subject_type' })
  subjectType!: BookingAvailabilitySubjectType

  @Property({ name: 'subject_id', type: 'uuid' })
  subjectId!: string

  @Property({ type: 'text' })
  timezone!: string

  @Property({ type: 'text' })
  rrule!: string

  @Property({ type: 'jsonb', default: [] })
  exdates: string[] = []

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_events' })
@Index({ name: 'booking_events_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'booking_events_status_idx', properties: ['status', 'tenantId', 'organizationId'] })
export class BookingEvent {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'service_id', type: 'uuid' })
  serviceId!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'starts_at', type: Date })
  startsAt!: Date

  @Property({ name: 'ends_at', type: Date })
  endsAt!: Date

  @Property({ type: 'text', nullable: true })
  timezone?: string | null

  @Property({ type: 'text', nullable: true })
  rrule?: string | null

  @Property({ type: 'jsonb', default: [] })
  exdates: string[] = []

  @Enum({ items: ['draft', 'negotiation', 'confirmed', 'cancelled'], type: 'text' })
  status!: BookingEventStatus

  @Property({ name: 'requires_confirmations', type: 'boolean', default: false })
  requiresConfirmations: boolean = false

  @Enum({ items: ['all_members', 'any_member', 'by_role'], type: 'text', name: 'confirmation_mode' })
  confirmationMode!: BookingConfirmationMode

  @Property({ name: 'confirmation_deadline_at', type: Date, nullable: true })
  confirmationDeadlineAt?: Date | null

  @Property({ name: 'confirmed_at', type: Date, nullable: true })
  confirmedAt?: Date | null

  @Property({ type: 'jsonb', default: [] })
  tags: string[] = []

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_event_attendees' })
@Index({ name: 'booking_event_attendees_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingEventAttendee {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'event_id', type: 'uuid' })
  eventId!: string

  @Property({ name: 'first_name', type: 'text' })
  firstName!: string

  @Property({ name: 'last_name', type: 'text' })
  lastName!: string

  @Property({ type: 'text', nullable: true })
  email?: string | null

  @Property({ type: 'text', nullable: true })
  phone?: string | null

  @Property({ name: 'address_line1', type: 'text', nullable: true })
  addressLine1?: string | null

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  @Property({ type: 'text', nullable: true })
  city?: string | null

  @Property({ type: 'text', nullable: true })
  region?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ type: 'text', nullable: true })
  country?: string | null

  @Property({ name: 'attendee_type', type: 'text', nullable: true })
  attendeeType?: string | null

  @Property({ name: 'external_ref', type: 'text', nullable: true })
  externalRef?: string | null

  @Property({ type: 'jsonb', default: [] })
  tags: string[] = []

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_event_members' })
@Index({ name: 'booking_event_members_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingEventMember {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'event_id', type: 'uuid' })
  eventId!: string

  @Property({ name: 'member_id', type: 'uuid' })
  memberId!: string

  @Property({ name: 'role_id', type: 'uuid', nullable: true })
  roleId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_event_resources' })
@Index({ name: 'booking_event_resources_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingEventResource {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'event_id', type: 'uuid' })
  eventId!: string

  @Property({ name: 'resource_id', type: 'uuid' })
  resourceId!: string

  @Property({ type: 'int', default: 1 })
  qty: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_event_confirmations' })
@Index({ name: 'booking_event_confirmations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class BookingEventConfirmation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'event_id', type: 'uuid' })
  eventId!: string

  @Property({ name: 'member_id', type: 'uuid' })
  memberId!: string

  @Enum({ items: ['pending', 'accepted', 'declined'], type: 'text' })
  status!: BookingConfirmationStatus

  @Property({ name: 'responded_at', type: Date, nullable: true })
  respondedAt?: Date | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_service_products' })
@Index({ name: 'booking_service_products_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'booking_service_products_unique_idx', properties: ['serviceId', 'productId'], options: { unique: true } })
export class BookingServiceProduct {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'service_id', type: 'uuid' })
  serviceId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'booking_service_product_variants' })
@Index({ name: 'booking_service_product_variants_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'booking_service_product_variants_unique_idx', properties: ['serviceId', 'variantId'], options: { unique: true } })
export class BookingServiceProductVariant {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'service_id', type: 'uuid' })
  serviceId!: string

  @Property({ name: 'variant_id', type: 'uuid' })
  variantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
