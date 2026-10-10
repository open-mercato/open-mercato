import { XRAY_GRAPH_NODE_MAX_WIDTH, XRAY_GRAPH_NODE_MIN_WIDTH, buildProcessGraph, dominantCause, estimateLabelWidth, graphNodeSize } from '../graph'
import {
  XRAY_MAP_MAX_HEIGHT,
  XRAY_MAP_MIN_HEIGHT,
  XRAY_MAP_READABLE_ZOOM,
  initialMapViewport,
  layoutProcessGraph,
  processMapHeight,
} from '../graphLayout'
import { filterQueryParams, xrayAnalyticsUrl, EMPTY_XRAY_FILTERS } from '../api'
import { formatActivityKey, formatDurationMs } from '../format'
import { cycleTimeFigure } from '../durations'
import { parseWindowParam, resolveCustomWindow, serializeWindow, windowQueryParams } from '../window'
import { readProcessUrlState, writeProcessUrlState } from '../urlState'
import { summarizeDraftPayload, readCreatedDefinitionId } from '../draft'

const translate = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)

function cell(raw: number, collapsed: number, human = collapsed, automated = 0, legacy = 0) {
  return { raw, collapsed, cases: Math.max(raw, collapsed), causes: { human, automated, legacy, other: 0, byKind: {} } }
}

