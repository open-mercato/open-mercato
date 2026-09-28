'use client'

import * as React from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import type { Edge, Node, NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { campaignNodeTypes } from './nodes'

export type CampaignCanvasProps = {
  nodes: Node[]
  edges: Edge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  onPositionsChange: (positions: Record<string, { x: number; y: number }>) => void
  height?: string
}

function Canvas({
  nodes: incomingNodes,
  edges: incomingEdges,
  selectedNodeId,
  onSelectNode,
  onPositionsChange,
  height = '70vh',
}: CampaignCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(incomingNodes)
  const [edges, setEdges] = useEdgesState(incomingEdges)

  // The graph is a rendering of the definition, so when the definition changes the canvas is
  // rebuilt from it rather than merged into — there is no canvas-only state worth preserving
  // except positions, which travel inside the definition itself.
  React.useEffect(() => { setNodes(incomingNodes) }, [incomingNodes, setNodes])
  React.useEffect(() => { setEdges(incomingEdges) }, [incomingEdges, setEdges])

  const handleNodesChange = React.useCallback((changes: NodeChange[]) => {
    onNodesChange(changes)
    // Only a finished drag is reported. Reporting every intermediate position would mark the
    // campaign dirty on a one-pixel nudge and flood the parent with renders.
    const settled = changes.some((change) => change.type === 'position' && change.dragging === false)
    if (!settled) return
    setNodes((current) => {
      onPositionsChange(Object.fromEntries(current.map((node) => [node.id, { x: node.position.x, y: node.position.y }])))
      return current
    })
  }, [onNodesChange, onPositionsChange, setNodes])

  const nodesWithSelection = React.useMemo(
    () => nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [nodes, selectedNodeId],
  )

  return (
    <div style={{ height }} className="rounded-md border border-border bg-background">
      <ReactFlow
        nodes={nodesWithSelection}
        edges={edges}
        nodeTypes={campaignNodeTypes as never}
        onNodesChange={handleNodesChange}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        // A campaign is a spine, not a free graph: there is no branching for a user-drawn edge
        // to mean, so connecting and deleting edges is off and the edge set stays derived.
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export default function CampaignCanvasImpl(props: CampaignCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
