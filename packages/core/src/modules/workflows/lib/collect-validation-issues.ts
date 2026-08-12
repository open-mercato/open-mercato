import type { Node, Edge } from '@xyflow/react'
import type { ValidationError } from './graph-utils'
import type { ContextLedger } from './context-ledger'
import {
  collectFlowLogicWarnings,
  type FlowLogicDefinition,
  type FlowLogicWarningCode,
  type TaskAssigneeEntityAccess,
} from './flow-logic-warnings'

export type WorkflowValidationIssueSeverity = 'error' | 'warning'

export interface WorkflowValidationIssue {
  id: string
  severity: WorkflowValidationIssueSeverity
  message: string
  nodeId?: string
  edgeId?: string
  nodeLabel?: string
}

export interface ZodIssueLike {
  path: Array<string | number | symbol>
  message: string
}

/**
 * Message keys for the Phase 3a flow-logic warnings. English fallbacks live with
 * the translator so a caller without an i18n dictionary still gets readable
 * text.
 */
export const FLOW_LOGIC_MESSAGE_KEYS: Record<FlowLogicWarningCode, { key: string; fallback: string }> = {
  errorRouteUnknownSource: {
    key: 'workflows.visualEditor.problems.errorRouteUnknownSource',
    fallback: 'Error route "{transitionId}" starts at unknown step "{stepId}"',
  },
  errorRouteUnknownTarget: {
    key: 'workflows.visualEditor.problems.errorRouteUnknownTarget',
    fallback: 'Error route "{transitionId}" targets unknown step "{stepId}"',
  },
  errorRouteDuplicateTarget: {
    key: 'workflows.visualEditor.problems.errorRouteDuplicateTarget',
    fallback: 'Error route "{transitionId}" shares its source and target with a normal route; the engine cannot tell them apart',
  },
  branchingWithoutOtherwise: {
    key: 'workflows.visualEditor.problems.branchingWithoutOtherwise',
    fallback: 'Branching step "{stepId}" has no unconditioned route; add an otherwise route so the workflow cannot stall when no condition matches',
  },
  duplicateBranchingCase: {
    key: 'workflows.visualEditor.problems.duplicateBranchingCase',
    fallback: 'Branching step "{stepId}" has more than one route for {caseValue}; only the highest-priority one can ever match',
  },
  conditionUnknownPath: {
    key: 'workflows.visualEditor.problems.conditionUnknownPath',
    fallback: 'Condition path "{path}" is not provided by any earlier step, trigger, or input',
  },
  unmappedStepConfig: {
    key: 'workflows.visualEditor.problems.unmappedStepConfig',
    fallback: 'Step "{stepId}" keeps unmapped configuration from an earlier type change ({keys}); it is stored but no longer executed',
  },
  taskDecisionUnknownRoute: {
    key: 'workflows.visualEditor.problems.taskDecisionUnknownRoute',
    fallback: 'Decision "{decisionId}" on task "{stepId}" points at route "{transitionId}", which no longer leaves this step',
  },
  taskDecisionDuplicateId: {
    key: 'workflows.visualEditor.problems.taskDecisionDuplicateId',
    fallback: 'Task "{stepId}" has more than one decision with the id "{decisionId}"; only one of them can ever be recorded',
  },
  taskWithoutOwner: {
    key: 'workflows.visualEditor.problems.taskWithoutOwner',
    fallback: 'Task "{stepId}" names neither an assignee nor a role queue, so nobody can complete it and the workflow will stall there',
  },
  taskPortalWithoutBinding: {
    key: 'workflows.visualEditor.problems.taskPortalWithoutBinding',
    fallback: 'Task "{stepId}" is addressed to a customer but is about no record; a portal task is only visible to the customer whose record it is linked to, so nobody in the portal would see it',
  },
  taskBindingUnknownEntityType: {
    key: 'workflows.visualEditor.problems.taskBindingUnknownEntityType',
    fallback: 'Task "{stepId}" is about "{entityType}", which is not a known record type; the task would be hidden from its own assignee',
  },
  outcomeRouteUnknownKind: {
    key: 'workflows.visualEditor.problems.outcomeRouteUnknownKind',
    fallback: 'Outcome route "{transitionId}" claims outcome "{outcomeKind}", which the platform does not define; it can never be selected',
  },
  outcomeRouteDuplicateKind: {
    key: 'workflows.visualEditor.problems.outcomeRouteDuplicateKind',
    fallback: 'Agent step "{stepId}" has more than one route for the "{outcomeKind}" outcome; only the highest-priority one can ever be taken',
  },
  taskBindingAssigneeCannotView: {
    key: 'workflows.visualEditor.problems.taskBindingAssigneeCannotView',
    fallback: 'Task "{stepId}" is about "{entityType}", which {roles} may not view; assignees holding only those roles would not see the task',
  },
  agentOutOfBandInParallelBranch: {
    key: 'workflows.visualEditor.problems.agentOutOfBandInParallelBranch',
    fallback: 'Step "{stepId}" invokes agent "{agentId}", which answers out of band, inside the parallel branch opened by "{forkStepId}"; a branch cannot be resumed by the instance-level signal that answer arrives on, so the step will fail after the external call has already been placed. Move this agent step outside the parallel branch',
  },
}

