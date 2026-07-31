import type { Node, Edge } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import type { WorkflowDefinition } from '../data/entities'
import type { WorkflowIoContract } from '../data/validators'
import { isCompensationGhostEdge } from './compensation-ghosts'
import { isDataMappingEdge } from './data-edge-mapping'
import { isAnnotationNode } from './editor-annotations'
import { isTriggerEdge, isTriggerNode } from './trigger-node'
import {
  findRouteKindDescriptor,
  resolveEdgeRouteKind,
  type RouteKindTransitionLike,
} from './route-kinds'
import {
  NODE_DESCRIPTION_HEIGHT,
  NODE_HEIGHT,
  NODE_OUTCOME_FOOTER_CHROME_HEIGHT,
  NODE_OUTCOME_ROW_HEIGHT,
  NODE_MAX_WIDTH,
  NODE_MIN_WIDTH,
  TERMINAL_NODE_HEIGHT,
  TERMINAL_NODE_MIN_WIDTH,
} from './node-geometry'

/**
 * Graph Utilities for Visual Workflow Editor
 *
 * Converts between ReactFlow graph representation and workflow definition JSON
 */

export interface GraphToDefinitionOptions {
  includePositions?: boolean
}

/**
 * Task inspector keys (spec §6.1) that round-trip verbatim between the node and
 * the definition's `userTaskConfig`.
 *
 * They are listed rather than spread so an editor-only key on `node.data` can
 * never leak into a persisted definition, and so the set is one obvious place
 * to extend. The engine reads them through `userTaskConfig`; the inspector
 * reads them off `node.data`, which is why both directions copy.
 */
const USER_TASK_INSPECTOR_KEYS = [
  'instructions',
  'entityBindings',
  'priority',
  'deadline',
  'reminders',
  'onBreach',
  'decisions',
  'editablePrefilled',
  // The §7.1 portal discriminator. Listing it here is what makes it survive a
  // Studio save at all: before, a definition carrying `assigneeKind: 'customer'`
  // (authorable only through the Code view) was rebuilt from the fixed keys
  // above and the portal addressing was silently downgraded to backoffice.
  'assigneeKind',
] as const

export interface DefinitionToGraphOptions {
  autoLayout?: boolean
  layoutSpacing?: { vertical: number; horizontal: number }
  /**
   * Declared IO port contracts of referenced sub-workflows, keyed by
   * `subWorkflowId`. When provided, a SUB_WORKFLOW node renders the child's
   * IN/OUT ports. Absent → the node renders without ports (backward compatible).
   */
  childContracts?: Map<string, WorkflowIoContract>
}

export interface LayoutWithDagreOptions {
  /** Flow direction. Default `'LR'` (left→right). */
  direction?: 'LR' | 'TB'
  nodeWidth?: number
  nodeHeight?: number
}

/**
 * Convert ReactFlow graph (nodes + edges) to workflow definition JSON
 */
