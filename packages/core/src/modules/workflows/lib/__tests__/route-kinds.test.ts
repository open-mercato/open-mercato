import { describe, test, expect } from '@jest/globals'
import { definitionToGraph, graphToDefinition } from '../graph-utils'
import { reattachWorkflowEdge } from '../edge-reattachment'
import { ERROR_SOURCE_HANDLE_ID, ERROR_TRANSITION_KIND } from '../error-routing'
import { SLA_BREACH_SOURCE_HANDLE_ID, SLA_BREACH_TRANSITION_KIND } from '../breach-routing'
import {
  DEFAULT_SOURCE_HANDLE_ID,
  findRouteKindDescriptor,
  findRouteKindDescriptorForHandle,
  isNonNormalRouteKind,
  listRouteKindDescriptors,
  resolveEdgeRouteKind,
} from '../route-kinds'
import { buildDefaultRouteRow } from '../node-outcome-rows'

const steps = [
  { stepId: 'start', stepName: 'Start', stepType: 'START' },
  { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK' },
  { stepId: 'work', stepName: 'Work', stepType: 'AUTOMATED' },
  { stepId: 'escalate', stepName: 'Escalate', stepType: 'USER_TASK' },
  { stepId: 'end', stepName: 'End', stepType: 'END' },
]

function definitionWith(transitions: Record<string, unknown>[]) {
  return { steps, transitions } as any
}

const plainTransitions = [
  { transitionId: 't_a', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
  { transitionId: 't_b', fromStepId: 'review', toStepId: 'work', trigger: 'auto' },
  { transitionId: 't_c', fromStepId: 'work', toStepId: 'escalate', trigger: 'auto' },
  { transitionId: 't_d', fromStepId: 'escalate', toStepId: 'end', trigger: 'auto' },
]

describe('route kind registry', () => {
  test('registers every non-normal kind with a disjoint source handle', () => {
    const descriptors = listRouteKindDescriptors()
    const kinds = descriptors.map((descriptor) => descriptor.kind)
    expect(kinds).toEqual(expect.arrayContaining([ERROR_TRANSITION_KIND, SLA_BREACH_TRANSITION_KIND]))
    expect(new Set(kinds).size).toBe(kinds.length)

    for (const descriptor of descriptors) {
      const handle = descriptor.resolveSourceHandle({})
      const matching = descriptors.filter((other) => other.matchesSourceHandle(handle))
      expect(matching.map((entry) => entry.kind)).toEqual([descriptor.kind])
    }
  })

  test('treats normal and absent kinds as the same absent form', () => {
    expect(findRouteKindDescriptor(undefined)).toBeNull()
    expect(findRouteKindDescriptor('normal')).toBeNull()
    expect(findRouteKindDescriptor('')).toBeNull()
    expect(isNonNormalRouteKind('normal')).toBe(false)
    expect(isNonNormalRouteKind(ERROR_TRANSITION_KIND)).toBe(true)
  })

  test('resolves a kind from the carried data before the handle', () => {
    expect(resolveEdgeRouteKind(SLA_BREACH_TRANSITION_KIND, null)?.kind).toBe(SLA_BREACH_TRANSITION_KIND)
    expect(resolveEdgeRouteKind(undefined, ERROR_SOURCE_HANDLE_ID)?.kind).toBe(ERROR_TRANSITION_KIND)
    expect(resolveEdgeRouteKind(undefined, 'some-other-handle')).toBeNull()
    expect(findRouteKindDescriptorForHandle(SLA_BREACH_SOURCE_HANDLE_ID)?.kind).toBe(SLA_BREACH_TRANSITION_KIND)
  })
})

describe('transition kind round trip through the canvas', () => {
  test.each([ERROR_TRANSITION_KIND, SLA_BREACH_TRANSITION_KIND])(
    'a %s route survives definitionToGraph → graphToDefinition',
    (kind) => {
      const definition = definitionWith([
        ...plainTransitions,
        { transitionId: 't_kinded', fromStepId: 'review', toStepId: 'escalate', trigger: 'auto', kind },
      ])

      const { nodes, edges } = definitionToGraph(definition)
      const kindedEdge = edges.find((edge) => edge.id === 't_kinded')
      expect(kindedEdge?.sourceHandle).toBe(
        findRouteKindDescriptor(kind)?.resolveSourceHandle({}),
      )
      expect((kindedEdge?.data as { kind?: string } | undefined)?.kind).toBe(kind)

      const roundTripped = graphToDefinition(nodes, edges)
      const persisted = roundTripped.transitions.find((transition: any) => transition.transitionId === 't_kinded')
      expect(persisted?.kind).toBe(kind)
    },
  )

  test('a definition carrying no kinds round-trips with no kind fields at all', () => {
    const { nodes, edges } = definitionToGraph(definitionWith(plainTransitions))
    const roundTripped = graphToDefinition(nodes, edges)
    for (const transition of roundTripped.transitions as any[]) {
      expect(transition).not.toHaveProperty('kind')
    }
  })

  test('an explicit normal kind serializes as absent, never as a route off the happy path', () => {
    const { nodes, edges } = definitionToGraph(
      definitionWith([
        { transitionId: 't_a', fromStepId: 'start', toStepId: 'review', trigger: 'auto', kind: 'normal' },
      ]),
    )
    const roundTripped = graphToDefinition(nodes, edges)
    expect(roundTripped.transitions[0]).not.toHaveProperty('kind')
  })

  test('a kinded route never inherits the source automated step activity', () => {
    const definition = definitionWith([
      {
        transitionId: 't_kinded',
        fromStepId: 'work',
        toStepId: 'escalate',
        trigger: 'auto',
        kind: ERROR_TRANSITION_KIND,
      },
    ])
    const { nodes, edges } = definitionToGraph(definition)
    const automated = nodes.find((node) => node.id === 'work')
    if (automated) {
      automated.data = { ...automated.data, activityType: 'CALL_API', activityId: 'call_it' }
    }
    const roundTripped = graphToDefinition(nodes, edges)
    expect((roundTripped.transitions[0] as any).activities).toBeUndefined()
  })
})

describe('the default handle is presentation, never routing', () => {
  test('no route kind claims it, so a connection drawn from it is still a normal route', () => {
    expect(findRouteKindDescriptorForHandle(DEFAULT_SOURCE_HANDLE_ID)).toBeNull()
    expect(resolveEdgeRouteKind(undefined, DEFAULT_SOURCE_HANDLE_ID)).toBeNull()
  })

  test('the footer row that now renders it carries the same id it always had', () => {
    expect(buildDefaultRouteRow().handleId).toBe(DEFAULT_SOURCE_HANDLE_ID)
  })

  test('an agent step with a plain outgoing route round-trips unchanged', () => {
    const definition = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'assess',
          stepName: 'Assess',
          stepType: 'AUTOMATED',
          activities: [{ activityId: 'a1', activityType: 'INVOKE_AGENT', config: { agentId: 'x' } }],
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't_a', fromStepId: 'start', toStepId: 'assess', trigger: 'auto' },
        { transitionId: 't_b', fromStepId: 'assess', toStepId: 'end', trigger: 'auto' },
      ],
    } as any

    const { nodes, edges } = definitionToGraph(definition)
    const plain = edges.find((edge) => edge.id === 't_b')
    expect(plain?.sourceHandle).toBeUndefined()

    const persisted = graphToDefinition(nodes, edges).transitions.find(
      (transition: any) => transition.transitionId === 't_b',
    )
    expect(persisted).not.toHaveProperty('kind')
    expect(persisted).not.toHaveProperty('outcomeKind')
    expect(persisted?.fromStepId).toBe('assess')
    expect(persisted?.toStepId).toBe('end')
  })
})

