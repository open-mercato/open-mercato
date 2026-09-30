/**
 * Workflows Module - Node outcome rows (pure)
 *
 * The data behind the node footer of the canvas redesign (fidelity gap #4): the
 * labelled rows hanging off an agent or user-task card, each ending in a dot
 * that IS its connection handle.
 *
 * Two producers, one row shape:
 *
 *  - an INVOKE_AGENT node renders spec §7.2's disposition outcomes, with the
 *    progressive-disclosure rule applied — only WIRED outcomes plus `approved`,
 *    which §7.2 renders unconditionally because it is the node's ordinary
 *    output. Five agent nodes in a 60-node flow have to stay readable;
 *  - a USER_TASK node renders its authored decisions, which need no engine work
 *    at all: `taskDecisionSchema` already binds each decision to a durable
 *    `transitionId`, so the row's handle is the only missing piece.
 *
 * PURE: no React, no `@xyflow/react`, no ORM. The component consumes rows; this
 * decides what they are, which is what makes the rule testable without a canvas.
 */

import {
  AGENT_OUTCOME_KINDS,
  isAgentOutcomeKind,
  outcomeSourceHandleId,
  type AgentOutcomeKind,
} from './outcome-routing'
import { DEFAULT_SOURCE_HANDLE_ID } from './route-kinds'

/**
 * How a row reads at a glance. Paired with the row's LABEL, never standing in
 * for it: at canvas zoom a 10px dot cannot carry meaning on its own, and two
 * red dots are indistinguishable to a red-blind reader. The tone picks the DS
 * status token; the glyph gives each row a second, non-colour discriminator.
 */
export type NodeOutcomeRowTone = 'success' | 'warning' | 'error' | 'info' | 'neutral'
export type NodeOutcomeRowGlyph = 'check' | 'info' | 'slash' | 'shield' | 'alert' | 'dot' | 'corner'

export interface NodeOutcomeRow {
  /** Stable key AND the React Flow source handle id the dot binds to. */
  handleId: string
  /** i18n key for the row label. */
  labelKey: string
  /** English fallback, so an untranslated locale still names the row. */
  labelFallback: string
  tone: NodeOutcomeRowTone
  glyph: NodeOutcomeRowGlyph
}

const OUTCOME_ROW_PRESENTATION: Record<
  AgentOutcomeKind,
  { tone: NodeOutcomeRowTone; glyph: NodeOutcomeRowGlyph; labelFallback: string }
> = {
  approved: { tone: 'success', glyph: 'check', labelFallback: 'approved' },
  researcher: { tone: 'info', glyph: 'info', labelFallback: 'researcher' },
  rejected: { tone: 'error', glyph: 'slash', labelFallback: 'rejected' },
  guardrailBlocked: { tone: 'error', glyph: 'shield', labelFallback: 'guardrail blocked' },
  error: { tone: 'warning', glyph: 'alert', labelFallback: 'error' },
}

export interface OutcomeRowTransitionLike {
  fromStepId?: string
  kind?: string
  outcomeKind?: string
}

/**
 * Which outcomes an agent node shows: every wired one, plus `approved`, in the
 * platform's fixed order. Nothing else — an unwired outcome is reachable
 * through the node's error directive, which the footer states rather than
 * drawing a handle nobody connected.
 */
export function buildAgentOutcomeRows(
  transitions: OutcomeRowTransitionLike[] | null | undefined,
  stepId: string,
): NodeOutcomeRow[] {
  const shown = new Set<AgentOutcomeKind>(['approved'])
  for (const transition of transitions ?? []) {
    if (transition.fromStepId !== stepId) continue
    if (transition.kind !== 'outcome') continue
    if (isAgentOutcomeKind(transition.outcomeKind)) shown.add(transition.outcomeKind)
  }

  return AGENT_OUTCOME_KINDS.filter((outcome) => shown.has(outcome)).map((outcome) => ({
    handleId: outcomeSourceHandleId(outcome),
    labelKey: `workflows.outcomes.${outcome}`,
    ...OUTCOME_ROW_PRESENTATION[outcome],
  }))
}