export function graphToDefinition(
  allNodes: Node[],
  edges: Edge[],
  options: GraphToDefinitionOptions = {}
): WorkflowDefinition['definition'] {
  // Sticky notes and groups are editor annotations (spec 4.5): they live only in
  // `metadata.editor.annotations` and MUST NOT reach `steps` or `transitions`,
  // so a definition carrying them serializes byte-identically to one that does
  // not and the engine can never see them.
  // The canvas trigger pill (fidelity gap #5) is filtered on the same terms:
  // it is a render-time overlay derived from `definition.triggers` and has no
  // step form at all, so a definition declaring triggers must serialize
  // byte-identically to one that does not. It can only reach here through a
  // caller mistake — it never enters the editor's node state — which is exactly
  // why the guarantee is enforced rather than assumed.
  const nodes = allNodes.filter((node) => !isAnnotationNode(node) && !isTriggerNode(node))
  const annotationIds = new Set(
    allNodes.filter((node) => isAnnotationNode(node) || isTriggerNode(node)).map((node) => node.id),
  )

  // Extract steps from nodes
  const steps = nodes.map((node) => {
    const step: any = {
      stepId: node.id,
      stepName: node.data.label || node.id,
      stepType: mapNodeTypeToStepType(node.type || 'automated'),
    }

    // Add step-specific configuration
    if (node.data.description) {
      step.description = node.data.description
    }

    // Add timeout if present
    if (node.data.timeout) {
      step.timeout = node.data.timeout
    }

    // Add retryPolicy if present
    if (node.data.retryPolicy) {
      step.retryPolicy = node.data.retryPolicy
    }

    // Add generic config if present
    if (node.data.config) {
      step.config = node.data.config
    }

    // User task configuration
    if (node.type === 'userTask' && node.data) {
      step.userTaskConfig = {
        assignedTo: node.data.assignedTo,
        assignedToRoles: node.data.assignedToRoles || [],
        formKey: node.data.formKey,
        allowedActions: node.data.allowedActions || ['complete', 'cancel'],
      }

      // Add form schema if present
      if ((node.data as any).formSchema || (node.data as any).userTaskConfig?.formSchema) {
        step.userTaskConfig.formSchema = (node.data as any).formSchema || (node.data as any).userTaskConfig.formSchema
      }

      // Add advanced fields if present
      if ((node.data as any).assignmentRule || (node.data as any).userTaskConfig?.assignmentRule) {
        step.userTaskConfig.assignmentRule = (node.data as any).assignmentRule || (node.data as any).userTaskConfig.assignmentRule
      }

      if ((node.data as any).slaDuration || (node.data as any).userTaskConfig?.slaDuration) {
        step.userTaskConfig.slaDuration = (node.data as any).slaDuration || (node.data as any).userTaskConfig.slaDuration
      }

      if ((node.data as any).escalationRules || (node.data as any).userTaskConfig?.escalationRules) {
        step.userTaskConfig.escalationRules = (node.data as any).escalationRules || (node.data as any).userTaskConfig.escalationRules
      }

      for (const key of USER_TASK_INSPECTOR_KEYS) {
        const authored = (node.data as any)[key] ?? (node.data as any).userTaskConfig?.[key]
        if (authored !== undefined) step.userTaskConfig[key] = authored
      }
    }

    // Wait for signal configuration
    if (node.type === 'waitForSignal' && node.data.signalConfig) {
      step.signalConfig = node.data.signalConfig
    }

    // Step activities (for AUTOMATED steps)
    if (node.type === 'automated' && node.data.activities) {
      step.activities = node.data.activities
    }

    // Invoke-agent step → AUTOMATED step carrying the INVOKE_AGENT activity plus
    // a signalConfig so the engine can park-and-resume the human path. The
    // stepType is already AUTOMATED via mapNodeTypeToStepType.
    if (node.type === 'invokeAgent') {
      if (node.data.activities) {
        step.activities = node.data.activities
      }
      if (node.data.signalConfig) {
        step.signalConfig = node.data.signalConfig
      }
    }

    // Pre-conditions (for START steps)
    if (node.type === 'start' && (node.data as any).preConditions && (node.data as any).preConditions.length > 0) {
      step.preConditions = (node.data as any).preConditions
    }

    // Error directive (spec 5.9). Absent stays absent so definitions that never
    // opened the picker save byte-identically.
    if ((node.data as any).errorDirective) {
      step.errorDirective = (node.data as any).errorDirective
    }

    // Editor-owned step metadata. `unmappedConfig` is config a step-type
    // conversion could not map onto the new type (spec 4.5) — it is carried
    // through save/load verbatim so nothing an author configured is ever lost.
    const stepMetadata: Record<string, unknown> = {
      ...((node.data as any).stepMetadata && typeof (node.data as any).stepMetadata === 'object'
        ? (node.data as any).stepMetadata as Record<string, unknown>
        : {}),
    }
    const unmappedConfig = (node.data as any).unmappedConfig
    if (unmappedConfig && typeof unmappedConfig === 'object' && Object.keys(unmappedConfig).length > 0) {
      stepMetadata.unmappedConfig = unmappedConfig
    } else {
      delete stepMetadata.unmappedConfig
    }
    if (Object.keys(stepMetadata).length > 0) {
      step.metadata = stepMetadata
    }

    // Store position for visual editor
    if (options.includePositions && node.position) {
      step._editorPosition = {
        x: node.position.x,
        y: node.position.y,
      }
    }

    return step
  })

  // Extract transitions from edges. Drag-authored data-mapping edges are NOT
  // transitions — their binding lives in the target step's config.inputMapping —
  // and compensation ghosts (spec 4.4) are a rendering of existing routes, not
  // routes of their own, so both are excluded here.
  const transitions = edges
    .filter((edge) => !isDataMappingEdge(edge)
      && !isCompensationGhostEdge(edge)
      && !isTriggerEdge(edge)
      && !annotationIds.has(edge.source)
      && !annotationIds.has(edge.target))
    .map((edge) => {
    const edgeData = edge.data as any
    const transition: any = {
      transitionId: edge.id,
      fromStepId: edge.source,
      toStepId: edge.target,
      trigger: edgeData?.trigger || 'auto',
    }

    // Add transition name if present
    if (edgeData?.transitionName) {
      transition.transitionName = edgeData.transitionName
    }

    // Add priority if present (default 0)
    if (edgeData?.priority !== undefined) {
      transition.priority = edgeData.priority
    }

    // Route kind marker (spec 5.9 error routes, and every kind registered
    // beside them in lib/route-kinds.ts). Only non-normal kinds are persisted;
    // normal routes stay exactly as they were serialized before.
    const routeKind = resolveEdgeRouteKind(edgeData?.kind, edge.sourceHandle)
    if (routeKind) {
      transition.kind = routeKind.kind
      Object.assign(transition, routeKind.discriminatorFields(edge))
    }

    // Add continueOnActivityFailure if present (default false)
    if (edgeData?.continueOnActivityFailure !== undefined) {
      transition.continueOnActivityFailure = edgeData.continueOnActivityFailure
    }

    // Add conditions if present
    if (edgeData?.preConditions && edgeData.preConditions.length > 0) {
      transition.preConditions = edgeData.preConditions
    }

    if (edgeData?.postConditions && edgeData.postConditions.length > 0) {
      transition.postConditions = edgeData.postConditions
    }

    // Inline condition expression (business_rules language). Branching routes
    // authored on IF_ELSE / SWITCH nodes are plain conditioned transitions.
    if (edgeData?.condition !== undefined && edgeData.condition !== null) {
      transition.condition = edgeData.condition
    }

    // Add activities if present in edge data
    if (edgeData?.activities && edgeData.activities.length > 0) {
      transition.activities = edgeData.activities.map((activity: any) => ({
        activityId: activity.activityId,
        activityName: activity.activityName,
        activityType: activity.activityType,
        config: activity.config || {},
        // Include all optional fields
        ...(activity.async !== undefined && { async: activity.async }),
        ...(activity.timeout && { timeout: activity.timeout }),
        ...(activity.retryPolicy && { retryPolicy: activity.retryPolicy }),
        ...(activity.compensate !== undefined && { compensate: activity.compensate }),
      // Saga compensation (`compensation.activityId`) is what the canvas'
      // compensation ghosts render and what `lib/compensation-handler.ts`
      // executes on failure — it MUST survive the editor round trip.
      ...(activity.compensation && { compensation: activity.compensation }),
      }))
    } else if (!transition.kind) {
      // Check if source node is automated and has activity data
      // If so, place the activity in this transition. A non-normal route never
      // inherits the source step's activity — it is the recovery path, and
      // re-running the activity that just failed (or that the run never got
      // past) is exactly wrong.
      const sourceNode = nodes.find(n => n.id === edge.source)
      if (sourceNode && sourceNode.type === 'automated' && sourceNode.data) {
        if (sourceNode.data.activityType || sourceNode.data.activityId) {
          const activity: any = {
            activityId: sourceNode.data.activityId || `activity_${sourceNode.id}`,
            activityName: sourceNode.data.activityName || sourceNode.data.label || 'Automated Activity',
            activityType: sourceNode.data.activityType || 'CALL_API',
            config: sourceNode.data.activityConfig || {},
          }
          // Include optional activity fields from node data
          if ((sourceNode.data as any).activityAsync !== undefined) {
            activity.async = (sourceNode.data as any).activityAsync
          }
          if ((sourceNode.data as any).activityTimeout) {
            activity.timeout = (sourceNode.data as any).activityTimeout
          }
          if ((sourceNode.data as any).activityRetryPolicy) {
            activity.retryPolicy = (sourceNode.data as any).activityRetryPolicy
          }
          if ((sourceNode.data as any).activityCompensate !== undefined) {
            activity.compensate = (sourceNode.data as any).activityCompensate
          }
          transition.activities = [activity]
        }
      }
    }

    // Add label if present (legacy field, transitionName is preferred)
    if (edgeData?.label && !transition.transitionName) {
      transition.transitionName = edgeData.label
    }

    return transition
  })

  return {
    steps,
    transitions,
    activities: [], // Global activities can be added later
  }
}

