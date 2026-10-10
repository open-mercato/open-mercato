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
  type ReactFlowInstance,
} from '@xyflow/react'
import { EyeOff, Repeat2 } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { useTheme } from '@open-mercato/ui/theme'
import { formatActivityKey, formatCount, type XrayActivityLabelMap } from '../../lib/client/xray/format'
import type { XrayGraphModel, XrayGraphNode } from '../../lib/client/xray/graph'
import {
  initialMapViewport,
  layoutProcessGraph,
  processMapHeight,
  type XrayGraphLayout,
} from '../../lib/client/xray/graphLayout'
import { XRAY_CAUSE_BORDER_CLASSES, XRAY_CAUSE_STROKES, XrayCauseBadge } from './XrayCauseBadge'

export type XrayMapSelection = { kind: 'node'; activityKey: string } | { kind: 'edge'; from: string; to: string } | null

export type XrayProcessMapCanvasProps = {
  model: XrayGraphModel
  /** Server-resolved labels of the map response (`activityLabels`). */
  labels?: XrayActivityLabelMap
  onSelectionChange?: (selection: XrayMapSelection) => void
}

type ActivityNodeData = { node: XrayGraphNode; label: string }

const NODE_TYPE = 'xrayActivity'
const EDGE_WIDTH_MIN = 1.5
const EDGE_WIDTH_RANGE = 2
const HIDDEN_EDGE_DASH = '6 4'
const ARROW_SIZE = 28
const MIN_ZOOM = 0.2
const MAX_ZOOM = 1.5

function ActivityNode({ data }: NodeProps<Node<ActivityNodeData>>) {
  const t = useT()
  const locale = useLocale()
  const { node, label } = data
  const terminal = node.kind === 'start' || node.kind === 'end'
  const hidden = node.kind === 'hidden'
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col justify-center gap-1 rounded-md border bg-card px-3 py-2 text-left shadow-xs',
        terminal ? 'items-center rounded-full border-border' : 'border-l-4',
        !terminal && (hidden ? 'border-dashed border-border bg-muted/30' : cn('border-border', XRAY_CAUSE_BORDER_CLASSES[node.causeClass])),
      )}
      data-testid={`xray-map-node-${node.kind}`}
      data-activity-key={hidden ? undefined : node.activityKey}
    >
      {node.kind !== 'start' ? <Handle type="target" position={Position.Top} isConnectable={false} className="opacity-0" /> : null}
      <p className="truncate text-sm font-medium text-foreground" title={hidden ? undefined : `${label} (${node.activityKey})`}>
        {label}
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
      {node.kind !== 'end' ? <Handle type="source" position={Position.Bottom} isConnectable={false} className="opacity-0" /> : null}
    </div>
  )
}

const NODE_TYPES = { [NODE_TYPE]: ActivityNode }

type MapFlowProps = {
  initialNodes: Node<ActivityNodeData>[]
  initialEdges: Edge[]
  layout: XrayGraphLayout
  firstNodeId: string | null
  canvasRef: React.RefObject<HTMLDivElement | null>
  onSelectionChange?: (selection: XrayMapSelection) => void
}

/**
 * The React Flow instance of one graph. Nodes and edges live in React Flow state so selection
 * (click, or Tab + Enter from the keyboard) reaches `onSelectionChange`; nothing can be dragged,
 * connected or deleted. Remounted whenever the graph changes; the initial view keeps labels
 * readable (`initialMapViewport`), and the user can still zoom out or fit the whole map.
 */
function MapFlow({ initialNodes, initialEdges, layout, firstNodeId, canvasRef, onSelectionChange }: MapFlowProps) {
  const t = useT()
  const { resolvedTheme } = useTheme()
  const [nodes, , handleNodesChange] = useNodesState<Node<ActivityNodeData>>(initialNodes)
  const [edges, , handleEdgesChange] = useEdgesState<Edge>(initialEdges)

  const handleInit = React.useCallback((instance: ReactFlowInstance<Node<ActivityNodeData>, Edge>) => {
    const canvas = canvasRef.current
    const width = canvas?.clientWidth ?? 0
    const height = canvas?.clientHeight ?? 0
    if (width <= 0 || height <= 0) {
      void instance.fitView({ padding: 0.1, maxZoom: 1 })
      return
    }
    void instance.setViewport(initialMapViewport(layout, { width, height }, firstNodeId))
  }, [canvasRef, firstNodeId, layout])

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
      onInit={handleInit}
      nodesDraggable={false}
      nodesConnectable={false}
      deleteKeyCode={null}
      elementsSelectable
      nodesFocusable
      edgesFocusable
      onSelectionChange={handleSelection}
      proOptions={{ hideAttribution: true }}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      ariaLabelConfig={ariaLabelConfig}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} fitViewOptions={{ padding: 0.1, maxZoom: 1 }} />
    </ReactFlow>
  )
}

