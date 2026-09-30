/** @jest-environment node */

/**
 * A route the author just drew and the same route re-read from a saved
 * definition must render as the same edge.
 *
 * They did not: `definitionToGraph` typed every stored transition
 * `workflowTransition` (the module's own bezier renderer) while the Studio's
 * `handleConnect` and the insert-on-route splice typed a newly authored NORMAL
 * route `smoothstep`, React Flow's built-in orthogonal renderer — so a freshly
 * drawn route came out as a right-angled staircase and only became a curve
 * after a save and a reload. `defaultEdgeOptions` cannot correct that: ReactFlow
 * merges it UNDER each edge, so an explicit type always wins.
 *
 * Two halves are asserted here: the shapes match, and no source file spells an
 * edge type of its own any more — the duplicated construction WAS the defect.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Edge, Node } from '@xyflow/react'
import { buildWorkflowRouteEdge, WORKFLOW_TRANSITION_EDGE_TYPE } from '../route-edge'
import { definitionToGraph, graphToDefinition } from '../graph-utils'
import { insertStepOnRoute } from '../palette-drop'

const nodes: Node[] = [
  { id: 'start_1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
  { id: 'notify_1', type: 'automated', position: { x: 300, y: 0 }, data: { label: 'Notify' } },
  { id: 'end_1', type: 'end', position: { x: 600, y: 0 }, data: { label: 'End' } },
]

/** Everything about an edge that decides how React Flow draws it. */
function renderShape(edge: Edge | undefined) {
  return {
    type: edge?.type,
    sourceHandle: edge?.sourceHandle ?? null,
    targetHandle: edge?.targetHandle ?? null,
  }
}

function drawnRoute(overrides: Partial<Parameters<typeof buildWorkflowRouteEdge>[0]> = {}): Edge {
  return buildWorkflowRouteEdge({
    id: 't_drawn',
    source: 'start_1',
    target: 'notify_1',
    data: {
      trigger: 'auto',
      preConditions: [],
      postConditions: [],
      activities: [],
      label: '',
    },
    ...overrides,
  })
}

describe('a drawn route and a loaded route are the same edge', () => {
  test('both take the workflow transition renderer, never a built-in step edge', () => {
    const drawn = drawnRoute()
    const definition = graphToDefinition(nodes, [drawn])
    const loaded = definitionToGraph(definition).edges.find((edge) => edge.id === 't_drawn')

    expect(drawn.type).toBe(WORKFLOW_TRANSITION_EDGE_TYPE)
    expect(renderShape(loaded)).toEqual(renderShape(drawn))
  })

  test('the insert-on-route continuation is built the same way', () => {
    const original = drawnRoute({ id: 't_main', target: 'end_1' })
    const spliced = insertStepOnRoute(nodes, [original], 't_main', {
      id: 'inserted_1',
      type: 'automated',
      position: { x: 300, y: 0 },
      data: { label: 'Inserted' },
    })

    expect(spliced.ok).toBe(true)
    if (!spliced.ok) return
    for (const edge of spliced.edges) {
      expect(edge.type).toBe(WORKFLOW_TRANSITION_EDGE_TYPE)
    }
  })

  test('omits a handle it was not given, so a plain route keeps its stored shape', () => {
    const edge = buildWorkflowRouteEdge({ id: 't_1', source: 'a', target: 'b' })
    expect(Object.prototype.hasOwnProperty.call(edge, 'sourceHandle')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(edge, 'targetHandle')).toBe(false)
    expect(edge.data).toEqual({})
  })
})

describe('the edge type is render-time only', () => {
  test('two edges differing only in type compile to the same transition', () => {
    const drawn = drawnRoute()
    const legacyStepEdge: Edge = { ...drawn, type: 'smoothstep' }

    expect(graphToDefinition(nodes, [legacyStepEdge])).toEqual(graphToDefinition(nodes, [drawn]))
  })
})

const MODULE_ROOT = path.join(__dirname, '..', '..')
const SCANNED_DIRS = ['lib', 'components', 'backend']
/** React Flow's built-in edge renderers — none of them draws a workflow route. */
const BUILT_IN_EDGE_TYPES = /type:\s*'(?:smoothstep|step|straight|default|bezier)'/
/**
 * The deprecated trigger overlay's connector is NOT a control-flow route: it is
 * an inert dashed line to a pill the engine never executes, deliberately drawn
 * with a built-in edge. It is the one file this rule does not govern.
 */
const NON_ROUTE_EDGE_FILES = new Set([path.join('lib', 'trigger-node.ts')])

function sourceFiles(dir: string): string[] {
  const absolute = path.join(MODULE_ROOT, dir)
  const entries = fs.readdirSync(absolute, { withFileTypes: true })
  return entries.flatMap((entry) => {
    if (entry.name === '__tests__') return []
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name))
    if (!/\.tsx?$/.test(entry.name)) return []
    return [path.join(dir, entry.name)]
  })
}

describe('route edges are constructed in exactly one place', () => {
  const files = SCANNED_DIRS.flatMap(sourceFiles)

  test('scans the module sources it claims to', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  test('no source assigns a route one of React Flow built-in edge types', () => {
    const offenders = files
      .filter((file) => !NON_ROUTE_EDGE_FILES.has(file))
      .filter((file) => BUILT_IN_EDGE_TYPES.test(fs.readFileSync(path.join(MODULE_ROOT, file), 'utf8')))
    expect(offenders).toEqual([])
  })

  test('only route-edge.ts names the workflow transition edge type as a literal', () => {
    const offenders = files.filter(
      (file) =>
        file !== path.join('lib', 'route-edge.ts') &&
        /'workflowTransition'/.test(fs.readFileSync(path.join(MODULE_ROOT, file), 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
