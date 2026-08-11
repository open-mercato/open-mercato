import {
  PROPOSAL_OPTIONS_MAX,
  PROPOSAL_OPTION_ID_MAX,
  PROPOSAL_OPTION_LABEL_MAX,
  PROPOSAL_RATIONALE_MAX,
  agentProposalSchema,
  proposedActionSchema,
  type AgentProposalPayload,
  type ProposalOption,
  type ProposedAction,
} from './validators'

/**
 * Pure helpers over the proposal envelope (`{ options[], rationale? }`).
 *
 * Server-safe and dependency-free like `agentIcons.ts`/`agentTags.ts`, so the runner,
 * the dispose command, the migration's runtime twin and the Caseload all read one
 * implementation. Every function tolerates an arbitrary `unknown` payload: a stored
 * row, an agent's declared OUTCOME object and an operator's edited payload all arrive
 * here unvalidated.
 */

/** Id + label the single implicit option carries when a legacy `{ actions }` payload is lifted. */
export const IMPLICIT_OPTION_ID = 'primary'
export const IMPLICIT_OPTION_LABEL = 'Proposal'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function readActions(value: unknown): ProposedAction[] {
  if (!Array.isArray(value)) return []
  const actions: ProposedAction[] = []
  for (const entry of value) {
    const parsed = proposedActionSchema.safeParse(entry)
    if (parsed.success) actions.push(parsed.data)
  }
  return actions
}

