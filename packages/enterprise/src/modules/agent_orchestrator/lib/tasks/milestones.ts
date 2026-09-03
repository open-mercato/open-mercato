import type {
  WorkflowIssueTranslator,
  WorkflowValidationIssue,
} from '@open-mercato/core/modules/workflows/lib/collect-validation-issues'
import { processMilestonesSchema, type ProcessMilestone } from '../../data/validators'

/**
 * Readers and the drift diagnostic for the `agent_process_definitions.milestones`
 * jsonb column. Dependency-free and client-safe (no ORM, no scheduler, no
 * server-only import), like its `triggers.ts` sibling: the milestone editor, the
 * business-facing stage view and the tests all read the column through here.
 */

/**
 * Tolerant parse of the stored column, mirroring `parseProcessTriggers`: a row
 * written by an older release or hand-edited must not take a page down, so
 * unparseable entries are dropped rather than thrown on.
 */
export function parseProcessMilestones(raw: unknown): ProcessMilestone[] {
  if (!Array.isArray(raw)) return []
  const parsed = processMilestonesSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const kept: ProcessMilestone[] = []
  for (const entry of raw) {
    const one = processMilestonesSchema.safeParse([entry])
    if (one.success && !kept.some((milestone) => milestone.id === one.data[0].id)) kept.push(...one.data)
  }
  return kept
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

export type MilestoneIssueCode = 'milestoneUnknownStep'

/**
 * Message keys in the shape core `workflows` uses for its own Problems-panel
 * entries (`FLOW_LOGIC_MESSAGE_KEYS` in `lib/collect-validation-issues.ts`):
 * an i18n key plus an English fallback, so a caller with no dictionary still
 * gets readable text.
 */
export const MILESTONE_MESSAGE_KEYS: Record<MilestoneIssueCode, { key: string; fallback: string }> = {
  milestoneUnknownStep: {
    key: 'agent_orchestrator.processDefinitions.milestones.problems.unknownStep',
    fallback: 'Milestone "{label}" maps to step "{stepId}", which this workflow no longer declares',
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
   * The step ids the target workflow declares. `null` means the definition
   * could not be resolved (workflows module absent, no permission, request
   * failed) — then NOTHING is reported, because "unknown" is not "missing".
   */
  knownStepIds: ReadonlySet<string> | null
  translate?: WorkflowIssueTranslator
}

/**
 * The drift diagnostic the milestone model is load-bearing on: because the
 * label is authored on the definition rather than read from the step, the
 * mapping is a thing that can drift, and a milestone naming a step the workflow
 * no longer declares would otherwise fail silently at render time.
 *
 * It is a WARNING, not an error — a definition mid-edit must stay saveable —
 * and it reuses the exact `WorkflowValidationIssue` shape core `workflows`
 * already emits for unknown outcome kinds and quarantined step config.
 */
export function collectMilestoneIssues(input: CollectMilestoneIssuesInput): WorkflowValidationIssue[] {
  const { milestones, knownStepIds, translate = defaultTranslator } = input
  if (!knownStepIds) return []
  const message = MILESTONE_MESSAGE_KEYS.milestoneUnknownStep
  return orderedMilestones(milestones)
    .filter((milestone) => !knownStepIds.has(milestone.stepId))
    .map((milestone, index) => ({
      id: `milestone-milestoneUnknownStep-${index}`,
      severity: 'warning' as const,
      message: translate(message.key, message.fallback, {
        label: milestone.label,
        stepId: milestone.stepId,
      }),
      nodeId: milestone.stepId,
      nodeLabel: milestone.label,
    }))
}

export type MilestoneStageState = 'done' | 'current' | 'upcoming'

export type MilestoneStage = {
  key: string
  label: string
  state: MilestoneStageState
}

/**
 * The business-facing stage list: the authored labels in authored order, with
 * the run's current step resolved to one of them. A process sitting on a step
 * no milestone names leaves every stage `upcoming` rather than guessing.
 */
export function buildMilestoneStages(
  milestones: ProcessMilestone[],
  currentStepId: string | null,
  options?: { terminal?: boolean },
): MilestoneStage[] {
  const ordered = orderedMilestones(milestones)
  const currentIndex = currentStepId ? ordered.findIndex((one) => one.stepId === currentStepId) : -1
  return ordered.map((milestone, index) => ({
    key: milestone.stepId,
    label: milestone.label,
    state: options?.terminal
      ? 'done'
      : currentIndex < 0
        ? 'upcoming'
        : index < currentIndex
          ? 'done'
          : index === currentIndex
            ? 'current'
            : 'upcoming',
  }))
}
