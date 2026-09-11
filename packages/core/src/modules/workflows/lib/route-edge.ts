/**
 * Workflows Module - Route edge construction (pure)
 *
 * The ONE place a control-flow route becomes a React Flow edge.
 *
 * A route the author has just drawn and the same route re-read from a saved
 * definition are the same thing and must render identically. They did not:
 * `definitionToGraph` typed every stored transition `workflowTransition` — the
 * module's own bezier renderer — while the Studio's `handleConnect` and the
 * insert-on-route splice typed a newly authored NORMAL route `smoothstep`,
 * React Flow's built-in orthogonal renderer. ReactFlow merges
 * `defaultEdgeOptions` UNDER each edge (`{ ...defaultEdgeOptions, ...edge }`),
 * so the canvas default could not correct an explicit type, and a freshly drawn
 * route rendered as a right-angled staircase that only became a curve after a
 * save and a reload. The duplicated construction WAS the defect, so both paths
 * build their edge here.
 *
 * Render-time only: nothing here reaches `graphToDefinition`, which reads
 * endpoints, handles and `data` — an edge's `type` is how a route is drawn, not
 * what is stored.
 *
 * PURE — plain graph data in, plain graph data out. The `Edge` import is
 * type-only, so the visual-editor page keeps its lazy `@xyflow/react` boundary
 * (#3169).
 */

import type { Edge } from '@xyflow/react'

/**
 * React Flow edge type registered for `WorkflowTransitionEdge` in
 * `WorkflowGraphImpl`'s `edgeTypes` (and its `defaultEdgeOptions`). Every
 * control-flow route — kinded or not, drawn or loaded — renders through it.
 */
export const WORKFLOW_TRANSITION_EDGE_TYPE = 'workflowTransition'

export interface WorkflowRouteEdgeInput {
  id: string
  source: string
  target: string
  /** Omitted entirely when absent, so a route without one keeps today's shape. */
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: Record<string, unknown>
}

/** Build the React Flow edge for one control-flow route. */
export function buildWorkflowRouteEdge(input: WorkflowRouteEdgeInput): Edge {
  return {
    id: input.id,
    source: input.source,
    target: input.target,
    type: WORKFLOW_TRANSITION_EDGE_TYPE,
    ...(input.sourceHandle ? { sourceHandle: input.sourceHandle } : {}),
    ...(input.targetHandle ? { targetHandle: input.targetHandle } : {}),
    data: input.data ?? {},
  }
}
