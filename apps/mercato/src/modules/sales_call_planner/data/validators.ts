/**
 * The contracts the deal-briefing workflow is authored against.
 *
 * Three of them matter to a workflow author:
 *
 *  1. `dealBriefResultSchema` — what agent 1 (`sales_call_planner.deal_brief`)
 *     returns, and therefore what the voice step reads aloud.
 *  2. `taskExtractionResultSchema` — what agent 3
 *     (`sales_call_planner.task_extractor`) returns, and therefore what the
 *     transition activities turn into CRM rows.
 *  3. `ensureTaskInputSchema` — the `input` object the `UPDATE_ENTITY` node
 *     passes to this module's idempotent ensure-task command (tracker task B3).
 *
 * ## Why 1 and 2 are ENVELOPES
 *
 * `defineAgent` / `defineExternalAgent` register the OUTCOME schema, and
 * `resolveAgentOutcomeZod` reads the inner `data` off a
 * `{ kind: 'researcher', data: … }` wrapper to project the agent's contract into
 * the workflows context ledger. An agent that registers the INNER shape by
 * mistake silently vanishes from that ledger — the Studio's variable picker
 * types every `data.*` path as `unknown` and `outputMapping: { brief: 'data' }`
 * stops resolving. Registration warns rather than throws, so the mistake is
 * quiet. Hence: agents import the `*ResultSchema` exports below, never the
 * `*OutcomeSchema` ones.
 */

import { z } from 'zod'

/**
 * A briefing is read aloud over the phone, so its length is a product
 * constraint, not just a guard against a runaway array: a call that recites
 * thirty deals is a call nobody listens to.
 */
export const MAX_BRIEFED_DEALS = 12

/**
 * Every extracted task becomes a CRM row. The array bound is what stands
 * between one conversation and an unbounded number of rows a salesperson has to
 * clean up by hand — see the ensure-task command's idempotency argument, which
 * bounds RETRIES but not fan-out.
 */
export const MAX_EXTRACTED_TASKS = 10

/**
 * How urgently a deal needs attention. Deliberately coarse: the value is spoken
 * aloud, so a 0-100 score would be noise. `customers`' own `priority` column is
 * numeric (0-100) and the ensure-task command maps onto it.
 */
export const dealRiskSignals = ['none', 'watch', 'at_risk', 'stalled'] as const

export const taskPriorities = ['low', 'medium', 'high', 'urgent'] as const

/** One deal, as the chief of sales will hear it. */
export const dealBriefItemSchema = z.object({
  /** `customer_deals.id`. Carried through so an extracted task can be attributed back to its deal. */
  dealId: z.string().uuid(),
  dealTitle: z.string().trim().min(1).max(300),
  /** Pipeline stage name as read from the CRM, not an id — this is spoken text. */
  stage: z.string().trim().max(200).nullable(),
  /** Deal value already rendered for speech, e.g. `"48,000 PLN"`. Null when the deal carries no amount. */
  amountLabel: z.string().trim().max(120).nullable(),
  /** Short, checkable statements about the deal. One clause each; no narrative. */
  facts: z.array(z.string().trim().min(1).max(400)).max(6),
  riskSignal: z.enum(dealRiskSignals),
  /** Why the risk signal is what it is. Null only when `riskSignal` is `none`. */
  riskReason: z.string().trim().max(600).nullable(),
  /** The single concrete action that would move this deal forward. */
  recommendedNextMove: z.string().trim().min(1).max(600),
})

export type DealBriefItem = z.infer<typeof dealBriefItemSchema>

export const dealBriefOutcomeSchema = z.object({
  /** Echoed from the run input so the downstream steps never have to re-resolve it. */
  companyId: z.string().uuid(),
  companyName: z.string().trim().min(1).max(300),
  /** One line naming the state of the account overall. */
  headline: z.string().trim().min(1).max(300),
  deals: z.array(dealBriefItemSchema).max(MAX_BRIEFED_DEALS),
  /**
   * The whole briefing in spoken form — plain sentences, no markdown, no
   * bullets, no ids. This is the field the voice agent reads to a human, so it
   * is the one field of this outcome that must stand alone.
   */
  spokenSummary: z.string().trim().min(1).max(1500),
})

export type DealBriefOutcome = z.infer<typeof dealBriefOutcomeSchema>

/** The registered OUTCOME of `sales_call_planner.deal_brief`. */
export const dealBriefResultSchema = z.object({
  kind: z.literal('researcher'),
  data: dealBriefOutcomeSchema,
})

