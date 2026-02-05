'use client'

import { useCallback, useMemo, useEffect } from 'react'
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
} from '@xyflow/react'
import {StartNode, EndNode, UserTaskNode, AutomatedNode, SubWorkflowNode, WaitForSignalNode} from './nodes'
import { WorkflowTransitionEdge } from './WorkflowTransitionEdge'
import { STATUS_COLORS } from '../lib/status-colors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Edit3 } from 'lucide-react'
import { useTheme } from '@open-mercato/ui/theme'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// NOTE: ReactFlow styles should be imported in the page that uses this component
// or in a global CSS file. Import: '@xyflow/react/dist/style.css'

export interface WorkflowGraphProps {
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

/**
 * WorkflowGraph - ReactFlow wrapper component for workflow visualization
 *
 * Provides a graph-based view of workflow definitions with:
 * - Pan and zoom controls
 * - Background grid
 * - Mini-map for navigation
 * - Optional editing capabilities
 */
export function WorkflowGraph({
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
}: WorkflowGraphProps) {
  const t = useT()
  // Use ReactFlow hooks for node and edge state management
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Get theme for dark mode support
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const backgroundDotColor = isDark ? '#374151' : '#e5e7eb'

  // Sync internal state when external state changes (e.g., when parent adds nodes)
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

  // Handle connection between nodes (when user drags from one node to another)
  const onConnect = useCallback(
    (connection: Connection) => {
      if (onConnectProp) {
        // Let parent handle the connection
        onConnectProp(connection)
      } else {
        // Fallback: handle internally if no parent callback
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

  // Notify parent when nodes change
  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChange(changes)
      if (onNodesChangeProp) {
        onNodesChangeProp(changes)
      }
    },
    [onNodesChange, onNodesChangeProp]
  )

  // Notify parent when edges change
  const handleEdgesChange = useCallback(
    (changes: any) => {
      onEdgesChange(changes)
      if (onEdgesChangeProp) {
        onEdgesChangeProp(changes)
      }
    },
    [onEdgesChange, onEdgesChangeProp]
  )

  // Register custom node types
  const nodeTypes = useMemo(
    () => ({
      start: StartNode,
      end: EndNode,
      userTask: UserTaskNode,
      automated: AutomatedNode,
      subWorkflow: SubWorkflowNode,
      waitForSignal: WaitForSignalNode,
    }),
    []
  )

  // Register custom edge types
  const edgeTypes = useMemo(
    () => ({
      workflowTransition: WorkflowTransitionEdge,
    }),
    []
  )

  return (
    <div className={`workflow-graph-container ${className}`} style={{ height }}>
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
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{
          padding: 0.2,
          maxZoom: 1,
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
            color: '#9ca3af',
          },
        }}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={editable}
        proOptions={{ hideAttribution: true }}
      >
        {/* Background grid for visual reference */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color={backgroundDotColor}
        />

        {/* Zoom and pan controls */}
        <Controls
          showZoom={true}
          showFitView={true}
          showInteractive={false}
          position="top-right"
          className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!fill-foreground [&>button:hover]:!bg-muted"
        />

        {/* Mini-map for navigation in large workflows */}
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(node) => {
            // Color nodes by status - using status-based colors
            const status = (node.data?.status || 'not_started') as keyof typeof STATUS_COLORS
            return STATUS_COLORS[status]?.hex || STATUS_COLORS.not_started.hex
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          position="bottom-left"
          className="!bg-card !border !border-border !rounded-lg"
        />

        {/* Info panel */}
        {!editable && (
          <Panel position="top-left" style={{ margin: 10 }}>
            <div className="bg-card rounded-lg shadow-sm border border-border px-4 py-2">
              <p className="text-sm text-muted-foreground font-medium">
                {t('workflows.graph.visualization')}
              </p>
            </div>
          </Panel>
        )}

        {editable && (
          <Panel position="top-left" style={{ margin: 10 }}>
            <Alert variant="info" className="max-w-sm">
              <Edit3 className="size-4" />
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

/**
 * WorkflowGraphReadOnly - Read-only version for viewing workflow execution
 */
export function WorkflowGraphReadOnly({
  nodes,
  edges,
  className = '',
  height = '500px',
}: {
  nodes: Node[]
  edges: Edge[]
  className?: string
  height?: string
}) {
  return (
    <WorkflowGraph
      initialNodes={nodes}
      initialEdges={edges}
      editable={false}
      className={className}
      height={height}
    />
  )
}