function buildOption(raw: unknown, index: number, fallbackLabel: string): ProposalOption | null {
  if (!isRecord(raw)) return null
  const actions = readActions(raw.actions)
  if (actions.length === 0) return null
  const id = clampText(raw.id, PROPOSAL_OPTION_ID_MAX) ?? `${IMPLICIT_OPTION_ID}_${index + 1}`
  const label = clampText(raw.label, PROPOSAL_OPTION_LABEL_MAX) ?? fallbackLabel
  const rationale = clampText(raw.rationale, PROPOSAL_RATIONALE_MAX)
  const confidence = clampConfidence(raw.confidence)
  return {
    id,
    label,
    actions,
    ...(rationale !== undefined ? { rationale } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  }
}

/**
 * Coerce any proposal payload into the canonical envelope.
 *
 * The lift of a pre-envelope `{ actions, confidence, rationale }` payload is the exact
 * rule the backfill migration applies: one implicit option `primary` carrying the old
 * actions and confidence — EXCEPT when `actions` is empty, which becomes an empty
 * option set rather than an option that would fail `actions.min(1)`.
 *
 * Bounds are applied by clamping rather than rejection: a model that returns an
 * over-long rationale or an eleventh option must not lose its whole proposal to a
 * validation error the operator can do nothing about.
 */
export function normalizeProposalEnvelope(raw: unknown, fallbackLabel?: string): AgentProposalPayload {
  const label = clampText(fallbackLabel, PROPOSAL_OPTION_LABEL_MAX) ?? IMPLICIT_OPTION_LABEL
  if (!isRecord(raw)) return { options: [] }
  const rationale = clampText(raw.rationale, PROPOSAL_RATIONALE_MAX)
  const withRationale = (options: ProposalOption[]): AgentProposalPayload => ({
    options,
    ...(rationale !== undefined ? { rationale } : {}),
  })

  if (Array.isArray(raw.options)) {
    const options = raw.options
      .slice(0, PROPOSAL_OPTIONS_MAX)
      .map((entry, index) => buildOption(entry, index, label))
      .filter((option): option is ProposalOption => option !== null)
    return withRationale(dedupeOptionIds(options))
  }

  if (Array.isArray(raw.actions)) {
    const actions = readActions(raw.actions)
    if (actions.length === 0) return withRationale([])
    const confidence = clampConfidence(raw.confidence)
    return withRationale([
      {
        id: IMPLICIT_OPTION_ID,
        label,
        actions,
        ...(confidence !== undefined ? { confidence } : {}),
      },
    ])
  }

  return withRationale([])
}

/**
 * Option ids are the disposition's addressing scheme, so two options may not share
 * one — a duplicate would make `selectedOptionId` ambiguous and silently run the
 * wrong plan. Later duplicates are suffixed rather than dropped.
 */
function dedupeOptionIds(options: ProposalOption[]): ProposalOption[] {
  const seen = new Set<string>()
  return options.map((option) => {
    if (!seen.has(option.id)) {
      seen.add(option.id)
      return option
    }
    let suffix = 2
    let candidate = `${option.id}_${suffix}`
    while (seen.has(candidate)) {
      suffix += 1
      candidate = `${option.id}_${suffix}`
    }
    seen.add(candidate)
    return { ...option, id: candidate.slice(0, PROPOSAL_OPTION_ID_MAX) }
  })
}

/** Highest confidence first; an option that declared none ranks as 0. Stable for ties. */
export function rankProposalOptions(options: readonly ProposalOption[]): ProposalOption[] {
  return [...options].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
}

/** The option a reviewer sees first, and the one auto-approval considers. */
export function leadProposalOption(payload: unknown): ProposalOption | null {
  const { options } = normalizeProposalEnvelope(payload)
  return rankProposalOptions(options)[0] ?? null
}

export function findProposalOption(payload: unknown, optionId: string): ProposalOption | null {
  const { options } = normalizeProposalEnvelope(payload)
  return options.find((option) => option.id === optionId) ?? null
}

export function listProposalOptionIds(payload: unknown): string[] {
  return normalizeProposalEnvelope(payload).options.map((option) => option.id)
}

/**
 * The value written to `agent_proposals.confidence` / `agent_runs.confidence`.
 *
 * Derived for display, still persisted for query: the traces `low-confidence` facet
 * filters on the indexed float column and a jsonb scan cannot replace it. The leader
 * option's confidence before disposition, the CHOSEN option's after.
 *
 * A payload carrying no option confidence at all falls back to a numeric top-level
 * `confidence` — the shape a pre-envelope agent OUTCOME declares — so lifting an
 * actionable result that proposes no concrete action does not silently null the
 * column the facet reads.
 */
export function deriveEnvelopeConfidence(payload: unknown, selectedOptionId?: string | null): number | null {
  const option = selectedOptionId ? findProposalOption(payload, selectedOptionId) : leadProposalOption(payload)
  if (option && typeof option.confidence === 'number') return option.confidence
  if (isRecord(payload)) {
    const fallback = clampConfidence(payload.confidence)
    if (fallback !== undefined) return fallback
  }
  return null
}

/** The plan that runs for the chosen option — or, absent a choice, the leader's. */
export function readProposalActions(payload: unknown, selectedOptionId?: string | null): ProposedAction[] {
  const option = selectedOptionId ? findProposalOption(payload, selectedOptionId) : leadProposalOption(payload)
  return option ? option.actions : []
}

/**
 * Replace one option's plan, leaving every other option, the option's own rationale
 * and confidence, and the envelope rationale untouched. Backs the operator's
 * structured edit: an override is a training signal only while the rest of the
 * agent's testimony survives it.
 */
export function replaceOptionActions(
  payload: unknown,
  actions: ProposedAction[],
  selectedOptionId?: string | null,
): AgentProposalPayload {
  const envelope = normalizeProposalEnvelope(payload)
  const targetId = selectedOptionId ?? rankProposalOptions(envelope.options)[0]?.id
  if (!targetId || actions.length === 0) return envelope
  return {
    ...envelope,
    options: envelope.options.map((option) => (option.id === targetId ? { ...option, actions } : option)),
  }
}

/** True when the payload validates as the canonical envelope with no coercion applied. */
export function isProposalEnvelope(payload: unknown): payload is AgentProposalPayload {
  return agentProposalSchema.safeParse(payload).success
}
