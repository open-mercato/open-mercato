import { BigIntType, Collection, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type IncidentEscalationTarget = {
  type: 'user' | 'team' | 'role'
  id: string
}

export type IncidentEscalationStep = {
  delayMinutes: number
  targets: IncidentEscalationTarget[]
  notifyStrategy?: 'all'
}

// Snapshot of who was paged at the current escalation level (resolved at page-time).
export type IncidentEscalationLastTargets = {
  targets: IncidentEscalationTarget[]
  recipients: Array<{ userId: string; label?: string }>
  resolvedAt: string
}

export type IncidentSlaTarget = {
  response_minutes: number
  resolution_minutes: number
  at_risk_pct: number
}

export type IncidentSlaTargets = Record<string, IncidentSlaTarget>

export type IncidentUpdateCadenceEntry = {
  updateMinutes: number
}

export type IncidentUpdateCadence = Record<string, IncidentUpdateCadenceEntry>

export type IncidentTriggerCondition = {
  path: string
  equals: string | number | boolean
}

export type IncidentServiceComponentType = 'service' | 'component'
export type IncidentServiceComponentCriticality = 'low' | 'medium' | 'high' | 'critical'

@Entity({ tableName: 'incidents' })
@Index({ name: 'incidents_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incidents_org_tenant_number_unique', expression: `create unique index "incidents_org_tenant_number_unique" on "incidents" ("organization_id", "tenant_id", "number") where "deleted_at" is null` })
@Index({ name: 'incidents_org_tenant_source_event_ref_unique', expression: `create unique index "incidents_org_tenant_source_event_ref_unique" on "incidents" ("organization_id", "tenant_id", "source_event_ref") where "deleted_at" is null and "source_event_ref" is not null` })
export class Incident {
  [OptionalProps]?:
    | 'description'
    | 'incidentTypeId'
    | 'priority'
    | 'visibility'
    | 'isDrill'
    | 'isMajor'
    | 'ownerUserId'
    | 'owningTeamId'
    | 'detectedAt'
    | 'acknowledgedAt'
    | 'startedAt'
    | 'resolvedAt'
    | 'closedAt'
    | 'escalationLevel'
    | 'nextEscalationAt'
    | 'nextUpdateDueAt'
    | 'updateOverdueNotifiedAt'
    | 'snoozedUntil'
    | 'escalationPolicyId'
    | 'escalationStatus'
    | 'escalationRepeatsDone'
    | 'escalationLastTargets'
    | 'slaResponseDueAt'
    | 'slaResolutionDueAt'
    | 'slaAtRisk'
    | 'slaBreached'
    | 'mergedIntoIncidentId'
    | 'sourceEventRef'
    | 'customerImpactSummary'
    | 'revenueAtRiskMinor'
    | 'revenueAtRiskCurrency'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'number', type: 'text' })
  number!: string

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'incident_type_id', type: 'uuid', nullable: true })
  incidentTypeId?: string | null

  @Property({ name: 'severity_id', type: 'uuid' })
  severityId!: string

  @Property({ name: 'priority', type: 'text', nullable: true })
  priority?: string | null

  @Property({ name: 'status', type: 'text' })
  status!: string

  @Property({ name: 'visibility', type: 'text', default: 'internal' })
  visibility: string = 'internal'

  @Property({ name: 'is_drill', type: 'boolean', default: false })
  isDrill: boolean = false

  @Property({ name: 'is_major', type: 'boolean', default: false })
  isMajor: boolean = false

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'owning_team_id', type: 'uuid', nullable: true })
  owningTeamId?: string | null

  @Property({ name: 'reporter_user_id', type: 'uuid' })
  reporterUserId!: string

  @Property({ name: 'detected_at', type: Date, nullable: true })
  detectedAt?: Date | null

  @Property({ name: 'acknowledged_at', type: Date, nullable: true })
  acknowledgedAt?: Date | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'escalation_level', type: 'integer', default: 0 })
  escalationLevel: number = 0

  @Property({ name: 'next_escalation_at', type: Date, nullable: true })
  nextEscalationAt?: Date | null

  @Property({ name: 'next_update_due_at', type: Date, nullable: true })
  nextUpdateDueAt?: Date | null

  @Property({ name: 'update_overdue_notified_at', type: Date, nullable: true })
  updateOverdueNotifiedAt?: Date | null

  @Property({ name: 'snoozed_until', type: Date, nullable: true })
  snoozedUntil?: Date | null

  @Property({ name: 'escalation_policy_id', type: 'uuid', nullable: true })
  escalationPolicyId?: string | null

  @Property({ name: 'escalation_status', type: 'text', default: 'inactive' })
  escalationStatus: string = 'inactive'

  @Property({ name: 'escalation_repeats_done', type: 'integer', default: 0 })
  escalationRepeatsDone: number = 0

  @Property({ name: 'escalation_last_targets', type: 'jsonb', nullable: true })
  escalationLastTargets?: IncidentEscalationLastTargets | null

  @Property({ name: 'sla_response_due_at', type: Date, nullable: true })
  slaResponseDueAt?: Date | null

  @Property({ name: 'sla_resolution_due_at', type: Date, nullable: true })
  slaResolutionDueAt?: Date | null

  @Property({ name: 'sla_at_risk', type: 'boolean', default: false })
  slaAtRisk: boolean = false

  @Property({ name: 'sla_breached', type: 'boolean', default: false })
  slaBreached: boolean = false

  @Property({ name: 'merged_into_incident_id', type: 'uuid', nullable: true })
  mergedIntoIncidentId?: string | null

  @Property({ name: 'source_event_ref', type: 'text', nullable: true })
  sourceEventRef?: string | null

  @Property({ name: 'customer_impact_summary', type: 'text', nullable: true })
  customerImpactSummary?: string | null

  @Property({ name: 'revenue_at_risk_minor', type: new BigIntType('string'), nullable: true })
  revenueAtRiskMinor?: string | null

  @Property({ name: 'revenue_at_risk_currency', type: 'text', nullable: true })
  revenueAtRiskCurrency?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_timeline_entries' })
