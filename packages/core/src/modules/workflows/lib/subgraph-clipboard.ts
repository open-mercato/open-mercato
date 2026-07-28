/**
 * Portable-JSON subgraph clipboard (spec section 4.5).
 *
 * "Multi-select → portable-JSON subgraph on the clipboard; paste re-IDs and
 * splices; works across workflows and into the Code view."
 *
 * The payload speaks the DEFINITION vocabulary (`steps` + `transitions`), not
 * React Flow's nodes and edges: the Code view renders the definition JSON, so a
 * fragment copied from the canvas has to be the same shape a fragment copied out
 * of the Code view is — otherwise the two surfaces could not exchange anything.
 * Positions ride along as `_editorPosition`, exactly as a saved definition
 * carries them.
 *
 * Only transitions INTERNAL to the selection travel. A route with one endpoint
 * outside the selection describes a connection to a step that is not in the
 * payload, so pasting it could only invent a dangling id.
 *
 * PURE: plain data in, plain data out. Clipboard access, translation and flash
 * messages belong to the page.
 */

import type { Node, Edge } from '@xyflow/react'
import type { WorkflowDefinition } from '../data/entities'
import { definitionToGraph, generateStepId, generateTransitionId, graphToDefinition } from './graph-utils'
import { isDataMappingEdge } from './data-edge-mapping'
import { isAnnotationNode } from './editor-annotations'

/** Format discriminator. Written by the canvas and by the Code view alike. */
export const WORKFLOW_SUBGRAPH_CLIPBOARD_KIND = 'open-mercato.workflow-subgraph'

/** Bumped only for a breaking payload change; readers refuse what they do not know. */
export const WORKFLOW_SUBGRAPH_CLIPBOARD_VERSION = 1

/** How far a pasted copy lands from the original, in flow units. */
export const SUBGRAPH_PASTE_OFFSET = { x: 48, y: 48 }

type DefinitionStep = WorkflowDefinition['definition']['steps'][number]
type DefinitionTransition = WorkflowDefinition['definition']['transitions'][number]

export interface WorkflowSubgraphClipboard {
  kind: typeof WORKFLOW_SUBGRAPH_CLIPBOARD_KIND
  version: typeof WORKFLOW_SUBGRAPH_CLIPBOARD_VERSION
  steps: DefinitionStep[]
  transitions: DefinitionTransition[]
}

export type SubgraphClipboardParseFailure =
  | { ok: false; code: 'invalidJson' }
  | { ok: false; code: 'unsupportedFormat' }
  | { ok: false; code: 'empty' }

export type SubgraphClipboardParseResult =
  | { ok: true; payload: WorkflowSubgraphClipboard }
  | SubgraphClipboardParseFailure

export interface SubgraphPasteResult {
  nodes: Node[]
  edges: Edge[]
  /** Ids of the freshly minted steps, so the caller can select what it pasted. */
  pastedNodeIds: string[]
}

/**
 * Serialize the selected steps and the routes strictly between them.
 *
 * Returns `null` when the selection holds no step: a clipboard payload with no
 * steps has nothing to splice, and writing one would silently clear whatever the
 * author copied earlier.
 */
export function serializeWorkflowSubgraph(
  nodes: Node[],
  edges: Edge[],
  selectedNodeIds: string[],
): WorkflowSubgraphClipboard | null {
  const selected = new Set(selectedNodeIds)
  // Annotations never travel on the clipboard: the payload speaks the definition
  // vocabulary, and a note has no definition form to speak.
  const selectedNodes = nodes.filter((node) => selected.has(node.id) && !isAnnotationNode(node))
  if (selectedNodes.length === 0) return null

  const internalEdges = edges.filter(
    (edge) => selected.has(edge.source) && selected.has(edge.target) && !isDataMappingEdge(edge),
  )
  const definition = graphToDefinition(selectedNodes, internalEdges, { includePositions: true })

  return {
    kind: WORKFLOW_SUBGRAPH_CLIPBOARD_KIND,
    version: WORKFLOW_SUBGRAPH_CLIPBOARD_VERSION,
    steps: definition.steps,
    transitions: definition.transitions,
  }
}

export function stringifyWorkflowSubgraph(payload: WorkflowSubgraphClipboard): string {
  return JSON.stringify(payload, null, 2)
}

