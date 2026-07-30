import {
  collectLeaves,
  type FindingEvidence,
  type FindingSeverity,
  type MockupDocument,
  type MockupFinding,
  type MockupLeafNode,
} from './schema'

/**
 * The encoded heuristic checklist behind the `om-ux-heuristics` skill (spec
 * 2026-07-05-ds-live-mockup-composer.md, Phase 2 — UX skills). Two classes of
 * checks:
 *
 * - MECHANICAL — decidable from the document alone; implemented here so they
 *   are deterministic and unit-testable. Re-running replaces exactly the
 *   findings these checks own (matched by heuristic id) and touches nothing
 *   else. Mechanical findings carry `evidence: 'heuristic'` — they encode
 *   heuristics, not product research (om-ux-product-design evidence hierarchy).
 * - JUDGMENT — Nielsen's 10, the remaining project contracts, and the
 *   anti-pattern blocklist items that need context; applied by the skill
 *   (agent judgment), never by this module.
 *
 * The skill (.ai/skills/om-ux-heuristics/SKILL.md) documents both sets; this
 * file is the single source of truth for ids and the mechanical semantics.
 */

export const HEURISTIC_IDS = [
  'nielsen-01', // visibility of system status
  'nielsen-02', // match between system and the real world
  'nielsen-03', // user control and freedom
  'nielsen-04', // consistency and standards
  'nielsen-05', // error prevention
  'nielsen-06', // recognition rather than recall
  'nielsen-07', // flexibility and efficiency of use
  'nielsen-08', // aesthetic and minimalist design
  'nielsen-09', // help users recognize, diagnose, and recover from errors
  'nielsen-10', // help and documentation
  'om-empty-state-next-action', // every list has an empty state with a next action
  'om-destructive-confirm-undo', // destructive actions confirm and offer undo
  'om-progress-over-1s', // operations >1s show progress
  'om-dialog-keyboard-contract', // dialogs honor Escape/Cmd+Enter
  'om-no-dead-ends', // every screen names an exit or next step
  'om-placeholder-only-label', // anti-pattern: placeholder as the only label
  'om-vague-action-label', // anti-pattern: bare OK/Next/Send when the action can be named
] as const
export type HeuristicId = (typeof HEURISTIC_IDS)[number]

/** Gallery entries that render a list surface — must show empty-state intent. */
export const LIST_ENTRY_IDS = ['table'] as const

/** Entries that give a screen an action or a way out — dead-end evidence. */
export const ACTION_ENTRY_IDS = [
  'button',
  'button-group',
  'icon-button',
  'link-button',
  'fancy-button',
  'section-header',
  'filter-bar',
  'segmented-control',
  'tabs',
  'pagination',
  'breadcrumb',
] as const

/**
 * Bare verbs/acknowledgements that name no action. A block prop carrying one
 * of these as its whole value trips `om-vague-action-label` — buttons name the
 * action ("Save changes", "Send invoice"), never a bare OK/Next/Send.
 */
export const VAGUE_ACTION_LABELS = [
  'ok',
  'okay',
  'next',
  'send',
  'submit',
  'continue',
  'go',
  'yes',
  'no',
  'click here',
] as const

export type MechanicalCheckResult = {
  heuristicId: HeuristicId
  blockId: string | null // null = screen-level (documentFindings)
  severity: FindingSeverity
  summary: string
  suggestion: string
  evidence: FindingEvidence
}

function hasEmptyStateEvidence(leaf: MockupLeafNode): boolean {
  if (leaf.type === 'block' && leaf.props) {
    if (Object.keys(leaf.props).some((key) => /empty/i.test(key))) return true
  }
  return typeof leaf.note === 'string' && /empty[ -]state/i.test(leaf.note)
}

/**
 * Walks a props value depth-first and reports every object that has a
 * placeholder-ish key (`/placeholder/i`) with no label-ish sibling
 * (`/label|title|legend/i`) — the "placeholder as the only label" anti-pattern
 * as far as it is decidable from a document.
 */
function hasPlaceholderWithoutLabel(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPlaceholderWithoutLabel)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  const hasPlaceholder = keys.some((key) => /placeholder/i.test(key))
  const hasLabel = keys.some((key) => /label|title|legend/i.test(key))
  if (hasPlaceholder && !hasLabel) return true
  return keys.some((key) => hasPlaceholderWithoutLabel(record[key]))
}

/** Depth-first string prop values whose whole trimmed value is a vague action label. */
function collectVagueLabels(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return (VAGUE_ACTION_LABELS as readonly string[]).includes(normalized) ? [value.trim()] : []
  }
  if (Array.isArray(value)) return value.flatMap(collectVagueLabels)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectVagueLabels)
  }
  return []
}

/**
 * Mechanical checks, deterministic over the document:
 *
 * - `om-empty-state-next-action` — a block referencing a list entry
 *   (LIST_ENTRY_IDS) with neither an empty-state prop (key matching /empty/i)
 *   nor a note mentioning its empty state.
 * - `om-no-dead-ends` — screen-level: no leaf references any action/navigation
 *   entry (ACTION_ENTRY_IDS), so the screen names no exit or next step.
 * - `om-placeholder-only-label` — a block whose props contain an object with a
 *   placeholder key and no label/title sibling: the placeholder would be the
 *   only label, which disappears the moment the user types.
 * - `om-vague-action-label` — a block on an action entry whose string prop
 *   value is a bare OK/Next/Send-class verb instead of a named action.
 */
