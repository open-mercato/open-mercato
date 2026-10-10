/**
 * Change simulator constants (spec `2026-10-08-insights-change-simulator.md`, S11–S17). Bump
 * `SIMULATION_ENGINE_VERSION` when the orchestration changes what a run computes: it is part of
 * every inputs hash, so a changed engine never answers with an old run.
 */
export const SIMULATION_ENGINE_VERSION = 1

export const SIMULATION_QUEUE = 'insights-simulation'

export const SIMULATION_QUEUE_CONCURRENCY = 2

export const SIMULATION_JOB_TYPE = 'insights.simulation'

export const SIMULATION_RUN_RESOURCE_KIND = 'insights.simulation_run'

export const SIMULATION_DECISION_RESOURCE_KIND = 'insights.simulation_decision'

export const SIMULATION_VIEW_FEATURE = 'insights.simulator.view'

export const SIMULATION_RUN_FEATURE = 'insights.simulator.run'

export const SIMULATION_PROGRESS_MANAGE_FEATURE = 'progress.manage'

/** Past record values rebuilt from audit snapshots need this feature (else they are `cannot_tell`). */
export const SIMULATION_PAST_VALUES_FEATURE = 'audit_logs.view_tenant'

export const SIMULATION_LIMITS = {
  maxActivePerUser: 2,
  maxActivePerTenant: 5,
  submissionsPerHour: 20,
  maxInputBytes: 64 * 1024,
  maxInputDepth: 64,
  maxRecords: 50_000,
  maxDurationMs: 120_000,
  maxWindowDays: 365,
  defaultWindowDays: 90,
  maxBatchBytes: 4 * 1024 * 1024,
  maxBatchRows: 500,
  sliceMs: 15_000,
  statementTimeoutMs: 5_000,
} as const

export const SIMULATION_DEFAULT_TTL_HOURS = 30 * 24

export const SIMULATION_CONTINUATION_DELAY_MS = 1_000

/** A slice of a tenant that already has a slice running waits this long before it is retried. */
export const SIMULATION_TENANT_BUSY_DELAY_MS = 3_000

/** A queued/running run whose version has not moved for this long is failed as `abandoned`. */
export const SIMULATION_STALE_ACTIVE_MS = 30 * 60 * 1_000

export const SIMULATION_DECISION_RETENTION_MONTHS = 13

export const SIMULATION_PURGE_BATCH = 500

export const SIMULATION_PURGE_MAX_BATCHES = 20

/** Sample ids kept per visible cell (after `loadCurrent` confirmed them). */
export const SIMULATION_SAMPLE_LIMIT = 3

/** Candidate sample ids a kind may hand back per cell. */
export const SIMULATION_SAMPLE_CANDIDATES = 10

export const SIMULATION_MAINTENANCE_KIND = 'simulation_maintenance'

export const SIMULATION_MAINTENANCE_INTERVAL = '1d'

export const SIMULATION_LIST_MAX_PAGE_SIZE = 100

export const SIMULATION_RATE_LIMIT_KEY_PREFIX = 'insights:simulation_request'
