import type { ColumnType, Generated } from 'kysely'

type Timestamp = ColumnType<Date, Date | string, Date | string>

type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>

type Json<TValue> = ColumnType<TValue, string, string>

type NullableJson<TValue> = ColumnType<TValue | null, string | null, string | null>

export type InsightsProcessCursorsTable = {
  id: Generated<string>
  tenant_id: string
  organization_id: string
  last_created_at: NullableTimestamp
  last_log_id: string | null
  state_watermark: NullableTimestamp
  state_last_log_id: string | null
  scan_id: string | null
  scan_kind: string | null
  scan_from: NullableTimestamp
  scan_until: NullableTimestamp
  scan_after_created_at: NullableTimestamp
  scan_after_log_id: string | null
  scan_progress_job_id: string | null
  scan_processed_count: ColumnType<string, number | string, number | string>
  scan_started_at: NullableTimestamp
  scan_updated_at: NullableTimestamp
  scan_chain_id: string | null
  actor_key_fingerprint: string | null
  last_reconciled_at: NullableTimestamp
  last_full_reconciled_at: NullableTimestamp
  last_pruned_at: NullableTimestamp
  lease_owner: string | null
  lease_token: ColumnType<string, number | string, number | string>
  lease_until: NullableTimestamp
  contract_hashes: NullableJson<Record<string, string>>
  pending_rebuild_keys: Json<string[]>
  scan_process_keys: NullableJson<string[]>
  contract_changed_at: NullableTimestamp
  contract_change: NullableJson<ProcessContractChange>
  coverage_from: NullableTimestamp
  history_scanned_at: NullableTimestamp
  undecryptable_rows: ColumnType<string, number | string, number | string>
  overlap_timeouts: ColumnType<string, number | string, number | string>
  last_overlap_timeout_at: NullableTimestamp
  status: string
  last_run_at: NullableTimestamp
  last_error: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

/** Process keys whose contract changed, were added or were removed in one transition. */
export type ProcessContractChange = {
  changed: string[]
  added: string[]
  removed: string[]
}

export type InsightsProcessEventsTable = {
  id: Generated<string>
  tenant_id: string
  organization_id: string
  process_key: string
  case_kind: string
  case_id: string
  activity_key: string
  activity_kind: string
  occurred_at: Timestamp
  source_log_id: string
  seq: number
  actor_pseudonym: string | null
  actor_role_ids: string[] | null
  actor_team_id: string | null
  cause_kind: string
  cause_id: string | null
  via_sync_run: boolean
  followup_field: string | null
  followup_value: string | null
  voided: boolean
  voided_by_log_id: string | null
  created_at: Timestamp
}

export type InsightsProcessCasesTable = {
  id: Generated<string>
  tenant_id: string
  organization_id: string
  process_key: string
  case_kind: string
  case_id: string
  started_at: Timestamp
  last_activity_at: Timestamp
  ended_at: NullableTimestamp
  status: string
  event_count: number
  rework_count: number
  distinct_actor_count: number
  automated_share: number
  variant_hash: string
  variant_keys: Json<string[]>
  dimensions: Json<Record<string, unknown>>
  truncated: boolean
  recomputed_at: Timestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export type InsightsProcessRollupsTable = {
  id: Generated<string>
  tenant_id: string
  organization_id: string
  process_key: string
  window_key: string
  window_start: Timestamp
  window_end: Timestamp
  computed_at: Timestamp
  metrics: Json<Record<string, unknown>>
  created_at: Timestamp
}

export type InsightsProcessSettingsTable = {
  id: Generated<string>
  tenant_id: string
  organization_id: string
  enabled: boolean
  retention_days: number
  k_anonymity: number
  debounce_seconds: number
  individuals_enabled: boolean
  conformance_workflow_id: string | null
  activity_step_map: Json<Record<string, string> | null>
  created_at: Timestamp
  updated_at: NullableTimestamp
  deleted_at: NullableTimestamp
}

export type InsightsProcessErasuresTable = {
  id: Generated<string>
  tenant_id: string
  user_id: string
  replacement: string
  created_at: Timestamp
}

export type XrayDatabase = {
  insights_process_cursors: InsightsProcessCursorsTable
  insights_process_events: InsightsProcessEventsTable
  insights_process_cases: InsightsProcessCasesTable
  insights_process_rollups: InsightsProcessRollupsTable
  insights_process_settings: InsightsProcessSettingsTable
  insights_process_erasures: InsightsProcessErasuresTable
}

export type ProjectionScope = {
  tenantId: string
  organizationId: string
}