/**
 * Convert workflow definition JSON to ReactFlow graph (nodes + edges)
 */
export function definitionToGraph(
  definition: WorkflowDefinition['definition'],
  options: DefinitionToGraphOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  const { autoLayout = true, layoutSpacing = { vertical: 200, horizontal: 300 }, childContracts } = options

  // Build step map for quick lookup
  const stepMap = new Map(definition.steps.map(step => [step.stepId, step]))

  // Collect author-arranged positions persisted in the definition. A stored
  // position always wins over an auto-computed one, so a saved graph re-opens
  // exactly as the author left it.
  const storedPositions = new Map<string, { x: number; y: number }>()
  for (const step of definition.steps) {
    const stored = (step as any)._editorPosition
    if (stored && typeof stored.x === 'number' && typeof stored.y === 'number') {
      storedPositions.set(step.stepId, { x: stored.x, y: stored.y })
    }
  }

  // Auto-arrange only the steps that lack a stored position (e.g. freshly added
  // nodes, or legacy/code graphs with no stored coordinates at all). When the
  // caller explicitly disables autoLayout, skip dagre entirely.
  const needsDagre = autoLayout && definition.steps.some((step) => !storedPositions.has(step.stepId))
  const dagrePositions = needsDagre
    ? layoutWithDagre(definition.steps, definition.transitions, {
        direction: 'LR',
        nodeWidth: NODE_MIN_WIDTH,
        nodeHeight: NODE_HEIGHT,
      })
    : null

  // Convert steps to nodes
  const nodes: Node[] = definition.steps.map((step, index) => {
    // Determine position: stored (author-arranged) → dagre (auto) → fallback.
    const position = storedPositions.get(step.stepId)
      || dagrePositions?.get(step.stepId)
      || { x: 250, y: 50 + index * layoutSpacing.vertical }

    // Map step type to node type. An AUTOMATED step whose activities contain a
    // single INVOKE_AGENT marker is the compiled form of an invoke-agent node —
    // round-trip it back to that node type so the dedicated editor/UI is used.
    const invokeAgentActivity = (step.stepType === 'AUTOMATED'
      ? ((step as any).activities as any[] | undefined)?.find(
          (activity) => activity?.activityType === 'INVOKE_AGENT',
        )
      : undefined)
    const nodeType = invokeAgentActivity
      ? 'invokeAgent'
      : mapStepTypeToNodeType(step.stepType)

    // Build node data
    const nodeData: any = {
      label: step.stepName,
      description: (step as any).description,
      stepNumber: index > 0 ? index : undefined,
    }

    // Add timeout if present
    if ((step as any).timeout) {
      nodeData.timeout = (step as any).timeout
    }

    // Add retryPolicy if present
    if ((step as any).retryPolicy) {
      nodeData.retryPolicy = (step as any).retryPolicy
    }

    // Add generic config if present
    if ((step as any).config) {
      nodeData.config = (step as any).config
    }

    // Editor-owned step metadata round-trips as-is; the quarantined config a
    // step-type conversion produced is lifted out so the inspector can show it.
    const stepMetadata = (step as any).metadata
    if (stepMetadata && typeof stepMetadata === 'object') {
      nodeData.stepMetadata = stepMetadata
      const unmappedConfig = (stepMetadata as Record<string, unknown>).unmappedConfig
      if (unmappedConfig && typeof unmappedConfig === 'object') {
        nodeData.unmappedConfig = unmappedConfig
      }
    }

    // Add user task data
    if (step.stepType === 'USER_TASK' && step.userTaskConfig) {
      nodeData.assignedTo = step.userTaskConfig.assignedTo
      nodeData.assignedToRoles = step.userTaskConfig.assignedToRoles || []
      nodeData.formKey = step.userTaskConfig.formKey
      nodeData.allowedActions = step.userTaskConfig.allowedActions

      // Store full userTaskConfig for advanced fields
      nodeData.userTaskConfig = step.userTaskConfig

      // Add form schema if present
      if (step.userTaskConfig.formSchema) {
        nodeData.formSchema = step.userTaskConfig.formSchema
      }

      // Add advanced fields if present
      if (step.userTaskConfig.assignmentRule) {
        nodeData.assignmentRule = step.userTaskConfig.assignmentRule
      }

      if (step.userTaskConfig.slaDuration) {
        nodeData.slaDuration = step.userTaskConfig.slaDuration
      }

      if (step.userTaskConfig.escalationRules) {
        nodeData.escalationRules = step.userTaskConfig.escalationRules
      }

      for (const key of USER_TASK_INSPECTOR_KEYS) {
        const persisted = (step.userTaskConfig as Record<string, unknown>)[key]
        if (persisted !== undefined) nodeData[key] = persisted
      }
    }

    // Add wait for signal data
    if (step.stepType === 'WAIT_FOR_SIGNAL' && (step as any).signalConfig) {
      nodeData.signalConfig = (step as any).signalConfig
    }

    // Add sub-workflow port contract so the node renders the child's IN/OUT
    // ports without opening it. Resolved from the supplied childContracts map.
    if (step.stepType === 'SUB_WORKFLOW') {
      const subWorkflowId = (step as any).config?.subWorkflowId
      const contract = subWorkflowId ? childContracts?.get(subWorkflowId) : undefined
      if (contract?.inputs?.length) nodeData.inputs = contract.inputs
      if (contract?.outputs?.length) nodeData.outputs = contract.outputs
      // Display-only mirror of config.subWorkflowId/version, so the node renders
      // "Invokes: <id>" without re-reading config. The runtime + editor dialog
      // keep config.subWorkflowId/version as the source of truth.
      if ((step as any).config) {
        nodeData.subWorkflowId = (step as any).config.subWorkflowId
        if ((step as any).config.version != null) {
          nodeData.version = (step as any).config.version
        }
      }
    }

    // Add step activities data (for AUTOMATED steps)
    if (step.stepType === 'AUTOMATED' && (step as any).activities) {
      nodeData.activities = (step as any).activities
    }

    // Add invoke-agent data (compiled AUTOMATED step). Carry the signalConfig and
    // a display-only agentId so the node renders without re-parsing activities.
    if (invokeAgentActivity) {
      if ((step as any).signalConfig) {
        nodeData.signalConfig = (step as any).signalConfig
      }
      nodeData.agentId = invokeAgentActivity.config?.agentId
    }

    // Add pre-conditions data (for START steps)
    if (step.stepType === 'START' && (step as any).preConditions) {
      nodeData.preConditions = (step as any).preConditions
    }

    // Error directive (spec 5.9)
    if ((step as any).errorDirective) {
      nodeData.errorDirective = (step as any).errorDirective
    }

    // Set badge based on type
    nodeData.badge = getBadgeForNodeType(nodeType)

    // Default status is pending
    nodeData.status = 'pending'

    return {
      id: step.stepId,
      type: nodeType,
      position,
      data: nodeData,
    }
  })

  const decisionTransitionIdsByStep = new Map<string, Set<string>>()
  for (const step of definition.steps) {
    if (step.stepType !== 'USER_TASK') continue
    const transitionIds = (step.userTaskConfig?.decisions ?? [])
      .map((decision: { transitionId?: unknown }) => decision.transitionId)
      .filter(
        (transitionId: unknown): transitionId is string =>
          typeof transitionId === 'string',
      )
    if (transitionIds.length > 0) {
      decisionTransitionIdsByStep.set(step.stepId, new Set(transitionIds))
    }
  }

  // Convert transitions to edges
  const edges: Edge[] = definition.transitions.map((transition) => {
    const routeTransition: RouteKindTransitionLike = transition
    const routeKind = findRouteKindDescriptor(routeTransition.kind)
    const decisionSourceHandle = decisionTransitionIdsByStep
      .get(transition.fromStepId)
      ?.has(transition.transitionId)
      ? transition.transitionId
      : undefined
    return {
      id: transition.transitionId,
      source: transition.fromStepId,
      target: transition.toStepId,
      type: 'workflowTransition',
      // A kinded route re-attaches to its own output handle so the canvas
      // renders it leaving the same port the author drew it from.
      ...(routeKind
        ? { sourceHandle: routeKind.resolveSourceHandle(routeTransition) }
        : decisionSourceHandle
          ? { sourceHandle: decisionSourceHandle }
          : {}),
      data: {
        trigger: transition.trigger,
        ...(routeKind ? { kind: routeKind.kind } : {}),
        ...(routeTransition.outcomeKind ? { outcomeKind: routeTransition.outcomeKind } : {}),
        transitionName: (transition as any).transitionName,
        priority: (transition as any).priority !== undefined ? (transition as any).priority : 0,
        continueOnActivityFailure: (transition as any).continueOnActivityFailure !== undefined
          ? (transition as any).continueOnActivityFailure
          : false,
        preConditions: transition.preConditions || [],
        postConditions: transition.postConditions || [],
        condition: (transition as any).condition,
        activities: transition.activities || [],
        label: (transition as any).transitionName || (transition as any).label, // Backward compat
        state: (transition as any).state || 'pending', // Default edge state
      },
    }
  })

  return { nodes, edges }
}

