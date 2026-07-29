/**
 * Workflows Module — the canvas trigger node (pure; fidelity gap #5).
 *
 * Until now nothing on the canvas answered "where does this start". A
 * definition's triggers lived only in the details drawer, so a flow opened onto
 * a generic START card indistinguishable from a step. These helpers derive the
 * pill that states the answer — and nothing else: there is NO engine change
 * here, the triggers are already on the definition.
 *
 * The node is a RENDER-TIME overlay, exactly like the compensation ghosts
 * (`lib/compensation-ghosts.ts`) and the "show last run" decoration. It is
 * minted inside `WorkflowGraphImpl` from a prop and never enters the editor's
 * node state, so it is absent from `graphToDefinition`, from the undo stack,
 * from the drag autosave, from the per-user draft and from the subgraph
 * clipboard by construction. `graphToDefinition` and `validateWorkflowGraph`
 * filter it anyway, so the guarantee is testable rather than merely true.
 *
 * What it says has to be TRUE, which drives three decisions the mockup does not
 * make for us:
 *
 *  - **Manual and API starts are always a way in.** `POST /api/workflows/instances`
 *    → `workflowExecutor.startWorkflow` needs no trigger at all; it only needs
 *    the definition to be enabled. So the node always carries a manual/API line,
 *    and a definition with zero triggers still renders — it just does not claim
 *    an event starts it.
 *  - **A DISABLED definition starts from nothing.** `startWorkflow` throws
 *    `DEFINITION_DISABLED` before it looks at anything else, so the node says so
 *    instead of listing entry points that cannot fire.
 *  - **A disabled trigger does not start the workflow.** It is still shown (the
 *    canvas would otherwise disagree with the drawer the author just used) but
 *    it is marked, and it never displaces a live trigger into the overflow.
 *
 * PURE: no React, no ORM, no registry. `@xyflow/react` is imported for types
 * only, the same boundary `lib/compensation-ghosts.ts` keeps.
 */

import type { Edge, Node } from '@xyflow/react'
import { EDGE_COLORS } from './status-colors'
import {
  TERMINAL_NODE_HEIGHT,
  TERMINAL_NODE_MIN_WIDTH,
  TRIGGER_NODE_GAP,
  TRIGGER_NODE_HEADER_HEIGHT,
  TRIGGER_NODE_ROW_HEIGHT,
  TRIGGER_NODE_WIDTH,
} from './node-geometry'

/** Node type registered on the canvas for the trigger pill. Never a step type. */
export const WORKFLOW_TRIGGER_NODE_TYPE = 'workflowTrigger'

/**
 * The synthetic node's id. Reserved and recognisable without consulting the
 * type, which is what lets `graphToDefinition` refuse to serialize it even if
 * the node ever reached it.
 */
export const WORKFLOW_TRIGGER_NODE_ID = '__workflow_trigger__'

/** Id of the connector drawn from the pill into START. */
export const WORKFLOW_TRIGGER_EDGE_ID = '__workflow_trigger_edge__'

/**
 * Event tags rendered before the rest collapse into a `+N` line, matching
 * `ROUTE_CHIP_LIMIT`. A definition may declare many triggers, and the 60-node
 * density criterion is what settles the question: an uncapped list turns one
 * node into a scrolling legend at exactly the zoom where the canvas is supposed
 * to read as structure.
 */
export const TRIGGER_NODE_EVENT_LIMIT = 3

/**
 * The connector's own dash pattern. `pending` routes are SOLID since fidelity
 * gap #2, so a dash again means something — here, "this is not a transition".
 * Distinct from error (`8,4`), data-mapping (`2,3`) and compensation ghosts
 * (`10,4,2,4`).
 */
export const TRIGGER_EDGE_DASH_ARRAY = '4,4'

export interface TriggerLike {
  triggerId?: unknown
  name?: unknown
  eventPattern?: unknown
  enabled?: unknown
}

export interface TriggerNodeEventRow {
  /** Stable React key — the trigger id when it has one. */
  key: string
  name: string
  eventPattern: string
  enabled: boolean
}

