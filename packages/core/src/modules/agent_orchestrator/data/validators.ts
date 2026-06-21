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

/** Query schema for GET /runs (list + ?id= detail). */
export const runListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    agentId: z.string().optional(),
    status: z.enum(['running', 'ok', 'error']).optional(),
    resultKind: z.enum(['informative', 'actionable']).optional(),
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
export const dealHealthCheckResult = z.object({
  kind: z.literal('actionable'),
  proposal: z.object({
    actions: z.array(
      z.object({
        type: z.string(),
        payload: z.record(z.string(), z.unknown()),
      }),
    ),
    confidence: z.number().optional(),
    rationale: z.string().optional(),
  }),
})
export type DealHealthCheckResult = z.infer<typeof dealHealthCheckResult>