@Index({ name: 'incident_timeline_entries_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_timeline_entries_incident_idx', properties: ['incidentId'] })
export class IncidentTimelineEntry {
  [OptionalProps]?: 'actorUserId' | 'body' | 'visibility' | 'metadata' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'incident_id', type: 'uuid' })
  incidentId!: string

  @Property({ name: 'kind', type: 'text' })
  kind!: string

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'visibility', type: 'text', default: 'internal' })
  visibility: string = 'internal'

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'incident_participants' })
@Index({ name: 'incident_participants_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_participants_incident_user_kind_unique', expression: `create unique index "incident_participants_incident_user_kind_unique" on "incident_participants" ("incident_id", "user_id", "kind") where "deleted_at" is null` })
export class IncidentParticipant {
  [OptionalProps]?: 'roleId' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'incident_id', type: 'uuid' })
  incidentId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'kind', type: 'text' })
  kind!: string

  @Property({ name: 'role_id', type: 'uuid', nullable: true })
  roleId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_impacts' })
@Index({ name: 'incident_impacts_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_impacts_incident_target_type_idx', properties: ['incidentId', 'targetType'] })
@Index({ name: 'incident_impacts_target_unique', expression: `create unique index "incident_impacts_target_unique" on "incident_impacts" ("incident_id", "target_type", (coalesce("target_id"::text, "component_label"))) where "deleted_at" is null` })
export class IncidentImpact {
  [OptionalProps]?:
    | 'targetId'
    | 'componentLabel'
    | 'impactStatus'
    | 'snapshot'
    | 'revenueAmountMinor'
    | 'revenueCurrency'
    | 'revenueRefreshedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'incident_id', type: 'uuid' })
  incidentId!: string

  @Property({ name: 'target_type', type: 'text' })
  targetType!: string

  @Property({ name: 'target_id', type: 'uuid', nullable: true })
  targetId?: string | null

  @Property({ name: 'component_label', type: 'text', nullable: true })
  componentLabel?: string | null

  @Property({ name: 'impact_status', type: 'text', default: 'operational' })
  impactStatus: string = 'operational'

  @Property({ name: 'snapshot', type: 'jsonb', nullable: true })
  snapshot?: Record<string, unknown> | null

  @Property({ name: 'revenue_amount_minor', type: new BigIntType('string'), nullable: true })
  revenueAmountMinor?: string | null

