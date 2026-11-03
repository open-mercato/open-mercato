import { readVariants, SPLIT_STEP_TYPE } from '../engine/split.js'
import type { SplitVariant } from '../engine/split.js'
import type { CampaignCanvasLayout, CampaignDefinition, CampaignStep } from '../engine/types.js'
import type { CampaignTriggerInput } from '../../data/validators.js'

/**
 * The canvas is a RENDERING of the authored step tree, not a free graph.
 *
 * A campaign executes as: any one of its triggers starts a run, the audience decides whether
 * the run proceeds, then the steps run in order. The only branch is an A/B split, and which lane
 * a subject takes is decided by the engine, not by an edge somebody drew. Edges are therefore
 * derived from the data on every render and never persisted, and order lives in the definition's
 * arrays — reordering is an explicit action, never a consequence of dragging a node three pixels.
 *
 * That is the whole reason this mapping is lossless: the only thing the graph owns is layout.
 *
 * A split renders as a fan-out into one row per lane which then rejoins the outer chain, because
 * that is exactly what `flattenSteps` does — the picture and the execution agree by construction.
 */

export const AUDIENCE_NODE_ID = 'audience'

/** Which lane a node belongs to, or `null` for the top-level chain. */
export type GraphLane = { splitId: string; laneKey: string } | null

export type CampaignGraphNode =
  | { id: string; type: 'trigger'; position: { x: number; y: number }; data: { trigger: CampaignTriggerInput } }
  | { id: string; type: 'audience'; position: { x: number; y: number }; data: { audience: CampaignDefinition['audience']; isEveryone: boolean } }
  | { id: string; type: 'step'; position: { x: number; y: number }; data: { step: CampaignStep; index: number; lane: GraphLane } }
  | { id: string; type: 'split'; position: { x: number; y: number }; data: { step: CampaignStep; index: number; lane: GraphLane; variants: SplitVariantShare[] } }

/** A lane with the share of subjects it will receive, which is what an author actually reads. */
export type SplitVariantShare = { key: string; weight: number; share: number; stepCount: number }

export type CampaignGraphEdge = {
  id: string
  source: string
  target: string
}

const COLUMN_WIDTH = 320
const TRIGGER_COLUMN = 0
const AUDIENCE_COLUMN = 1
const STEP_COLUMN = 2
const ROW_HEIGHT = 140
const MAX_LANE_DEPTH = 5

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
    // The source is part of the identity: two schedules at the same interval over DIFFERENT sources
    // are two triggers, and keying only on the interval would collapse them onto one node.
    : `trigger:schedule:${trigger.sweepSource ?? 'customers'}:${trigger.scheduleValue}`
}

function positionFor(
  canvas: CampaignCanvasLayout | undefined,
  nodeId: string,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  return canvas?.nodePositions?.[nodeId] ?? fallback
}

function variantShares(variants: SplitVariant[]): SplitVariantShare[] {
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0)
  return variants.map((variant) => ({
    key: variant.key,
    weight: variant.weight,
    share: total > 0 ? variant.weight / total : 0,
    stepCount: variant.steps.length,
  }))
}

type BuildState = {
  nodes: CampaignGraphNode[]
  edges: CampaignGraphEdge[]
  canvas: CampaignCanvasLayout | undefined
}

function connect(state: BuildState, sources: string[], target: string): void {
  for (const source of sources) {
    state.edges.push({ id: `edge:${source}->${target}`, source, target })
  }
}

/**
 * Lays out one chain downwards and returns the nodes the next step must attach to.
 *
 * Steps read top to bottom, which is the promise the editor's own hint makes; a split forks to the
 * RIGHT — one column per lane — and the trunk resumes below the deepest lane. So a lane is visibly
 * a detour off the main line, and returning every lane's exit is what draws the rejoin.
 *
 * An empty lane exits at the split node itself, which keeps the chain connected instead of
 * stranding everything downstream of the split.
 */
function appendChain(
  state: BuildState,
  steps: CampaignStep[],
  column: number,
  startRow: number,
  incoming: string[],
  lane: GraphLane,
  depth: number,
): { exits: string[]; nextRow: number } {
  if (depth > MAX_LANE_DEPTH) return { exits: incoming, nextRow: startRow }

  let row = startRow
  let currentIncoming = incoming

  steps.forEach((step, index) => {
    const position = positionFor(state.canvas, step.id, { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT })

    if (step.type !== SPLIT_STEP_TYPE) {
      state.nodes.push({ id: step.id, type: 'step', position, data: { step, index, lane } })
      connect(state, currentIncoming, step.id)
      currentIncoming = [step.id]
      row += 1
      return
    }

    const variants = readVariants(step)
    state.nodes.push({ id: step.id, type: 'split', position, data: { step, index, lane, variants: variantShares(variants) } })
    connect(state, currentIncoming, step.id)

    const laneExits: string[] = []
    let deepest = row + 1
    variants.forEach((variant, laneIndex) => {
      const result = appendChain(
        state,
        variant.steps,
        column + 1 + laneIndex,
        row + 1,
        [step.id],
        { splitId: step.id, laneKey: variant.key },
        depth + 1,
      )
      laneExits.push(...result.exits)
      deepest = Math.max(deepest, result.nextRow)
    })

    currentIncoming = laneExits.length > 0 ? Array.from(new Set(laneExits)) : [step.id]
    row = deepest
  })

  return { exits: currentIncoming, nextRow: row }
}

export function definitionToGraph(
  definition: CampaignDefinition,
  triggers: CampaignTriggerInput[],
): { nodes: CampaignGraphNode[]; edges: CampaignGraphEdge[] } {
  const state: BuildState = { nodes: [], edges: [], canvas: definition.canvas }

  triggers.forEach((trigger, index) => {
    const id = triggerNodeId(trigger)
    state.nodes.push({
      id,
      type: 'trigger',
      position: positionFor(state.canvas, id, { x: TRIGGER_COLUMN * COLUMN_WIDTH, y: index * ROW_HEIGHT }),
      data: { trigger },
    })
    state.edges.push({ id: `edge:${id}->${AUDIENCE_NODE_ID}`, source: id, target: AUDIENCE_NODE_ID })
  })

  state.nodes.push({
    id: AUDIENCE_NODE_ID,
    type: 'audience',
    position: positionFor(state.canvas, AUDIENCE_NODE_ID, { x: AUDIENCE_COLUMN * COLUMN_WIDTH, y: 0 }),
    // An absent audience means "everyone", which the node must say out loud — an empty box
    // reads as "not configured yet", and those are very different campaigns.
    data: { audience: definition.audience, isEveryone: !definition.audience },
  })

  appendChain(state, definition.steps, STEP_COLUMN, 0, [AUDIENCE_NODE_ID], null, 0)

  return { nodes: state.nodes, edges: state.edges }
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