/**
 * Compute overlap-free, node-size-aware layout positions using `@dagrejs/dagre`.
 *
 * Builds a layered graph (default `rankdir: 'LR'` → left→right flow), runs dagre
 * to rank nodes and minimize edge crossings, then converts dagre's center-origin
 * coordinates to React Flow's top-left origin. Returns a `Map` of `stepId` →
 * top-left `{ x, y }`, the same shape the previous custom layout produced.
 *
 * Only control-flow transitions are passed here — drag-authored data mappings
 * are not transitions (they live in the target step's `config.inputMapping`).
 */
/**
 * Approximate a node card's rendered footprint when its true measured size is
 * not yet known (initial open, before React Flow measures the DOM). Cards are
 * `w-fit` between `NODE_MIN_WIDTH` and `NODE_MAX_WIDTH` (see lib/node-geometry); their
 * width is driven mostly by the two-line `line-clamp-2` description, which pushes
 * almost any described node to the max width. So a node WITH a description is
 * estimated at the cap (and taller for the extra line); a bare-title node sizes
 * to its title. Underestimating here is what makes ranks overlap, so this errs
 * toward the real (larger) footprint. The Auto-arrange path uses exact measured
 * sizes instead and does not rely on this.
 */
function estimateNodeSize(
  label: unknown,
  hasDescription: boolean,
  isTerminal: boolean,
  outcomeRowCount = 0,
): { width: number; height: number } {
  const text = typeof label === 'string' ? label.trim() : ''
  const titleWidth = Math.round(text.length * 7) + 64
  // Terminals are auto-width pills carrying only an icon and a name: no
  // description row, no minimum card width.
  if (isTerminal) {
    return {
      width: Math.min(Math.max(TERMINAL_NODE_MIN_WIDTH, titleWidth), NODE_MAX_WIDTH),
      height: TERMINAL_NODE_HEIGHT,
    }
  }
  const width = hasDescription
    ? NODE_MAX_WIDTH
    : Math.min(Math.max(NODE_MIN_WIDTH, titleWidth), NODE_MAX_WIDTH)
  const bodyHeight = hasDescription ? NODE_HEIGHT + NODE_DESCRIPTION_HEIGHT : NODE_HEIGHT
  const footerHeight =
    outcomeRowCount > 0
      ? NODE_OUTCOME_FOOTER_CHROME_HEIGHT + outcomeRowCount * NODE_OUTCOME_ROW_HEIGHT
      : 0
  return { width, height: bodyHeight + footerHeight }
}