  @Property({ name: 'revenue_currency', type: 'text', nullable: true })
  revenueCurrency?: string | null

  @Property({ name: 'revenue_refreshed_at', type: Date, nullable: true })
  revenueRefreshedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_service_components' })
@Index({ name: 'incident_service_components_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_service_components_org_tenant_key_unique', expression: `create unique index "incident_service_components_org_tenant_key_unique" on "incident_service_components" ("organization_id", "tenant_id", "key") where "deleted_at" is null` })
@Index({ name: 'incident_service_components_source_idx', expression: `create index "incident_service_components_source_idx" on "incident_service_components" ("organization_id", "tenant_id", "source_type", "source_id") where "deleted_at" is null and "source_type" is not null and "source_id" is not null` })
export class IncidentServiceComponent {
  [OptionalProps]?:
    | 'description'
    | 'componentType'
    | 'ownerTeamId'
    | 'ownerUserId'
    | 'criticality'
    | 'tier'
    | 'sloTargetBasisPoints'
    | 'sourceType'
    | 'sourceId'
    | 'snapshot'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'key', type: 'text' })
  key!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'component_type', type: 'text', default: 'service' })
  componentType: IncidentServiceComponentType = 'service'

  @Property({ name: 'owner_team_id', type: 'uuid', nullable: true })
  ownerTeamId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'criticality', type: 'text', default: 'medium' })
  criticality: IncidentServiceComponentCriticality = 'medium'

  @Property({ name: 'tier', type: 'text', nullable: true })
  tier?: string | null

  @Property({ name: 'slo_target_basis_points', type: 'integer', nullable: true })
  sloTargetBasisPoints?: number | null

  @Property({ name: 'source_type', type: 'text', nullable: true })
  sourceType?: string | null

  @Property({ name: 'source_id', type: 'text', nullable: true })
  sourceId?: string | null

  @Property({ name: 'snapshot', type: 'jsonb', nullable: true })
  snapshot?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_service_dependencies' })
@Index({ name: 'incident_service_dependencies_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_service_dependencies_source_idx', properties: ['sourceComponentId'] })
@Index({ name: 'incident_service_dependencies_target_idx', properties: ['targetComponentId'] })
@Index({ name: 'incident_service_dependencies_unique', expression: `create unique index "incident_service_dependencies_unique" on "incident_service_dependencies" ("organization_id", "tenant_id", "source_component_id", "target_component_id", "dependency_kind") where "deleted_at" is null` })
export class IncidentServiceDependency {
  [OptionalProps]?:
    | 'dependencyKind'
    | 'snapshot'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'source_component_id', type: 'uuid' })
  sourceComponentId!: string

  @Property({ name: 'target_component_id', type: 'uuid' })
  targetComponentId!: string

  @Property({ name: 'dependency_kind', type: 'text', default: 'depends_on' })
  dependencyKind: string = 'depends_on'

  @Property({ name: 'snapshot', type: 'jsonb', nullable: true })
  snapshot?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_action_items' })
@Index({ name: 'incident_action_items_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_action_items_incident_idx', properties: ['incidentId'] })
export class IncidentActionItem {
  [OptionalProps]?:
    | 'description'
    | 'assigneeUserId'
    | 'status'
    | 'dueAt'
    | 'completedAt'
    | 'externalRef'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'incident_id', type: 'uuid' })
  incidentId!: string

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ name: 'status', type: 'text', default: 'open' })
  status: string = 'open'

  @Property({ name: 'due_at', type: Date, nullable: true })
  dueAt?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'external_ref', type: 'text', nullable: true })
  externalRef?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_postmortems' })
@Index({ name: 'incident_postmortems_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_postmortems_incident_unique', expression: `create unique index "incident_postmortems_incident_unique" on "incident_postmortems" ("incident_id") where "deleted_at" is null` })
export class IncidentPostmortem {
  [OptionalProps]?:
    | 'summary'
    | 'rootCause'
    | 'impact'
    | 'contributingFactors'
    | 'lessons'
    | 'status'
    | 'publishedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'incident_id', type: 'uuid' })
  incidentId!: string

  @Property({ name: 'summary', type: 'text', nullable: true })
  summary?: string | null

