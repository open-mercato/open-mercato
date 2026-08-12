/**
 * Workflows Module — author-time check: an out-of-band agent inside a parallel
 * branch (PURE).
 *
 * `executeInvokeAgent`'s parallel-branch path (`context.branchInstanceId`)
 * resolves the agent bridge INLINE, and `sendSignal`'s FORKED branch resume only
 * matches WAIT_FOR_SIGNAL steps — so a branch can never be woken by the
 * instance-level signal an out-of-band answer arrives on. An agent that answers
 * minutes later therefore has nowhere to land there, and the executor refuses
 * with `AgentSuspensionUnsupportedError` (non-retryable, and non-retryable for a
 * reason: by the time it throws the external effector has ALREADY run — a phone
 * call has been placed). This module catches the same mistake at AUTHORING time,
 * before any run.
 *
 * WARNING, never an error. Three reasons, all of them the module's standing
 * rules rather than a judgement call here:
 *  - a definition mid-edit must stay saveable, which is why every flow-logic
 *    finding is a warning (`flow-logic-warnings.ts`);
 *  - the refusal is deliberately ABSORBABLE at run time by an `error` route, an
 *    `errorDirective` or `continueOnActivityFailure`, so an author who wired
 *    failure handling has a legitimate design here;
 *  - "answers out of band" is a property of the agent REGISTRY, which is tenant
 *    and deployment state the definition does not carry — it can change after a
 *    definition is authored, and blocking a save on it would trap work.
 *
 * DEGRADES TO SILENCE. The caller supplies the set of agent ids known to answer
 * out of band. Omit it — no agent catalogue, the OPTIONAL `agent_orchestrator`
 * peer absent, the listing request failed — and NOTHING is reported. An agent id
 * the catalogue does not carry is likewise not reported: unknown is not
 * "suspends", and a warning on every agent step would train authors to ignore
 * the Problems panel.
 *
 * SCOPE: step activities only. The Studio's `invokeAgent` node compiles to an
 * AUTOMATED step carrying one INVOKE_AGENT activity (`graph-utils`), which is
 * the authoring surface this check exists for. An INVOKE_AGENT hand-authored
 * onto a TRANSITION also runs with the branch token, but its natural subject is
 * the route rather than a step, and naming the route's source step ("step X runs
 * inside a parallel branch") would be wrong for the fork's own branch-opening
 * transitions. Left out deliberately rather than reported inaccurately.
 *
 * PURE: no React, no ORM, no DI, no xyflow. Callers hand in the plain definition
 * JSON.
 */

import { excludeNonNormalTransitions } from './route-kinds'

export type ParallelBranchAgentWarning = {
  /** The step carrying the INVOKE_AGENT activity. */
  stepId: string
  /** The agent the step names. */
  agentId: string
  /** The PARALLEL_FORK whose region the step sits in. */
  forkStepId: string
  /** Zod-style path so the Problems panel can map the warning onto its node. */
  path: Array<string | number>
}

export type ParallelBranchAgentCheckOptions = {
  /**
   * Agent ids the caller KNOWS answer out of band (`runtime: 'external'` in the
   * agent registry). Absent or empty ⇒ the check reports nothing.
   */
  outOfBandAgentIds?: ReadonlySet<string> | null
}

