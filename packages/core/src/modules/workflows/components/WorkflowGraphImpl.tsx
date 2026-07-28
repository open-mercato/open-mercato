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
  MarkerType,
  type ReactFlowInstance,
} from '@xyflow/react'
import {StartNode, EndNode, UserTaskNode, AutomatedNode, SubWorkflowNode, WaitForSignalNode, WaitForTimerNode, WaitForConditionNode, ParallelForkNode, ParallelJoinNode, InvokeAgentNode, IfElseNode, SwitchNode, StickyNoteNode, AnnotationGroupNode} from './nodes'
import { ANNOTATION_GROUP_NODE_TYPE, ANNOTATION_NOTE_NODE_TYPE } from '../lib/editor-annotations'
import { WorkflowTransitionEdge } from './WorkflowTransitionEdge'
import { WorkflowDataMappingEdge } from './WorkflowDataMappingEdge'
import { STATUS_COLORS, toWorkflowStatus } from '../lib/status-colors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Edit3 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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
 * smooth-step curve would only be an approximation.
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

  const backgroundDotColor = 'var(--border)'
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
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: 'var(--muted-foreground)',
          },
        }
        setEdges((eds) => addEdge(newEdge, eds))
      }
    },
    [setEdges, onConnectProp]
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const nextNodes = applyNodeChanges(changes, latestNodesRef.current)
      setNodes(nextNodes)
      if (onNodesChangeProp) {
        onNodesChangeProp(nextNodes, describeNodeChanges(changes))
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
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={editable ? onConnect : undefined}
        onReconnect={editable ? onReconnectProp : undefined}
        edgesReconnectable={editable && !!onReconnectProp}
        onNodeClick={onNodeClickProp}
        onEdgeClick={onEdgeClickProp}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance
        }}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'workflowTransition',
          animated: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: 'var(--muted-foreground)',
          },
        }}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={editable}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color={backgroundDotColor}
        />

        <Controls
          showZoom={true}
          showFitView={true}
          showInteractive={false}
          position={isCompactViewport ? 'bottom-right' : 'top-right'}
          className={`!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!fill-foreground [&>button:hover]:!bg-muted ${isCompactViewport ? 'scale-90 origin-bottom-right' : ''}`}
        />

        {!isCompactViewport && (
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={(node) => {
              const status = toWorkflowStatus(node.data?.status as string | undefined)
              return STATUS_COLORS[status]?.hex || STATUS_COLORS.not_started.hex
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
            position="bottom-left"
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