  @Property({ name: 'root_cause', type: 'text', nullable: true })
  rootCause?: string | null

  @Property({ name: 'impact', type: 'text', nullable: true })
  impact?: string | null

  @Property({ name: 'contributing_factors', type: 'text', nullable: true })
  contributingFactors?: string | null

  @Property({ name: 'lessons', type: 'text', nullable: true })
  lessons?: string | null

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'published_at', type: Date, nullable: true })
  publishedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_links' })
@Index({ name: 'incident_links_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_links_incident_linked_kind_unique', expression: `create unique index "incident_links_incident_linked_kind_unique" on "incident_links" ("incident_id", "linked_incident_id", "kind") where "deleted_at" is null` })
export class IncidentLink {
  [OptionalProps]?: 'createdAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'incident_id', type: 'uuid' })
  incidentId!: string

  @Property({ name: 'linked_incident_id', type: 'uuid' })
  linkedIncidentId!: string

  @Property({ name: 'kind', type: 'text' })
  kind!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_severities' })
@Index({ name: 'incident_severities_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_severities_org_tenant_key_unique', expression: `create unique index "incident_severities_org_tenant_key_unique" on "incident_severities" ("organization_id", "tenant_id", "key") where "deleted_at" is null` })
export class IncidentSeverity {
  [OptionalProps]?: 'defaultRunbookId' | 'isDefault' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'key', type: 'text' })
  key!: string

  @Property({ name: 'label', type: 'text' })
  label!: string

  @Property({ name: 'rank', type: 'integer' })
  rank!: number

  @Property({ name: 'color_token', type: 'text' })
  colorToken!: string

  @Property({ name: 'default_runbook_id', type: 'uuid', nullable: true })
  defaultRunbookId?: string | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_escalation_policies' })
@Index({ name: 'incident_escalation_policies_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_escalation_policies_org_tenant_key_unique', expression: `create unique index "incident_escalation_policies_org_tenant_key_unique" on "incident_escalation_policies" ("organization_id", "tenant_id", "key") where "deleted_at" is null` })
export class IncidentEscalationPolicy {
  [OptionalProps]?: 'repeatCount' | 'isDefault' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'key', type: 'text' })
  key!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'steps', type: 'jsonb' })
  steps!: IncidentEscalationStep[]

  @Property({ name: 'repeat_count', type: 'integer', default: 0 })
  repeatCount: number = 0

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_runbooks' })
@Index({ name: 'incident_runbooks_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_runbooks_org_tenant_key_unique', expression: `create unique index "incident_runbooks_org_tenant_key_unique" on "incident_runbooks" ("organization_id", "tenant_id", "key") where "deleted_at" is null` })
export class IncidentRunbook {
  [OptionalProps]?: 'description' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'key', type: 'text' })
  key!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
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

@Entity({ tableName: 'incident_runbook_steps' })
@Index({ name: 'incident_runbook_steps_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_runbook_steps_runbook_idx', properties: ['runbookId'] })
@Index({ name: 'incident_runbook_steps_runbook_position_unique', expression: `create unique index "incident_runbook_steps_runbook_position_unique" on "incident_runbook_steps" ("runbook_id", "position") where "deleted_at" is null` })
export class IncidentRunbookStep {
  [OptionalProps]?:
    | 'description'
    | 'assigneeUserId'
    | 'dueOffsetMinutes'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'runbook_id', type: 'uuid' })
  runbookId!: string

  @Property({ name: 'position', type: 'integer' })
  position!: number

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ name: 'due_offset_minutes', type: 'integer', nullable: true })
  dueOffsetMinutes?: number | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_triggers' })
