import type { Edge, Node } from '@xyflow/react'
import {
  buildCompensationGhostEdges,
  collectCompensationRoutes,
  compensatingStepIds,
  COMPENSATION_GHOST_EDGE_ID_PREFIX,
  isCompensationGhostEdge,
  WORKFLOW_COMPENSATION_GHOST_EDGE_TYPE,
} from '../compensation-ghosts'
import { graphToDefinition } from '../graph-utils'

/**
 * Step 3.14 (workflows UX Phase 3b): compensation ghosts (spec section 4.4).
 *
 * The ghosts are READ-ONLY visualization of a model the engine already has
 * (`activity.compensation.activityId`, executed LIFO by the compensation
 * handler). The load-bearing guarantees are that they appear only where
 * compensation is actually declared, that they run in REVERSE of the route that
 * declares it, and that they can never reach the saved definition.
 */

function route(id: string, source: string, target: string, activities: unknown[] = []): Edge {
  return { id, source, target, data: { activities } }
}

function step(id: string, type: string, label: string): Node {
  return { id, type, position: { x: 0, y: 0 }, data: { label } }
}

const compensatedActivity = {
  activityId: 'charge_card',
  activityName: 'Charge card',
  activityType: 'CALL_API',
  config: {},
  compensation: { activityId: 'refund_card' },
}

const plainActivity = {
  activityId: 'send_receipt',
  activityName: 'Send receipt',
  activityType: 'SEND_EMAIL',
  config: {},
}

describe('compensation ghosts', () => {
  test('a route whose activity declares compensation yields one reverse ghost', () => {
    const edges = [route('t1', 'start', 'charge', [compensatedActivity])]

    const ghosts = buildCompensationGhostEdges(edges)

    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].source).toBe('charge')
    expect(ghosts[0].target).toBe('start')
    expect(ghosts[0].type).toBe(WORKFLOW_COMPENSATION_GHOST_EDGE_TYPE)
    expect(ghosts[0].id.startsWith(COMPENSATION_GHOST_EDGE_ID_PREFIX)).toBe(true)
    expect(ghosts[0].data).toMatchObject({
      transitionId: 't1',
      compensationActivityIds: ['refund_card'],
      compensatedActivityNames: ['Charge card'],
    })
  })

  test('routes without compensation produce nothing at all', () => {
    const edges = [route('t1', 'start', 'notify', [plainActivity]), route('t2', 'notify', 'end')]

    expect(collectCompensationRoutes(edges)).toEqual([])
    expect(buildCompensationGhostEdges(edges)).toEqual([])
    expect(compensatingStepIds(edges)).toEqual([])
  })

  test('the badge marks the step the compensable route LEAVES', () => {
    const edges = [
      route('t1', 'start', 'charge', [compensatedActivity]),
      route('t2', 'charge', 'end', [plainActivity]),
    ]

    expect(compensatingStepIds(edges)).toEqual(['start'])
  })

  test('one ghost per route no matter how many of its activities compensate', () => {
    const edges = [
      route('t1', 'start', 'charge', [
        compensatedActivity,
        { ...plainActivity, compensation: { activityId: 'unsend_receipt' } },
      ]),
    ]

    const ghosts = buildCompensationGhostEdges(edges)
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].data).toMatchObject({
      compensationActivityIds: ['refund_card', 'unsend_receipt'],
    })
  })

  test('a blank compensation activity id is not compensation', () => {
    const edges = [route('t1', 'start', 'charge', [{ ...compensatedActivity, compensation: { activityId: '' } }])]

    expect(buildCompensationGhostEdges(edges)).toEqual([])
  })

  test('ghosts are non-interactive and recognisable without their type', () => {
    const [ghost] = buildCompensationGhostEdges([route('t1', 'start', 'charge', [compensatedActivity])])

    expect(ghost.selectable).toBe(false)
    expect(ghost.deletable).toBe(false)
    expect(isCompensationGhostEdge(ghost)).toBe(true)
    expect(isCompensationGhostEdge({ ...ghost, type: undefined })).toBe(true)
    expect(isCompensationGhostEdge(route('t1', 'a', 'b'))).toBe(false)
  })

  test('ghosts never enter the saved definition, and never re-ghost themselves', () => {
    const nodes = [step('start', 'start', 'Start'), step('charge', 'automated', 'Charge'), step('end', 'end', 'End')]
    const edges = [
      route('t1', 'start', 'charge', [compensatedActivity]),
      route('t2', 'charge', 'end'),
    ]
    const ghosts = buildCompensationGhostEdges(edges)

    const withoutGhosts = graphToDefinition(nodes, edges)
    const withGhosts = graphToDefinition(nodes, [...edges, ...ghosts])

    expect(withGhosts).toEqual(withoutGhosts)
    expect(withGhosts.transitions.map((transition) => transition.transitionId)).toEqual(['t1', 't2'])
    expect(buildCompensationGhostEdges([...edges, ...ghosts])).toHaveLength(1)
  })

  test('the compensation declaration survives the graph round trip', () => {
    const nodes = [step('start', 'start', 'Start'), step('charge', 'automated', 'Charge')]
    const definition = graphToDefinition(nodes, [route('t1', 'start', 'charge', [compensatedActivity])])

    expect(definition.transitions[0].activities?.[0]).toMatchObject({
      activityId: 'charge_card',
      compensation: { activityId: 'refund_card' },
    })
  })
})
