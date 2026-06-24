import { z, type ZodTypeAny } from 'zod'

/**
 * A single proposed action emitted by an actionable agent. `payload` is shaped
 * per-agent via the agent's `result.schema`; the generic form keeps it open.
 */
export const proposedActionSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
})
export type ProposedAction = z.infer<typeof proposedActionSchema>

/** The proposal envelope carried by an actionable AgentResult. */
export const agentProposalSchema = z.object({
  actions: z.array(proposedActionSchema),
  confidence: z.number().optional(),
  rationale: z.string().optional(),
})
export type AgentProposalPayload = z.infer<typeof agentProposalSchema>

/**
 * The AgentResult union (the return contract). Generic helper so callers can
 * narrow `data`/`proposal` against their own agent `result.schema`.
 */
export function agentResultSchema(dataSchema: ZodTypeAny = z.unknown()) {
  return z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('informative'), data: dataSchema }),
    z.object({ kind: z.literal('actionable'), proposal: agentProposalSchema }),
  ])
}

export const baseAgentResultSchema = agentResultSchema()
export type AgentResult<T = unknown> =
  | { kind: 'informative'; data: T }
  | { kind: 'actionable'; proposal: AgentProposalPayload }

/** Trace-list filter facets (trace-eval overlay). */
export const runFilterFacet = z.enum(['overridden', 'low-confidence', 'eval-fail'])
export type RunFilterFacet = z.infer<typeof runFilterFacet>

/** Relative time windows for trace/metrics queries. */
export const runWindow = z.enum(['24h', '7d', '30d', '90d'])
export type RunWindow = z.infer<typeof runWindow>

/** Query schema for GET /runs (list + ?id= detail). */
export const runListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    agentId: z.string().optional(),
    status: z.enum(['running', 'ok', 'error', 'cancelled']).optional(),
    resultKind: z.enum(['informative', 'actionable']).optional(),
    // Trace facets + window (trace-eval overlay).
    filter: runFilterFacet.optional(),
    window: runWindow.optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()
export type RunListQuery = z.infer<typeof runListQuerySchema>

/** Body schema for POST /agents/:id/run (playground). */
export const agentRunRequestSchema = z.object({
  input: z.unknown(),
})
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>

/** The dispositions an operator may set through the dispose endpoint (area 03). */
export type ProposalDisposition = 'approved' | 'edited' | 'rejected'

/**
 * Body schema for POST /proposals/:id/dispose. The endpoint only ever serves the
 * human verdicts — `pending`/`auto_approved` are internal-only and never accepted
 * over the wire. `edited` overrides the proposal payload (requires reason);
 * `rejected` requires a reason.
 */
export const disposeProposalSchema = z
  .object({
    disposition: z.enum(['approved', 'edited', 'rejected']),
    payload: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.disposition === 'edited' || value.disposition === 'rejected') && !value.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: '[internal] reason required for edit/reject' })
    }
    if (value.disposition === 'edited' && !value.payload) {
      ctx.addIssue({ code: 'custom', path: ['payload'], message: '[internal] payload required for edit' })
    }
  })
export type DisposeProposalInput = z.infer<typeof disposeProposalSchema>

/** Query schema for GET /proposals (list + ?id= detail). */
export const proposalListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    agentId: z.string().optional(),
    processId: z.string().uuid().optional(),
    disposition: z.enum(['pending', 'auto_approved', 'approved', 'edited', 'rejected']).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>

// ── Sample / reference result schema ──────────────────────────────────────
// The real demo agent ships in area 05; this actionable result schema is the
// single source for the example `deals.health_check` agent referenced by the
// area-01 SDK doc and the throwaway smoke-test `ai-agents.ts`.
// Tightened so object-mode generation always yields a usable proposal: a
// REQUIRED confidence (drives the disposition threshold — a missing one would
// fail-closed and always park) and a typed `set_stage` action with a non-empty
// stage (the effector reads `proposal.actions[0].payload.stage`). With these
// required, `generateObject` constrains the model to fill them.
export const dealHealthCheckResult = z.object({
  kind: z.literal('actionable'),
  proposal: z.object({
    actions: z
      .array(
        z.object({
          type: z.literal('set_stage'),
          payload: z.object({ stage: z.string().min(1) }),
        }),
      )
      .min(1),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
  }),
})
export type DealHealthCheckResult = z.infer<typeof dealHealthCheckResult>

// ── Trace ingestion (trace-eval overlay) ───────────────────────────────────
// The normalized trace a runtime adapter POSTs to /trace/ingest. tenantId and
// organizationId are NEVER taken from the body — they are derived server-side
// from the authenticated/HMAC principal so a caller cannot ingest cross-tenant.
// Idempotency key is (runtime, externalRunId). Large payloads (input/output and
// per-tool request/response) are offloaded to storage-s3 by the service; only
// redacted summaries stay on the row.