@Index({ name: 'incident_triggers_org_tenant_event_enabled_idx', expression: `create index "incident_triggers_org_tenant_event_enabled_idx" on "incident_triggers" ("organization_id", "tenant_id", "event_id", "is_enabled") where "deleted_at" is null` })
@Index({ name: 'incident_triggers_org_tenant_event_unique', expression: `create unique index "incident_triggers_org_tenant_event_unique" on "incident_triggers" ("organization_id", "tenant_id", "event_id") where "deleted_at" is null` })
export class IncidentTrigger {
  [OptionalProps]?:
    | 'isEnabled'
    | 'severityKey'
    | 'typeKey'
    | 'escalationPolicyId'
    | 'conditions'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'event_id', type: 'text' })
  eventId!: string

  @Property({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean = true

  @Property({ name: 'severity_key', type: 'text', nullable: true })
  severityKey?: string | null

  @Property({ name: 'type_key', type: 'text', nullable: true })
  typeKey?: string | null

  @Property({ name: 'escalation_policy_id', type: 'uuid', nullable: true })
  escalationPolicyId?: string | null

  @Property({ name: 'conditions', type: 'jsonb', nullable: true })
  conditions?: IncidentTriggerCondition[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_types' })
@Index({ name: 'incident_types_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_types_org_tenant_key_unique', expression: `create unique index "incident_types_org_tenant_key_unique" on "incident_types" ("organization_id", "tenant_id", "key") where "deleted_at" is null` })
export class IncidentType {
  [OptionalProps]?:
    | 'defaultSeverityId'
    | 'defaultEscalationPolicyId'
    | 'defaultRunbookId'
    | 'defaultRoleIds'
    | 'requiredFieldsOnResolve'
    | 'isDefault'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'key', type: 'text' })
  key!: string

  @Property({ name: 'label', type: 'text' })
  label!: string

  @Property({ name: 'default_severity_id', type: 'uuid', nullable: true })
  defaultSeverityId?: string | null

  @Property({ name: 'default_escalation_policy_id', type: 'uuid', nullable: true })
  defaultEscalationPolicyId?: string | null

  @Property({ name: 'default_runbook_id', type: 'uuid', nullable: true })
  defaultRunbookId?: string | null

  @Property({ name: 'default_role_ids', type: 'jsonb', nullable: true })
  defaultRoleIds?: string[] | null

  @Property({ name: 'required_fields_on_resolve', type: 'jsonb', nullable: true })
  requiredFieldsOnResolve?: string[] | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_roles' })
@Index({ name: 'incident_roles_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'incident_roles_org_tenant_key_unique', expression: `create unique index "incident_roles_org_tenant_key_unique" on "incident_roles" ("organization_id", "tenant_id", "key") where "deleted_at" is null` })
export class IncidentRole {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'key', type: 'text' })
  key!: string

  @Property({ name: 'label', type: 'text' })
  label!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_settings' })
@Index({ name: 'incident_settings_org_tenant_unique', expression: `create unique index "incident_settings_org_tenant_unique" on "incident_settings" ("organization_id", "tenant_id") where "deleted_at" is null` })
export class IncidentSettings {
  [OptionalProps]?:
    | 'ackTimeoutMinutes'
    | 'escalationTimeoutMinutes'
    | 'defaultEscalationPolicyId'
    | 'slaTargets'
    | 'updateCadence'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'number_format', type: 'text' })
  numberFormat!: string

  @Property({ name: 'ack_timeout_minutes', type: 'integer', nullable: true })
  ackTimeoutMinutes?: number | null

  @Property({ name: 'escalation_timeout_minutes', type: 'integer', nullable: true })
  escalationTimeoutMinutes?: number | null

  @Property({ name: 'default_escalation_policy_id', type: 'uuid', nullable: true })
  defaultEscalationPolicyId?: string | null

  @Property({ name: 'sla_targets', type: 'jsonb', nullable: true })
  slaTargets?: IncidentSlaTargets | null

  @Property({ name: 'update_cadence', type: 'jsonb', nullable: true })
  updateCadence?: IncidentUpdateCadence | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'incident_number_sequences' })
@Unique({ name: 'incident_number_sequences_org_tenant_unique', properties: ['organizationId', 'tenantId'] })
export class IncidentNumberSequence {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'current_value', type: 'bigint' })
  currentValue!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export const incidentsEntities = [
  Incident,
  IncidentTimelineEntry,
  IncidentParticipant,
  IncidentImpact,
  IncidentServiceComponent,
  IncidentServiceDependency,
  IncidentActionItem,
  IncidentPostmortem,
  IncidentLink,
  IncidentSeverity,
  IncidentEscalationPolicy,
  IncidentRunbook,
  IncidentRunbookStep,
  IncidentType,
  IncidentRole,
  IncidentSettings,
  IncidentTrigger,
  IncidentNumberSequence,
] as const