/**
 * START / END, in either vocabulary: `definitionToGraph` lays out definition
 * steps (which carry `stepType`), `applyAutoLayout` lays out React Flow nodes
 * (which carry the editor `nodeType`).
 */
interface NodeFootprintLike {
  width?: unknown
  height?: unknown
  description?: unknown
  stepName?: unknown
  label?: unknown
  stepType?: unknown
  nodeType?: unknown
  stepId?: unknown
  userTaskConfig?: { decisions?: unknown }
  decisions?: unknown
  activities?: unknown
}

interface OutcomeLayoutTransitionLike {
  fromStepId?: unknown
  kind?: unknown
  outcomeKind?: unknown
}

function isTerminalStep(step: NodeFootprintLike): boolean {
  return step.stepType === 'START'
    || step.stepType === 'END'
    || step.nodeType === 'start'
    || step.nodeType === 'end'
}

/**
 * Footprint dagre reserves for a node: its exact measured size when React Flow
 * has already laid it out (the Auto-arrange path passes `node.measured`),
 * otherwise the description-aware estimate above. Exported so a layout test can
 * assert that the boxes dagre reserved actually do not overlap.
 */
export function nodeFootprint(
  step: NodeFootprintLike,
  outcomeRowCount = 0,
): { width: number; height: number } {
  if (typeof step.width === 'number' && typeof step.height === 'number') {
    return { width: step.width, height: step.height }
  }
  const description = step.description
  const hasDescription = typeof description === 'string' && description.trim().length > 0
  return estimateNodeSize(
    step.stepName ?? step.label,
    hasDescription,
    isTerminalStep(step),
    outcomeRowCount,
  )
}

/**
 * How many outcome rows a step's footer renders (fidelity gap #4). An agent step
 * shows its WIRED outcomes plus `approved`; a user task shows one row per
 * authored decision. Both are derived here rather than measured, because dagre
 * runs before React Flow has laid a single card out.
 *
 * A footer that renders at all also carries the step's DEFAULT route as its last
 * row, which is why a non-empty count gets one more: under-estimating here is
 * exactly what makes dagre pack ranks into each other.
 */
function countOutcomeRows(
  step: NodeFootprintLike,
  transitions: OutcomeLayoutTransitionLike[],
): number {
  const rows = countAuthoredOutcomeRows(step, transitions)
  return rows > 0 ? rows + 1 : 0
}

