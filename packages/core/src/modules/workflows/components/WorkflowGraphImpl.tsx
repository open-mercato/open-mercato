'use client'

import '@xyflow/react/dist/style.css'

import { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  NodeChange,
  EdgeChange,
  ConnectionMode,
  ConnectionLineType,
  MarkerType,
  type ReactFlowInstance,
} from '@xyflow/react'
import {StartNode, EndNode, UserTaskNode, AutomatedNode, SubWorkflowNode, WaitForSignalNode, WaitForTimerNode, WaitForConditionNode, ParallelForkNode, ParallelJoinNode, InvokeAgentNode, IfElseNode, SwitchNode, StickyNoteNode, AnnotationGroupNode} from './nodes'
import { ANNOTATION_GROUP_NODE_TYPE, ANNOTATION_NOTE_NODE_TYPE } from '../lib/editor-annotations'
import {
  buildTriggerNodeModel,
  type TriggerLike,
} from '../lib/trigger-node'
import { WorkflowTransitionEdge } from './WorkflowTransitionEdge'
import { WorkflowDataMappingEdge } from './WorkflowDataMappingEdge'
import { WorkflowCompensationGhostEdge } from './WorkflowCompensationGhostEdge'
import {
  buildCompensationGhostEdges,
  compensatingStepIds,
  WORKFLOW_COMPENSATION_GHOST_EDGE_TYPE,
} from '../lib/compensation-ghosts'
import { buildAgentOutcomeRows } from '../lib/node-outcome-rows'
import { filterOwnedNodeChanges } from '../lib/owned-node-changes'
import { isRouteTaken, resolveNodeRunStatus, type RunExecution } from '../lib/run-execution'
import {
  presentationToWorkflowStatus,
  readNodeAgentId,
  resolveStepPresentation,
} from '../lib/step-presentation'
import { EDGE_COLORS, STATUS_COLORS, toWorkflowStatus } from '../lib/status-colors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Edit3 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Arrowhead every control-flow route ends in. Sized against the 1.5px wire it
 * caps — xyflow's 16px default reads top-heavy on a hairline stroke — and
 * painted in the same derived colour as the route itself, so head and stroke
 * are one mark rather than two weights. Declared once because the connection
 * fallback below and `defaultEdgeOptions` both need it and used to carry
 * separate copies that could drift.
 */
const ROUTE_MARKER_END = {
  type: MarkerType.ArrowClosed,
  width: 10,
  height: 10,
  color: EDGE_COLORS.pending.stroke,
} as const

export interface WorkflowGraphFocusTarget {
  nodeId?: string
  edgeId?: string
  requestId: number
}

/**
 * What a node-change batch means for persistence (#4248). React Flow reports a
 * position change on every drag frame plus one final frame with `dragging:
 * false`; selection and measurement changes carry no arrangement at all. The
 * parent only commits an arrangement when `persistable` is true, so a drag
 * persists once — on drag end — and clicking a node never writes anything.
 */
export interface WorkflowGraphNodesChangeMeta {
  dragging: boolean
  /**
   * An annotation resize is in flight. Resizing behaves exactly like dragging:
   * many frames, one persisted arrangement at the end.
   */
  resizing: boolean
  persistable: boolean
}

function describeNodeChanges(changes: NodeChange[]): WorkflowGraphNodesChangeMeta {
  const dragging = changes.some((change) => change.type === 'position' && change.dragging === true)
  const resizing = changes.some((change) => change.type === 'dimensions' && change.resizing === true)
  if (dragging || resizing) return { dragging, resizing, persistable: false }
  const persistable = changes.some((change) => {
    if (change.type === 'select') return false
    // React Flow's own measurement carries no `resizing` flag; only the resizer's
    // final frame reports `false`, and that is the arrangement worth saving.
    if (change.type === 'dimensions') return change.resizing === false
    if (change.type === 'position') return change.dragging !== true
    return true
  })
  return { dragging, resizing, persistable }
}

/**
 * A drop onto the canvas (spec section 4.2). The graph resolves the two things
 * only it can know — the flow-space position under the cursor
 * (`screenToFlowPosition`) and which route, if any, the cursor was over — and
 * hands the parent plain data, so the drop EFFECT stays out of the React Flow
 * boundary (#3169).
 */
export interface WorkflowGraphDropEvent {
  dataTransfer: DataTransfer
  position: { x: number; y: number }
  edgeId: string | null
}

/**
 * Resolve which route the cursor is over. React Flow renders each edge as a
 * `<g class="react-flow__edge" data-id="…">` carrying a wide invisible
 * interaction path, so hit-testing the DOM is exact where geometry over a
 * bezier curve would only be an approximation.
 */
