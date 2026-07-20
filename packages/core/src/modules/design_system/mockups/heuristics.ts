import {
  collectLeaves,
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
 *   else.
 * - JUDGMENT — Nielsen's 10 and the remaining project contracts; applied by
 *   the skill (agent judgment), never by this module.
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

export type MechanicalCheckResult = {
  heuristicId: HeuristicId
  blockId: string | null // null = screen-level (documentFindings)
  severity: FindingSeverity
  summary: string
  suggestion: string
}

function hasEmptyStateEvidence(leaf: MockupLeafNode): boolean {
  if (leaf.type === 'block' && leaf.props) {
    if (Object.keys(leaf.props).some((key) => /empty/i.test(key))) return true
  }
  return typeof leaf.note === 'string' && /empty[ -]state/i.test(leaf.note)
}

/**
 * Mechanical checks, deterministic over the document:
 *
 * - `om-empty-state-next-action` — a block referencing a list entry
 *   (LIST_ENTRY_IDS) with neither an empty-state prop (key matching /empty/i)
 *   nor a note mentioning its empty state.
 * - `om-no-dead-ends` — screen-level: no leaf references any action/navigation
 *   entry (ACTION_ENTRY_IDS), so the screen names no exit or next step.
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
    })
  }

  return results
}

/** Heuristic ids the mechanical engine owns — replaced wholesale on re-run. */
export const MECHANICAL_HEURISTIC_IDS: readonly HeuristicId[] = [
  'om-empty-state-next-action',
  'om-no-dead-ends',
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
