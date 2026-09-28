import type { CampaignCanvasLayout, CampaignDefinition, CampaignStep } from '../engine/types.js'
import type { CampaignTriggerInput } from '../../data/validators.js'

/**
 * The canvas is a RENDERING of an ordered step list, not a free graph.
 *
 * A campaign executes as: any one of its triggers starts a run, the audience decides whether
 * the run proceeds, then the steps run in order. There is no branching, so there is nothing
 * for a user-drawn edge to mean. Edges are therefore derived from the data on every render and
 * never persisted, and step order lives in the definition's array — reordering is an explicit
 * action, never a consequence of dragging a node three pixels.
 *
 * That is the whole reason this mapping is lossless: the only thing the graph owns is layout.
 */

export const AUDIENCE_NODE_ID = 'audience'

export type CampaignGraphNode =
  | { id: string; type: 'trigger'; position: { x: number; y: number }; data: { trigger: CampaignTriggerInput } }
  | { id: string; type: 'audience'; position: { x: number; y: number }; data: { audience: CampaignDefinition['audience']; isEveryone: boolean } }
  | { id: string; type: 'step'; position: { x: number; y: number }; data: { step: CampaignStep; index: number } }

export type CampaignGraphEdge = {
  id: string
  source: string
  target: string
}

const TRIGGER_COLUMN_X = 0
const AUDIENCE_COLUMN_X = 320
const STEP_COLUMN_X = 640
const ROW_HEIGHT = 140

/**
 * A node id derived from the trigger's own content.
 *
 * Content-derived rather than a generated key so a saved layout survives a round trip without
 * storing an extra identifier. Editing a trigger's event resets its position, which is correct
 * — it is a different trigger.
 */
export function triggerNodeId(trigger: CampaignTriggerInput): string {
  return trigger.kind === 'event'
    ? `trigger:event:${trigger.eventId}`
    : `trigger:schedule:${trigger.scheduleValue}`
}

function positionFor(
  canvas: CampaignCanvasLayout | undefined,
  nodeId: string,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  return canvas?.nodePositions?.[nodeId] ?? fallback
}

export function definitionToGraph(
  definition: CampaignDefinition,
  triggers: CampaignTriggerInput[],
): { nodes: CampaignGraphNode[]; edges: CampaignGraphEdge[] } {
  const canvas = definition.canvas
  const nodes: CampaignGraphNode[] = []
  const edges: CampaignGraphEdge[] = []

  triggers.forEach((trigger, index) => {
    const id = triggerNodeId(trigger)
    nodes.push({
      id,
      type: 'trigger',
      position: positionFor(canvas, id, { x: TRIGGER_COLUMN_X, y: index * ROW_HEIGHT }),
      data: { trigger },
    })
    edges.push({ id: `edge:${id}->${AUDIENCE_NODE_ID}`, source: id, target: AUDIENCE_NODE_ID })
  })

  nodes.push({
    id: AUDIENCE_NODE_ID,
    type: 'audience',
    position: positionFor(canvas, AUDIENCE_NODE_ID, { x: AUDIENCE_COLUMN_X, y: 0 }),
    // An absent audience means "everyone", which the node must say out loud — an empty box
    // reads as "not configured yet", and those are very different campaigns.
    data: { audience: definition.audience, isEveryone: !definition.audience },
  })

  definition.steps.forEach((step, index) => {
    nodes.push({
      id: step.id,
      type: 'step',
      position: positionFor(canvas, step.id, { x: STEP_COLUMN_X, y: index * ROW_HEIGHT }),
      data: { step, index },
    })
    const source = index === 0 ? AUDIENCE_NODE_ID : definition.steps[index - 1].id
    edges.push({ id: `edge:${source}->${step.id}`, source, target: step.id })
  })

  return { nodes, edges }
}

/**
 * Collects layout back off the graph.
 *
 * Only positions and the viewport — never order, never structure. Positions of nodes the
 * definition no longer contains are dropped, so a deleted step does not leave a ghost entry
 * that grows the jsonb forever.
 */
export function readCanvasFromGraph(
  nodes: Pick<CampaignGraphNode, 'id' | 'position'>[],
  viewport?: CampaignCanvasLayout['viewport'],
): CampaignCanvasLayout {
  const nodePositions: Record<string, { x: number; y: number }> = {}
  for (const node of nodes) {
    nodePositions[node.id] = { x: node.position.x, y: node.position.y }
  }
  return viewport ? { viewport, nodePositions } : { nodePositions }
}

/** Re-runs the default column layout, discarding manual positions. */
export function autoArrange(
  definition: CampaignDefinition,
  triggers: CampaignTriggerInput[],
): CampaignCanvasLayout {
  const withoutPositions: CampaignDefinition = { ...definition, canvas: { viewport: definition.canvas?.viewport } }
  const { nodes } = definitionToGraph(withoutPositions, triggers)
  return readCanvasFromGraph(nodes, definition.canvas?.viewport)
}