function edgeIdAtPoint(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const edgeElement = (element as Element).closest?.('.react-flow__edge')
    const edgeId = edgeElement?.getAttribute('data-id')
    if (edgeId) return edgeId
  }
  return null
}

export interface WorkflowGraphImplProps {
  initialNodes?: Node[]
  initialEdges?: Edge[]
  onNodesChange?: (nodes: Node[], meta: WorkflowGraphNodesChangeMeta) => void
  onEdgesChange?: (edges: Edge[]) => void
  onNodeClick?: (event: React.MouseEvent, node: Node) => void
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void
  onConnect?: (connection: Connection) => void
  /**
   * Route reattachment (#4233). React Flow calls this when an existing edge
   * endpoint is dropped on another node; the parent decides whether to accept
   * the new endpoints. Leaving the committed edges untouched snaps back.
   */
  onReconnect?: (oldEdge: Edge, connection: Connection) => void
  /** Drag-from-palette (spec section 4.2). Absent → the canvas accepts no drops. */
  onCanvasDrop?: (event: WorkflowGraphDropEvent) => void
  editable?: boolean
  className?: string
  height?: string
  focusTarget?: WorkflowGraphFocusTarget | null
  nodeErrorCounts?: Record<string, number>
  /**
   * Compensation ghosts (spec section 4.4). Display-only: the dashed reverse
   * edges are minted at render time and never enter the editor's edge state, so
   * they can never reach `graphToDefinition`.
   */
  showCompensation?: boolean
  /**
   * "Show last run" execution overlay (spec §8.3). Applied at render time — the
   * same rule the compensation ghosts and the outcome-row footers follow — so
   * the painted statuses and taken routes never enter the document, the undo
   * stack, an autosave, or `graphToDefinition`.
   */
  runOverlay?: RunExecution | null
  /**
   * Agent id → label for the overlay's reason line, from the OPTIONAL
   * `agent_orchestrator` peer. Rides alongside `runOverlay` so the Studio names
   * an agent exactly the way the run detail page does — use the agent's LABEL,
   * never its definition key.
   */
  runAgentLabels?: ReadonlyMap<string, string> | null
  /**
   * The definition's event triggers, for the canvas trigger node (fidelity gap
   * #5). Display-only and minted at RENDER time, the same rule the compensation
   * ghosts and the last-run overlay follow, so the pill never enters the
   * editor's node state, the undo stack, an autosave or `graphToDefinition`.
   *
   * `undefined` / `null` renders nothing at all, so every existing caller (the
   * read-only viewers) is untouched. An ARRAY opts in — including an EMPTY one,
   * which still renders the pill: a definition with no triggers is not a
   * definition with no way in, it is one started manually or through the API,
   * and saying so is the point of the node.
   */
  triggers?: TriggerLike[] | null
  /**
   * The definition's own enabled flag. `startWorkflow` throws
   * `DEFINITION_DISABLED` before it looks at triggers, so the pill must not list
   * entry points that cannot fire.
   */
  definitionEnabled?: boolean
  /** Opens the definition drawer on its triggers section. */
  onOpenTriggers?: () => void
}

