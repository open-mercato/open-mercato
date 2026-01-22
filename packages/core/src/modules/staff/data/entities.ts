import { Entity, PrimaryKey, Property, Index, ManyToOne, Enum } from '@mikro-orm/core'

export type StaffLeaveRequestStatus = 'pending' | 'approved' | 'rejected'

@Entity({ tableName: 'staff_teams' })
@Index({ name: 'staff_teams_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeam {
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

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_team_roles' })
@Index({ name: 'staff_team_roles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeamRole {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'team_id', type: 'uuid', nullable: true })
  teamId?: string | null

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

@Entity({ tableName: 'staff_team_members' })
@Index({ name: 'staff_team_members_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeamMember {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'team_id', type: 'uuid', nullable: true })
  teamId?: string | null

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'role_ids', type: 'jsonb', default: [] })
  roleIds: string[] = []

  @Property({ type: 'jsonb', default: [] })
  tags: string[] = []

  @Property({ name: 'availability_rule_set_id', type: 'uuid', nullable: true })
  availabilityRuleSetId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_leave_requests' })
@Index({ name: 'staff_leave_requests_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_leave_requests_member_idx', properties: ['member'] })
@Index({ name: 'staff_leave_requests_status_idx', properties: ['status', 'tenantId', 'organizationId'] })
export class StaffLeaveRequest {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember

  @Property({ name: 'start_date', type: Date })
  startDate!: Date

  @Property({ name: 'end_date', type: Date })
  endDate!: Date

  @Property({ type: 'text' })
  timezone!: string

  @Enum({ items: ['pending', 'approved', 'rejected'], type: 'text', name: 'status' })
  status: StaffLeaveRequestStatus = 'pending'

  @Property({ name: 'unavailability_reason_entry_id', type: 'uuid', nullable: true })
  unavailabilityReasonEntryId?: string | null

  @Property({ name: 'unavailability_reason_value', type: 'text', nullable: true })
  unavailabilityReasonValue?: string | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'decision_comment', type: 'text', nullable: true })
  decisionComment?: string | null

  @Property({ name: 'submitted_by_user_id', type: 'uuid', nullable: true })
  submittedByUserId?: string | null

  @Property({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId?: string | null

  @Property({ name: 'decided_at', type: Date, nullable: true })
  decidedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_team_member_comments' })
@Index({ name: 'staff_team_member_comments_member_idx', properties: ['member'] })
@Index({ name: 'staff_team_member_comments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeamMemberComment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'body', type: 'text' })
  body!: string

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

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

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember
}

@Entity({ tableName: 'staff_team_member_activities' })
@Index({ name: 'staff_team_member_activities_member_idx', properties: ['member'] })
@Index({ name: 'staff_team_member_activities_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_team_member_activities_member_occurred_created_idx', properties: ['member', 'occurredAt', 'createdAt'] })
export class StaffTeamMemberActivity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'activity_type', type: 'text' })
  activityType!: string

  @Property({ name: 'subject', type: 'text', nullable: true })
  subject?: string | null

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'occurred_at', type: Date, nullable: true })
  occurredAt?: Date | null

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember
}

@Entity({ tableName: 'staff_team_member_job_histories' })
@Index({ name: 'staff_team_member_job_histories_member_idx', properties: ['member'] })
@Index({ name: 'staff_team_member_job_histories_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_team_member_job_histories_member_start_idx', properties: ['member', 'startDate'] })
export class StaffTeamMemberJobHistory {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'company_name', type: 'text', nullable: true })
  companyName?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'start_date', type: Date })
  startDate!: Date

  @Property({ name: 'end_date', type: Date, nullable: true })
  endDate?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember
}

@Entity({ tableName: 'staff_team_member_addresses' })
@Index({ name: 'staff_team_member_addresses_member_idx', properties: ['member'] })
@Index({ name: 'staff_team_member_addresses_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeamMemberAddress {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'name', type: 'text', nullable: true })
  name?: string | null

  @Property({ name: 'purpose', type: 'text', nullable: true })
  purpose?: string | null

  @Property({ name: 'company_name', type: 'text', nullable: true })
  companyName?: string | null

  @Property({ name: 'address_line1', type: 'text' })
  addressLine1!: string

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  @Property({ name: 'city', type: 'text', nullable: true })
  city?: string | null

  @Property({ name: 'region', type: 'text', nullable: true })
  region?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ name: 'country', type: 'text', nullable: true })
  country?: string | null

  @Property({ name: 'building_number', type: 'text', nullable: true })
  buildingNumber?: string | null

  @Property({ name: 'flat_number', type: 'text', nullable: true })
  flatNumber?: string | null

  @Property({ name: 'latitude', type: 'float', nullable: true })
  latitude?: number | null

  @Property({ name: 'longitude', type: 'float', nullable: true })
  longitude?: number | null

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember
}
