import { z } from 'zod'

/**
 * Result schema for the `support.ticket_triage` example agent.
 *
 * This is an RESEARCHER agent: it returns structured data (no proposal, no
 * actions). The schema therefore wraps the payload under `kind: 'researcher'`
 * + `data`, which is exactly the AgentResult shape the runtime persists and the
 * cockpit renders. (Contrast with an `proposal` agent, whose schema wraps a
 * `proposal` instead — see agent_orchestrator's `dealHealthCheckResult`.)
 */
export const ticketTriageResult = z.object({
  kind: z.literal('researcher'),
  data: z.object({
    category: z.enum(['billing', 'technical', 'account', 'feedback', 'other']),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    summary: z.string().min(1),
  }),
})

export type TicketTriageResult = z.infer<typeof ticketTriageResult>

/**
 * Result schema for the `support.triage_batch` manager agent. It delegates each
 * ticket to the `support.ticket_triage` sub-agent (in parallel) and aggregates.
 * Researcher — it summarizes; it proposes nothing.
 */
export const triageBatchResult = z.object({
  kind: z.literal('researcher'),
  data: z.object({
    total: z.number().int().min(0),
    urgentCount: z.number().int().min(0),
    items: z
      .array(
        z.object({
          subject: z.string(),
          category: z.enum(['billing', 'technical', 'account', 'feedback', 'other']),
          priority: z.enum(['low', 'medium', 'high', 'urgent']),
          summary: z.string().min(1),
        }),
      )
      .min(1),
  }),
})

export type TriageBatchResult = z.infer<typeof triageBatchResult>

/**
 * Input of the `support.policy_check` example agent: the support reply to
 * check and the policy-set version every cited policy must exist at.
 */
export const policyCheckInput = z.object({
  reply: z.string().min(1).max(8000),
  policySetVersion: z.string().min(1).max(50),
})

export type PolicyCheckInput = z.infer<typeof policyCheckInput>

/**
 * Result schema for the `support.policy_check` example agent. Each finding
 * names the policy the reply breaks and quotes the offending reply text; the
 * agent's integrity rules verify both (see `lib/policyCheckIntegrity.ts`).
 */
export const policyCheckResult = z.object({
  kind: z.literal('research'),
  data: z.object({
    findings: z.array(
      z.object({
        policyId: z.string().min(1),
        explanation: z.string().min(1),
        evidence: z
          .array(
            z.object({
              quote: z.string().min(1),
              start: z.number().int().min(0),
              end: z.number().int().min(0),
            }),
          )
          .min(1),
        confidence: z.number().min(0).max(1),
      }),
    ),
  }),
})

export type PolicyCheckResult = z.infer<typeof policyCheckResult>
