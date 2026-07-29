'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { Node, Edge, Connection } from '@xyflow/react'
import type { WorkflowGraphDropEvent, WorkflowGraphNodesChangeMeta } from './WorkflowGraphImpl'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { RunExecution } from '../lib/run-execution'
import type { TriggerLike } from '../lib/trigger-node'

export type { WorkflowGraphDropEvent, WorkflowGraphNodesChangeMeta } from './WorkflowGraphImpl'

export interface WorkflowGraphFocusTarget {
  nodeId?: string
  edgeId?: string
  requestId: number
}

export interface WorkflowGraphProps {
  initialNodes?: Node[]
  initialEdges?: Edge[]
  onNodesChange?: (nodes: Node[], meta: WorkflowGraphNodesChangeMeta) => void
  onEdgesChange?: (edges: Edge[]) => void
  onNodeClick?: (event: React.MouseEvent, node: Node) => void
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void
  onConnect?: (connection: Connection) => void
  /**
   * Route reattachment (#4233): fired when an existing edge endpoint is dropped
   * on another node. Leaving the edge list unchanged snaps the endpoint back.
   */
  onReconnect?: (oldEdge: Edge, connection: Connection) => void
  /**
   * Drag-from-palette (spec section 4.2): fired when something is dropped on the
   * canvas, carrying the flow-space cursor position and the route under it.
   */
  onCanvasDrop?: (event: WorkflowGraphDropEvent) => void
  editable?: boolean
  className?: string
  height?: string
  focusTarget?: WorkflowGraphFocusTarget | null
  nodeErrorCounts?: Record<string, number>
  /** Render the dashed reverse compensation ghosts (spec section 4.4). */
  showCompensation?: boolean
  /**
   * "Show last run" execution overlay (spec §8.3). Display-only: node statuses
   * and taken routes are applied at render time and never enter the editor's
   * node/edge state, so they cannot reach `graphToDefinition`, the undo stack or
   * an autosave.
   */
  runOverlay?: RunExecution | null
  /**
   * The definition's event triggers (fidelity gap #5). Display-only: the pill is
   * minted at render time and never enters the editor's node state, so it cannot
   * reach `graphToDefinition`, the undo stack or an autosave. `undefined`/`null`
   * renders nothing; an ARRAY opts in, and an EMPTY array still renders — a
   * definition with no triggers is started manually or by API, which is exactly
   * what the pill then says.
   */
  triggers?: TriggerLike[] | null
  /** The definition's enabled flag — a disabled definition starts from nothing. */
  definitionEnabled?: boolean
  /** Opens the definition drawer on its triggers section. */
  onOpenTriggers?: () => void
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