/**
 * The directly-follows graph on React Flow, laid out top to bottom with dagre. Read-only: nodes
 * are focusable and selectable from the keyboard (Tab, Enter) to inspect them; node boxes fit
 * their labels (server-resolved, readable activity names); edge width follows the transition
 * count, color the dominant cause (chart palette), arrowheads keep a fixed size; edges into or
 * out of a step whose counts are hidden for privacy are dashed and that step shows a
 * placeholder instead of its name. The canvas height follows the graph within bounds.
 */
export default function XrayProcessMapCanvas({ model, labels, onSelectionChange }: XrayProcessMapCanvasProps) {
  const t = useT()
  const locale = useLocale()
  const canvasRef = React.useRef<HTMLDivElement | null>(null)
  const labelOf = React.useCallback(
    (node: XrayGraphNode) => (node.kind === 'hidden' ? t('insights.xray.ui.map.hiddenStep') : formatActivityKey(node.activityKey, t, labels)),
    [labels, t],
  )
  const endpointLabel = React.useCallback((activityKey: string) => {
    const node = model.nodes.find((candidate) => candidate.activityKey === activityKey)
    return node ? labelOf(node) : formatActivityKey(activityKey, t, labels)
  }, [labelOf, labels, model.nodes, t])
  const layout = React.useMemo(() => layoutProcessGraph(model, labelOf), [labelOf, model])
  const firstNodeId = React.useMemo(
    () => model.nodes.find((node) => node.kind === 'start')?.id ?? model.nodes[0]?.id ?? null,
    [model.nodes],
  )
  const nodes = React.useMemo<Node<ActivityNodeData>[]>(() => model.nodes.map((node) => {
    const label = labelOf(node)
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
    const box = layout.boxes.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 }
    return {
      id: node.id,
      type: NODE_TYPE,
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: { node, label },
      draggable: false,
      connectable: false,
      deletable: false,
      ariaLabel: description,
    }
  }), [labelOf, layout, locale, model.nodes, t])
  const edges = React.useMemo<Edge[]>(() => model.edges.map((edge) => {
    const stroke = edge.touchesHidden ? XRAY_CAUSE_STROKES.none : XRAY_CAUSE_STROKES[edge.causeClass]
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: formatCount(edge.count, locale),
      ariaLabel: t('insights.xray.ui.map.edgeAria', {
        from: endpointLabel(edge.from),
        to: endpointLabel(edge.to),
        count: formatCount(edge.count, locale),
        cases: formatCount(edge.cases, locale),
      }),
      data: { from: edge.from, to: edge.to },
      style: {
        stroke,
        strokeWidth: EDGE_WIDTH_MIN + edge.weight * EDGE_WIDTH_RANGE,
        ...(edge.touchesHidden ? { strokeDasharray: HIDDEN_EDGE_DASH } : {}),
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: ARROW_SIZE, height: ARROW_SIZE, markerUnits: 'userSpaceOnUse' },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      focusable: true,
      deletable: false,
    }
  }), [endpointLabel, locale, model.edges, t])

  const graphKey = React.useMemo(() => [
    locale,
    model.nodes.map((node) => `${node.id}:${node.count ?? '-'}:${node.selfLoops}:${labelOf(node)}`).join('|'),
    model.edges.map((edge) => `${edge.id}:${edge.count}`).join('|'),
  ].join('#'), [labelOf, locale, model])
  const height = processMapHeight(layout)

  return (
    <div
      ref={canvasRef}
      className="w-full overflow-hidden rounded-lg border border-border bg-background"
      style={{ height }}
      data-testid="xray-process-map"
      data-map-height={height}
    >
      <MapFlow
        key={graphKey}
        initialNodes={nodes}
        initialEdges={edges}
        layout={layout}
        firstNodeId={firstNodeId}
        canvasRef={canvasRef}
        onSelectionChange={onSelectionChange}
      />
    </div>
  )
}
