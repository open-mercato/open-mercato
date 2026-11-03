/**
 * Prompt-to-draft: the pure half (spec §9, "AI-assisted authoring").
 *
 * *"natural language → draft definition generated against the real catalogs
 * (events, commands, ledger), opened in the Studio with a Problems pass already
 * run. Never auto-published."*
 *
 * ## What this module owns
 *
 * The three decisions that must be testable without a model, a canvas or a
 * database: what the request looks like, what a response is allowed to become,
 * and what the resulting undo entry is CALLED.
 *
 *  - `buildWorkflowDraftCatalog` shapes the platform's own registries into the
 *    compact catalog the prompt carries. Generation targets schemas, not
 *    vibes — an activity type the registry does not know can only be invented,
 *    and the catalog is what stops that.
 *  - `buildWorkflowDraftPrompt` turns a prompt plus a catalog into the exact
 *    request string. Pure, so a change to the instructions is a diff a test can
 *    read.
 *  - `interpretWorkflowDraftObject` maps a model response onto a definition, or
 *    refuses. It NEVER hand-rolls validation: the caller passes the definition
 *    parser in, so the Studio, the API route and the tests all reach the one
 *    `workflowDefinitionDataSchema`.
 *  - `buildAiCheckpointLabel` names the undo entry. Spec §9 asks for a *named
 *    checkpoint in the undo stack (§4.5)* — `lib/editor-history.ts` already
 *    carries a translated label per entry, so "checkpoint" is a NAMING problem,
 *    not a second history.
 *  - `classifyWorkflowDraftFailure` decides whether a thrown error means "there
 *    is no model here" or "the call failed". It reads the error's `code`
 *    STRUCTURALLY — the same technique `isGuardrailBlockedError` uses — so this
 *    module never imports the AI runtime and stays loadable in the browser.
 *
 * ## What it deliberately does NOT own
 *
 * Applying. A generated definition reaches the canvas through
 * `evaluateCodeViewDraft` (`lib/code-view-apply.ts`) — the same four escalating
 * refusals a human-pasted definition passes, because an AI-authored graph has
 * earned exactly as much trust as a pasted one, which is to say none.
 *
 * PURE: zod and plain data only — no React, no ORM, no DI, no registry imports.
 */

import { z } from 'zod'

/**
 * The object-mode agent that authors drafts. Declared in the module-root
 * `ai-agents.ts`; resolved by the AI runtime's generated registry, which means
 * it answers `agent_unknown` — and therefore "AI authoring is unavailable" —
 * until `yarn generate` has run.
 */
export const WORKFLOW_DRAFT_AGENT_ID = 'workflows.workflow_author'

export const WORKFLOW_DRAFT_PROMPT_MAX_LENGTH = 2000

// ---------------------------------------------------------------------------
// The generation contract
// ---------------------------------------------------------------------------

/**
 * What the model is allowed to produce.
 *
 * Deliberately NARROWER than `workflowDefinitionDataSchema`, in both
 * directions:
 *
 *  - It omits identity (`workflowId`, `workflowName`, `version`). Those are the
 *    engine's unique key, they are edited in the metadata drawer, and — this is
 *    the load-bearing reason — they are NOT versioned by the editor's undo
 *    stack. Writing them on apply would leave a residue an undo could not
 *    remove, which breaks the one thing this feature promises.
 *  - It omits `io`, `interpolation`, `errorHandler` and triggers: each is a
 *    separate authoring decision with its own inspector, and a first draft that
 *    silently rewires a definition's error handling is a worse draft.
 *
 * `activityType` is a plain string rather than the registry-driven enum
 * because this module is pure and must not import the registry. The catalog in
 * the prompt is what steers it, and `workflowDefinitionDataSchema` is what
 * enforces it — the model's output is re-parsed through the real schema before
 * anything reaches a canvas.
 */
const draftActivitySchema = z.object({
  activityId: z.string().min(1).max(100),
  activityName: z.string().min(1).max(255),
  activityType: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()),
})