type DefinitionLike = {
  steps?: unknown
  transitions?: unknown
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readRecord(source: unknown, key: string): Record<string, unknown> | undefined {
  if (!source || typeof source !== 'object') return undefined
  const value = (source as Record<string, unknown>)[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

type BranchTransition = { fromStepId: string; toStepId: string; trigger?: string }

function readTransitions(definition: DefinitionLike): BranchTransition[] {
  const shaped: Array<BranchTransition & { kind?: string }> = []
  for (const transition of asArray(definition.transitions)) {
    const fromStepId = readString(transition, 'fromStepId')
    const toStepId = readString(transition, 'toStepId')
    if (!fromStepId || !toStepId) continue
    shaped.push({
      fromStepId,
      toStepId,
      trigger: readString(transition, 'trigger'),
      ...(readString(transition, 'kind') ? { kind: readString(transition, 'kind') } : {}),
    })
  }
  // Same graph a fork region is validated over (`validateParallelForkJoin`):
  // error and breach routes leave the region on purpose, so a step reachable
  // only through one is not "inside the branch" for authoring purposes.
  return excludeNonNormalTransitions(shaped)
}

/**
 * Every step id that executes under a branch token, mapped to the fork whose
 * region it belongs to.
 *
 * Mirrors the engine: `openFork` opens one branch per outgoing `auto` transition
 * and each branch walks forward until it reaches the fork's `joinStepId`. The
 * walk therefore seeds from those transitions' targets, stops AT the join (a
 * join step runs at the instance level once every branch has merged) and
 * tolerates a malformed graph — a missing `joinStepId`, a cycle or a nested fork
 * is somebody else's diagnostic (`validateParallelForkJoin`), not a reason for
 * this check to throw or to hang.
 */
export function collectParallelBranchStepIds(
  definition: DefinitionLike | null | undefined,
): Map<string, string> {
  const membership = new Map<string, string>()
  if (!definition) return membership

  const transitions = readTransitions(definition)
  const outgoing = new Map<string, BranchTransition[]>()
  for (const transition of transitions) {
    const list = outgoing.get(transition.fromStepId)
    if (list) list.push(transition)
    else outgoing.set(transition.fromStepId, [transition])
  }

  for (const step of asArray(definition.steps)) {
    if (readString(step, 'stepType') !== 'PARALLEL_FORK') continue
    const forkStepId = readString(step, 'stepId')
    if (!forkStepId) continue
    const joinStepId = readString(readRecord(step, 'config'), 'joinStepId')

    const seen = new Set<string>([forkStepId])
    const frontier = (outgoing.get(forkStepId) ?? [])
      .filter((transition) => transition.trigger === 'auto')
      .map((transition) => transition.toStepId)

    while (frontier.length > 0) {
      const stepId = frontier.pop() as string
      if (stepId === joinStepId) continue
      if (seen.has(stepId)) continue
      seen.add(stepId)
      // First fork wins: nesting is refused by `validateParallelForkJoin`, so a
      // step claimed twice already has a louder diagnostic than this one.
      if (!membership.has(stepId)) membership.set(stepId, forkStepId)
      for (const transition of outgoing.get(stepId) ?? []) frontier.push(transition.toStepId)
    }
  }

  return membership
}

/** Agent ids the step's INVOKE_AGENT activities name, in activity order. */
function invokeAgentIdsOfStep(step: unknown): string[] {
  if (!step || typeof step !== 'object') return []
  const agentIds: string[] = []
  for (const activity of asArray((step as { activities?: unknown }).activities)) {
    if (readString(activity, 'activityType') !== 'INVOKE_AGENT') continue
    const agentId = readString(readRecord(activity, 'config'), 'agentId')
    if (agentId) agentIds.push(agentId)
  }
  return agentIds
}

/**
 * INVOKE_AGENT steps inside a parallel branch that name an agent the caller says
 * answers out of band.
 */
export function collectParallelBranchAgentWarnings(
  definition: DefinitionLike | null | undefined,
  options: ParallelBranchAgentCheckOptions = {},
): ParallelBranchAgentWarning[] {
  const outOfBandAgentIds = options.outOfBandAgentIds
  if (!definition || !outOfBandAgentIds || outOfBandAgentIds.size === 0) return []

  const membership = collectParallelBranchStepIds(definition)
  if (membership.size === 0) return []

  const warnings: ParallelBranchAgentWarning[] = []
  asArray(definition.steps).forEach((step, stepIndex) => {
    const stepId = readString(step, 'stepId')
    if (!stepId) return
    const forkStepId = membership.get(stepId)
    if (!forkStepId) return
    for (const agentId of invokeAgentIdsOfStep(step)) {
      if (!outOfBandAgentIds.has(agentId)) continue
      warnings.push({ stepId, agentId, forkStepId, path: ['steps', stepIndex] })
    }
  })

  return warnings
}