export type WorkflowIssueTranslator = (
  key: string,
  fallback: string,
  params: Record<string, string>,
) => string

function interpolateFallback(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

const defaultTranslator: WorkflowIssueTranslator = (_key, fallback, params) =>
  interpolateFallback(fallback, params)

export interface CollectValidationIssuesInput {
  graphErrors: ValidationError[]
  zodIssues?: ZodIssueLike[]
  configWarnings?: ZodIssueLike[]
  nodes: Node[]
  edges: Edge[]
  /**
   * Definition JSON for the Phase 3a checks (error routes, branching routes,
   * condition paths). Omit it and only the legacy channels run.
   */
  definition?: FlowLogicDefinition | null
  /** Context ledger enabling the condition-path resolution check. */
  ledger?: ContextLedger
  /**
   * Generated entity ids that exist. Without it the unknown-binding check falls
   * back to a shape test rather than flagging every id it cannot enumerate.
   */
  knownEntityIds?: ReadonlySet<string> | null
  /** Tenant role features + entity view requirements, when the caller has them. */
  assigneeEntityAccess?: TaskAssigneeEntityAccess | null
  /**
   * Agent ids the caller knows answer OUT OF BAND (`runtime: 'external'` in the
   * agent registry). Without it the parallel-branch agent check reports nothing
   * — the agent registry lives behind an OPTIONAL peer module, and treating an
   * agent the caller cannot enumerate as suspending would flag every agent step.
   */
  outOfBandAgentIds?: ReadonlySet<string> | null
  translate?: WorkflowIssueTranslator
}

function resolveNodeLabel(node: Node | undefined): string | undefined {
  if (!node) return undefined
  const label = node.data?.label
  return typeof label === 'string' && label.length > 0 ? label : node.id
}

function mapZodPathToGraph(
  path: Array<string | number | symbol>,
  nodes: Node[],
  edges: Edge[],
): { nodeId?: string; edgeId?: string; nodeLabel?: string } {
  const [collection, index] = path
  if (typeof index !== 'number') return {}
  if (collection === 'steps') {
    const node = nodes[index]
    if (!node) return {}
    return { nodeId: node.id, nodeLabel: resolveNodeLabel(node) }
  }
  if (collection === 'transitions') {
    const edge = edges[index]
    if (!edge) return {}
    return { edgeId: edge.id }
  }
  return {}
}

function formatZodPath(path: Array<string | number | symbol>): string {
  return path.map((segment) => String(segment)).join('.')
}

export function collectValidationIssues(input: CollectValidationIssuesInput): WorkflowValidationIssue[] {
  const {
    graphErrors,
    zodIssues = [],
    configWarnings = [],
    nodes,
    edges,
    definition,
    ledger,
    knownEntityIds = null,
    assigneeEntityAccess = null,
    outOfBandAgentIds = null,
    translate = defaultTranslator,
  } = input

  const graphIssues: WorkflowValidationIssue[] = graphErrors.map((error, index) => ({
    id: `graph-${index}`,
    severity: error.type,
    message: error.message,
    ...(error.nodeId ? { nodeId: error.nodeId } : {}),
    ...(error.edgeId ? { edgeId: error.edgeId } : {}),
    ...(error.nodeId
      ? { nodeLabel: resolveNodeLabel(nodes.find((node) => node.id === error.nodeId)) }
      : {}),
  }))

  const schemaIssues: WorkflowValidationIssue[] = zodIssues.map((issue, index) => {
    const pathText = formatZodPath(issue.path)
    return {
      id: `schema-${index}`,
      severity: 'error',
      message: pathText ? `${pathText} - ${issue.message}` : issue.message,
      ...mapZodPathToGraph(issue.path, nodes, edges),
    }
  })

  const configWarningIssues: WorkflowValidationIssue[] = configWarnings.map((issue, index) => {
    const pathText = formatZodPath(issue.path)
    return {
      id: `config-${index}`,
      severity: 'warning',
      message: pathText ? `${pathText} - ${issue.message}` : issue.message,
      ...mapZodPathToGraph(issue.path, nodes, edges),
    }
  })

  // Phase 3a flow-logic + ledger checks default to WARNINGS: flow logic is
  // transition sugar and a path a later edit will provide must never make the
  // definition unsaveable. The §6.4 task checks opt into `error` because they
  // describe a step the engine can never advance past — the same class as the
  // structural problems `graphErrors` carries.
  const flowLogicIssues: WorkflowValidationIssue[] = collectFlowLogicWarnings(definition, {
    ledger,
    knownEntityIds,
    assigneeEntityAccess,
    outOfBandAgentIds,
  }).map((warning, index) => {
    const message = FLOW_LOGIC_MESSAGE_KEYS[warning.code]
    return {
      id: `flow-${warning.code}-${index}`,
      severity: warning.severity ?? 'warning',
      message: translate(message.key, message.fallback, warning.params),
      ...mapZodPathToGraph(warning.path, nodes, edges),
    }
  })

  const all = [...graphIssues, ...schemaIssues, ...configWarningIssues, ...flowLogicIssues]
  const errors = all.filter((issue) => issue.severity === 'error')
  const warnings = all.filter((issue) => issue.severity === 'warning')
  return [...errors, ...warnings]
}

export function countIssuesBySeverity(issues: WorkflowValidationIssue[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}