export interface TriggerNodeModel {
  /** Event tags actually rendered, capped at {@link TRIGGER_NODE_EVENT_LIMIT}. */
  rows: TriggerNodeEventRow[]
  /** Declared triggers the cap left out. */
  hiddenCount: number
  /** Every declared trigger, enabled or not. */
  triggerCount: number
  /** Triggers that can actually fire. */
  enabledCount: number
  /** The definition itself is enabled — i.e. anything can start it at all. */
  definitionEnabled: boolean
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * What the pill says, from the definition's triggers.
 *
 * Enabled triggers sort first so a disabled one can never push a live entry
 * point past the cap — the overflow line has to hide the least load-bearing
 * rows, not an arbitrary tail of the authoring order. Order is otherwise
 * preserved, so the canvas lists triggers in the order the drawer does.
 */
export function buildTriggerNodeModel(
  triggers: TriggerLike[] | null | undefined,
  options: { definitionEnabled?: boolean } = {},
): TriggerNodeModel {
  const declared = (triggers ?? []).filter((trigger) => !!trigger && readString(trigger.eventPattern).length > 0)
  const enabled = declared.filter((trigger) => trigger.enabled !== false)
  const disabled = declared.filter((trigger) => trigger.enabled === false)
  const ordered = [...enabled, ...disabled]

  const rows: TriggerNodeEventRow[] = ordered.slice(0, TRIGGER_NODE_EVENT_LIMIT).map((trigger, index) => {
    const eventPattern = readString(trigger.eventPattern)
    return {
      key: readString(trigger.triggerId) || `${eventPattern}:${index}`,
      name: readString(trigger.name) || eventPattern,
      eventPattern,
      enabled: trigger.enabled !== false,
    }
  })

  return {
    rows,
    hiddenCount: Math.max(0, ordered.length - rows.length),
    triggerCount: ordered.length,
    enabledCount: enabled.length,
    definitionEnabled: options.definitionEnabled !== false,
  }
}

/**
 * Lines the pill renders below its header: one per shown event tag, one for the
 * overflow when there is one, and the manual/API line — which is unconditional
 * because that entry point always exists — or the disabled note, which replaces
 * it because a disabled definition cannot be started by any means.
 */
export function triggerNodeRowCount(model: TriggerNodeModel): number {
  if (!model.definitionEnabled) return 1
  return model.rows.length + (model.hiddenCount > 0 ? 1 : 0) + 1
}

/**
 * The pill's footprint. Derived, not measured — the node is placed relative to
 * START before React Flow has measured anything.
 */
export function triggerNodeFootprint(model: TriggerNodeModel): { width: number; height: number } {
  return {
    width: TRIGGER_NODE_WIDTH,
    height: TRIGGER_NODE_HEADER_HEIGHT + triggerNodeRowCount(model) * TRIGGER_NODE_ROW_HEIGHT,
  }
}

export interface TriggerAnchorNode {
  id: string
  position: { x: number; y: number }
  measured?: { width?: number; height?: number }
}

/**
 * The pill, anchored to the START terminal.
 *
 * It sits one rank-gap to the LEFT of START and is centred on it. It is never
 * given to dagre — a synthetic node has no rank, and ranking it would make it
 * participate in the fork/join walks and in `validateWorkflowGraph`'s
 * exactly-one-START count. Because dagre's LR layout puts START in the first
 * rank, the gutter it is placed in is empty by construction, so not ranking it
 * costs nothing.
 *
 * Non-interactive in every way that could corrupt the graph: not draggable, not
 * selectable, not deletable, and not connectable, so no gesture can make it the
 * source or target of a real transition. Clicking it is still useful — the pill
 * renders its own button, which opens the definition drawer's triggers section.
 */
export function buildTriggerNode(
  model: TriggerNodeModel,
  startNode: TriggerAnchorNode,
  data: Record<string, unknown> = {},
): Node {
  const { width, height } = triggerNodeFootprint(model)
  const startHeight = startNode.measured?.height ?? TERMINAL_NODE_HEIGHT

  return {
    id: WORKFLOW_TRIGGER_NODE_ID,
    type: WORKFLOW_TRIGGER_NODE_TYPE,
    position: {
      x: startNode.position.x - width - TRIGGER_NODE_GAP,
      y: startNode.position.y + startHeight / 2 - height / 2,
    },
    data: { ...data, model },
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
    connectable: false,
  }
}

/**
 * Where the pill lands and how big it is, without a DOM. The canvas places the
 * node from exactly these numbers, so a layout assertion can check the box
 * clears START rather than eyeballing a screenshot.
 */
export function triggerNodeBox(
  model: TriggerNodeModel,
  startNode: TriggerAnchorNode,
): { x: number; y: number; width: number; height: number } {
  const node = buildTriggerNode(model, startNode)
  const { width, height } = triggerNodeFootprint(model)
  return { x: node.position.x, y: node.position.y, width, height }
}

/** The START terminal's own box, in the same terms. */
export function startNodeBox(
  startNode: TriggerAnchorNode,
): { x: number; y: number; width: number; height: number } {
  return {
    x: startNode.position.x,
    y: startNode.position.y,
    width: startNode.measured?.width ?? TERMINAL_NODE_MIN_WIDTH,
    height: startNode.measured?.height ?? TERMINAL_NODE_HEIGHT,
  }
}

/**
 * The connector from the pill into START. Deliberately NOT a
 * `workflowTransition`: it carries no condition, no activities and no id the
 * engine resolves, so rendering it in the routes' own channel would be a lie an
 * author could try to click. It uses React Flow's built-in bezier edge with the
 * trigger dash pattern and is inert — unselectable, unfocusable, undeletable
 * and unreconnectable, so no editing gesture can reach it.
 */
export function buildTriggerEdge(startNodeId: string, markerEnd?: Edge['markerEnd']): Edge {
  return {
    id: WORKFLOW_TRIGGER_EDGE_ID,
    source: WORKFLOW_TRIGGER_NODE_ID,
    target: startNodeId,
    type: 'default',
    selectable: false,
    focusable: false,
    deletable: false,
    reconnectable: false,
    ...(markerEnd ? { markerEnd } : {}),
    style: {
      stroke: EDGE_COLORS.pending.stroke,
      strokeWidth: EDGE_COLORS.pending.strokeWidth,
      strokeDasharray: TRIGGER_EDGE_DASH_ARRAY,
    },
  }
}

export function isTriggerNode(node: { id?: string; type?: string }): boolean {
  return node?.type === WORKFLOW_TRIGGER_NODE_TYPE || node?.id === WORKFLOW_TRIGGER_NODE_ID
}

export function isTriggerEdge(edge: { id?: string; source?: string; target?: string }): boolean {
  return edge?.id === WORKFLOW_TRIGGER_EDGE_ID || edge?.source === WORKFLOW_TRIGGER_NODE_ID
}
