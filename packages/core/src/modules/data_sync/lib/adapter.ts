export interface TenantScope {
  organizationId: string
  tenantId: string
}

export type FieldMappingKind =
  | 'core'
  | 'relation'
  | 'external_id'
  | 'custom_field'
  | 'metadata'
  | 'ignore'

export type FieldMappingDedupeRole = 'primary' | 'secondary'

export interface FieldMapping {
  externalField: string
  localField: string
  transform?: string
  required?: boolean
  defaultValue?: unknown
  mappingKind?: FieldMappingKind
  dedupeRole?: FieldMappingDedupeRole
}

export interface DataMapping {
  entityType: string
  fields: FieldMapping[]
  matchStrategy: 'externalId' | 'sku' | 'email' | 'custom'
  matchField?: string
}

export interface StreamImportInput {
  entityType: string
  cursor?: string
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
  runId?: string
  /**
   * Operator-supplied run parameters, normalized against the adapter's
   * declared `runParameters`. Only declared keys are present; values are
   * already coerced to the declared types. Empty object when the adapter
   * declares no parameters.
   */
  parameters?: Record<string, RunParameterValue>
  /**
   * Aborted when the run is cancelled, so an adapter can stop INSIDE a batch.
   *
   * The engine only gets to look at cancellation between batches — its check sits in the batch
   * handler, which runs after the adapter has yielded. An adapter whose batch takes minutes (a
   * whole-table walk over a slow link) therefore keeps working, keeps writing, and keeps its
   * advisory lock for that whole time, however long ago the operator pressed Cancel.
   *
   * Honour it wherever the work is divisible — per page, per record, around a long flush — and just
   * return: the generator's own `finally` runs, which is where a lock or a connection is released.
   * Adapters that ignore it behave exactly as they do today.
   *
   * The `return` MUST sit ABOVE the `yield` for the page you abandoned, never below it. The engine
   * commits `batch.cursor` for every batch it receives, so yielding a half-applied page advances the
   * cursor past records that were never applied and no later run ever walks them again.
   *
   * The signal only reaches work running in THIS process. An adapter that hands part of a batch to
   * other workers must give that work its own cancellation check against the same progress job —
   * aborting here stops the generator, not anything already queued elsewhere.
   */
  signal?: AbortSignal
}

export interface ImportItem {
  externalId: string
  data: Record<string, unknown>
  action: 'create' | 'update' | 'skip' | 'failed'
  hash?: string
}

export interface ImportBatch {
  items: ImportItem[]
  cursor: string
  /**
   * Whether the source has more to give after this batch. The final batch MUST report `false`.
   *
   * This is not advisory. The engine uses the last batch's value to tell a stream that DRAINED from
   * one the adapter STOPPED EARLY on {@link StreamImportInput.signal}, because both end the same way
   * — the generator simply returns. An adapter that reports `true` on its final batch will have a
   * complete run misreported as `cancelled` whenever a cancel lands during the final read: the
   * operator is told a finished sync was partial, and the run stays resumable with nothing left to
   * resume.
   *
   * Derive it from the source rather than hardcoding it — `Boolean(nextPage)`, `offset < total`.
   */
  hasMore: boolean
  totalEstimate?: number
  processedCount?: number
  refreshCoverageEntityTypes?: string[]
  message?: string
  batchIndex: number
}

export interface StreamExportInput {
  entityType: string
  cursor?: string
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
  filter?: Record<string, unknown>
  runId?: string
  /** See {@link StreamImportInput.parameters}. */
  parameters?: Record<string, RunParameterValue>
  /** Aborted when the run is cancelled — see {@link StreamImportInput.signal}. */
  signal?: AbortSignal
}

export interface ExportItemResult {
  localId: string
  externalId?: string
  status: 'success' | 'error' | 'skipped'
  error?: string
}

export interface ExportBatch {
  results: ExportItemResult[]
  cursor: string
  /** Whether the source has more to give; the final batch MUST report `false`. See {@link ImportBatch.hasMore}. */
  hasMore: boolean
  batchIndex: number
}

export interface ValidationResult {
  ok: boolean
  message?: string
  details?: Record<string, unknown>
}

export type RunParameterType = 'boolean' | 'string' | 'number' | 'select'

export type RunParameterValue = boolean | string | number

export interface RunParameterOption {
  value: string
  label?: string
}

/**
 * A single operator-facing parameter an adapter accepts when a run is started.
 *
 * The `data_sync` UI renders an input per declared parameter, the run API
 * validates and coerces the submitted values against this declaration, and the
 * normalized values are handed back to the adapter on `StreamImportInput` /
 * `StreamExportInput`. Keep declarations generic — this contract is provider
 * agnostic.
 */