export default function WorkflowGraphImpl({
  initialNodes = [],
  initialEdges = [],
  onNodesChange: onNodesChangeProp,
  onEdgesChange: onEdgesChangeProp,
  onNodeClick: onNodeClickProp,
  onEdgeClick: onEdgeClickProp,
  onConnect: onConnectProp,
  onReconnect: onReconnectProp,
  onCanvasDrop: onCanvasDropProp,
  editable = false,
  className = '',
  height = '600px',
  focusTarget = null,
  nodeErrorCounts,
  showCompensation = false,
  runOverlay = null,
  runAgentLabels = null,
  triggers = null,
  definitionEnabled = true,
  onOpenTriggers,
}: WorkflowGraphImplProps) {
  const t = useT()
  const [nodes, setNodes] = useNodesState(initialNodes)
  const [edges, setEdges] = useEdgesState(initialEdges)

  // Track the latest committed graph so the change reducers can run inside the
  // lazy boundary (#3169) and forward the already-applied arrays to the parent,
  // keeping React Flow's runtime out of the editor page chunk.
  const latestNodesRef = useRef(nodes)
  latestNodesRef.current = nodes
  const latestEdgesRef = useRef(edges)
  latestEdgesRef.current = edges

  // A 16px dot grid on a large canvas reads as moiré while each dot is nearly
  // invisible. A 24px grid (the 4px-scale step nearest the design's 22px) at a
  // low mix of `--muted-foreground` gives the plane a texture you can read
  // depth from without competing with the graph.
  const backgroundDotColor = 'color-mix(in oklab, var(--muted-foreground) 22%, transparent)'
  const backgroundDotGap = 24
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null)

  // Let a small graph zoom in to actually use the canvas, but never magnify so
  // far that a tall workflow overflows. A wide graph stays width-limited.
  const fitViewOptions = useMemo(
    () => ({ padding: 0.1, maxZoom: isCompactViewport ? 0.9 : 1.5 }),
    [isCompactViewport]
  )

  // Re-fit whenever the canvas itself resizes (e.g. the author hides the
  // metadata panel or toggles Focus mode, which grows the canvas). ReactFlow's
  // declarative `fitView` only fits on first render, so without this the graph
  // stays small in the newly enlarged canvas — the "wasted space" symptom.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        reactFlowInstanceRef.current?.fitView(fitViewOptions)
      })
    })
    observer.observe(el)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fitViewOptions])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(max-width: 1279px)')
    const updateViewportMode = () => setIsCompactViewport(mediaQuery.matches)

    updateViewportMode()
    mediaQuery.addEventListener('change', updateViewportMode)

    return () => {
      mediaQuery.removeEventListener('change', updateViewportMode)
    }
  }, [])

  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

  useEffect(() => {
    if (!focusTarget) return
    const instance = reactFlowInstanceRef.current
    if (!instance) return
    const focusOptions = { zoom: 1, duration: 300 }
    if (focusTarget.nodeId) {
      const node = latestNodesRef.current.find((candidate) => candidate.id === focusTarget.nodeId)
      if (!node) return
      const width = node.measured?.width ?? 0
      const height = node.measured?.height ?? 0
      void instance.setCenter(node.position.x + width / 2, node.position.y + height / 2, focusOptions)
      setNodes((currentNodes) =>
        currentNodes.map((candidate) => ({ ...candidate, selected: candidate.id === focusTarget.nodeId }))
      )
    } else if (focusTarget.edgeId) {
      const edge = latestEdgesRef.current.find((candidate) => candidate.id === focusTarget.edgeId)
      if (!edge) return
      const source = latestNodesRef.current.find((candidate) => candidate.id === edge.source)
      const target = latestNodesRef.current.find((candidate) => candidate.id === edge.target)
      if (!source || !target) return
      void instance.setCenter(
        (source.position.x + target.position.x) / 2,
        (source.position.y + target.position.y) / 2,
        focusOptions
      )
      setEdges((currentEdges) =>
        currentEdges.map((candidate) => ({ ...candidate, selected: candidate.id === focusTarget.edgeId }))
      )
    }
  }, [focusTarget, setNodes, setEdges])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (onConnectProp) {
        onConnectProp(connection)
      } else {
        const newEdge = {
          ...connection,
          type: 'workflowTransition',
          animated: false,
          markerEnd: ROUTE_MARKER_END,
        }
        setEdges((eds) => addEdge(newEdge, eds))
      }
    },
    [setEdges, onConnectProp]
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Render-only overlay nodes (the trigger pill, fidelity gap #5) are minted
      // in `canvasNodes` at render time and are NOT part of the editor's node
      // state. ReactFlow still measures them and emits a `dimensions` change on
      // every render; applying that here would setNodes → re-render → re-mint the
      // overlay → ReactFlow re-measures it → an unbounded loop that pins the CPU
      // and starves node dragging, so a dragged card never visibly tracks the
      // cursor and only lands at the drop point (the "teleport" bug). Keep only
      // changes for nodes we own; if nothing is left, this batch is pure overlay
      // churn — do nothing so no re-render is scheduled.
      const ownedIds = new Set(latestNodesRef.current.map((node) => node.id))
      const ownedChanges = filterOwnedNodeChanges(changes, ownedIds)
      if (ownedChanges.length === 0) return
      const nextNodes = applyNodeChanges(ownedChanges, latestNodesRef.current)
      setNodes(nextNodes)
      if (onNodesChangeProp) {
        onNodesChangeProp(nextNodes, describeNodeChanges(ownedChanges))
      }
    },
    [setNodes, onNodesChangeProp]
  )

  const acceptsDrop = editable && !!onCanvasDropProp

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!acceptsDrop) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    [acceptsDrop],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!acceptsDrop) return
      const instance = reactFlowInstanceRef.current
      if (!instance) return
      event.preventDefault()
      onCanvasDropProp?.({
        dataTransfer: event.dataTransfer,
        position: instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        edgeId: edgeIdAtPoint(event.clientX, event.clientY),
      })
    },
    [acceptsDrop, onCanvasDropProp],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const nextEdges = applyEdgeChanges(changes, latestEdgesRef.current)
      setEdges(nextEdges)
      if (onEdgesChangeProp) {
        onEdgesChangeProp(nextEdges)
      }
    },
    [setEdges, onEdgesChangeProp]
  )

  // Decorate nodes with validation-error state at render time only, so the
  // error flags never enter the committed graph state or the saved definition.
  const displayNodes = useMemo(() => {
    if (!nodeErrorCounts) return nodes
    return nodes.map((node) => {
      const errorCount = nodeErrorCounts[node.id]
      if (!errorCount) return node
      return { ...node, data: { ...node.data, hasError: true, errorCount } }
    })
  }, [nodes, nodeErrorCounts])

  // Compensation ghosts + their node badges, both derived from the committed
  // edges at render time only (spec section 4.4). Read-only visualization: no
  // engine change, and nothing here is part of the document.
  const compensationBadgeIds = useMemo(
    () => (showCompensation ? new Set(compensatingStepIds(edges)) : null),
    [showCompensation, edges],
  )

  const compensationNodes = useMemo(() => {
    if (!compensationBadgeIds || compensationBadgeIds.size === 0) return displayNodes
    return displayNodes.map((node) => (
      compensationBadgeIds.has(node.id)
        ? { ...node, data: { ...node.data, hasCompensation: true } }
        : node
    ))
  }, [displayNodes, compensationBadgeIds])

  // Outcome-row footers on agent nodes (spec §7.2 / fidelity gap #4). Which
  // outcomes a node shows depends on which are WIRED, so it is a fact about the
  // edges, not about the node — derived at render time exactly like the
  // compensation badges above, so it never enters the document or the save.
  const outcomeRowTransitions = useMemo(
    () =>
      edges.map((edge) => {
        const data = (edge.data ?? {}) as { kind?: string; outcomeKind?: string }
        return { fromStepId: edge.source, kind: data.kind, outcomeKind: data.outcomeKind }
      }),
    [edges],
  )

  const decoratedNodes = useMemo(
    () =>
      compensationNodes.map((node) =>
        node.type === 'invokeAgent'
          ? {
              ...node,
              data: {
                ...node.data,
                outcomeRows: buildAgentOutcomeRows(outcomeRowTransitions, node.id),
              },
            }
          : node,
      ),
    [compensationNodes, outcomeRowTransitions],
  )

  // "Show last run" (spec §8.3). Derived at render time from the SAME
  // `RunExecution` the run detail page paints from, so the Studio and the run
  // view can never disagree about which path executed.
  const overlaidNodes = useMemo(() => {
    if (!runOverlay) return decoratedNodes
    return decoratedNodes.map((node) => {
      const runStatus = resolveNodeRunStatus(runOverlay, { id: node.id, type: node.type })
      // `pending` is the editor's own look, so an un-run node is left exactly
      // as it was rather than being repainted into a third state.
      if (runStatus === 'pending') return node
      // Spec Part 2 — the SAME resolver the run detail page uses, so the Studio
      // and the run view cannot disagree about whether a step is working or
      // waiting, or about what it is waiting for.
      const presentation = resolveStepPresentation(
        runOverlay,
        { id: node.id, status: runStatus },
        { agentLabels: runAgentLabels ?? undefined, agentId: readNodeAgentId(node.data) },
      )
      return {
        ...node,
        data: {
          ...node.data,
          status: presentationToWorkflowStatus(presentation.state),
          runReason: presentation.reason,
          runStartedAt: presentation.startedAt,
        },
      }
    })
  }, [decoratedNodes, runOverlay, runAgentLabels])

  // Triggers (fidelity gap #5, Direction A). Derived at render time from the
  // definition's triggers and folded into the START node as a clickable cap —
  // NOT a separate overlay node with a dashed connector. The old overlay node
  // was minted fresh every render and, being outside the node state, was
  // re-measured by ReactFlow on every render in an unbounded loop (the canvas
  // "teleport" bug). Injecting the cap into the OWNED START node avoids that:
  // its measurement is persisted to state like any real node. The model stays
  // out of the document, undo, autosave, the per-user draft and the subgraph
  // clipboard because it lives only in the render-time `data`, never in the
  // definition (`graphToDefinition` reads steps/edges, not this key).
  const triggerModel = useMemo(
    () => (triggers ? buildTriggerNodeModel(triggers, { definitionEnabled }) : null),
    [triggers, definitionEnabled],
  )

  const canvasNodes = useMemo(() => {
    if (!triggerModel) return overlaidNodes
    return overlaidNodes.map((node) =>
      node.type === 'start'
        ? { ...node, data: { ...node.data, trigger: triggerModel, onOpenTriggers } }
        : node,
    )
  }, [overlaidNodes, triggerModel, onOpenTriggers])

  const displayEdges = useMemo(() => {
    const withGhosts = showCompensation ? [...edges, ...buildCompensationGhostEdges(edges)] : edges
    if (!runOverlay) return withGhosts
    return withGhosts.map((edge) =>
      isRouteTaken(runOverlay, { transitionId: edge.id, fromStepId: edge.source, toStepId: edge.target })
        ? { ...edge, data: { ...edge.data, state: 'completed' } }
        : edge,
    )
  }, [showCompensation, edges, runOverlay])

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      onNodeClickProp?.(event, node)
    },
    [onNodeClickProp],
  )

  const nodeTypes = useMemo(
    () => ({
      start: StartNode,
      end: EndNode,
      userTask: UserTaskNode,
      automated: AutomatedNode,
      subWorkflow: SubWorkflowNode,
      waitForSignal: WaitForSignalNode,
      waitForTimer: WaitForTimerNode,
      waitForCondition: WaitForConditionNode,
      parallelFork: ParallelForkNode,
      parallelJoin: ParallelJoinNode,
      invokeAgent: InvokeAgentNode,
      ifElse: IfElseNode,
      switch: SwitchNode,
      [ANNOTATION_NOTE_NODE_TYPE]: StickyNoteNode,
      [ANNOTATION_GROUP_NODE_TYPE]: AnnotationGroupNode,
    }),
    []
  )

  const edgeTypes = useMemo(
    () => ({
      workflowTransition: WorkflowTransitionEdge,
      workflowDataMapping: WorkflowDataMappingEdge,
      [WORKFLOW_COMPENSATION_GHOST_EDGE_TYPE]: WorkflowCompensationGhostEdge,
    }),
    []
  )

  return (
    <div
      ref={containerRef}
      className={`workflow-graph-container ${className}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        height,
        // Edge colour tokens mapped to DS palette roles: control transitions vs
        // drag-authored data-mapping edges (consumed by WorkflowDataMappingEdge).
        ['--edge-control' as string]: 'var(--primary)',
        ['--edge-data' as string]: 'var(--muted-foreground)',
      } as React.CSSProperties}
    >
      <ReactFlow
        nodes={canvasNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={editable ? onConnect : undefined}
        onReconnect={editable ? onReconnectProp : undefined}
        edgesReconnectable={editable && !!onReconnectProp}
        onNodeClick={handleNodeClick}
        onEdgeClick={onEdgeClickProp}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance
        }}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.Bezier}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'workflowTransition',
          animated: false,
          markerEnd: ROUTE_MARKER_END,
        }}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={editable}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={backgroundDotGap}
          size={1}
          color={backgroundDotColor}
        />

        {/* Tools bottom-left, minimap bottom-right. Top-right put the canvas
            controls directly under the editor's own header actions, so two
            unrelated button clusters stacked on the same corner. */}
        <Controls
          showZoom={true}
          showFitView={true}
          showInteractive={false}
          position="bottom-left"
          className={`!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!fill-foreground [&>button:hover]:!bg-muted ${isCompactViewport ? 'scale-90 origin-bottom-left' : ''}`}
        />

        {!isCompactViewport && (
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={(node) => {
              const status = toWorkflowStatus(node.data?.status as string | undefined)
              return STATUS_COLORS[status]?.hex || STATUS_COLORS.not_started.hex
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
            position="bottom-right"
            className="!bg-card !border !border-border !rounded-lg"
          />
        )}

        {!editable && !isCompactViewport && (
          <Panel position="top-left" style={{ margin: 10 }}>
            <div className="bg-card rounded-lg shadow-sm border border-border px-4 py-2">
              <p className="text-sm text-muted-foreground font-medium">
                {t('workflows.graph.visualization')}
              </p>
            </div>
          </Panel>
        )}

        {editable && !isCompactViewport && (
          <Panel position="top-left" style={{ margin: 10 }}>
            <Alert variant="info" icon={<Edit3 aria-hidden="true" />} className="max-w-sm">
              <AlertDescription className="font-medium">
                {t('workflows.graph.editModeInfo')}
              </AlertDescription>
            </Alert>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}
