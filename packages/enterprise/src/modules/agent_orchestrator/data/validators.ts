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

export const proposalDispositionValues = ['pending', 'auto_approved', 'approved', 'edited', 'rejected'] as const
export type ProposalDispositionValue = (typeof proposalDispositionValues)[number]

/**
 * `disposition` accepts one value or a comma-separated list (e.g.
 * `approved,auto_approved,edited` for the Caseload "Approved" tab) — additive
 * on the original single-enum contract.
 */
const proposalDispositionFilter = z
  .string()
  .refine(
    (value) =>
      value
        .split(',')
        .every((token) => (proposalDispositionValues as readonly string[]).includes(token)),
    { message: '[internal] invalid disposition filter' },
  )

/** Query schema for GET /proposals (list + ?id= detail). */
export const proposalListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    agentId: z.string().optional(),
    processId: z.string().uuid().optional(),
    disposition: proposalDispositionFilter.optional(),
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

// ── Eval assertion management (F9) ──────────────────────────────────────────
/**
 * Create/update schemas for `AgentEvalAssertion` rows (editable → optimistic
 * lock applies). `config` parameterizes the scorer/judge; it stays permissive
 * (`unknown`) and is narrowed only at this zod boundary. `appliesTo` is an agent
 * id or `'*'` (every agent). Only `deterministic` assertions are gate-graded —
 * the route enforces that `llm_judge` is always `warn` (the judge cannot block).
 */
export const evalAssertionType = z.enum(['deterministic', 'llm_judge'])
export type EvalAssertionType = z.infer<typeof evalAssertionType>

export const evalAssertionSeverity = z.enum(['gate', 'warn'])
export type EvalAssertionSeverity = z.infer<typeof evalAssertionSeverity>

export const evalAssertionCreateSchema = z.object({
  key: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  appliesTo: z.string().min(1).max(100).default('*'),
  type: evalAssertionType,
  severity: evalAssertionSeverity,
  config: z.unknown().optional(),
  enabled: z.boolean().optional(),
})
export type EvalAssertionCreateInput = z.infer<typeof evalAssertionCreateSchema>

export const evalAssertionUpdateSchema = z
  .object({ id: z.string().uuid() })
  .merge(evalAssertionCreateSchema.partial())
export type EvalAssertionUpdateInput = z.infer<typeof evalAssertionUpdateSchema>

/** Query schema for GET /eval-assertions (list). */
export const evalAssertionListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    appliesTo: z.string().optional(),
    type: evalAssertionType.optional(),
    severity: evalAssertionSeverity.optional(),
    enabled: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()
export type EvalAssertionListQuery = z.infer<typeof evalAssertionListQuerySchema>

// ── Runtime guardrails (Phase 1) ────────────────────────────────────────────
/**
 * Guardrail phase/kind/result unions — mirror the TS string-unions on the
 * AgentGuardrailCheck entity (kept as Zod enums for runtime validation of the
 * verdict + persisted check shape).
 */
export const guardrailPhase = z.enum(['input', 'output'])
export type GuardrailPhaseInput = z.infer<typeof guardrailPhase>

export const guardrailKind = z.enum([
  'prompt_injection',
  'pii',
  'grounding',
  'schema',
  'moderation',
  'tool_scope',
])
export type GuardrailKindInput = z.infer<typeof guardrailKind>

export const guardrailResult = z.enum(['pass', 'warn', 'block'])
export type GuardrailResultInput = z.infer<typeof guardrailResult>

/**
 * Redacted-only evidence carried on an AgentGuardrailCheck / verdict check. NEVER
 * raw PII or plaintext spans — only a redacted detail string and pointers/offsets
 * into the encrypted artifact store. Phase 1 populates `detail` (e.g. the schema
 * error path) and `pointers`; richer redaction lands with the PII phase.
 */
