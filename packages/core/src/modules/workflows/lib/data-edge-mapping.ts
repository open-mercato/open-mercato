/**
 * Workflows Module - Data-edge field mapping
 *
 * Pure helpers that let a SUB_WORKFLOW field mapping be authored by dragging a
 * connection to a child IN port, as an alternative to the key/value form. A
 * data-port connection is persisted as the SAME `config.inputMapping` shape the
 * form writes (`{ childPortKey: parentDotPath }`) and rendered as a distinct
 * "data" edge rather than a control-flow transition.
 *
 * Port handle ids (from the SubWorkflowNode): `in:<key>` (child input target),
 * `out:<key>` (child output source). Control-flow handles keep ids
 * `target` / `source`.
 */

import type { Connection, Edge, Node } from '@xyflow/react'

export const IN_PORT_PREFIX = 'in:'
export const OUT_PORT_PREFIX = 'out:'

/** Edge type used for drag-authored field mappings (not a transition). */
export const DATA_MAPPING_EDGE_TYPE = 'workflowDataMapping'

export type ConnectionClassification =
  | { kind: 'control' }
  | { kind: 'data-mapping'; targetNodeId: string; childPortKey: string; parentPath: string }
  | { kind: 'data-ignored' }

/**
 * Derive the parent-context dot-path a data connection maps from.
 *
 * MVP (per spec D3 — no per-node typed output ports yet): when the source is a
 * child OUT port (`out:<name>`) use that port name; otherwise fall back to the
 * source node id. Either way the value is a plain dot-path the user can refine
 * in the key/value form.
 */
export function deriveParentPath(connection: Connection): string {
  const sourceHandle = connection.sourceHandle || ''
  if (sourceHandle.startsWith(OUT_PORT_PREFIX)) {
    return sourceHandle.slice(OUT_PORT_PREFIX.length)
  }
  return connection.source || ''
}

/**
 * Classify a new connection:
 * - `data-mapping` — the target is a child IN port (`in:<key>`); becomes an
 *   `inputMapping` entry + a data edge, never a transition.
 * - `data-ignored` — dragged from an OUT port but not onto an IN port; there is
 *   no child port to bind, so it is dropped (no bogus transition is created).
 * - `control` — a plain control connection; keeps today's transition behaviour.
 */
export function classifyConnection(connection: Connection): ConnectionClassification {
  const targetHandle = connection.targetHandle || ''
  const sourceHandle = connection.sourceHandle || ''

  if (targetHandle.startsWith(IN_PORT_PREFIX)) {
    return {
      kind: 'data-mapping',
      targetNodeId: connection.target || '',
      childPortKey: targetHandle.slice(IN_PORT_PREFIX.length),
      parentPath: deriveParentPath(connection),
    }
  }

  if (sourceHandle.startsWith(OUT_PORT_PREFIX)) {
    return { kind: 'data-ignored' }
  }

  return { kind: 'control' }
}

/** Stable id for a data edge — one per (target node, child port). */
export function dataMappingEdgeId(targetNodeId: string, childPortKey: string): string {
  return `data:${targetNodeId}:${childPortKey}`
}

/** Build the React Flow edge for a data mapping connection. */
export function buildDataMappingEdge(connection: Connection, childPortKey: string): Edge {
  return {
    id: dataMappingEdgeId(connection.target || '', childPortKey),
    source: connection.source || '',
    target: connection.target || '',
    sourceHandle: connection.sourceHandle || undefined,
    targetHandle: connection.targetHandle || undefined,
    type: DATA_MAPPING_EDGE_TYPE,
  }
}

/**
 * Apply a data mapping to the target node's `config.inputMapping`, returning a
 * new nodes array. The result matches the key/value form's shape exactly
 * (`config.inputMapping[childPortKey] = parentPath`).
 */
export function applyInputMappingToNodes(
  nodes: Node[],
  targetNodeId: string,
  childPortKey: string,
  parentPath: string,
): Node[] {
  return nodes.map((node) => {
    if (node.id !== targetNodeId) return node
    const data = (node.data || {}) as Record<string, any>
    const config = (data.config || {}) as Record<string, any>
    const inputMapping = { ...(config.inputMapping || {}), [childPortKey]: parentPath }
    return { ...node, data: { ...data, config: { ...config, inputMapping } } }
  })
}

/** True when an edge is a drag-authored data mapping (not a transition). */
export function isDataMappingEdge(edge: Pick<Edge, 'type'>): boolean {
  return edge.type === DATA_MAPPING_EDGE_TYPE
}