function countAuthoredOutcomeRows(
  step: NodeFootprintLike,
  transitions: OutcomeLayoutTransitionLike[],
): number {
  const decisions = step?.userTaskConfig?.decisions ?? step?.decisions
  if (Array.isArray(decisions)) {
    return decisions.filter(
      (decision) =>
        typeof decision === 'object'
        && decision !== null
        && typeof (decision as { transitionId?: unknown }).transitionId === 'string',
    ).length
  }
  if (!isInvokeAgentStep(step)) return 0
  const wired = new Set<string>()
  for (const transition of transitions) {
    if (transition?.fromStepId !== step.stepId) continue
    if (transition?.kind !== 'outcome') continue
    if (typeof transition.outcomeKind === 'string') wired.add(transition.outcomeKind)
  }
  wired.add('approved')
  return wired.size
}

function isInvokeAgentStep(step: NodeFootprintLike): boolean {
  if (step?.nodeType === 'invokeAgent') return true
  const activities = step?.activities
  return Array.isArray(activities)
    && activities.some(
      (activity) =>
        typeof activity === 'object'
        && activity !== null
        && (activity as { activityType?: unknown }).activityType === 'INVOKE_AGENT',
    )
}

function layoutWithDagre(
  steps: any[],
  transitions: any[],
  options: LayoutWithDagreOptions = {}
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()

  if (steps.length === 0) return positions

  const rankdir = options.direction ?? 'LR'

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir, nodesep: 60, ranksep: 80 })

  // Reserve each node's real footprint (measured when available, else a
  // description-aware estimate). `ranksep`/`nodesep` then become the actual
  // visible gap between cards, so the spacing is neither cramped nor blown apart.
  for (const step of steps) {
    graph.setNode(step.stepId, nodeFootprint(step, countOutcomeRows(step, transitions)))
  }

  // Transition labels are hover-only (WorkflowTransitionEdge), so they occupy no
  // persistent canvas space — the layout no longer reserves a label pill between
  // ranks, keeping nodes tight against `ranksep` instead of pushing them apart by
  // the (previously up to 220px wide) label footprint.
  for (const transition of transitions) {
    if (graph.hasNode(transition.fromStepId) && graph.hasNode(transition.toStepId)) {
      graph.setEdge(transition.fromStepId, transition.toStepId, {})
    }
  }

  dagre.layout(graph)

  for (const step of steps) {
    const node = graph.node(step.stepId)
    if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') continue
    // dagre returns the node center; React Flow positions use the top-left corner.
    // Offset by this node's own footprint (set above), not a shared constant.
    positions.set(step.stepId, {
      x: node.x - node.width / 2,
      y: node.y - node.height / 2,
    })
  }

  return positions
}

/** Gap between the main flow and the return lane a loop node is dropped into. */
export const RETURN_LANE_GAP = 64

/**
 * Drop dedicated return nodes into a lane BELOW the main flow (issue: loop route
 * lines cross-cutting the cards).
 *
 * dagre lays out LR and ranks a loop node (e.g. a retry `WAIT_FOR_TIMER`) to the
 * RIGHT of the step it routes back to, so its back-edge curves across the row and
 * reads as spaghetti. This post-pass finds a node whose ONLY outgoing edge is a
 * back-edge (its target sits left of it) — i.e. a node that exists purely to
 * route back — and lowers it beneath every card its return arc spans, keeping its
 * x. The forward edge then drops down to it and the return edge rises back up as
 * one clean arc under the row.
 *
 * Guards keep it conservative: only single-out-edge return nodes move, so a
 * genuine business loop through a multi-branch step is left to dagre. PURE.
 */
export function liftReturnNodesBelow(
  positions: Map<string, { x: number; y: number }>,
  sizeById: Map<string, { width: number; height: number }>,
  transitions: { fromStepId: string; toStepId: string }[],
  gap: number = RETURN_LANE_GAP,
): Map<string, { x: number; y: number }> {
  const outDegree = new Map<string, number>()
  for (const transition of transitions) {
    outDegree.set(transition.fromStepId, (outDegree.get(transition.fromStepId) ?? 0) + 1)
  }

  const widthOf = (id: string) => sizeById.get(id)?.width ?? NODE_MIN_WIDTH
  const heightOf = (id: string) => sizeById.get(id)?.height ?? NODE_HEIGHT

  const result = new Map(positions)
  for (const transition of transitions) {
    const from = result.get(transition.fromStepId)
    const to = result.get(transition.toStepId)
    if (!from || !to) continue
    // A back-edge in an LR layout: the target sits left of the source.
    if (to.x >= from.x) continue
    // Only a DEDICATED return node moves — one whose sole job is to route back.
    if ((outDegree.get(transition.fromStepId) ?? 0) !== 1) continue

    const spanLeft = to.x
    const spanRight = from.x + widthOf(transition.fromStepId)
    let laneTop = Number.NEGATIVE_INFINITY
    for (const [id, pos] of result) {
      if (id === transition.fromStepId) continue
      const nodeRight = pos.x + widthOf(id)
      if (nodeRight < spanLeft || pos.x > spanRight) continue // no horizontal overlap
      laneTop = Math.max(laneTop, pos.y + heightOf(id))
    }
    if (laneTop === Number.NEGATIVE_INFINITY) continue
    result.set(transition.fromStepId, { x: from.x, y: Math.round(laneTop + gap) })
  }
  return result
}

/**
 * Re-run the dagre layered layout (`rankdir: 'LR'`) directly over React Flow
 * nodes + edges and return a NEW node array with refreshed `position` values.
 *
 * This is the single intentional full re-layout entry point (the "Auto-arrange"
 * toolbar action): it deliberately IGNORES any stored `_editorPosition` and
 * re-tidies the whole graph. Every other node field (`data`, `type`, handle
 * config, …) is preserved — only `position` is replaced. Data-mapping edges are
 * excluded from the rank graph since they are not control-flow transitions.
 */