export const guardrailEvidenceSchema = z
  .object({
    /** Short, redacted human/debug detail — never raw PII (schema-error path etc.). */
    detail: z.string().optional(),
    /** storage-s3 keys / offsets into the encrypted artifact store. */
    pointers: z.array(z.string()).optional(),
    /**
     * Prompt-injection detector rule ids that fired (redaction-safe — the rule id,
     * never the matched text). See `lib/guardrails/promptInjection.ts`.
     */
    rules: z.array(z.string()).optional(),
    /** Count of untrusted spans flagged (a number, never the span content). */
    flaggedSpans: z.number().int().nonnegative().optional(),
    /**
     * The tool/action that triggered a tool-scope `block` (the tool id, which is a
     * configured allowlist key — not user/untrusted data).
     */
    tool: z.string().optional(),
  })
  .passthrough()
export type GuardrailEvidence = z.infer<typeof guardrailEvidenceSchema>

/** One check within a verdict (and the shape attached to the proposal's guardResults). */
export const guardrailCheckSchema = z.object({
  kind: guardrailKind,
  result: guardrailResult,
  guardrailSetVersion: z.string().min(1),
  evidence: guardrailEvidenceSchema.optional(),
})
export type GuardrailCheck = z.infer<typeof guardrailCheckSchema>

/**
 * The verdict GuardrailService.checkInput/checkOutput returns. `result` is the
 * worst severity across `checks`; `blockedReason` is set only on a `block`.
 */
export const guardrailVerdictSchema = z.object({
  result: guardrailResult,
  checks: z.array(guardrailCheckSchema),
  blockedReason: z
    .object({ phase: guardrailPhase, kind: guardrailKind })
    .optional(),
})
export type GuardrailVerdict = z.infer<typeof guardrailVerdictSchema>

/** The `guardResults` jsonb attached to an AgentProposal (the verdict's checks). */
export const guardResultsSchema = z.array(guardrailCheckSchema)
export type GuardResults = z.infer<typeof guardResultsSchema>

/**
 * One UNTRUSTED span screened by the pre-call prompt-injection check (Wave 3,
 * Phase 3). `text` is attacker-controllable document/retrieval content — the
 * detector reads it but it is NEVER persisted to evidence (only the provenance
 * locator + matched rule ids are). Mirrors the `document`/`retrieval` sources the
 * Wave-2 ContextResolver assembles.
 */
export const untrustedSpanSchema = z.object({
  sourceKind: z.enum(['document', 'retrieval']),
  /** Source attachment id / retrieval ref — a pointer, never the content. */
  sourceRef: z.string().min(1),
  /** `page:N[#bbox]` (document) or the retrieval locator — a pointer into the artifact. */
  locator: z.string().min(1),
  /** The raw untrusted text. Screened in-memory; never written to evidence. */
  text: z.string(),
})
export type UntrustedSpan = z.infer<typeof untrustedSpanSchema>

/**
 * A tool/action the model attempted (output phase tool-scope backstop). Untrusted
 * document text must NEVER authorize a tool call — the tool-scope check rejects any
 * attempt outside the per-capability `ai_assistant` allowlist regardless of how it
 * was elicited. `isMutation` reflects the tool's registered mutation flag (a
 * read-only agent under `read-only` policy may invoke NO mutation tool).
 */
export const attemptedToolSchema = z.object({
  name: z.string().min(1),
  isMutation: z.boolean().optional(),
})
export type AttemptedTool = z.infer<typeof attemptedToolSchema>

/** Query schema for GET /guardrail-checks (list + ?id= detail). */
export const guardrailCheckListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    agentRunId: z.string().uuid().optional(),
    proposalId: z.string().uuid().optional(),
    phase: guardrailPhase.optional(),
    kind: guardrailKind.optional(),
    result: guardrailResult.optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()
export type GuardrailCheckListQuery = z.infer<typeof guardrailCheckListQuerySchema>

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

// ── Context bundles / TDCR assembly (context overlay, Phase 1) ──────────────
/**
 * Source kind a `ContextModule` may expose. `entity` = an OM structured record
 * read via `queryEngine`/`query_index`; `document` = an ingested attachment
 * (Phase 3); `retrieval` = a ranked `searchService` snippet (Phase 2).
 */
export const contextSourceKind = z.enum(['entity', 'document', 'retrieval'])
export type ContextSourceKind = z.infer<typeof contextSourceKind>