export function buildAllAgentOutcomeRows(): NodeOutcomeRow[] {
  return AGENT_OUTCOME_KINDS.map((outcome) => ({
    handleId: outcomeSourceHandleId(outcome),
    labelKey: `workflows.outcomes.${outcome}`,
    ...OUTCOME_ROW_PRESENTATION[outcome],
  }))
}

/**
 * The step's ORDINARY output, as the footer's last row.
 *
 * It used to render as a lone handle floating at the card's right edge, roughly
 * level with the first outcome row it then collided with. It is not decorative
 * and deleting it would be a regression: `resolveAgentOutcomeHandling` returns
 * `{ kind: 'default' }` — "route exactly as this instance always would have" —
 * for a step that wired NO outcome at all (so this handle carries every
 * disposition, which is how every definition written before §7.2 still runs)
 * and for `approved` whenever `approved` is not separately wired.
 *
 * It is NOT a catch-all, which is why it is named `default` rather than
 * `otherwise`: an unwired `rejected` / `researcher` / `guardrailBlocked` /
 * `error` inherits the step's error directive instead, exactly as the footer's
 * inheritance note states. A row promising "everything else comes here" would
 * be the one label on this card an author could act on and be wrong.
 *
 * The handle id is unchanged (`source`), so a stored transition that resolves
 * to it keeps resolving to it — this is presentation, not routing.
 */
export function buildDefaultRouteRow(): NodeOutcomeRow {
  return {
    handleId: DEFAULT_SOURCE_HANDLE_ID,
    labelKey: 'workflows.outcomes.default',
    labelFallback: 'default',
    tone: 'neutral',
    glyph: 'corner',
  }
}

export interface DecisionRowLike {
  id?: string
  label?: unknown
  transitionId?: string
  style?: string
}

const DECISION_STYLE_PRESENTATION: Record<
  string,
  { tone: NodeOutcomeRowTone; glyph: NodeOutcomeRowGlyph }
> = {
  primary: { tone: 'success', glyph: 'check' },
  secondary: { tone: 'neutral', glyph: 'dot' },
  destructive: { tone: 'error', glyph: 'slash' },
}

/**
 * A decision's authored label may be a plain string or a locale map
 * (`taskLocalizedStringSchema`). The canvas shows the author's own words, so
 * this reads the requested locale, then English, then the first entry — never
 * an object rendered as `[object Object]`.
 */
export function readDecisionLabel(label: unknown, locale = 'en'): string {
  if (typeof label === 'string') return label
  if (!label || typeof label !== 'object') return ''
  const map = label as Record<string, unknown>
  for (const key of [locale, 'en']) {
    if (typeof map[key] === 'string') return map[key] as string
  }
  const first = Object.values(map).find((value) => typeof value === 'string')
  return typeof first === 'string' ? first : ''
}

/**
 * A user task's decision buttons as footer rows. The handle id is the decision's
 * DURABLE transition id, which is exactly what the engine already resolves the
 * button to — so the canvas and the run agree by construction.
 */
export function buildDecisionOutcomeRows(
  decisions: DecisionRowLike[] | null | undefined,
  locale = 'en',
): NodeOutcomeRow[] {
  const rows: NodeOutcomeRow[] = []
  for (const decision of decisions ?? []) {
    if (!decision?.transitionId) continue
    const label = readDecisionLabel(decision.label, locale) || decision.id || decision.transitionId
    const presentation = DECISION_STYLE_PRESENTATION[decision.style ?? ''] ?? {
      tone: 'neutral' as const,
      glyph: 'dot' as const,
    }
    rows.push({
      handleId: decision.transitionId,
      labelKey: '',
      labelFallback: label,
      ...presentation,
    })
  }
  return rows
}

export function isDecisionSourceHandle(
  decisions: DecisionRowLike[] | null | undefined,
  sourceHandle: unknown,
): sourceHandle is string {
  if (typeof sourceHandle !== 'string' || sourceHandle.length === 0) return false
  return (decisions ?? []).some((decision) => decision.transitionId === sourceHandle)
}