export function applyAutoLayout(nodes: Node[], edges: Edge[]): Node[] {
  // Use each node's exact measured footprint so dagre reserves the real on-screen
  // size; React Flow has already measured the cards by the time the user clicks
  // Auto-arrange. Fall back to the estimate only for any not-yet-measured node.
  // Annotations are not ranked: dagre only knows about the control-flow graph,
  // so a note or group placed deliberately beside a step keeps the position its
  // author gave it while Tidy re-lays the steps around it.
  // The trigger pill is excluded for the same reason a note is, only harder: it
  // has no rank at all. It is positioned relative to the START terminal it
  // annotates, so ranking it would move it out from under its own anchor.
  const steps = nodes
    .filter((node) => !isAnnotationNode(node) && !isTriggerNode(node))
    .map((node) => ({
      stepId: node.id,
      stepName: (node.data as any)?.label,
      nodeType: node.type,
      description: (node.data as any)?.description,
      width: node.measured?.width,
      height: node.measured?.height,
    }))
  const transitions = edges
    .filter((edge) => !isDataMappingEdge(edge))
    .map((edge) => ({
      fromStepId: edge.source,
      toStepId: edge.target,
    }))

  const positions = layoutWithDagre(steps, transitions, {
    direction: 'LR',
    nodeWidth: NODE_MIN_WIDTH,
    nodeHeight: NODE_HEIGHT,
  })

  // Post-pass: lower dedicated return nodes (retry timers, loop-back waits) into
  // a lane below the row so their return arc reads cleanly instead of cutting
  // across the cards.
  const sizeById = new Map<string, { width: number; height: number }>(
    steps.map((step) => [
      step.stepId as string,
      { width: step.width ?? NODE_MIN_WIDTH, height: step.height ?? NODE_HEIGHT },
    ]),
  )
  const laidOut = liftReturnNodesBelow(positions, sizeById, transitions)

  return nodes.map((node) => {
    const next = laidOut.get(node.id)
    return next ? { ...node, position: { x: next.x, y: next.y } } : node
  })
}

/**
 * Map node type to step type (for graph → definition)
 */
function mapNodeTypeToStepType(nodeType: string): string {
  const mapping: Record<string, string> = {
    start: 'START',
    end: 'END',
    userTask: 'USER_TASK',
    automated: 'AUTOMATED',
    subWorkflow: 'SUB_WORKFLOW',
    decision: 'DECISION',
    waitForSignal: 'WAIT_FOR_SIGNAL',
    waitForTimer: 'WAIT_FOR_TIMER',
    waitForCondition: 'WAIT_FOR_CONDITION',
    parallelFork: 'PARALLEL_FORK',
    parallelJoin: 'PARALLEL_JOIN',
    // The invoke-agent node is a specialization of an AUTOMATED step.
    invokeAgent: 'AUTOMATED',
    ifElse: 'IF_ELSE',
    switch: 'SWITCH',
  }
  return mapping[nodeType] || 'AUTOMATED'
}

/**
 * Map step type to node type (for definition → graph)
 */
function mapStepTypeToNodeType(stepType: string): string {
  const mapping: Record<string, string> = {
    START: 'start',
    END: 'end',
    USER_TASK: 'userTask',
    AUTOMATED: 'automated',
    SUB_WORKFLOW: 'subWorkflow',
    DECISION: 'decision',
    WAIT_FOR_SIGNAL: 'waitForSignal',
    WAIT_FOR_TIMER: 'waitForTimer',
    WAIT_FOR_CONDITION: 'waitForCondition',
    PARALLEL_FORK: 'parallelFork',
    PARALLEL_JOIN: 'parallelJoin',
    IF_ELSE: 'ifElse',
    SWITCH: 'switch',
  }
  return mapping[stepType] || 'automated'
}

/**
 * Get badge text for node type
 */
export function getBadgeForNodeType(nodeType: string): string {
  const badges: Record<string, string> = {
    start: 'Start',
    end: 'End',
    userTask: 'User Task',
    automated: 'Automated',
    decision: 'Decision',
    subWorkflow: 'Sub-Workflow',
    waitForSignal: 'Wait for Signal',
    waitForTimer: 'Wait for Timer',
    waitForCondition: 'Wait for Condition',
    parallelFork: 'Parallel Fork',
    parallelJoin: 'Parallel Join',
    invokeAgent: 'Invoke Agent',
    ifElse: 'If / Else',
    switch: 'Switch',
  }
  return badges[nodeType] || 'Task'
}

/**
 * Validate workflow graph
 */
export interface ValidationError {
  type: 'error' | 'warning'
  message: string
  nodeId?: string
  edgeId?: string
}

