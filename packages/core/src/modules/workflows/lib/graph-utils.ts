import { Node, Edge } from '@xyflow/react'
import type { WorkflowDefinition } from '../data/entities'

/**
 * Graph Utilities for Visual Workflow Editor
 *
 * Converts between ReactFlow graph representation and workflow definition JSON
 */

export interface GraphToDefinitionOptions {
  includePositions?: boolean
}

export interface DefinitionToGraphOptions {
  autoLayout?: boolean
  layoutSpacing?: { vertical: number; horizontal: number }
}

/**
 * Convert ReactFlow graph (nodes + edges) to workflow definition JSON
 */
export function graphToDefinition(
  nodes: Node[],
  edges: Edge[],
  options: GraphToDefinitionOptions = {}
): WorkflowDefinition['definition'] {
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
    }

    // Wait for signal configuration
    if (node.type === 'waitForSignal' && node.data.signalConfig) {
      step.signalConfig = node.data.signalConfig
    }

    // Step activities (for AUTOMATED steps)
    if (node.type === 'automated' && node.data.activities) {
      step.activities = node.data.activities
    }

    // Pre-conditions (for START steps)
    if (node.type === 'start' && (node.data as any).preConditions && (node.data as any).preConditions.length > 0) {
      step.preConditions = (node.data as any).preConditions
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

  // Extract transitions from edges
  const transitions = edges.map((edge) => {
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

    // Add continueOnActivityFailure if present (default true)
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
      }))
    } else {
      // Check if source node is automated and has activity data
      // If so, place the activity in this transition
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
  const { autoLayout = true, layoutSpacing = { vertical: 200, horizontal: 300 } } = options

  // Build step map for quick lookup
  const stepMap = new Map(definition.steps.map(step => [step.stepId, step]))

  // Calculate smart layout positions if autoLayout is enabled
  const positions = autoLayout
    ? calculateSmartLayout(definition.steps, definition.transitions, layoutSpacing)
    : null

  // Convert steps to nodes
  const nodes: Node[] = definition.steps.map((step, index) => {
    // Determine position
    let position = positions?.get(step.stepId) || { x: 250, y: 50 + index * layoutSpacing.vertical }

    // Use stored position if available and not auto-layouting
    if (!autoLayout && (step as any)._editorPosition) {
      position = (step as any)._editorPosition
    }

    // Map step type to node type
    const nodeType = mapStepTypeToNodeType(step.stepType)

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
    }

    // Add wait for signal data
    if (step.stepType === 'WAIT_FOR_SIGNAL' && (step as any).signalConfig) {
      nodeData.signalConfig = (step as any).signalConfig
    }

    // Add step activities data (for AUTOMATED steps)
    if (step.stepType === 'AUTOMATED' && (step as any).activities) {
      nodeData.activities = (step as any).activities
    }

    // Add pre-conditions data (for START steps)
    if (step.stepType === 'START' && (step as any).preConditions) {
      nodeData.preConditions = (step as any).preConditions
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

  // Convert transitions to edges
  const edges: Edge[] = definition.transitions.map((transition) => {
    return {
      id: transition.transitionId,
      source: transition.fromStepId,
      target: transition.toStepId,
      type: 'workflowTransition',
      data: {
        trigger: transition.trigger,
        transitionName: (transition as any).transitionName,
        priority: (transition as any).priority !== undefined ? (transition as any).priority : 0,
        continueOnActivityFailure: (transition as any).continueOnActivityFailure !== undefined
          ? (transition as any).continueOnActivityFailure
          : true,
        preConditions: transition.preConditions || [],
        postConditions: transition.postConditions || [],
        activities: transition.activities || [],
        label: (transition as any).transitionName || (transition as any).label, // Backward compat
        state: (transition as any).state || 'pending', // Default edge state
      },
    }
  })

  return { nodes, edges }
}

/**
 * Calculate smart layout positions for workflow nodes
 * Uses a layered/hierarchical layout algorithm that:
 * 1. Assigns levels (ranks) to nodes based on graph topology
 * 2. Spreads sibling nodes horizontally at the same level
 * 3. Centers merge points below their incoming nodes
 */
function calculateSmartLayout(
  steps: any[],
  transitions: any[],
  spacing: { vertical: number; horizontal: number }
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()

  if (steps.length === 0) return positions

  // Build adjacency lists
  const outgoing = new Map<string, string[]>() // node -> children
  const incoming = new Map<string, string[]>() // node -> parents

  for (const step of steps) {
    outgoing.set(step.stepId, [])
    incoming.set(step.stepId, [])
  }

  for (const t of transitions) {
    const children = outgoing.get(t.fromStepId) || []
    children.push(t.toStepId)
    outgoing.set(t.fromStepId, children)

    const parents = incoming.get(t.toStepId) || []
    parents.push(t.fromStepId)
    incoming.set(t.toStepId, parents)
  }

  // Find start node(s) - nodes with no incoming edges
  const startNodes = steps.filter(s => (incoming.get(s.stepId) || []).length === 0)
  if (startNodes.length === 0) {
    // Fallback: use first step as start
    startNodes.push(steps[0])
  }

  // Assign levels using BFS (longest path from start)
  const levels = new Map<string, number>()
  const queue: Array<{ id: string; level: number }> = []

  for (const start of startNodes) {
    queue.push({ id: start.stepId, level: 0 })
  }

  while (queue.length > 0) {
    const { id, level } = queue.shift()!
    const currentLevel = levels.get(id)

    // Take the maximum level (longest path)
    if (currentLevel === undefined || level > currentLevel) {
      levels.set(id, level)
    }

    const children = outgoing.get(id) || []
    for (const child of children) {
      queue.push({ id: child, level: level + 1 })
    }
  }

  // Group nodes by level
  const nodesByLevel = new Map<number, string[]>()
  for (const [nodeId, level] of levels) {
    const nodesAtLevel = nodesByLevel.get(level) || []
    nodesAtLevel.push(nodeId)
    nodesByLevel.set(level, nodesAtLevel)
  }

  // Calculate positions
  const centerX = 400 // Center line for the graph
  const startY = 50

  for (const [level, nodeIds] of nodesByLevel) {
    const count = nodeIds.length
    const y = startY + level * spacing.vertical

    if (count === 1) {
      // Single node at this level - center it
      positions.set(nodeIds[0], { x: centerX, y })
    } else {
      // Multiple nodes at this level - spread them horizontally
      const totalWidth = (count - 1) * spacing.horizontal
      const startX = centerX - totalWidth / 2

      // Sort nodes by their parent's position for consistent ordering
      nodeIds.sort((a, b) => {
        const parentsA = incoming.get(a) || []
        const parentsB = incoming.get(b) || []
        const parentPosA = parentsA.length > 0 ? (positions.get(parentsA[0])?.x || 0) : 0
        const parentPosB = parentsB.length > 0 ? (positions.get(parentsB[0])?.x || 0) : 0
        return parentPosA - parentPosB
      })

      nodeIds.forEach((nodeId, idx) => {
        positions.set(nodeId, { x: startX + idx * spacing.horizontal, y })
      })
    }
  }

  return positions
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
    decision: 'DECISION',
    waitForSignal: 'WAIT_FOR_SIGNAL',
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
    DECISION: 'decision',
    WAIT_FOR_SIGNAL: 'waitForSignal',
  }
  return mapping[stepType] || 'automated'
}

/**
 * Get badge text for node type
 */
function getBadgeForNodeType(nodeType: string): string {
  const badges: Record<string, string> = {
    start: 'Start',
    end: 'End',
    userTask: 'User Task',
    automated: 'Automated',
    decision: 'Decision',
    waitForSignal: 'Wait for Signal',
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

export function validateWorkflowGraph(nodes: Node[], edges: Edge[]): ValidationError[] {
  const errors: ValidationError[] = []

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
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
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

/**
 * Generate unique transition ID
 */
export function generateTransitionId(fromStepId: string, toStepId: string): string {
  const id = `e_${fromStepId}_${toStepId}`
  return sanitizeId(id)
}