const draftStepSchema = z.object({
  stepId: z.string().min(1).max(100),
  stepName: z.string().min(1).max(255),
  stepType: z.string().min(1).max(50),
  description: z.string().max(1000).optional(),
})

const draftTransitionSchema = z.object({
  transitionId: z.string().min(1).max(100),
  fromStepId: z.string().min(1).max(100),
  toStepId: z.string().min(1).max(100),
  transitionName: z.string().max(255).optional(),
  trigger: z.string().min(1).max(20),
  activities: z.array(draftActivitySchema).optional(),
})

const draftContextFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['text', 'number', 'boolean', 'select', 'date']),
  label: z.string().optional(),
  required: z.boolean().optional(),
})

export const workflowDraftGenerationSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(400)
    .describe('One plain-language sentence describing what the workflow does'),
  steps: z.array(draftStepSchema).min(2),
  transitions: z.array(draftTransitionSchema).min(1),
  contextSchema: z
    .object({ input: z.object({ fields: z.array(draftContextFieldSchema) }) })
    .optional(),
})

export type WorkflowDraftGeneration = z.infer<typeof workflowDraftGenerationSchema>

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export interface WorkflowDraftCatalogEntry {
  id: string
  /** Compact JSON-Schema description of the entry's config, when it has one. */
  configSchema?: unknown
  description?: string
}

export interface WorkflowDraftCatalog {
  stepTypes: string[]
  transitionTriggers: string[]
  activityTypes: WorkflowDraftCatalogEntry[]
  commands: WorkflowDraftCatalogEntry[]
  functions: WorkflowDraftCatalogEntry[]
  events: string[]
  /**
   * The agents an `INVOKE_AGENT` activity may target. Empty when the optional
   * `agent_orchestrator` peer is absent or exposes none — which is exactly when
   * `INVOKE_AGENT` must be forbidden (an agent step with no agent to run can
   * only fail the strict `invokeAgentConfigSchema` later). Fail-closed.
   */
  agents: WorkflowDraftCatalogEntry[]
}

export interface WorkflowDraftCatalogInput {
  stepTypes: readonly string[]
  transitionTriggers: readonly string[]
  activityTypes: readonly { id: string; configSchema?: unknown }[]
  commands: readonly { id: string; label?: string }[]
  functions: readonly { name: string; label?: string }[]
  events: readonly { id: string }[]
  /** Usable agents; omitted/empty ⇒ `INVOKE_AGENT` is fail-closed forbidden. */
  agents?: readonly { id: string; label?: string }[]
}

/**
 * The number of registry entries of each kind the prompt carries. A tenant with
 * hundreds of registered commands would otherwise spend the whole context
 * window on a catalog, and a truncated catalog is honest — the model simply has
 * fewer ids to reach for, and every id it does reach for is real.
 */
export const WORKFLOW_DRAFT_CATALOG_LIMIT = 60