export interface RunParameter {
  /** Stable identifier used as the key in the normalized parameters object. */
  key: string
  /**
   * Human-readable label shown next to the input. Used verbatim when
   * `labelKey` is absent, and as the fallback when it resolves to nothing.
   */
  label: string
  /**
   * i18n key the dashboard resolves for the label, preferred over `label`.
   * Declare it whenever the adapter ships to more than one locale — `label`
   * alone can only ever be one language.
   */
  labelKey?: string
  type: RunParameterType
  /** Optional helper text rendered under the input. */
  description?: string
  /** i18n key for `description`, preferred over the literal when present. */
  descriptionKey?: string
  /**
   * When true, the run cannot start unless a non-empty value is provided.
   *
   * Has no effect on `boolean` parameters: a switch always submits `true` or
   * `false`, neither of which is blank, so the check can never fire. Use
   * `defaultValue` to express the intended default instead. This is why the
   * dashboard renders the required marker only on the input types where the
   * constraint is real.
   */
  required?: boolean
  /** Pre-filled value; also the value used when the field is left blank. */
  defaultValue?: RunParameterValue
  /** Placeholder for `string` / `number` inputs. */
  placeholder?: string
  /** i18n key for `placeholder`, preferred over the literal when present. */
  placeholderKey?: string
  /** Allowed choices for `select` parameters. */
  options?: RunParameterOption[]
  /** Inclusive bounds for `number` parameters. */
  min?: number
  max?: number
  /**
   * Restrict the parameter to a single run direction. When omitted the
   * parameter applies to both import and export runs.
   */
  direction?: 'import' | 'export'
  /**
   * Restrict the parameter to one or more entity types (matched against the
   * run's `entityType`, i.e. a value from `supportedEntities`). When omitted
   * the parameter applies to every entity the adapter supports. Use this when
   * a knob only makes sense for a specific entity's run — e.g. a bulk-reindex
   * toggle that only applies to the orders backfill.
   */
  entityType?: string | string[]
}

export interface DataSyncAdapter {
  readonly providerKey: string
  readonly direction: 'import' | 'export' | 'bidirectional'
  readonly supportedEntities: string[]
  /**
   * How a run may be started.
   *
   * - `generic` (default): `/api/data_sync/run` has enough information to
   *   create and enqueue the run.
   * - `provider`: the provider owns a prerequisite flow before a run can be
   *   enqueued, such as uploading a CSV and linking that upload to the run.
   */
  readonly runMode?: 'generic' | 'provider'
  readonly operationalTelemetry?: boolean
  /**
   * Optional operator-facing parameters accepted when a run is started. The
   * `data_sync` dashboard renders an input per entry, and the normalized values
   * are passed back on `StreamImportInput` / `StreamExportInput`.
   */
  readonly runParameters?: RunParameter[]

  /**
   * Batch work MUST be replay-safe.
   *
   * Sync jobs are delivered at least once: BullMQ redelivers a job whose lock
   * was not renewed, and the engine resumes the run from its last committed
   * cursor. A batch the generator already yielded can therefore be produced and
   * executed again, and the engine only fences its own commit — anything the
   * generator itself did before yielding has already happened.
   *
   * Upserts keyed by `externalId` satisfy this. Per-record side effects that are
   * not idempotent (sending mail, posting to a third party, incrementing a
   * remote counter) do not, and will run twice on a resume. Make them
   * conditional on state the adapter can re-read, or move them behind an event
   * the engine emits after the commit.
   *
   * `cursor` is a resume position, not an identity: repeating it between batches
   * is allowed.
   */
  streamImport?(input: StreamImportInput): AsyncIterable<ImportBatch>
  streamExport?(input: StreamExportInput): AsyncIterable<ExportBatch>
  /**
   * Whether the engine mirrors this entity type's cursor into the shared
   * `sync_cursors` row — one row per (integration, entityType, direction,
   * scope), overwritten by every run that commits a batch.
   *
   * Default `true`. Return `false` for an entity type whose cursor is a single
   * run's scan state rather than a durable position in a log. The run row keeps
   * `initialCursor` + `cursor` either way, so a redelivered job still resumes
   * exactly; what goes away is two concurrent or consecutive runs of the same
   * entity type silently redefining each other's start position.
   *
   * The distinction is a blast radius, not a preference: losing a log position
   * means re-draining the whole change queue, while losing a table walk's
   * position means re-walking a table the adapter already re-walks idempotently.
   * The predicate is per entity type because one adapter commonly serves both
   * kinds — an incremental feed and a whole-table backfill.
   */
  persistsSharedCursor?(entityType: string): boolean
  getInitialCursor?(input: { entityType: string; scope: TenantScope }): Promise<string | null>
  getMapping(input: { entityType: string; scope: TenantScope }): Promise<DataMapping>
  validateConnection?(input: {
    entityType: string
    credentials: Record<string, unknown>
    mapping: DataMapping
    scope: TenantScope
  }): Promise<ValidationResult>
}