describe('buildProcessGraph', () => {
  const map = {
    nodes: [
      { activityKey: 'created', activityKind: 'lifecycle', ...cell(10, 10) },
      { activityKey: 'status:open', activityKind: 'stage', ...cell(12, 10, 2, 8) },
      { activityKey: 'status:won', activityKind: 'stage', ...cell(6, 0) },
    ],
    edges: [
      { from: '__start__', to: 'created', ...cell(10, 10) },
      { from: 'created', to: 'status:open', ...cell(12, 10) },
      { from: 'status:open', to: 'status:hidden', ...cell(5, 5) },
      { from: 'status:open', to: 'status:open', ...cell(3, 2) },
      { from: 'status:open', to: 'status:won', ...cell(6, 0) },
    ],
  }

  it('keeps transitions into a suppressed step with a hidden placeholder node and no counts', () => {
    const graph = buildProcessGraph(map, 'collapsed')
    const hidden = graph.nodes.find((node) => node.activityKey === 'status:hidden')
    expect(hidden).toEqual(expect.objectContaining({ kind: 'hidden', count: null, cases: null }))
    expect(graph.hiddenNodes).toBe(1)
    expect(graph.edges.find((edge) => edge.to === 'status:hidden')?.touchesHidden).toBe(true)
    expect(graph.edges.find((edge) => edge.to === 'status:open')?.touchesHidden).toBe(false)
    expect(graph.nodes.find((node) => node.activityKey === '__start__')?.kind).toBe('start')
  })

  it('counts raw or collapsed steps and drops cells that collapse to nothing', () => {
    const collapsed = buildProcessGraph(map, 'collapsed')
    const raw = buildProcessGraph(map, 'raw')
    expect(collapsed.nodes.find((node) => node.activityKey === 'status:won')).toBeUndefined()
    expect(raw.nodes.find((node) => node.activityKey === 'status:won')?.count).toBe(6)
    expect(collapsed.nodes.find((node) => node.activityKey === 'status:open')?.count).toBe(10)
    expect(raw.nodes.find((node) => node.activityKey === 'status:open')?.count).toBe(12)
    expect(collapsed.edges.some((edge) => edge.to === 'status:won')).toBe(false)
  })

  it('turns repeats of one step into a self-loop count instead of an edge', () => {
    const graph = buildProcessGraph(map, 'raw')
    expect(graph.edges.some((edge) => edge.from === edge.to)).toBe(false)
    expect(graph.nodes.find((node) => node.activityKey === 'status:open')?.selfLoops).toBe(3)
  })

  it('classifies the dominant cause, never counting legacy rows as human', () => {
    expect(dominantCause({ human: 7, automated: 3, legacy: 0, other: 0, byKind: {} })).toBe('human')
    expect(dominantCause({ human: 2, automated: 8, legacy: 0, other: 0, byKind: {} })).toBe('automated')
    expect(dominantCause({ human: 0, automated: 0, legacy: 5, other: 0, byKind: {} })).toBe('legacy')
    expect(dominantCause({ human: 5, automated: 5, legacy: 0, other: 0, byKind: {} })).toBe('mixed')
    expect(dominantCause({ human: 0, automated: 0, legacy: 0, other: 0, byKind: {} })).toBe('none')
  })

  it('lays the graph out top to bottom with boxes sized from the labels and no overlap', () => {
    const graph = buildProcessGraph(map, 'raw')
    const labels: Record<string, string> = { 'status:open': 'Status: A rather long open status label' }
    const layout = layoutProcessGraph(graph, (node) => labels[node.activityKey] ?? node.activityKey)
    expect(layout.boxes.size).toBe(graph.nodes.length)
    const boxOf = (key: string) => layout.boxes.get(graph.nodes.find((node) => node.activityKey === key)?.id ?? '')
    const start = boxOf('__start__')
    const created = boxOf('created')
    const open = boxOf('status:open')
    expect(start && created && open).toBeTruthy()
    expect(start!.y + start!.height).toBeLessThanOrEqual(created!.y)
    expect(created!.y + created!.height).toBeLessThanOrEqual(open!.y)
    expect(open!.width).toBeGreaterThan(created!.width)
    const boxes = Array.from(layout.boxes.values())
    for (const [index, left] of boxes.entries()) {
      for (const right of boxes.slice(index + 1)) {
        const overlaps = left.x < right.x + right.width && right.x < left.x + left.width && left.y < right.y + right.height && right.y < left.y + left.height
        expect(overlaps).toBe(false)
      }
    }
    expect(layout.bounds.height).toBeGreaterThan(0)
  })

  it('sizes node boxes from their label within bounds (wide glyphs count double)', () => {
    expect(estimateLabelWidth('상태')).toBeGreaterThan(estimateLabelWidth('ab'))
    expect(graphNodeSize({ kind: 'activity' }, 'x').width).toBe(XRAY_GRAPH_NODE_MIN_WIDTH)
    expect(graphNodeSize({ kind: 'activity' }, 'x'.repeat(200)).width).toBe(XRAY_GRAPH_NODE_MAX_WIDTH)
    expect(graphNodeSize({ kind: 'hidden' }, 'Hidden step').height).toBeLessThan(graphNodeSize({ kind: 'activity' }, 'Hidden step').height)
    expect(graphNodeSize({ kind: 'start' }, 'Start').height).toBeLessThan(graphNodeSize({ kind: 'activity' }, 'Start').height)
  })

  it('keeps labels readable: the initial zoom never drops below the readable zoom and long maps start at the top', () => {
    const chain = {
      nodes: Array.from({ length: 7 }, (_, index) => ({ activityKey: `status:s${index}`, activityKind: 'stage', ...cell(10, 10) })),
      edges: [
        { from: '__start__', to: 'status:s0', ...cell(10, 10) },
        ...Array.from({ length: 6 }, (_, index) => ({ from: `status:s${index}`, to: `status:s${index + 1}`, ...cell(10, 10) })),
        { from: 'status:s6', to: '__end__', ...cell(10, 10) },
      ],
    }
    const graph = buildProcessGraph(chain, 'raw')
    const layout = layoutProcessGraph(graph, (node) => `Status: step ${node.activityKey}`)
    const height = processMapHeight(layout)
    expect(height).toBe(XRAY_MAP_MAX_HEIGHT)
    const startId = graph.nodes.find((node) => node.kind === 'start')?.id ?? null
    const viewport = initialMapViewport(layout, { width: 900, height }, startId)
    expect(viewport.zoom).toBe(XRAY_MAP_READABLE_ZOOM)
    const startBox = layout.boxes.get(startId ?? '')
    expect(startBox).toBeDefined()
    expect(startBox!.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(0)
    expect(startBox!.y * viewport.zoom + viewport.y).toBeLessThan(64)

    const short = layoutProcessGraph(buildProcessGraph({ nodes: [chain.nodes[0]], edges: [chain.edges[0]] }, 'raw'), () => 'Created')
    expect(processMapHeight(short)).toBe(XRAY_MAP_MIN_HEIGHT)
    expect(initialMapViewport(short, { width: 900, height: XRAY_MAP_MIN_HEIGHT }, null).zoom).toBe(1)
  })
})

describe('X-Ray windows', () => {
  it('accepts a custom range of at most 180 days and refuses longer or reversed ones', () => {
    expect(resolveCustomWindow('2026-01-01', '2026-06-28')).toEqual(expect.objectContaining({ from: expect.any(String), to: expect.any(String) }))
    expect(resolveCustomWindow('2026-01-01', '2026-07-31')).toEqual({ issue: 'too_long' })
    expect(resolveCustomWindow('2026-03-01', '2026-02-01')).toEqual({ issue: 'order' })
    expect(resolveCustomWindow('2026-02-30', '2026-03-01')).toEqual({ issue: 'invalid' })
  })

  it('round-trips windows through the URL and falls back to 30 days', () => {
    expect(parseWindowParam(serializeWindow({ kind: 'custom', start: '2026-01-01', end: '2026-01-31' }))).toEqual({ kind: 'custom', start: '2026-01-01', end: '2026-01-31' })
    expect(parseWindowParam('7d')).toEqual({ kind: 'preset', key: '7d' })
    expect(parseWindowParam('1y')).toEqual({ kind: 'preset', key: '30d' })
    expect(parseWindowParam('2026-01-01..nope')).toEqual({ kind: 'preset', key: '30d' })
    expect(parseWindowParam('2026-01-01..2026-12-31')).toEqual({ kind: 'preset', key: '30d' })
    expect(parseWindowParam('2026-03-01..2026-02-01')).toEqual({ kind: 'preset', key: '30d' })
  })

  it('omits the time zone of default windows (organization zone and rollups apply)', () => {
    expect(windowQueryParams({ kind: 'preset', key: '90d' })).toEqual({ window: '90d' })
    expect(windowQueryParams({ kind: 'custom', start: '2026-01-01', end: '2027-01-01' })).toBeNull()
  })
})

describe('X-Ray analytics URLs', () => {
  it('serializes window, filters and drill-down parameters', () => {
    const url = new URL(xrayAnalyticsUrl('customers.deal', 'cases', { kind: 'preset', key: '7d' }, {
      causeKinds: ['user', 'legacy'],
      includeSyncRun: true,
      actorRoleIds: ['a1'],
      actorTeamIds: [],
    }, { pageSize: 50, cursor: null }) ?? '', 'http://localhost')
    expect(url.pathname).toBe('/api/insights/xray/customers.deal/cases')
    expect(Object.fromEntries(url.searchParams)).toEqual({ window: '7d', causeKinds: 'user,legacy', actorRoleIds: 'a1', includeSyncRun: 'true', pageSize: '50' })
    expect(filterQueryParams(EMPTY_XRAY_FILTERS)).toEqual({})
  })

  it('keeps the process page state in the URL and ignores malformed values', () => {
    const query = writeProcessUrlState({
      tab: 'breakdown',
      window: { kind: 'preset', key: '90d' },
      filters: { causeKinds: ['user'], includeSyncRun: true, actorRoleIds: ['AAAAAAAA-0000-4000-8000-000000000001'], actorTeamIds: [] },
    })
    const state = readProcessUrlState(new URLSearchParams(`${query}&teams=not-a-uuid`))
    expect(state.tab).toBe('breakdown')
    expect(state.window).toEqual({ kind: 'preset', key: '90d' })
    expect(state.filters).toEqual({ causeKinds: ['user'], includeSyncRun: true, actorRoleIds: ['aaaaaaaa-0000-4000-8000-000000000001'], actorTeamIds: [] })
    expect(readProcessUrlState(new URLSearchParams('tab=nope')).tab).toBe('map')
  })
})

describe('X-Ray formatting', () => {
  it('labels activity keys without exposing full ids', () => {
    expect(formatActivityKey('created', translate)).toBe('insights.xray.ui.activity.created')
    expect(formatActivityKey('ownerUserId:changed', translate)).toBe('insights.xray.ui.activity.fieldChanged:{"field":"ownerUserId"}')
    expect(formatActivityKey('pipelineStageId:12345678-1234-4123-8123-123456789012', translate))
      .toBe('insights.xray.ui.activity.fieldValue:{"field":"pipelineStageId","value":"12345678…"}')
    expect(formatActivityKey('quote.created', translate)).toBe('quote.created')
  })

  it('prefers the server label of the response and ignores blank or inherited entries', () => {
    const labels = { 'status:won': 'Status: Won', 'status:blank': '  ' }
    expect(formatActivityKey('status:won', translate, labels)).toBe('Status: Won')
    expect(formatActivityKey('status:blank', translate, labels)).toBe('insights.xray.ui.activity.fieldValue:{"field":"status","value":"blank"}')
    expect(formatActivityKey('created', translate, labels)).toBe('insights.xray.ui.activity.created')
    expect(formatActivityKey('constructor', translate, labels)).toBe('constructor')
    expect(formatActivityKey('created', translate, null)).toBe('insights.xray.ui.activity.created')
  })

  it('formats durations with their two largest units', () => {
    expect(formatDurationMs(((2 * 24 + 5) * 60 + 3) * 60 * 1000, translate)).toBe('insights.xray.ui.duration.daysHours:{"days":2,"hours":5}')
    expect(formatDurationMs(45 * 1000, translate)).toBe('insights.xray.ui.duration.seconds:{"seconds":45}')
    expect(formatDurationMs(450, translate)).toBe('insights.xray.ui.duration.underSecond')
    expect(formatDurationMs(null, translate)).toBeNull()
  })

  it('reports cycle-time figures only above their n guards', () => {
    const stats = (n: number, medianMs: number | null, p90Ms: number | null) => ({ empty: false, stats: { n, medianMs, p90Ms, lowConfidence: n < 30 }, histogram: [], excludedSyncRun: 0 })
    expect(cycleTimeFigure(null, 'median')).toEqual({ kind: 'hidden' })
    expect(cycleTimeFigure(stats(4, null, null), 'median')).toEqual({ kind: 'too_few', n: 4, minimum: 5 })
    expect(cycleTimeFigure(stats(10, 1000, null), 'p90')).toEqual({ kind: 'too_few', n: 10, minimum: 20 })
    expect(cycleTimeFigure(stats(10, 1000, null), 'median')).toEqual({ kind: 'value', valueMs: 1000, n: 10, lowConfidence: true })
  })
})

describe('draft payload summary', () => {
  it('reads the trigger and update steps of a generated draft', () => {
    const summary = summarizeDraftPayload({
      workflowId: 'xray.s.customers.deal.abc',
      workflowName: 'Deal: set status',
      enabled: false,
      lifecycle: 'draft',
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 's1', stepName: 'Set status', stepType: 'AUTOMATED', activities: [{ activityType: 'UPDATE_ENTITY', config: { commandId: 'customers.deals.update', input: { id: '{{context.recordId}}', status: 'qa_review' } } }] },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        triggers: [{ eventPattern: 'customers.deal.created', config: { filterConditions: [{ field: 'x', operator: 'eq', value: 'y' }] } }],
      },
    })
    expect(summary).toEqual({
      workflowId: 'xray.s.customers.deal.abc',
      workflowName: 'Deal: set status',
      enabled: false,
      lifecycle: 'draft',
      steps: [{ stepId: 's1', stepName: 'Set status', stepType: 'AUTOMATED', updates: [{ commandId: 'customers.deals.update', inputKeys: ['status'] }] }],
      triggers: [{ eventPattern: 'customers.deal.created', conditions: 1 }],
    })
    expect(summarizeDraftPayload({ definition: {} })).toBeNull()
    expect(readCreatedDefinitionId({ data: { id: 'def-1' } })).toBe('def-1')
    expect(readCreatedDefinitionId({ error: 'x' })).toBeNull()
  })
})