export function buildWorkflowDraftCatalog(
  input: WorkflowDraftCatalogInput,
): WorkflowDraftCatalog {
  return {
    stepTypes: [...input.stepTypes],
    transitionTriggers: [...input.transitionTriggers],
    activityTypes: input.activityTypes
      .slice(0, WORKFLOW_DRAFT_CATALOG_LIMIT)
      .map((entry) => ({
        id: entry.id,
        ...(entry.configSchema === undefined ? {} : { configSchema: entry.configSchema }),
      })),
    commands: input.commands
      .slice(0, WORKFLOW_DRAFT_CATALOG_LIMIT)
      .map((entry) => ({ id: entry.id, ...(entry.label ? { description: entry.label } : {}) })),
    functions: input.functions
      .slice(0, WORKFLOW_DRAFT_CATALOG_LIMIT)
      .map((entry) => ({ id: entry.name, ...(entry.label ? { description: entry.label } : {}) })),
    events: input.events.slice(0, WORKFLOW_DRAFT_CATALOG_LIMIT).map((entry) => entry.id),
    agents: (input.agents ?? [])
      .slice(0, WORKFLOW_DRAFT_CATALOG_LIMIT)
      .map((entry) => ({ id: entry.id, ...(entry.label ? { description: entry.label } : {}) })),
  }
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export interface WorkflowDraftPromptInput {
  prompt: string
  catalog: WorkflowDraftCatalog
}

/**
 * Build the single user message the object-mode agent receives.
 *
 * The catalog travels in the REQUEST rather than through tool calls: the draft
 * agent is declared with an empty tool allowlist, so it has no way to reach
 * tenant data at all. That is the strongest form of "propose only" available —
 * not a policy that forbids writes, but a runtime with nothing to write to.
 */
export function buildWorkflowDraftPrompt(input: WorkflowDraftPromptInput): string {
  const { prompt, catalog } = input
  const invokeAgentRule =
    catalog.agents.length > 0
      ? '- An INVOKE_AGENT activity MUST set config.agentId to one of the catalog `agents` ids and config.onResult (either { autoApproveThreshold } or { alwaysAsk: true }).'
      : '- Do NOT use the INVOKE_AGENT activity type: this installation has no usable agents, so an agent step cannot be run. Use other activity types instead.'
  return [
    'Author a workflow definition for this request:',
    '',
    prompt.trim(),
    '',
    'Use ONLY the identifiers in this catalog. Never invent a step type, transition trigger, activity type, command id, function name or event name that is not listed here.',
    '',
    JSON.stringify(catalog),
    '',
    'Rules:',
    '- Exactly one START step and at least one END step.',
    '- Every step except END has at least one outgoing transition, and every step except START is reachable.',
    '- Step, transition and activity ids are lowercase letters, numbers, hyphens and underscores only.',
    '- Activities belong to the transition that LEAVES the step whose work they do.',
    '- Reference run context as {{context.<path>}}, and declare every path you reference in contextSchema.input.fields.',
    invokeAgentRule,
    '- Call the workflows.validate_workflow_definition tool on your draft and fix every reported error before you return it.',
    '- Prefer the smallest graph that answers the request.',
  ].join('\n')
}

/** How many repair attempts follow a rejected draft before the surface gives up. */
export const WORKFLOW_DRAFT_MAX_REPAIR_ATTEMPTS = 2

export interface WorkflowDraftRepairPromptInput {
  /** The prompt the previous attempt was authored against, catalog and all. */
  previousPrompt: string
  /** Exactly what the model returned, so it can see what it is amending. */
  rejectedDraft: unknown
  /** The validator's own messages, verbatim — `path: message`. */
  messages: string[]
}

/**
 * Build the follow-up message for a rejected draft.
 *
 * The validator already produces precise, per-path errors
 * (`transitions.3.activities.0.config.to: SEND_EMAIL activity requires "to"`).
 * Handing those to the human as a dead end while the model that can act on them
 * never sees them is the actual defect this repairs: the errors go BACK to the
 * author. The instruction is deliberately narrow — amend the listed paths and
 * change nothing else — because a model told to "try again" tends to rewrite
 * the graph and lose the parts that were already correct.
 */
export function buildWorkflowDraftRepairPrompt(input: WorkflowDraftRepairPromptInput): string {
  let rendered: string
  try {
    rendered = JSON.stringify(input.rejectedDraft)
  } catch {
    rendered = '(the previous response could not be serialized)'
  }
  return [
    input.previousPrompt,
    '',
    'Your previous answer was rejected by the workflow schema. This was it:',
    '',
    rendered,
    '',
    'Every path below failed validation. Fix exactly these and change nothing else:',
    ...input.messages.map((message) => `- ${message}`),
    '',
    'Return the whole corrected workflow, in the same shape as before.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// The response
// ---------------------------------------------------------------------------

export type WorkflowDraftInterpretation<TDefinition> =
  | { ok: true; definition: TDefinition; summary: string }
  | { ok: false; reason: 'malformedResponse'; messages: string[] }
  | { ok: false; reason: 'schemaError'; messages: string[] }

export interface InterpretWorkflowDraftInput<TDefinition> {
  raw: unknown
  /**
   * The one definition parser. Injected rather than imported so this module
   * stays pure and so no caller can end up on a second validator.
   */
  parseDefinition: (
    value: unknown,
  ) => { ok: true; definition: TDefinition } | { ok: false; messages: string[] }
}

/**
 * Map a model response onto a workflow definition.
 *
 * Two refusals, in escalating order, mirroring the Code view's gate: the object
 * does not match the generation contract at all (`malformedResponse`), or it
 * does but is not a workflow definition (`schemaError`). Both are NORMAL
 * outcomes a surface renders — never an exception, and never a partial apply.
 */
export function interpretWorkflowDraftObject<TDefinition>(
  input: InterpretWorkflowDraftInput<TDefinition>,
): WorkflowDraftInterpretation<TDefinition> {
  const generation = workflowDraftGenerationSchema.safeParse(input.raw)
  if (!generation.success) {
    return {
      ok: false,
      reason: 'malformedResponse',
      messages: generation.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    }
  }

  const candidate: Record<string, unknown> = {
    steps: generation.data.steps,
    transitions: generation.data.transitions,
  }
  if (generation.data.contextSchema) candidate.contextSchema = generation.data.contextSchema

  const parsed = input.parseDefinition(candidate)
  if (!parsed.ok) return { ok: false, reason: 'schemaError', messages: parsed.messages }

  return { ok: true, definition: parsed.definition, summary: generation.data.summary }
}

// ---------------------------------------------------------------------------
// The checkpoint name
// ---------------------------------------------------------------------------

export const AI_CHECKPOINT_LABEL_MAX_LENGTH = 64

/**
 * Name the undo entry an AI edit pushes.
 *
 * `prefix` is supplied translated by the caller (`useT`), so this stays pure
 * while the label an author reads stays localized. Truncation happens on a word
 * boundary where one is available, because a label cut mid-word reads like a
 * bug rather than an abbreviation.
 */
export function buildAiCheckpointLabel(
  prompt: string,
  options: { prefix: string; maxLength?: number } = { prefix: 'AI' },
): string {
  const maxLength = options.maxLength ?? AI_CHECKPOINT_LABEL_MAX_LENGTH
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return options.prefix
  const budget = Math.max(1, maxLength - options.prefix.length - 2)
  if (normalized.length <= budget) return `${options.prefix}: ${normalized}`
  const clipped = normalized.slice(0, budget)
  const lastSpace = clipped.lastIndexOf(' ')
  const body = lastSpace > budget / 2 ? clipped.slice(0, lastSpace) : clipped
  return `${options.prefix}: ${body}…`
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type WorkflowDraftFailureKind = 'unavailable' | 'failed'

/**
 * Error codes that mean "there is no model to call here", as opposed to "the
 * call went wrong".
 *
 * `no_provider_configured` / `api_key_missing` come from the AI model factory;
 * `agent_unknown` comes from the agent policy gate and is what a deployment
 * that has not run `yarn generate` answers. All three are the same thing to an
 * author: the feature is not set up, and the canvas is untouched.
 */
const UNAVAILABLE_ERROR_CODES = new Set([
  'no_provider_configured',
  'api_key_missing',
  'agent_unknown',
  'agent_features_denied',
  'execution_mode_not_supported',
])

/**
 * Read the failure kind off a thrown value STRUCTURALLY, without importing the
 * AI runtime — this module is loaded by the browser bundle, and the runtime is
 * server-only and optional.
 */
export function classifyWorkflowDraftFailure(error: unknown): WorkflowDraftFailureKind {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && UNAVAILABLE_ERROR_CODES.has(code)) return 'unavailable'
  }
  return 'failed'
}
