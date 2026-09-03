import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import type { TimeEntrySource } from '../lib/time-tracking/timeEntrySources'
import type { ReportGrouping } from '../lib/timesheets-reports/reportGroupings'

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

// --- Timesheets entities (Phase 1) ---

/**
 * EP-37: the accepted values are the time-entry source registry, not a database
 * enum, so an import integration can ship its own source. Re-exported from the
 * registry so the entity and the registry cannot drift.
 */
export type StaffTimeEntrySource = TimeEntrySource
export type StaffTimeProjectStatus = 'active' | 'on_hold' | 'completed'
export type StaffTimeProjectMemberStatus = 'active' | 'inactive'
export type StaffTimeEntrySegmentType = 'work' | 'break'
export type StaffTimeProjectBudgetKind = 'none' | 'hours' | 'amount'
export type StaffTimeReportPeriodKind = 'week' | 'month' | 'year' | 'custom'
/** EP-36: the accepted values are the report grouping registry, not a DB enum. */
export type StaffTimeReportGrouping = ReportGrouping
export type StaffTimeReportNonBillableMode = 'separate' | 'exclude'
export type StaffTimeReportStatus = 'draft' | 'closed'
export type StaffTimeReportEventType = 'closed' | 'unlocked' | 'exported'

@Entity({ tableName: 'staff_time_entries' })
@Index({ name: 'staff_time_entries_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_entries_member_date_idx', properties: ['organizationId', 'staffMemberId', 'date'] })
@Index({ name: 'staff_time_entries_project_date_idx', properties: ['organizationId', 'timeProjectId', 'date'] })
@Index({ name: 'staff_time_entries_task_idx', properties: ['organizationId', 'taskId'] })
@Index({ name: 'staff_time_entries_member_overlap_idx', properties: ['organizationId', 'staffMemberId', 'date', 'startedAt'] })
@Index({ name: 'staff_time_entries_locked_report_idx', properties: ['organizationId', 'lockedReportId'] })
export class StaffTimeEntry {
  [OptionalProps]?: 'durationMinutes' | 'isBillable' | 'source' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'staff_member_id', type: 'uuid' })
  staffMemberId!: string

  @Property({ name: 'date', type: 'date' })
  date!: Date

  @Property({ name: 'duration_minutes', type: 'integer', default: 0 })
  durationMinutes: number = 0

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'ended_at', type: Date, nullable: true })
  endedAt?: Date | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'time_project_id', type: 'uuid', nullable: true })
  timeProjectId?: string | null

  @Property({ name: 'task_id', type: 'uuid', nullable: true })
  taskId?: string | null

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'is_billable', type: 'boolean', default: true })
  isBillable: boolean = true

  @Property({ name: 'rounded_minutes', type: 'integer', nullable: true })
  roundedMinutes?: number | null

  @Property({ name: 'rate_override_amount', type: 'numeric', precision: 14, scale: 4, nullable: true })
  rateOverrideAmount?: string | null

  @Property({ name: 'rate_currency_code', type: 'text', nullable: true })
  rateCurrencyCode?: string | null

  @Property({ name: 'locked_report_id', type: 'uuid', nullable: true })
  lockedReportId?: string | null

  @Property({ name: 'locked_at', type: Date, nullable: true })
  lockedAt?: Date | null

  @Property({ name: 'source', type: 'text', default: 'manual' })
  source: StaffTimeEntrySource = 'manual'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_entry_segments' })
@Index({ name: 'staff_time_entry_segments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_entry_segments_entry_idx', properties: ['timeEntryId'] })
export class StaffTimeEntrySegment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'time_entry_id', type: 'uuid' })
  timeEntryId!: string

  @Property({ name: 'started_at', type: Date })
  startedAt!: Date

  @Property({ name: 'ended_at', type: Date, nullable: true })
  endedAt?: Date | null

  @Enum({ items: ['work', 'break'], type: 'text', name: 'segment_type', default: 'work' })
  segmentType: StaffTimeEntrySegmentType = 'work'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_projects' })
@Index({ name: 'staff_time_projects_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_projects_code_unique_idx', properties: ['organizationId', 'tenantId', 'code'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class StaffTimeProject {
  [OptionalProps]?: 'status' | 'billableByDefault' | 'budgetKind' | 'budgetWarnAtPercent' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ name: 'customer_snapshot', type: 'jsonb', nullable: true })
  customerSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'project_type', type: 'text', nullable: true })
  projectType?: string | null

  @Property({ type: 'varchar', length: 20, nullable: true })
  color?: string | null

  @Enum({ items: ['active', 'on_hold', 'completed'], type: 'text', name: 'status', default: 'active' })
  status: StaffTimeProjectStatus = 'active'

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'cost_center', type: 'text', nullable: true })
  costCenter?: string | null

  @Property({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date | null

  @Property({ name: 'hourly_rate', type: 'numeric', precision: 14, scale: 4, nullable: true })
  hourlyRate?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'billable_by_default', type: 'boolean', default: true })
  billableByDefault: boolean = true

  @Enum({ items: ['none', 'hours', 'amount'], type: 'text', name: 'budget_kind', default: 'none' })
  budgetKind: StaffTimeProjectBudgetKind = 'none'

  @Property({ name: 'budget_value', type: 'numeric', precision: 14, scale: 4, nullable: true })
  budgetValue?: string | null

  @Property({ name: 'budget_warn_at_percent', type: 'integer', default: 80 })
  budgetWarnAtPercent: number = 80

  @Property({ name: 'budget_alerted_at_percent', type: 'integer', nullable: true })
  budgetAlertedAtPercent?: number | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_project_members' })