/** A source the packer selected & packed into the bundle (routed). */
export const contextRoutedSourceSchema = z.object({
  kind: contextSourceKind,
  ref: z.string().min(1),
  locator: z.string().optional(),
  tokens: z.number().int().nonnegative(),
  score: z.number().optional(),
})
export type ContextRoutedSource = z.infer<typeof contextRoutedSourceSchema>

/** A candidate the packer excluded, with a reason (audit of the prune decision). */
export const contextPrunedSourceSchema = z.object({
  kind: z.string().min(1),
  ref: z.string().min(1),
  reason: z.string().min(1),
})
export type ContextPrunedSource = z.infer<typeof contextPrunedSourceSchema>

/**
 * Provenance for one fact in the bundle — links a routed fact back to its source
 * so compliance lineage and guardrails grounding read the same record. Stamped at
 * assembly time, never reconstructed.
 */
export const contextProvenanceSchema = z.object({
  factId: z.string().min(1),
  sourceKind: contextSourceKind,
  sourceRef: z.string().min(1),
  locator: z.string().optional(),
})
export type ContextProvenance = z.infer<typeof contextProvenanceSchema>

/** One redaction applied before packing (P4 populates richer rules). */
export const contextRedactionAppliedSchema = z.object({
  field: z.string().min(1),
  rule: z.string().min(1),
})
export type ContextRedactionApplied = z.infer<typeof contextRedactionAppliedSchema>

export const contextBundleRoutedSourcesSchema = z.array(contextRoutedSourceSchema)
export const contextBundlePrunedSourcesSchema = z.array(contextPrunedSourceSchema)
export const contextBundleSourcesSchema = z.array(contextProvenanceSchema)
export const contextBundleRedactionAppliedSchema = z.array(contextRedactionAppliedSchema)

// ── Document ingest / OCR extraction (context overlay, Phase 3) ─────────────
/**
 * A document locator points a fact back into its source document — the page (and
 * optional region) the fact was extracted from. The string form persisted on the
 * bundle is `page:<n>` or `page:<n>#<x0>,<y0>,<x1>,<y1>` so it round-trips through
 * the existing `ContextProvenance.locator`/`ContextRoutedSource.locator` string
 * columns without a schema change. Structured here for typed assembly; serialized
 * by `formatDocumentLocator`.
 */
export const documentRegionSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
])
export type DocumentRegion = z.infer<typeof documentRegionSchema>

export const documentLocatorSchema = z.object({
  page: z.number().int().positive(),
  region: documentRegionSchema.optional(),
})
export type DocumentLocator = z.infer<typeof documentLocatorSchema>

/**
 * One typed fact extracted from a document. Carries full lineage: the source
 * attachment id (`sourceRef`), the page/region `locator`, and a `confidence`
 * score in [0,1]. Extracted `value` is UNTRUSTED data (attacker-controllable
 * document content) — never an instruction; Wave 3 guardrails treat it as such.
 */
export const documentFactSchema = z.object({
  /** Field name within the doc-type schema (e.g. `invoice_total`, `policy_number`). */
  field: z.string().min(1),
  /** Extracted value — UNTRUSTED document content, never an instruction. */
  value: z.string(),
  /** Source attachment id (FK id → attachments; NOT an ORM relation). */
  sourceRef: z.string().min(1),
  /** Page/region the fact was extracted from (lineage → contestability). */
  locator: documentLocatorSchema,
  /** Extraction confidence in [0,1]; low-confidence facts are excludable from routing. */
  confidence: z.number().min(0).max(1),
})
export type DocumentFact = z.infer<typeof documentFactSchema>

/** Result of one document ingest run: the doc-type classification + its typed facts. */
export const documentExtractionSchema = z.object({
  /** Source attachment id the facts were extracted from. */
  sourceRef: z.string().min(1),
  /** Classified document type (e.g. `invoice`, `claim_form`, `unknown`). */
  docType: z.string().min(1),
  /** The swappable OCR/extraction provider id that produced the facts. */
  engine: z.string().min(1),
  facts: z.array(documentFactSchema),
})
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>

/** Query schema for GET /context-bundles (list + ?id= detail) — trace read route. */
export const contextBundleListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    agentRunId: z.string().uuid().optional(),
    processId: z.string().uuid().optional(),
    capability: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()