export function runMechanicalChecks(document: MockupDocument): MechanicalCheckResult[] {
  const results: MechanicalCheckResult[] = []
  const leaves = collectLeaves(document.root)

  for (const leaf of leaves) {
    if (leaf.type !== 'block') continue
    if (!(LIST_ENTRY_IDS as readonly string[]).includes(leaf.entry)) continue
    if (hasEmptyStateEvidence(leaf)) continue
    results.push({
      heuristicId: 'om-empty-state-next-action',
      blockId: leaf.id,
      severity: 'high',
      summary: `List block "${leaf.id}" declares no empty state — every list needs an empty state with a next action.`,
      suggestion:
        'Add an empty-state prop to the block, or state the empty-state behavior (and its call to action) in the block note.',
      evidence: 'heuristic',
    })
  }

  const hasAction = leaves.some(
    (leaf) => leaf.type === 'block' && (ACTION_ENTRY_IDS as readonly string[]).includes(leaf.entry),
  )
  if (!hasAction) {
    results.push({
      heuristicId: 'om-no-dead-ends',
      blockId: null,
      severity: 'medium',
      summary: 'The screen exposes no action or navigation block — it reads as a dead end.',
      suggestion:
        'Add the block that names the next step (a page header with actions, a button, tabs, or navigation).',
      evidence: 'heuristic',
    })
  }

  for (const leaf of leaves) {
    if (leaf.type !== 'block' || !leaf.props) continue
    if (hasPlaceholderWithoutLabel(leaf.props)) {
      results.push({
        heuristicId: 'om-placeholder-only-label',
        blockId: leaf.id,
        severity: 'high',
        summary: `Block "${leaf.id}" uses a placeholder with no label — the placeholder becomes the only label and disappears on input.`,
        suggestion:
          'Add a persistent label prop beside the placeholder; a placeholder may hint at format, never replace the label.',
        evidence: 'heuristic',
      })
    }
  }

  for (const leaf of leaves) {
    if (leaf.type !== 'block' || !leaf.props) continue
    if (!(ACTION_ENTRY_IDS as readonly string[]).includes(leaf.entry)) continue
    const vague = collectVagueLabels(leaf.props)
    if (vague.length > 0) {
      results.push({
        heuristicId: 'om-vague-action-label',
        blockId: leaf.id,
        severity: 'medium',
        summary: `Action block "${leaf.id}" is labeled "${vague[0]}" — a bare verb that names no action.`,
        suggestion:
          'Name the action the button performs ("Save changes", "Send invoice") instead of a bare OK/Next/Send.',
        evidence: 'heuristic',
      })
    }
  }

  return results
}

/** Heuristic ids the mechanical engine owns — replaced wholesale on re-run. */
export const MECHANICAL_HEURISTIC_IDS: readonly HeuristicId[] = [
  'om-empty-state-next-action',
  'om-no-dead-ends',
  'om-placeholder-only-label',
  'om-vague-action-label',
]

/** Deterministic finding id: same check + same block → same id on every run. */
export function findingIdFor(heuristicId: string, blockId: string | null): string {
  return blockId ? `f-${heuristicId}--${blockId}` : `f-${heuristicId}`
}

function toFinding(result: MechanicalCheckResult, atHash: string): MockupFinding {
  return {
    id: findingIdFor(result.heuristicId, result.blockId),
    heuristicId: result.heuristicId,
    severity: result.severity,
    summary: result.summary,
    suggestion: result.suggestion,
    atHash,
    evidence: result.evidence,
  }
}

/**
 * Writes the mechanical findings into a copy of the document, REPLACING only
 * findings whose heuristic id belongs to the mechanical set — hand-written and
 * judgment findings survive untouched. Idempotent: running twice on the same
 * content yields byte-identical findings.
 */
export function applyMechanicalFindings(document: MockupDocument, atHash: string): MockupDocument {
  const next = JSON.parse(JSON.stringify(document)) as MockupDocument
  const results = runMechanicalChecks(next)
  const owned = (candidate: MockupFinding) =>
    (MECHANICAL_HEURISTIC_IDS as readonly string[]).includes(candidate.heuristicId)

  const byBlock = new Map<string | null, MockupFinding[]>()
  for (const result of results) {
    const list = byBlock.get(result.blockId) ?? []
    list.push(toFinding(result, atHash))
    byBlock.set(result.blockId, list)
  }

  const docKept = (next.documentFindings ?? []).filter((candidate) => !owned(candidate))
  const docNew = byBlock.get(null) ?? []
  if (docKept.length + docNew.length > 0) next.documentFindings = [...docKept, ...docNew]
  else delete next.documentFindings

  const visit = (node: typeof next.root): void => {
    if (node.type === 'stack' || node.type === 'columns') {
      for (const child of node.children) visit(child)
      return
    }
    const kept = (node.findings ?? []).filter((candidate) => !owned(candidate))
    const fresh = byBlock.get(node.id) ?? []
    if (kept.length + fresh.length > 0) node.findings = [...kept, ...fresh]
    else delete node.findings
  }
  visit(next.root)
  return next
}
