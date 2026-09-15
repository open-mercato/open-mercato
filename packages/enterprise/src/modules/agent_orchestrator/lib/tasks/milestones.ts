import type {
  WorkflowIssueTranslator,
  WorkflowValidationIssue,
} from '@open-mercato/core/modules/workflows/lib/collect-validation-issues'
import {
  processMilestonesSchema,
  processMilestonesReachedSchema,
  type ProcessMilestone,
  type ProcessMilestoneReached,
} from '../../data/validators'

/**
 * Readers and the drift diagnostic for the milestone model.
 *
 * A milestone is a BUSINESS EVENT a workflow emits, never an alias for a step:
 * `process_definitions.milestones` declares the vocabulary (`key`, `label`,
 * `order`), a workflow step declares `milestone: '<key>'` in its advanced config,
 * and `process_instances.milestones_reached` records what actually happened. That
 * indirection is what lets a stage be reached after a parallel join, after a
 * retry, or after ten steps — and lets the business reader never learn there were
 * branches at all.
 *
 * Dependency-free and client-safe (no ORM, no scheduler, no server-only import),
 * like its `triggers.ts` sibling: the milestone editor, the business-facing stage
 * view and the tests all read through here.
 */

/**
 * Tolerant parse of the declared vocabulary, mirroring `parseProcessTriggers`: a
 * row written by an older release or hand-edited must not take a page down, so
 * unparseable entries are dropped rather than thrown on.
 */
export function parseProcessMilestones(raw: unknown): ProcessMilestone[] {
  if (!Array.isArray(raw)) return []
  const parsed = processMilestonesSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const kept: ProcessMilestone[] = []
  for (const entry of raw) {
    const one = processMilestonesSchema.safeParse([entry])
    if (one.success && !kept.some((milestone) => milestone.key === one.data[0].key)) kept.push(...one.data)
  }
  return kept
}

/** Same tolerant parse for the reached list on an execution row. */
export function parseMilestonesReached(raw: unknown): ProcessMilestoneReached[] {
  if (!Array.isArray(raw)) return []
  const parsed = processMilestonesReachedSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const kept: ProcessMilestoneReached[] = []
  for (const entry of raw) {
    const one = processMilestonesReachedSchema.safeParse([entry])
    if (one.success) kept.push(...one.data)
  }
  return kept
}

/**
 * Appends one reached milestone, idempotent per key. A workflow can emit the same
 * milestone twice — a retried step, a redelivered event — and the business
 * narrative must not stutter, so the FIRST arrival wins and later ones are
 * dropped rather than appended or overwritten.
 */
export function appendMilestoneReached(
  reached: ProcessMilestoneReached[],
  entry: ProcessMilestoneReached,
): ProcessMilestoneReached[] {
  if (reached.some((one) => one.key === entry.key)) return reached
  return [...reached, entry]
}

/** Authoring order is the stored `order`; ties fall back to the stored position. */
export function orderedMilestones(milestones: ProcessMilestone[]): ProcessMilestone[] {
  return milestones
    .map((milestone, index) => ({ milestone, index }))
    .sort((left, right) => left.milestone.order - right.milestone.order || left.index - right.index)
    .map((entry) => entry.milestone)
}

/**
 * Renumbers `order` to the list's own positions. Every editor mutation runs
 * through this, so a saved list can never carry gaps or duplicate ranks that
 * would make the rendered stage order depend on array position.
 */
export function withSequentialOrder(milestones: ProcessMilestone[]): ProcessMilestone[] {
  return milestones.map((milestone, index) => ({ ...milestone, order: index }))
}

/** Moves one milestone and renumbers; an out-of-range index is a no-op. */
export function moveMilestone(
  milestones: ProcessMilestone[],
  from: number,
  to: number,
): ProcessMilestone[] {
  if (from === to) return milestones
  if (from < 0 || from >= milestones.length) return milestones
  if (to < 0 || to >= milestones.length) return milestones
  const next = [...milestones]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return withSequentialOrder(next)
}

