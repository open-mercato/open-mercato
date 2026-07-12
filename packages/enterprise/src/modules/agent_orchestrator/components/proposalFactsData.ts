import type { AgentFactView } from './types'

/**
 * Pure helpers behind the Caseload facts panel. Resolve an agent's declared
 * facts (FACTS.json / defineAgent `facts`) against the run input, proposal
 * payload, and run output — or, when the agent declares none, derive a generic
 * fact set from the same sources so the operator always sees real data.
 */

export type ResolvedFact = {
  label: string
  value: string
}

export type FactSources = {
  input: unknown
  payload: unknown
  output: unknown
}

/** Resolve a dot-path (array indexes allowed) into a nested JSON value. */
export function resolvePath(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const segment of path.split('.')) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function formatFactValue(value: unknown, format?: AgentFactView['format']): string | null {
  if (value == null) return null
  if (format === 'percent') {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num)) return null
    return `${Math.round((num <= 1 ? num * 100 : num))}%`
  }
  if (format === 'number') {
    const num = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(num) ? num.toLocaleString() : null
  }
  if (format === 'boolean' || typeof value === 'boolean') {
    return value === true || value === 'true' ? '✓' : '✗'
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : null
  if (typeof value === 'string') return value.trim() || null
  return null
}

/** Resolve the agent's declared facts; entries whose path resolves to nothing are dropped. */
export function resolveDeclaredFacts(facts: AgentFactView[], sources: FactSources): ResolvedFact[] {
  return facts
    .map((fact): ResolvedFact | null => {
      const value = formatFactValue(resolvePath(sources[fact.source], fact.path), fact.format)
      return value == null ? null : { label: fact.label, value }
    })
    .filter((fact): fact is ResolvedFact => !!fact)
}

type ProposalShapedPayload = {
  actions: Array<{ type?: unknown; payload?: unknown }>
  confidence?: unknown
  rationale?: unknown
}

/** A nested value that looks like a persisted agent proposal payload (`{ actions, ... }`). */
function asProposalShaped(value: unknown): ProposalShapedPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.actions)) return null
  return candidate as ProposalShapedPayload
}

export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function summarizeProposalShaped(value: ProposalShapedPayload): string | null {
  const action = value.actions.find((entry) => typeof entry?.type === 'string')
  const type = typeof action?.type === 'string' ? action.type : null
  const confidence =
    typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? `${Math.round((value.confidence <= 1 ? value.confidence * 100 : value.confidence))}%`
      : null
  if (type && confidence) return `${type} · ${confidence}`
  if (type) return type
  return confidence
}

export type ProposalActionSummary = {
  /** Raw action type as persisted (`set_stage`) — tooltip material. */
  typeRaw: string
  /** Humanized action type (`Set stage`) — the bounded display vocabulary. */
  typeLabel: string
  /** Additional actions beyond the first (`Set stage · +1 more` when 1). */
  extraCount: number
}

/**
 * What a canonical proposal payload proposes: the first typed action,
 * humanized, plus how many more actions ride along. Returns null for anything
 * that is not `{ actions: [...] }`-shaped — callers fall back to the agent
 * label instead of leaking rationale prose (the pre-spec-4 failure mode).
 */
export function summarizeProposalActions(payload: unknown): ProposalActionSummary | null {
  const shaped = asProposalShaped(payload)
  if (!shaped) return null
  const action = shaped.actions.find((entry) => typeof entry?.type === 'string')
  const typeRaw = typeof action?.type === 'string' && action.type.trim() ? action.type : null
  if (!typeRaw) return null
  return {
    typeRaw,
    typeLabel: humanizeKey(typeRaw),
    extraCount: Math.max(0, shaped.actions.length - 1),
  }
}

const MAX_DERIVED_FACTS = 6

/**
 * Fallback when the agent declares no facts: derive a labelled grid from the
 * run input. Primitive entries render directly; nested sub-proposal payloads
 * (upstream agents' findings passed through workflow input mapping) summarize
 * to "action · confidence"; other shapes are skipped.
 */
export function deriveFactsFromInput(input: unknown): ResolvedFact[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const facts: ResolvedFact[] = []
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (facts.length >= MAX_DERIVED_FACTS) break
    if (value == null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const formatted = formatFactValue(value)
      if (formatted != null) facts.push({ label: humanizeKey(key), value: formatted })
      continue
    }
    const proposalShaped = asProposalShaped(value)
    if (proposalShaped) {
      const summary = summarizeProposalShaped(proposalShaped)
      if (summary) facts.push({ label: humanizeKey(key), value: summary })
    }
  }
  return facts
}

/** Flat primitive fields of the first proposed action's payload — what the operator decides on. */
export function deriveProposedFields(payload: unknown): ResolvedFact[] {
  const proposalShaped = asProposalShaped(payload)
  const action = proposalShaped?.actions.find(
    (entry) => entry && typeof entry === 'object' && entry.payload && typeof entry.payload === 'object',
  )
  if (!action) return []
  const fields: ResolvedFact[] = []
  for (const [key, value] of Object.entries(action.payload as Record<string, unknown>)) {
    const formatted = formatFactValue(value)
    if (formatted != null) fields.push({ label: humanizeKey(key), value: formatted })
  }
  return fields
}

export type ReasoningItem = {
  /** Optional source label (e.g. the input key the rationale came from). */
  label: string | null
  text: string
}

/**
 * Real reasoning behind a proposal: the proposal's own rationale first, then
 * rationales of nested upstream findings carried in the run input.
 */
export function deriveReasoning(rationale: string | null, input: unknown): ReasoningItem[] {
  const items: ReasoningItem[] = []
  if (rationale) items.push({ label: null, text: rationale })
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const proposalShaped = asProposalShaped(value)
      const nested = proposalShaped?.rationale
      if (typeof nested === 'string' && nested.trim()) {
        items.push({ label: humanizeKey(key), text: nested })
      }
    }
  }
  return items
}
