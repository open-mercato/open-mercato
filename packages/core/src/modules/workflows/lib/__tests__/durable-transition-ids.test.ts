import { describe, test, expect } from '@jest/globals'
import {
  generateTransitionId,
  isLegacyTransitionId,
  DURABLE_TRANSITION_ID_PREFIX,
  definitionToGraph,
  graphToDefinition,
} from '../graph-utils'
import { openFork } from '../parallel-handler'
import { workflowTransitionSchema } from '../../data/validators'
import { WorkflowBranchInstance } from '../../data/entities'

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'

const legacyDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
    { stepId: 'approve', stepName: 'Approve', stepType: 'USER_TASK' as const },
    { stepId: 'end', stepName: 'End', stepType: 'END' as const },
  ],
  transitions: [
    {
      transitionId: 'e_start_approve',
      fromStepId: 'start',
      toStepId: 'approve',
      trigger: 'auto' as const,
      priority: 10,
      activities: [],
    },
    {
      transitionId: 'e_approve_end',
      fromStepId: 'approve',
      toStepId: 'end',
      trigger: 'auto' as const,
      priority: 0,
      activities: [],
    },
  ],
}

describe('generateTransitionId', () => {
  test('mints opaque ids that do not embed the endpoints', () => {
    const id = generateTransitionId('start_step', 'approve_step')

    expect(id.startsWith(DURABLE_TRANSITION_ID_PREFIX)).toBe(true)
    expect(id).not.toContain('start_step')
    expect(id).not.toContain('approve_step')
    expect(isLegacyTransitionId(id)).toBe(false)
  })

  test('mints a distinct id per call so two routes may share endpoints', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateTransitionId()))

    expect(ids.size).toBe(500)
  })

  test('mints ids accepted by the transition validator', () => {
    const parsed = workflowTransitionSchema.parse({
      transitionId: generateTransitionId(),
      fromStepId: 'start',
      toStepId: 'end',
      trigger: 'auto',
    })

    expect(parsed.transitionId.startsWith(DURABLE_TRANSITION_ID_PREFIX)).toBe(true)
  })
})

describe('legacy transition ids', () => {
  test('the validator keeps accepting endpoint-derived ids', () => {
    const parsed = workflowTransitionSchema.parse(legacyDefinition.transitions[0])

    expect(parsed.transitionId).toBe('e_start_approve')
    expect(isLegacyTransitionId(parsed.transitionId)).toBe(true)
  })

  test('a stored legacy definition round-trips through the editor unchanged', () => {
    const { nodes, edges } = definitionToGraph(legacyDefinition as never)

    expect(edges.map((edge) => edge.id)).toEqual(['e_start_approve', 'e_approve_end'])

    const roundTripped = graphToDefinition(nodes, edges)

    expect(roundTripped.transitions.map((transition) => transition.transitionId)).toEqual([
      'e_start_approve',
      'e_approve_end',
    ])
    expect(
      roundTripped.transitions.map(({ transitionId, fromStepId, toStepId, priority }) => ({
        transitionId,
        fromStepId,
        toStepId,
        priority,
      })),
    ).toEqual([
      { transitionId: 'e_start_approve', fromStepId: 'start', toStepId: 'approve', priority: 10 },
      { transitionId: 'e_approve_end', fromStepId: 'approve', toStepId: 'end', priority: 0 },
    ])
  })

  test('ids do not churn across repeated save round-trips', () => {
    const mixed = {
      ...legacyDefinition,
      transitions: [
        ...legacyDefinition.transitions,
        {
          transitionId: generateTransitionId(),
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto' as const,
          priority: 0,
          activities: [],
        },
      ],
    }

    const firstPass = graphToDefinition(...graphPair(mixed))
    const secondPass = graphToDefinition(...graphPair(firstPass))

    expect(secondPass.transitions.map((transition) => transition.transitionId)).toEqual(
      mixed.transitions.map((transition) => transition.transitionId),
    )
  })
})

describe('fork branch identity with opaque ids', () => {
  test('branch keys carry the opaque transition ids and resolve back to their transitions', async () => {
    const forkTransitionA = generateTransitionId()
    const forkTransitionB = generateTransitionId()
    const definition = {
      id: '00000000-0000-4000-8000-000000000020',
      definition: {
        steps: [
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          { stepId: 'a', stepName: 'A', stepType: 'AUTOMATED' },
          { stepId: 'b', stepName: 'B', stepType: 'AUTOMATED' },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
        ],
        transitions: [
          { transitionId: forkTransitionA, fromStepId: 'fork', toStepId: 'a', trigger: 'auto' },
          { transitionId: forkTransitionB, fromStepId: 'fork', toStepId: 'b', trigger: 'auto' },
          { transitionId: generateTransitionId(), fromStepId: 'a', toStepId: 'join', trigger: 'auto' },
          { transitionId: generateTransitionId(), fromStepId: 'b', toStepId: 'join', trigger: 'auto' },
        ],
      },
    } as never as Parameters<typeof openFork>[2]

    const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
    const em = {
      create(entity: unknown, data: Record<string, unknown>) {
        const row = { ...data, id: `gen-${created.length}` }
        created.push({ entity, data: row })
        return row
      },
      persist() {
        return em
      },
      async flush() {},
      async findOne() {
        return null
      },
      async find() {
        return []
      },
    } as never as Parameters<typeof openFork>[0]

    const instance = {
      id: '00000000-0000-4000-8000-000000000010',
      definitionId: '00000000-0000-4000-8000-000000000020',
      tenantId,
      organizationId,
      status: 'RUNNING',
      currentStepId: 'fork',
      activeForkStepId: null,
      context: {},
      updatedAt: new Date(),
    } as never as Parameters<typeof openFork>[1]

    await openFork(em, instance, definition, {
      stepId: 'fork',
      stepName: 'Fork',
      stepType: 'PARALLEL_FORK',
      config: { joinStepId: 'join' },
    })

    const branches = created
      .filter((row) => row.entity === WorkflowBranchInstance)
      .map((row) => row.data as { branchKey: string })

    expect(branches.map((branch) => branch.branchKey)).toEqual([forkTransitionA, forkTransitionB])

    const transitions = (definition as unknown as { definition: { transitions: Array<{ transitionId: string; toStepId: string }> } })
      .definition.transitions
    for (const branch of branches) {
      const selected = transitions.find((transition) => transition.transitionId === branch.branchKey)
      expect(selected).toBeDefined()
    }
    expect(transitions.find((transition) => transition.transitionId === branches[0].branchKey)?.toStepId).toBe('a')
    expect(transitions.find((transition) => transition.transitionId === branches[1].branchKey)?.toStepId).toBe('b')
  })
})

function graphPair(definition: { steps: unknown[]; transitions: unknown[] }) {
  const { nodes, edges } = definitionToGraph(definition as never)
  return [nodes, edges] as const
}