export function validateWorkflowGraph(allNodes: Node[], edges: Edge[]): ValidationError[] {
  const errors: ValidationError[] = []

  // Annotations are documentation, not steps: a sticky note has no routes by
  // design and must never be reported as a disconnected node. The trigger pill
  // is skipped for a stronger reason: it is not a step, so counting it would
  // corrupt the exactly-one-START / at-least-one-END invariants this function
  // exists to enforce.
  const nodes = allNodes.filter((node) => !isAnnotationNode(node) && !isTriggerNode(node))

  // Check for at least one start node
  const startNodes = nodes.filter((n) => n.type === 'start')
  if (startNodes.length === 0) {
    errors.push({
      type: 'error',
      message: 'Workflow must have at least one START node',
    })
  }
  if (startNodes.length > 1) {
    errors.push({
      type: 'warning',
      message: 'Workflow has multiple START nodes',
    })
  }

  // Check for at least one end node
  const endNodes = nodes.filter((n) => n.type === 'end')
  if (endNodes.length === 0) {
    errors.push({
      type: 'error',
      message: 'Workflow must have at least one END node',
    })
  }

  // Check for orphan nodes (no incoming or outgoing edges)
  for (const node of nodes) {
    if (node.type === 'start') continue // Start nodes don't need incoming edges
    if (node.type === 'end') continue // End nodes don't need outgoing edges

    const hasIncoming = edges.some((e) => e.target === node.id)
    const hasOutgoing = edges.some((e) => e.source === node.id)

    if (!hasIncoming && !hasOutgoing) {
      errors.push({
        type: 'error',
        message: `Node "${node.data.label}" is disconnected`,
        nodeId: node.id,
      })
    } else if (!hasIncoming) {
      errors.push({
        type: 'warning',
        message: `Node "${node.data.label}" has no incoming connections`,
        nodeId: node.id,
      })
    } else if (!hasOutgoing) {
      errors.push({
        type: 'warning',
        message: `Node "${node.data.label}" has no outgoing connections`,
        nodeId: node.id,
      })
    }
  }

  // Check for cycles (simple detection)
  const hasCycle = detectCycle(nodes, edges)
  if (hasCycle) {
    errors.push({
      type: 'warning',
      message: 'Workflow contains cycles (loops)',
    })
  }

  // Check for duplicate step IDs
  const stepIds = new Set<string>()
  for (const node of nodes) {
    if (stepIds.has(node.id)) {
      errors.push({
        type: 'error',
        message: `Duplicate step ID: ${node.id}`,
        nodeId: node.id,
      })
    }
    stepIds.add(node.id)
  }

  return errors
}

/**
 * Simple cycle detection using DFS
 */
function detectCycle(nodes: Node[], edges: Edge[]): boolean {
  const adjList = new Map<string, string[]>()

  // Build adjacency list
  for (const node of nodes) {
    adjList.set(node.id, [])
  }
  for (const edge of edges) {
    const neighbors = adjList.get(edge.source) || []
    neighbors.push(edge.target)
    adjList.set(edge.source, neighbors)
  }

  const visited = new Set<string>()
  const recStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    recStack.add(nodeId)

    const neighbors = adjList.get(nodeId) || []
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true
      } else if (recStack.has(neighbor)) {
        return true // Cycle detected
      }
    }

    recStack.delete(nodeId)
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true
    }
  }

  return false
}

/**
 * Sanitize ID to match schema regex: /^[a-z0-9_-]+$/
 * Converts to lowercase, replaces invalid characters with underscores
 */
export function sanitizeId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .replace(/(?:^_|_$)/g, '') // Remove leading/trailing underscores
}

/**
 * Validate ID matches schema regex: /^[a-z0-9_-]+$/
 */
export function validateId(id: string): boolean {
  return /^[a-z0-9_-]+$/.test(id)
}

/**
 * Generate unique step ID
 */
export function generateStepId(prefix: string = 'step'): string {
  const id = `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  return sanitizeId(id)
}

/** Prefix marking a durable, opaque transition id. */
export const DURABLE_TRANSITION_ID_PREFIX = 't_'

const LEGACY_TRANSITION_ID_PATTERN = /^e_/

/**
 * Generate a durable, opaque transition ID.
 *
 * Endpoint-derived ids (`e_<from>_<to>`) tie a route's identity to the pair of
 * steps it happens to connect today, so re-pointing an edge would silently
 * change the id that mid-flight state resolves against
 * (`instance.pendingTransition`, `WorkflowBranchInstance.branchKey`). Opaque ids
 * keep route identity stable across reattachment and let two routes share the
 * same endpoints (a normal route and an error route, for example).
 *
 * Legacy endpoint-derived ids stay fully valid: stored definitions, seeded
 * examples and gallery templates keep their ids on load and save, and the
 * engine treats every transition id as an opaque string.
 *
 * The endpoint parameters are accepted for signature compatibility with callers
 * written against the endpoint-derived form; they no longer affect the result.
 */
export function generateTransitionId(_fromStepId?: string, _toStepId?: string): string {
  const id = `${DURABLE_TRANSITION_ID_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
  return sanitizeId(id)
}

/** True when the id uses the legacy endpoint-derived (`e_<from>_<to>`) shape. */
export function isLegacyTransitionId(transitionId: string): boolean {
  return LEGACY_TRANSITION_ID_PATTERN.test(transitionId)
}

/**
 * Append a new edge to the list, skipping duplicate connections.
 *
 * A plain-data replacement for React Flow's `addEdge` so the visual editor
 * page does not pull the `@xyflow/react` runtime out of its lazy boundary
 * (#3169). Mirrors `addEdge`'s dedup rule: an edge is dropped when one with
 * the same source/target endpoints (and handles) already exists.
 */
export function appendWorkflowEdge(edges: Edge[], edge: Edge): Edge[] {
  const isDuplicate = edges.some(
    (existing) =>
      existing.source === edge.source &&
      existing.target === edge.target &&
      // Match addEdge: empty-string and nullish handles are equivalent.
      (existing.sourceHandle || null) === (edge.sourceHandle || null) &&
      (existing.targetHandle || null) === (edge.targetHandle || null),
  )
  return isDuplicate ? edges : [...edges, edge]
}
