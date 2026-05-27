'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { Node, Edge, Connection } from '@xyflow/react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

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

const WorkflowGraphImpl = dynamic(() => import('./WorkflowGraphImpl'), {
  ssr: false,
  loading: () => (
    <div
      className="workflow-graph-container flex items-center justify-center rounded-lg border border-border bg-muted/30"
      style={{ height: '600px' }}
    >
      <Spinner className="h-6 w-6 text-muted-foreground" />
    </div>
  ),
})

/**
 * WorkflowGraph — lazy-loaded ReactFlow wrapper.
 *
 * @xyflow/react is loaded via next/dynamic({ ssr: false }) so the ~12 MB
 * package only enters the Turbopack module graph when this component
 * actually renders.
 */
export function WorkflowGraph(props: WorkflowGraphProps) {
  return <WorkflowGraphImpl {...props} />
}

/**
 * WorkflowGraphReadOnly — read-only viewer that reuses WorkflowGraph.
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