export type DealBriefResult = z.infer<typeof dealBriefResultSchema>

/**
 * One thing the chief of sales asked for, in a shape that maps onto a
 * `CustomerInteraction` with `interactionType: 'task'`.
 *
 * This exact schema is reused by `ensureTaskInputSchema` below, so the array the
 * agent produces can be handed to the command verbatim by the workflow
 * definition. Two schemas that merely resembled each other would drift on the
 * first field either side added.
 */
export const taskActionSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().max(4000).optional(),
  /**
   * ISO-8601 instant, e.g. `2026-08-20T09:00:00Z`. A STRING rather than a
   * coerced date because this schema is projected into the JSON schema the model
   * answers against, where `z.coerce.date()` has no meaning. The command coerces.
   */
  dueAt: z.string().trim().min(4).max(40).optional(),
  /**
   * Who the chief of sales named, in their words ("Ana", "the account manager").
   * NOT a user id — the model has no user directory. Resolving it to an
   * `ownerUserId` is the caller's job, and leaving it unresolved is allowed:
   * an unassigned task is still a task.
   */
  ownerHint: z.string().trim().max(200).optional(),
  /** Set when the ask is clearly about one deal from the brief. */
  dealId: z.string().uuid().optional(),
  priority: z.enum(taskPriorities).optional(),
})

export type TaskAction = z.infer<typeof taskActionSchema>

export const taskExtractionOutcomeSchema = z.object({
  tasks: z.array(taskActionSchema).max(MAX_EXTRACTED_TASKS),
  /**
   * Why these tasks and not others — the audit trail for a run that acted on a
   * conversation nobody else heard. An empty task list is a legitimate outcome
   * (the chief of sales asked for nothing), and the rationale is what makes that
   * outcome readable instead of indistinguishable from a failure.
   */
  rationale: z.string().trim().min(1).max(2000),
})

export type TaskExtractionOutcome = z.infer<typeof taskExtractionOutcomeSchema>

/** The registered OUTCOME of `sales_call_planner.task_extractor`. */
export const taskExtractionResultSchema = z.object({
  kind: z.literal('researcher'),
  data: taskExtractionOutcomeSchema,
})

export type TaskExtractionResult = z.infer<typeof taskExtractionResultSchema>

/**
 * Input to the idempotent ensure-task command (tracker task B3), declared
 * workflow-safe so an `UPDATE_ENTITY` transition activity may call it.
 *
 * ## Why the whole batch, not one task per call
 *
 * A transition activity runs ONCE, and the number of tasks is data the author
 * cannot know when writing the definition. So one invocation ensures the whole
 * bounded batch, and the deterministic id is `uuidv5` over
 * `${workflowInstanceId}:${stepId}:${index}` where `index` is the element's
 * position in `tasks`. Same inputs ⇒ same ids ⇒ a retry rewrites the same rows
 * instead of minting a second set, which is the property `UPDATE_ENTITY` needs
 * and that the customers module's no-CREATE policy correctly refuses to assume.
 *
 * Positional ids make `tasks` ORDER-SENSITIVE: reordering the array on a retry
 * would rewrite the wrong rows. The array comes verbatim from a completed
 * agent run stored in the instance context, so it is stable by construction.
 *
 * ## Why there is no `tenantId` / `organizationId`
 *
 * `executeUpdateEntity` passes the definition's `input` object through to the
 * command unchanged and supplies scope separately, from the workflow INSTANCE,
 * via `ctx.auth`. Accepting scope here would let an authored (and AI-draftable)
 * definition name another tenant's ids; deriving it from the instance cannot.
 */
export const ensureTaskInputSchema = z.object({
  /** `{{workflow.instanceId}}`. Half of the idempotency key. */
  workflowInstanceId: z.string().uuid(),
  /** `{{workflow.currentStepId}}`. The other half, so two nodes never collide. */
  stepId: z.string().trim().min(1).max(200),
  /**
   * `customer_entities.id` for the company — the timeline parent every
   * `CustomerInteraction` hangs off. NOT `customer_companies.id`.
   */
  entityId: z.string().uuid(),
  /** Resolved owner for every task in the batch; `ownerHint` stays advisory. */
  ownerUserId: z.string().uuid().nullable().optional(),
  tasks: z.array(taskActionSchema).max(MAX_EXTRACTED_TASKS),
})

export type EnsureTaskInput = z.infer<typeof ensureTaskInputSchema>