export type MilestoneIssueCode = 'milestoneNeverEmitted'

/**
 * Message keys in the shape core `workflows` uses for its own Problems-panel
 * entries (`FLOW_LOGIC_MESSAGE_KEYS` in `lib/collect-validation-issues.ts`):
 * an i18n key plus an English fallback, so a caller with no dictionary still
 * gets readable text.
 */
export const MILESTONE_MESSAGE_KEYS: Record<MilestoneIssueCode, { key: string; fallback: string }> = {
  milestoneNeverEmitted: {
    key: 'agent_orchestrator.processDefinitions.milestones.problems.neverEmitted',
    fallback: 'Milestone "{label}" ({key}) is declared but no step in this workflow emits it',
  },
}

function interpolateFallback(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

const defaultTranslator: WorkflowIssueTranslator = (_key, fallback, params) =>
  interpolateFallback(fallback, params)

export interface CollectMilestoneIssuesInput {
  milestones: ProcessMilestone[]
  /**
   * The milestone keys the bound workflow's steps actually emit. `null` means the
   * workflow could not be resolved (workflows module absent, no permission,
   * request failed) — then NOTHING is reported, because "unknown" is not
   * "missing".
   */
  emittedKeys: ReadonlySet<string> | null
  translate?: WorkflowIssueTranslator
}

/**
 * The drift diagnostic the milestone model needs: because the vocabulary is
 * declared on the process and the emission on the workflow, a declared stage can
 * end up unreachable — a key nobody emits renders as a stage that never arrives.
 *
 * It is a WARNING, not an error — a definition mid-edit must stay saveable —
 * and it reuses the exact `WorkflowValidationIssue` shape core `workflows`
 * already emits for unknown outcome kinds and quarantined step config.
 */
export function collectMilestoneIssues(input: CollectMilestoneIssuesInput): WorkflowValidationIssue[] {
  const { milestones, emittedKeys, translate = defaultTranslator } = input
  if (!emittedKeys) return []
  const message = MILESTONE_MESSAGE_KEYS.milestoneNeverEmitted
  return orderedMilestones(milestones)
    .filter((milestone) => !emittedKeys.has(milestone.key))
    .map((milestone, index) => ({
      id: `milestone-milestoneNeverEmitted-${index}`,
      severity: 'warning' as const,
      message: translate(message.key, message.fallback, {
        label: milestone.label,
        key: milestone.key,
      }),
      nodeLabel: milestone.label,
    }))
}

export type MilestoneStageState = 'done' | 'current' | 'upcoming'

export type MilestoneStage = {
  key: string
  label: string
  state: MilestoneStageState
  /** When the stage was actually reached; null while it has not been. */
  at: string | null
}

/**
 * The business-facing stage list: the declared labels in declared order, with
 * every stage the execution actually emitted marked done.
 *
 * "Current" is the first undeclared-yet stage AFTER the newest reached one, which
 * is an honest reading of an event log: the execution is somewhere past what it
 * announced and before what it has not. An execution that has announced nothing
 * leaves every stage `upcoming` rather than guessing that it is on the first.
 */
export function buildMilestoneStages(
  milestones: ProcessMilestone[],
  reached: ProcessMilestoneReached[],
  options?: { terminal?: boolean },
): MilestoneStage[] {
  const ordered = orderedMilestones(milestones)
  const reachedAt = new Map(reached.map((one) => [one.key, one.at]))
  let currentAssigned = false
  return ordered.map((milestone) => {
    const at = reachedAt.get(milestone.key) ?? null
    if (at) return { key: milestone.key, label: milestone.label, state: 'done' as const, at }
    if (options?.terminal) {
      return { key: milestone.key, label: milestone.label, state: 'upcoming' as const, at: null }
    }
    const state = !currentAssigned && reachedAt.size > 0 ? 'current' : 'upcoming'
    if (state === 'current') currentAssigned = true
    return { key: milestone.key, label: milestone.label, state: state as MilestoneStageState, at: null }
  })
}