export type ContextBundleListQuery = z.infer<typeof contextBundleListQuerySchema>

// ── Grounding / cite-or-abstain (Wave 3, Phase 4) ────────────────────────────
/**
 * A single citation a factual claim carries — an id INTO the run's
 * `AgentContextBundle.sources` (or a `retrieve()` snippet). The grounding check
 * resolves it against the citable sources surfaced for the run: a citation is
 * valid iff a citable source with the same `sourceRef` + `locator` exists and its
 * score clears the set's `minScore`. Pointers only — never raw span text.
 */
export const groundingCitationSchema = z.object({
  sourceKind: contextSourceKind,
  sourceRef: z.string().min(1),
  locator: z.string().min(1),
})
export type GroundingCitation = z.infer<typeof groundingCitationSchema>

/**
 * One factual claim emitted by a FACTUAL capability's proposal. `citations` is the
 * cite-or-abstain contract: a factual claim with zero resolvable citations is a
 * `block` (the model's only compliant alternative is to abstain — omit the claim).
 * `claim` is a short human label used only to point at WHICH claim lacked support
 * in evidence (never raw PII/payload — the capability authors a redaction-safe label).
 */
export const groundingClaimSchema = z.object({
  claim: z.string().min(1),
  citations: z.array(groundingCitationSchema).default([]),
})
export type GroundingClaim = z.infer<typeof groundingClaimSchema>

/** A citable source surfaced for the run (bundle `sources` + `retrieve()` snippets). */
export const citableSourceSchema = z.object({
  sourceKind: contextSourceKind,
  sourceRef: z.string().min(1),
  locator: z.string().min(1),
  score: z.number(),
})
export type CitableSource = z.infer<typeof citableSourceSchema>

/**
 * The per-capability grounding policy body. Versioned config (a guardrail SET):
 * declares the capability is factual + the severity of each grounding failure mode
 * + the minimum citable-source score a citation must clear. `claimsPath` points at
 * the array of factual claims within the proposal output (dot path, default
 * `proposal.claims`). The `version` recorded on each check is the CONTENT-HASH of
 * this body — editing it produces a new version; re-syncing an unchanged body is a
 * no-op (idempotent).
 */
export const groundingSeverity = z.enum(['warn', 'block'])
export type GroundingSeverity = z.infer<typeof groundingSeverity>

export const guardrailSetBodySchema = z.object({
  capability: z.string().min(1),
  /** Marks the capability factual — only factual capabilities run the grounding gate. */
  factual: z.boolean(),
  kind: z.literal('grounding'),
  /** Dot path to the factual-claims array within the proposal output. */
  claimsPath: z.string().min(1).default('proposal.claims'),
  /** A factual claim with zero resolvable citations. */
  missingCitation: groundingSeverity.default('block'),
  /** A citation that resolves to no citable source (or below `minScore`). */
  unresolvableCitation: groundingSeverity.default('block'),
  /** Minimum citable-source score a citation must clear to be considered resolved. */
  minScore: z.number().default(0),
})
export type GuardrailSetBody = z.infer<typeof guardrailSetBodySchema>

// ── Agent identity & on-behalf-of (Wave 4, Phase 1) ──────────────────────────
/**
 * The authentication path an `AgentPrincipal` uses. `internal` (the only mode
 * provisioned in Phase 1) = in-process `INVOKE_AGENT`, NO network auth and NO
 * interactive credential. `oauth_client` (Phase 3) + `authmd` (Phase 4) are
 * forward-compatible external seams declared now, provisioned later.
 */
export const agentCredentialMode = z.enum(['internal', 'oauth_client', 'authmd'])
export type AgentCredentialModeInput = z.infer<typeof agentCredentialMode>

/**
 * Input to provision (idempotently) an agent principal: the agent definition id,
 * the human-readable name stamped on the provisioned agent `User`, the scoped
 * feature grants for the agent's least-privilege `Role`, and the credential mode.
 * The provisioning service derives the agent `User` email + role name
 * deterministically from `agentDefinitionId` + scope, so a re-run is a no-op.
 */
