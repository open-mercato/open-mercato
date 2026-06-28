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
  Connection,
  ConnectionMode,
  MarkerType,
  type ReactFlowInstance,
} from '@xyflow/react'
import {StartNode, EndNode, UserTaskNode, AutomatedNode, SubWorkflowNode, WaitForSignalNode, WaitForTimerNode, ParallelForkNode, ParallelJoinNode, InvokeAgentNode} from './nodes'
import { WorkflowTransitionEdge } from './WorkflowTransitionEdge'
import { WorkflowDataMappingEdge } from './WorkflowDataMappingEdge'
import { STATUS_COLORS, toWorkflowStatus } from '../lib/status-colors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Edit3 } from 'lucide-react'
import { useTheme } from '@open-mercato/ui/theme'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface WorkflowGraphImplProps {
  initialNodes?: Node[]
  initialEdges?: Edge[]
  onNodesChange?: (changes: any[]) => void
  onEdgesChange?: (changes: any[]) => void
  onNodeClick?: (event: React.MouseEvent, node: Node) => void
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void
  onConnect?: (connection: Connection) => void
  editable?: boolean
  className?: string
  height?: string
}

export default function WorkflowGraphImpl({
  initialNodes = [],
  initialEdges = [],
  onNodesChange: onNodesChangeProp,
  onEdgesChange: onEdgesChangeProp,
  onNodeClick: onNodeClickProp,
  onEdgeClick: onEdgeClickProp,
  onConnect: onConnectProp,
  editable = false,
  className = '',
  height = '600px',
}: WorkflowGraphImplProps) {
  const t = useT()
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const backgroundDotColor = isDark ? '#374151' : '#e5e7eb'
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
            color: '#9ca3af',
          },
        }
        setEdges((eds) => addEdge(newEdge, eds))
      }
    },
    [setEdges, onConnectProp]
  )

  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChange(changes)
      if (onNodesChangeProp) {
        onNodesChangeProp(changes)
      }
    },
    [onNodesChange, onNodesChangeProp]
  )

  const handleEdgesChange = useCallback(
    (changes: any) => {
      onEdgesChange(changes)
      if (onEdgesChangeProp) {
        onEdgesChangeProp(changes)
      }
    },
    [onEdgesChange, onEdgesChangeProp]
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
      parallelFork: ParallelForkNode,
      parallelJoin: ParallelJoinNode,
      invokeAgent: InvokeAgentNode,
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
      style={{
        height,
        // Edge colour tokens mapped to DS palette roles: control transitions vs
        // drag-authored data-mapping edges (consumed by WorkflowDataMappingEdge).
        ['--edge-control' as string]: 'var(--primary)',
        ['--edge-data' as string]: 'var(--muted-foreground)',
      } as React.CSSProperties}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={editable ? onConnect : undefined}
        onNodeClick={onNodeClickProp}
        onEdgeClick={onEdgeClickProp}
        onInit={(instance) => { reactFlowInstanceRef.current = instance }}
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
            color: '#9ca3af',
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