describe('reattachment keeps a route on its own handle', () => {
  test('an SLA-breach route dropped on another step keeps its kind and handle', () => {
    const { nodes, edges } = definitionToGraph(
      definitionWith([
        ...plainTransitions,
        {
          transitionId: 't_breach',
          fromStepId: 'review',
          toStepId: 'escalate',
          trigger: 'auto',
          kind: SLA_BREACH_TRANSITION_KIND,
        },
      ]),
    )

    const result = reattachWorkflowEdge(nodes, edges, 't_breach', {
      source: 'review',
      target: 'end',
      sourceHandle: null,
      targetHandle: null,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.edge.sourceHandle).toBe(SLA_BREACH_SOURCE_HANDLE_ID)
    expect((result.edge.data as { kind?: string }).kind).toBe(SLA_BREACH_TRANSITION_KIND)
    const persisted = graphToDefinition(nodes, result.edges).transitions.find(
      (transition: any) => transition.transitionId === 't_breach',
    )
    expect(persisted?.kind).toBe(SLA_BREACH_TRANSITION_KIND)
  })

  test('an SLA-breach route is refused on a step that carries no deadline', () => {
    const { nodes, edges } = definitionToGraph(
      definitionWith([
        ...plainTransitions,
        {
          transitionId: 't_breach',
          fromStepId: 'review',
          toStepId: 'escalate',
          trigger: 'auto',
          kind: SLA_BREACH_TRANSITION_KIND,
        },
      ]),
    )

    const result = reattachWorkflowEdge(nodes, edges, 't_breach', {
      source: 'work',
      target: 'escalate',
      sourceHandle: null,
      targetHandle: null,
    })

    expect(result).toEqual({ ok: false, code: 'kindHandleUnsupported' })
  })
})
