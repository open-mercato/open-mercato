"use client"

import '@xyflow/react/dist/style.css'

import * as React from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import { EyeOff, Repeat2 } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { useTheme } from '@open-mercato/ui/theme'
import { formatActivityKey, formatCount } from '../../lib/client/xray/format'
import type { XrayGraphModel, XrayGraphNode } from '../../lib/client/xray/graph'
import { layoutProcessGraph } from '../../lib/client/xray/graphLayout'
import { XRAY_CAUSE_BORDER_CLASSES, XRAY_CAUSE_STROKES, XrayCauseBadge } from './XrayCauseBadge'

export type XrayMapSelection = { kind: 'node'; activityKey: string } | { kind: 'edge'; from: string; to: string } | null

export type XrayProcessMapCanvasProps = {
  model: XrayGraphModel
  onSelectionChange?: (selection: XrayMapSelection) => void
}

type ActivityNodeData = { node: XrayGraphNode }

const NODE_TYPE = 'xrayActivity'
const EDGE_WIDTH_MIN = 1.5
const EDGE_WIDTH_RANGE = 4.5
const HIDDEN_EDGE_DASH = '6 4'

function ActivityNode({ data }: NodeProps<Node<ActivityNodeData>>) {
  const t = useT()
  const locale = useLocale()
  const { node } = data
  const terminal = node.kind === 'start' || node.kind === 'end'
  const hidden = node.kind === 'hidden'
  return (
    <div
      className={cn(
        'flex flex-col justify-center gap-1 rounded-md border bg-card px-3 py-2 text-left shadow-xs',
        terminal ? 'h-10 w-30 items-center rounded-full border-border' : 'h-18 w-55 border-l-4',
        !terminal && (hidden ? 'border-dashed border-border bg-muted/30' : cn('border-border', XRAY_CAUSE_BORDER_CLASSES[node.causeClass])),
      )}
      data-testid={`xray-map-node-${node.kind}`}
      data-activity-key={node.activityKey}
    >
      {node.kind !== 'start' ? <Handle type="target" position={Position.Left} isConnectable={false} /> : null}
      <p className="truncate text-sm font-medium text-foreground" title={node.activityKey}>
        {formatActivityKey(node.activityKey, t)}
      </p>
      {hidden ? (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <EyeOff className="size-3" aria-hidden="true" />
          {t('insights.xray.ui.map.hiddenNode')}
        </p>
      ) : null}
      {!hidden && !terminal && node.count !== null ? (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {t('insights.xray.ui.map.nodeCounts', { events: formatCount(node.count, locale), cases: formatCount(node.cases ?? 0, locale) })}
          </span>
          {node.selfLoops > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title={t('insights.xray.ui.map.repeats', { count: formatCount(node.selfLoops, locale) })}>
              <Repeat2 className="size-3" aria-hidden="true" />
              {formatCount(node.selfLoops, locale)}
            </span>
          ) : null}
        </div>
      ) : null}
      {!hidden && !terminal ? <XrayCauseBadge causeClass={node.causeClass} /> : null}
      {node.kind !== 'end' ? <Handle type="source" position={Position.Right} isConnectable={false} /> : null}
    </div>
  )
}

const NODE_TYPES = { [NODE_TYPE]: ActivityNode }

type MapFlowProps = {
  initialNodes: Node<ActivityNodeData>[]
  initialEdges: Edge[]
  onSelectionChange?: (selection: XrayMapSelection) => void
}

/**
 * The React Flow instance of one graph. Nodes and edges live in React Flow state so selection
 * (click, or Tab + Enter from the keyboard) reaches `onSelectionChange`; nothing can be dragged,
 * connected or deleted. Remounted (and fitted to the view) whenever the graph changes.
 */