@Index({ name: 'staff_time_project_members_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_project_members_project_idx', properties: ['organizationId', 'timeProjectId'] })
@Index({ name: 'staff_time_project_members_member_idx', properties: ['organizationId', 'staffMemberId'] })
@Index({ name: 'staff_time_project_members_unique_idx', properties: ['organizationId', 'tenantId', 'timeProjectId', 'staffMemberId'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class StaffTimeProjectMember {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'time_project_id', type: 'uuid' })
  timeProjectId!: string

  @Property({ name: 'staff_member_id', type: 'uuid' })
  staffMemberId!: string

  @Property({ type: 'text', nullable: true })
  role?: string | null

  @Enum({ items: ['active', 'inactive'], type: 'text', name: 'status', default: 'active' })
  status: StaffTimeProjectMemberStatus = 'active'

  @Property({ name: 'show_in_grid', type: 'boolean', default: false })
  showInGrid: boolean = false

  @Property({ name: 'assigned_start_date', type: 'date' })
  assignedStartDate!: Date

  @Property({ name: 'assigned_end_date', type: 'date', nullable: true })
  assignedEndDate?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// --- Time tracking consulting suite entities ---

@Entity({ tableName: 'staff_time_task_statuses' })
@Index({ name: 'staff_time_task_statuses_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_task_statuses_project_idx', properties: ['organizationId', 'timeProjectId', 'position'] })
@Index({ name: 'staff_time_task_statuses_slug_unique_idx', properties: ['organizationId', 'tenantId', 'timeProjectId', 'slug'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class StaffTimeTaskStatus {
  [OptionalProps]?: 'position' | 'isDefault' | 'isDone' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'time_project_id', type: 'uuid' })
  timeProjectId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text', nullable: true })
  color?: string | null

  @Property({ type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_done', type: 'boolean', default: false })
  isDone: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_tasks' })
@Index({ name: 'staff_time_tasks_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_tasks_board_idx', properties: ['organizationId', 'timeProjectId', 'taskStatusId', 'position'] })
@Index({ name: 'staff_time_tasks_parent_idx', properties: ['organizationId', 'parentTaskId'] })
@Index({ name: 'staff_time_tasks_assignee_idx', properties: ['organizationId', 'assigneeStaffMemberId'] })
@Index({ name: 'staff_time_tasks_sequence_unique_idx', properties: ['organizationId', 'tenantId', 'timeProjectId', 'sequenceNumber'], options: { unique: true, where: 'deleted_at IS NULL' } })
@Index({ name: 'staff_time_tasks_reference_unique_idx', properties: ['organizationId', 'tenantId', 'reference'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class StaffTimeTask {
  [OptionalProps]?: 'sequenceNumber' | 'position' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'time_project_id', type: 'uuid' })
  timeProjectId!: string

  @Property({ name: 'parent_task_id', type: 'uuid', nullable: true })
  parentTaskId?: string | null

  @Property({ name: 'task_status_id', type: 'uuid' })
  taskStatusId!: string

  @Property({ name: 'sequence_number', type: 'integer', default: 0 })
  sequenceNumber: number = 0

  @Property({ type: 'text' })
  reference!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'assignee_staff_member_id', type: 'uuid', nullable: true })
  assigneeStaffMemberId?: string | null

  @Property({ type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_task_comments' })
@Index({ name: 'staff_time_task_comments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_task_comments_task_idx', properties: ['organizationId', 'taskId', 'createdAt'] })
export class StaffTimeTaskComment {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ type: 'text' })
  body!: string

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_tags' })
@Index({ name: 'staff_time_tags_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_tags_slug_unique_idx', properties: ['organizationId', 'tenantId', 'slug'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class StaffTimeTag {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  color?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_task_tags' })
@Index({ name: 'staff_time_task_tags_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_task_tags_task_idx', properties: ['organizationId', 'taskId'] })
@Index({ name: 'staff_time_task_tags_unique_idx', properties: ['tagId', 'taskId'], options: { unique: true } })
export class StaffTimeTaskTag {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tag_id', type: 'uuid' })
  tagId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'staff_time_entry_tags' })
@Index({ name: 'staff_time_entry_tags_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_entry_tags_entry_idx', properties: ['organizationId', 'timeEntryId'] })
@Index({ name: 'staff_time_entry_tags_unique_idx', properties: ['tagId', 'timeEntryId'], options: { unique: true } })
export class StaffTimeEntryTag {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tag_id', type: 'uuid' })
  tagId!: string

  @Property({ name: 'time_entry_id', type: 'uuid' })
  timeEntryId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'staff_time_reports' })
@Index({ name: 'staff_time_reports_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_reports_customer_idx', properties: ['organizationId', 'customerId'] })
@Index({ name: 'staff_time_reports_status_idx', properties: ['organizationId', 'status', 'periodFrom'] })
@Index({ name: 'staff_time_reports_reference_unique_idx', properties: ['organizationId', 'tenantId', 'reference'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class StaffTimeReport {
  [OptionalProps]?: 'periodKind' | 'grouping' | 'nonbillableMode' | 'includeAlreadyReported' | 'showRates' | 'roundingUnitMinutes' | 'roundingDirection' | 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'customer_snapshot', type: 'jsonb', nullable: true })
  customerSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text' })
  reference!: string

  @Property({ type: 'text' })
  title!: string

  @Enum({ items: ['week', 'month', 'year', 'custom'], type: 'text', name: 'period_kind', default: 'month' })
  periodKind: StaffTimeReportPeriodKind = 'month'

  @Property({ name: 'period_from', type: 'date' })
  periodFrom!: Date

  @Property({ name: 'period_to', type: 'date' })
  periodTo!: Date

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'grouping', type: 'text', default: 'project_task' })
  grouping: StaffTimeReportGrouping = 'project_task'

  @Enum({ items: ['separate', 'exclude'], type: 'text', name: 'nonbillable_mode', default: 'separate' })
  nonbillableMode: StaffTimeReportNonBillableMode = 'separate'

  @Property({ name: 'include_already_reported', type: 'boolean', default: false })
  includeAlreadyReported: boolean = false

  @Property({ name: 'show_rates', type: 'boolean', default: true })
  showRates: boolean = true

  @Property({ name: 'rounding_unit_minutes', type: 'integer', default: 0 })
  roundingUnitMinutes: number = 0

  @Property({ name: 'rounding_direction', type: 'text', default: 'up' })
  roundingDirection: string = 'up'

  @Enum({ items: ['draft', 'closed'], type: 'text', name: 'status', default: 'draft' })
  status: StaffTimeReportStatus = 'draft'

  @Property({ name: 'total_billable_minutes', type: 'integer', nullable: true })
  totalBillableMinutes?: number | null

  @Property({ name: 'total_nonbillable_minutes', type: 'integer', nullable: true })
  totalNonbillableMinutes?: number | null

  @Property({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalAmount?: string | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'closed_by_user_id', type: 'uuid', nullable: true })
  closedByUserId?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_report_projects' })
@Index({ name: 'staff_time_report_projects_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_report_projects_project_idx', properties: ['organizationId', 'timeProjectId'] })
@Index({ name: 'staff_time_report_projects_unique_idx', properties: ['reportId', 'timeProjectId'], options: { unique: true } })
export class StaffTimeReportProject {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'report_id', type: 'uuid' })
  reportId!: string

  @Property({ name: 'time_project_id', type: 'uuid' })
  timeProjectId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'staff_time_report_entries' })
@Index({ name: 'staff_time_report_entries_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_report_entries_entry_idx', properties: ['organizationId', 'timeEntryId'] })
@Index({ name: 'staff_time_report_entries_unique_idx', properties: ['reportId', 'timeEntryId'], options: { unique: true } })
export class StaffTimeReportEntry {
  [OptionalProps]?: 'frozenRawMinutes' | 'frozenRoundedMinutes' | 'frozenIsBillable' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'report_id', type: 'uuid' })
  reportId!: string

  @Property({ name: 'time_entry_id', type: 'uuid' })
  timeEntryId!: string

  @Property({ name: 'frozen_raw_minutes', type: 'integer', default: 0 })
  frozenRawMinutes: number = 0

  @Property({ name: 'frozen_rounded_minutes', type: 'integer', default: 0 })
  frozenRoundedMinutes: number = 0

  @Property({ name: 'frozen_rate_amount', type: 'numeric', precision: 14, scale: 4, nullable: true })
  frozenRateAmount?: string | null

  @Property({ name: 'frozen_currency_code', type: 'text' })
  frozenCurrencyCode!: string

  @Property({ name: 'frozen_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  frozenAmount?: string | null

  @Property({ name: 'frozen_is_billable', type: 'boolean', default: true })
  frozenIsBillable: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'staff_time_report_events' })
@Index({ name: 'staff_time_report_events_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_report_events_report_idx', properties: ['organizationId', 'reportId', 'createdAt'] })
export class StaffTimeReportEvent {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'report_id', type: 'uuid' })
  reportId!: string

  @Enum({ items: ['closed', 'unlocked', 'exported'], type: 'text', name: 'event_type' })
  eventType!: StaffTimeReportEventType

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
