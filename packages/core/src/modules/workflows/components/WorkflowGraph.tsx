'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { Node, Edge, Connection } from '@xyflow/react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export interface WorkflowGraphProps {
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
}

const WorkflowGraphImpl = dynamic(() => import('./WorkflowGraphImpl'), {
  ssr: false,
  loading: () => null,
})

function WorkflowGraphPlaceholder({ height }: { height: string }) {
  return (
    <div
      className="workflow-graph-container flex items-center justify-center rounded-lg border border-border bg-muted/30"
      style={{ height }}
    >
      <Spinner className="h-6 w-6 text-muted-foreground" />
    </div>
  )
}

/**
 * WorkflowGraph — lazy-loaded ReactFlow wrapper.
 *
 * @xyflow/react is loaded via next/dynamic({ ssr: false }) so the ~12 MB
 * package only enters the Turbopack module graph when this component
 * actually renders.
 */
export function WorkflowGraph(props: WorkflowGraphProps) {
  const { height = '600px' } = props
  // Track impl-chunk readiness so the loading placeholder respects the
  // caller's `height` prop (next/dynamic's `loading` cannot access props).
  // The browser caches the module, so the duplicate `import()` is free.
  const [isImplReady, setIsImplReady] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    void import('./WorkflowGraphImpl').then(() => {
      if (!cancelled) setIsImplReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!isImplReady) return <WorkflowGraphPlaceholder height={height} />
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
  onNodeClick,
}: {
  nodes: Node[]
  edges: Edge[]
  className?: string
  height?: string
  onNodeClick?: (event: React.MouseEvent, node: Node) => void
}) {
  return (
    <WorkflowGraph
      initialNodes={nodes}
      initialEdges={edges}
      editable={false}
      className={className}
      height={height}
      onNodeClick={onNodeClick}
    />
  )
}