/** Read a clipboard payload, refusing anything that is not this exact format. */
export function parseWorkflowSubgraph(text: string): SubgraphClipboardParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, code: 'invalidJson' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'unsupportedFormat' }
  }
  const candidate = parsed as Record<string, unknown>
  if (candidate.kind !== WORKFLOW_SUBGRAPH_CLIPBOARD_KIND) {
    return { ok: false, code: 'unsupportedFormat' }
  }
  if (candidate.version !== WORKFLOW_SUBGRAPH_CLIPBOARD_VERSION) {
    return { ok: false, code: 'unsupportedFormat' }
  }
  const steps = candidate.steps
  const transitions = candidate.transitions
  if (!Array.isArray(steps) || !Array.isArray(transitions)) {
    return { ok: false, code: 'unsupportedFormat' }
  }
  if (steps.length === 0) return { ok: false, code: 'empty' }

  return {
    ok: true,
    payload: {
      kind: WORKFLOW_SUBGRAPH_CLIPBOARD_KIND,
      version: WORKFLOW_SUBGRAPH_CLIPBOARD_VERSION,
      steps: steps as DefinitionStep[],
      transitions: transitions as DefinitionTransition[],
    },
  }
}

/**
 * Keep the meaningful part of a generated step id so a paste of `userTask_1753…`
 * stays recognisably a user task instead of turning into `step_…`, without the
 * id growing a suffix on every paste.
 */
function deriveStepIdPrefix(stepId: string): string {
  const withoutGeneratedSuffix = stepId.replace(/_\d{9,}_[a-z0-9]+$/i, '')
  const prefix = withoutGeneratedSuffix.trim()
  return prefix.length > 0 ? prefix : 'step'
}

export interface SubgraphPasteOptions {
  /** Flow-space translation applied to every pasted step. */
  offset?: { x: number; y: number }
}

/**
 * Splice a clipboard payload into the graph.
 *
 * Every step and every transition is re-IDed, so pasting into the workflow the
 * fragment came from can never collide with — or silently merge into — the
 * original. Internal routes are rewired onto the new ids; the copies land offset
 * from the originals so the paste is visible rather than hidden underneath them.
 */
export function pasteWorkflowSubgraph(
  nodes: Node[],
  edges: Edge[],
  payload: WorkflowSubgraphClipboard,
  options: SubgraphPasteOptions = {},
): SubgraphPasteResult {
  const offset = options.offset ?? SUBGRAPH_PASTE_OFFSET
  const existingIds = new Set(nodes.map((node) => node.id))

  const stepIdMap = new Map<string, string>()
  for (const step of payload.steps) {
    let nextId = generateStepId(deriveStepIdPrefix(step.stepId))
    while (existingIds.has(nextId) || stepIdMap.has(nextId)) {
      nextId = generateStepId(deriveStepIdPrefix(step.stepId))
    }
    existingIds.add(nextId)
    stepIdMap.set(step.stepId, nextId)
  }

  const rebasedSteps = payload.steps.map((step) => ({
    ...step,
    stepId: stepIdMap.get(step.stepId) as string,
  }))

  const rebasedTransitions = payload.transitions
    .filter((transition) => stepIdMap.has(transition.fromStepId) && stepIdMap.has(transition.toStepId))
    .map((transition) => ({
      ...transition,
      transitionId: generateTransitionId(),
      fromStepId: stepIdMap.get(transition.fromStepId) as string,
      toStepId: stepIdMap.get(transition.toStepId) as string,
    }))

  const graph = definitionToGraph({
    steps: rebasedSteps,
    transitions: rebasedTransitions,
  } as WorkflowDefinition['definition'])

  const pastedNodes = graph.nodes.map((node) => {
    // The running step number is derived from a node's index in the whole graph,
    // so a fragment's own numbering would be a lie once it is spliced in.
    const data = { ...(node.data as Record<string, unknown>) }
    delete data.stepNumber
    return {
      ...node,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      selected: true,
      data,
    }
  })

  return {
    nodes: [...nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), ...pastedNodes],
    edges: [...edges, ...graph.edges],
    pastedNodeIds: pastedNodes.map((node) => node.id),
  }
}
