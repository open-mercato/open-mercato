import { z } from 'zod'

/**
 * Result schema for the `support.ticket_triage` example agent.
 *
 * This is an INFORMATIVE agent: it returns structured data (no proposal, no
 * actions). The schema therefore wraps the payload under `kind: 'informative'`
 * + `data`, which is exactly the AgentResult shape the runtime persists and the
 * cockpit renders. (Contrast with an `actionable` agent, whose schema wraps a
 * `proposal` instead — see agent_orchestrator's `dealHealthCheckResult`.)
 */
export const ticketTriageResult = z.object({
  kind: z.literal('informative'),
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
 * Informative — it summarizes; it proposes nothing.
 */
export const triageBatchResult = z.object({
  kind: z.literal('informative'),
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