/** A single tool invocation within a span. `*Payload` are full payloads the service offloads. */
export const traceToolCallIngestSchema = z.object({
  toolName: z.string().min(1),
  requestSummary: z.unknown().optional(),
  responseSummary: z.unknown().optional(),
  requestPayload: z.unknown().optional(),
  responsePayload: z.unknown().optional(),
  status: z.enum(['ok', 'error']).default('ok'),
  latencyMs: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
})
export type TraceToolCallIngest = z.infer<typeof traceToolCallIngestSchema>

/** One execution-trace span. `externalSpanId` links children regardless of arrival order. */
export const traceSpanIngestSchema = z.object({
  externalSpanId: z.string().min(1),
  parentExternalSpanId: z.string().nullable().optional(),
  sequence: z.number().int().nonnegative(),
  name: z.string().min(1),
  kind: z.enum(['llm', 'tool', 'system']),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  status: z.enum(['ok', 'error']).default('ok'),
  attributes: z.unknown().optional(),
  toolCalls: z.array(traceToolCallIngestSchema).optional(),
})
export type TraceSpanIngest = z.infer<typeof traceSpanIngestSchema>

/** The run envelope POSTed to /trace/ingest. */
export const traceIngestSchema = z.object({
  runtime: z.string().min(1),
  externalRunId: z.string().min(1),
  agentId: z.string().min(1),
  agentVersion: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(['running', 'ok', 'error', 'cancelled']).optional(),
  processId: z.string().uuid().nullable().optional(),
  stepId: z.string().nullable().optional(),
  proposalId: z.string().uuid().nullable().optional(),
  confidence: z.number().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  outputSummary: z.unknown().optional(),
  contextRouting: z.unknown().optional(),
  spans: z.array(traceSpanIngestSchema).optional(),
})
export type TraceIngest = z.infer<typeof traceIngestSchema>

/** Shape returned by GET /runs/:id — the full run with its trace tree. */
export type RunDetailResponse = {
  run: Record<string, unknown>
  spans: Array<Record<string, unknown>>
  toolCalls: Array<Record<string, unknown>>
}

// ── Corrections & eval cases (flywheel) ────────────────────────────────────

export const correctionAction = z.enum(['edit', 'reject', 'override', 'answer'])
export type CorrectionActionInput = z.infer<typeof correctionAction>

/**
 * Body schema for POST /corrections. The route derives proposedValue, agentId,
 * run input, and scope from the proposal/run server-side; the client supplies
 * only the verdict, the mandatory reason, and (for edits) the corrected value.
 */
export const createCorrectionRequestSchema = z
  .object({
    proposalId: z.string().uuid(),
    action: correctionAction,
    reason: z.string().min(1),
    correctedValue: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'edit' && value.correctedValue === undefined) {
      ctx.addIssue({ code: 'custom', path: ['correctedValue'], message: '[internal] correctedValue required for edit/override' })
    }
  })
export type CreateCorrectionRequest = z.infer<typeof createCorrectionRequestSchema>

/** Versioned envelope for the agent_orchestrator eval-case export (STABLE/ADDITIVE-ONLY). */
export const EVAL_CASE_EXPORT_VERSION = 1 as const

export type EvalCaseExportItem = {
  id: string
  sourceType: 'correction' | 'golden_run'
  agentDefinitionId: string
  processType: string | null
  input: unknown
  expected: unknown | null
  assertions: unknown | null
  approvedByUserId: string | null
  createdAt: string
}

export type EvalCaseExport = {
  version: typeof EVAL_CASE_EXPORT_VERSION
  generatedAt: string
  count: number
  cases: EvalCaseExportItem[]
}

/** Query schema for GET /eval-cases/export. */
export const evalCaseExportQuerySchema = z
  .object({
    agentDefinitionId: z.string().optional(),
  })
  .passthrough()
export type EvalCaseExportQuery = z.infer<typeof evalCaseExportQuerySchema>

// ── Metric rollups (F2) ─────────────────────────────────────────────────────
/**
 * The `metrics` jsonb shape stored on an AgentMetricRollup row — the same KPIs
 * the /agents/:id/metrics endpoint computes live, precomputed per window. Null
 * rates mean "no denominator" (e.g. no evaluated runs) rather than zero.
 */
export const agentMetricRollupMetricsSchema = z.object({
  totalRuns: z.number().int().nonnegative(),
  evaluatedRuns: z.number().int().nonnegative(),
  evalPassRate: z.number().min(0).max(1).nullable(),
  overrides: z.number().int().nonnegative(),
  overrideRate: z.number().min(0).max(1).nullable(),
  avgLatencyMs: z.number().nonnegative().nullable(),
  costMinorTotal: z.number().nonnegative(),
  disposedProposals: z.number().int().nonnegative(),
  approveUnchangedRate: z.number().min(0).max(1).nullable(),
})
export type AgentMetricRollupMetrics = z.infer<typeof agentMetricRollupMetricsSchema>
