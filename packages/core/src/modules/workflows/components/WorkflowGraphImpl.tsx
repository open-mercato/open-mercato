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
  ReactFlowInstance,
} from '@xyflow/react'
import {StartNode, EndNode, UserTaskNode, AutomatedNode, SubWorkflowNode, WaitForSignalNode, WaitForTimerNode, ParallelForkNode, ParallelJoinNode} from './nodes'
import { WorkflowTransitionEdge } from './WorkflowTransitionEdge'
import { STATUS_COLORS } from '../lib/status-colors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Edit3 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface WorkflowGraphFocusTarget {
  nodeId?: string
  edgeId?: string
  requestId: number
}

export interface WorkflowGraphImplProps {
  initialNodes?: Node[]
  initialEdges?: Edge[]
  onNodesChange?: (nodes: Node[]) => void
  onEdgesChange?: (edges: Edge[]) => void
  onNodeClick?: (event: React.MouseEvent, node: Node) => void
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void
  onConnect?: (connection: Connection) => void
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

  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null)

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
        onNodesChangeProp(nextNodes)
      }
    },
    [setNodes, onNodesChangeProp]
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
      parallelFork: ParallelForkNode,
      parallelJoin: ParallelJoinNode,
    }),
    []
  )

  const edgeTypes = useMemo(
    () => ({
      workflowTransition: WorkflowTransitionEdge,
    }),
    []
  )

  return (
    <div className={`workflow-graph-container ${className}`} style={{ height }}>
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={editable ? onConnect : undefined}
        onNodeClick={onNodeClickProp}
        onEdgeClick={onEdgeClickProp}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance
        }}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{
          padding: 0.2,
          maxZoom: isCompactViewport ? 0.9 : 1,
        }}
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
              const status = (node.data?.status || 'not_started') as keyof typeof STATUS_COLORS
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