export const provisionAgentPrincipalSchema = z.object({
  agentDefinitionId: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200).optional(),
  /** Least-privilege ACL feature ids granted to the agent's scoped role. */
  roleFeatures: z.array(z.string().min(1)).default([]),
  credentialMode: agentCredentialMode.default('internal'),
})
export type ProvisionAgentPrincipalInput = z.infer<typeof provisionAgentPrincipalSchema>

/** Query schema for GET /identity/principals (list + ?id= detail). */
export const agentPrincipalListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    agentDefinitionId: z.string().optional(),
    credentialMode: agentCredentialMode.optional(),
    enabled: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()
export type AgentPrincipalListQuery = z.infer<typeof agentPrincipalListQuerySchema>

// ── External OAuth client-credentials + delegation grant (Wave 4 Phase 3) ─────

/**
 * RFC 6749 §4.4 client-credentials token request. Only `client_credentials` is
 * accepted (a non-conforming `grant_type` is rejected → `unsupported_grant_type`).
 * `scope` is OPTIONAL and only ever NARROWS within the grant's server-side scope
 * — the client can never widen beyond what the AgentDelegationGrant authorizes.
 * Tenant/organization are NEVER read from client input; they are derived from the
 * authenticated principal + grant so a client cannot mint a cross-tenant token.
 */
export const oauthTokenRequestSchema = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1).max(200),
  client_secret: z.string().min(1).max(500),
  /** Optional space-delimited scope subset; intersected with the grant's scopes. */
  scope: z.string().max(2000).optional(),
})
export type OAuthTokenRequest = z.infer<typeof oauthTokenRequestSchema>

/** RFC 6749 §5.1 access-token response. No secret is ever echoed. */
export const oauthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  scope: z.string(),
})
export type OAuthTokenResponse = z.infer<typeof oauthTokenResponseSchema>

/**
 * The audience-scoped JWT claims minted for an external agent. `aud:'agent'`
 * isolates the signing key (an agent token can never be replayed as a staff or
 * customer session). `scope`/`tenantId`/`organizationId`/`grantId` are
 * server-derived and unforgeable by the client. Verification re-loads the grant
 * by `grantId` and rejects when it is revoked/expired (revocation is immediate).
 */