function MapFlow({ initialNodes, initialEdges, onSelectionChange }: MapFlowProps) {
  const t = useT()
  const { resolvedTheme } = useTheme()
  const [nodes, , handleNodesChange] = useNodesState<Node<ActivityNodeData>>(initialNodes)
  const [edges, , handleEdgesChange] = useEdgesState<Edge>(initialEdges)

  const handleSelection = React.useCallback((params: OnSelectionChangeParams) => {
    if (!onSelectionChange) return
    const selectedNode = params.nodes[0] as Node<ActivityNodeData> | undefined
    if (selectedNode) {
      onSelectionChange({ kind: 'node', activityKey: selectedNode.data.node.activityKey })
      return
    }
    const selectedEdge = params.edges[0]
    const endpoints = selectedEdge?.data as { from?: unknown; to?: unknown } | undefined
    if (endpoints && typeof endpoints.from === 'string' && typeof endpoints.to === 'string') {
      onSelectionChange({ kind: 'edge', from: endpoints.from, to: endpoints.to })
      return
    }
    onSelectionChange(null)
  }, [onSelectionChange])

  const ariaLabelConfig = React.useMemo(() => ({
    'node.a11yDescription.default': t('insights.xray.ui.map.a11yNodes'),
    'node.a11yDescription.keyboardDisabled': t('insights.xray.ui.map.a11yNodes'),
    'edge.a11yDescription.default': t('insights.xray.ui.map.a11yEdges'),
    'controls.ariaLabel': t('insights.xray.ui.map.controls'),
    'controls.zoomIn.ariaLabel': t('insights.xray.ui.map.zoomIn'),
    'controls.zoomOut.ariaLabel': t('insights.xray.ui.map.zoomOut'),
    'controls.fitView.ariaLabel': t('insights.xray.ui.map.fitView'),
  }), [t])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      colorMode={resolvedTheme}
      nodeTypes={NODE_TYPES}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      deleteKeyCode={null}
      elementsSelectable
      nodesFocusable
      edgesFocusable
      onSelectionChange={handleSelection}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      ariaLabelConfig={ariaLabelConfig}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

/**
 * The directly-follows graph on React Flow, laid out left to right with dagre. Read-only: nodes
 * are focusable and selectable from the keyboard (Tab, Enter) to inspect them; edge width
 * follows the transition count, color the dominant cause (chart palette), and edges into or
 * out of a step whose counts are hidden for privacy are dashed.
 */
export default function XrayProcessMapCanvas({ model, onSelectionChange }: XrayProcessMapCanvasProps) {
  const t = useT()
  const locale = useLocale()
  const positions = React.useMemo(() => layoutProcessGraph(model), [model])
  const nodes = React.useMemo<Node<ActivityNodeData>[]>(() => model.nodes.map((node) => {
    const label = formatActivityKey(node.activityKey, t)
    const description = node.kind === 'hidden'
      ? t('insights.xray.ui.map.nodeAriaHidden', { activity: label })
      : node.count === null
        ? label
        : t('insights.xray.ui.map.nodeAria', {
          activity: label,
          events: formatCount(node.count, locale),
          cases: formatCount(node.cases ?? 0, locale),
          cause: t(`insights.xray.ui.cause.${node.causeClass}`),
        })
    return {
      id: node.id,
      type: NODE_TYPE,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { node },
      draggable: false,
      connectable: false,
      deletable: false,
      ariaLabel: description,
    }
  }), [locale, model.nodes, positions, t])
  const edges = React.useMemo<Edge[]>(() => model.edges.map((edge) => {
    const stroke = edge.touchesHidden ? XRAY_CAUSE_STROKES.none : XRAY_CAUSE_STROKES[edge.causeClass]
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: formatCount(edge.count, locale),
      ariaLabel: t('insights.xray.ui.map.edgeAria', {
        from: formatActivityKey(edge.from, t),
        to: formatActivityKey(edge.to, t),
        count: formatCount(edge.count, locale),
        cases: formatCount(edge.cases, locale),
      }),
      data: { from: edge.from, to: edge.to },
      style: {
        stroke,
        strokeWidth: EDGE_WIDTH_MIN + edge.weight * EDGE_WIDTH_RANGE,
        ...(edge.touchesHidden ? { strokeDasharray: HIDDEN_EDGE_DASH } : {}),
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      focusable: true,
      deletable: false,
    }
  }), [locale, model.edges, t])

  const graphKey = React.useMemo(() => [
    locale,
    model.nodes.map((node) => `${node.id}:${node.count ?? '-'}:${node.selfLoops}`).join('|'),
    model.edges.map((edge) => `${edge.id}:${edge.count}`).join('|'),
  ].join('#'), [locale, model])

  return (
    <div className="h-128 w-full overflow-hidden rounded-lg border border-border bg-background" data-testid="xray-process-map">
      <MapFlow key={graphKey} initialNodes={nodes} initialEdges={edges} onSelectionChange={onSelectionChange} />
    </div>
  )
}