export const agentTokenClaimsSchema = z.object({
  iss: z.literal('open-mercato'),
  aud: z.literal('agent'),
  /** The agent principal's `auth.User` id — the actor on every attributed write. */
  sub: z.string().uuid(),
  /** The human delegator this agent acts on behalf of, or null when none. */
  obo: z.string().uuid().nullable(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  /** Space-delimited `<capability>:<action>` scope grants. */
  scope: z.string(),
  /** FK id → agent_delegation_grants; the per-request revocation check key. */
  grantId: z.string().uuid(),
})
export type AgentTokenClaims = z.infer<typeof agentTokenClaimsSchema>

/**
 * Input to create an AgentDelegationGrant — links an external (`oauth_client`)
 * AgentPrincipal to the human delegator + the scopes it may mint tokens for.
 * Tenant/organization come from the authenticated request scope, never the body.
 */
export const createAgentDelegationGrantSchema = z.object({
  /** FK id → agent_principals (the external principal this grant authorizes). */
  agentPrincipalId: z.string().uuid(),
  /** FK id → auth.User — the human delegating authority to the agent. */
  delegatorUserId: z.string().uuid(),
  /** `<capability>:<action>` scopes the minted token may carry (non-empty). */
  scopes: z.array(z.string().min(1)).min(1),
  /** Optional hard expiry; tokens never outlive this even before revocation. */
  expiresAt: z.coerce.date().nullable().optional(),
})
export type CreateAgentDelegationGrantInput = z.infer<typeof createAgentDelegationGrantSchema>

/** Body for POST /identity/grants/:id/revoke (optimistic-lock token optional). */
export const revokeAgentDelegationGrantSchema = z
  .object({
    /** Optional expected `updated_at` token (also accepted via the standard header). */
    expectedUpdatedAt: z.string().optional(),
  })
  .partial()
export type RevokeAgentDelegationGrantInput = z.infer<typeof revokeAgentDelegationGrantSchema>

// ── auth.md / ID-JAG self-registration (Wave 4 Phase 4) ──────────────────────

/**
 * The OAuth grant type the platform exposes for the ID-JAG / JWT-bearer flow.
 * RFC 7523 (`urn:ietf:params:oauth:grant-type:jwt-bearer`) is the standard
 * external agents present an issuer-signed identity assertion under. Additive —
 * the OAuth-now `client_credentials` grant is unchanged.
 */
export const ID_JAG_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer' as const

/**
 * The public `/well-known` agent-auth discovery metadata. Read-only and free of
 * secrets — it advertises WHERE to authenticate, the supported grant types
 * (client-credentials now + the ID-JAG / JWT-bearer flow), and the audience an
 * external assertion must target. JWKS/issuer verification material is NEVER
 * exposed here (the platform validates the assertion server-side against its
 * trusted-issuer registry — there is no client-fetched key set to leak).
 */
export const agentAuthDiscoverySchema = z.object({
  issuer: z.string().min(1),
  /** Absolute path of the OAuth client-credentials token endpoint (RFC 6749 §4.4). */
  token_endpoint: z.string().min(1),
  /** Absolute path of the ID-JAG / JWT-bearer self-registration endpoint. */
  agent_auth_endpoint: z.string().min(1),
  grant_types_supported: z.array(z.string().min(1)),
  /** The audience an external ID-JAG assertion MUST target to be accepted. */
  agent_assertion_audience: z.string().min(1),
  /** The minted access token's audience (an agent token, isolated from staff/customer). */
  token_audience: z.string().min(1),
  token_endpoint_auth_methods_supported: z.array(z.string().min(1)),
})
export type AgentAuthDiscovery = z.infer<typeof agentAuthDiscoverySchema>

/**
 * RFC 7523 §2.1 JWT-bearer token request carrying an issuer-signed ID-JAG
 * assertion. Only the JWT-bearer grant is accepted here (a non-conforming
 * `grant_type` → `unsupported_grant_type`). `assertion` is the compact JWS the
 * provider signed; `scope` is OPTIONAL and only ever NARROWS within the resolved
 * grant. Tenant/org are NEVER read from the request — they are derived from the
 * resolved/onboarded principal, so a caller cannot self-assign a cross-tenant scope.
 */
export const idJagTokenRequestSchema = z.object({
  grant_type: z.literal(ID_JAG_GRANT_TYPE),
  /** The compact issuer-signed identity assertion (ID-JAG / JWT-bearer). */
  assertion: z.string().min(1).max(8000),
  /** Optional space-delimited scope subset; intersected with the grant's scopes. */
  scope: z.string().max(2000).optional(),
})
export type IdJagTokenRequest = z.infer<typeof idJagTokenRequestSchema>

/**
 * The validated claims of an issuer-signed ID-JAG assertion. `iss` selects the
 * trusted-issuer verification key (server-side registry — never client-supplied);
 * `aud` MUST equal the platform's assertion audience (a wrong-audience assertion
 * is rejected, mirroring the token-side audience isolation). `sub` is the external
 * agent's stable subject — the idempotency key for onboarding. `org_id`/`tenant_id`
 * bind the assertion to a concrete tenant the issuer is authorized for; the
 * onboarding service verifies the issuer is allowed to provision into that org.
 * Tenant/org are taken from the SIGNED assertion, never from request input.
 */
export const idJagAssertionClaimsSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.string().min(1),
  /** The tenant the issuer is provisioning the agent into (must be issuer-authorized). */
  tenant_id: z.string().uuid(),
  /** The organization the issuer is provisioning the agent into (must be issuer-authorized). */
  org_id: z.string().uuid(),
  /** The agent definition id the external agent maps to. */
  agent_definition_id: z.string().min(1).max(100),
  /** The human delegator the agent acts on behalf of, or null/absent for system grants. */
  delegator_user_id: z.string().uuid().nullable().optional(),
  /** Requested `<capability>:<action>` scopes; the onboarded grant carries these. */
  scopes: z.array(z.string().min(1)).optional(),
  /** Optional display name stamped on the provisioned agent `User`. */
  display_name: z.string().min(1).max(200).optional(),
})
export type IdJagAssertionClaims = z.infer<typeof idJagAssertionClaimsSchema>
