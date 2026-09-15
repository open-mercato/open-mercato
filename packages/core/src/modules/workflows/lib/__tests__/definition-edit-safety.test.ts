import { describe, test, expect } from '@jest/globals'
import { EntityManager } from '@mikro-orm/core'
import {
  ACTIVE_WORKFLOW_INSTANCE_STATUSES,
  STRUCTURAL_EDIT_CONFLICT_CODE,
  buildStructuralEditConflictBody,
  diffDefinitionStructure,
  isStructuralDefinitionChange,
  type StructuralChange,
} from '../definition-edit-safety'
import { findDefinitionForInstance } from '../find-definition'
import { WorkflowDefinition } from '../../data/entities'

const baseDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK', config: { assignedToRoles: ['admin'] } },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 't_a', fromStepId: 'start', toStepId: 'review', trigger: 'auto', priority: 0 },
    { transitionId: 't_b', fromStepId: 'review', toStepId: 'end', trigger: 'auto', priority: 0 },
  ],
}

function withDefinition(mutate: (draft: Record<string, unknown>) => void): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(baseDefinition)) as Record<string, unknown>
  mutate(clone)
  return clone
}

type DiffCase = {
  name: string
  next: Record<string, unknown>
  expected: StructuralChange[]
}

const structuralCases: DiffCase[] = [
  {
    name: 'adding a step',
    next: withDefinition((draft) => {
      ;(draft.steps as unknown[]).push({ stepId: 'notify', stepName: 'Notify', stepType: 'AUTOMATED' })
    }),
    expected: [{ kind: 'stepAdded', id: 'notify' }],
  },
  {
    name: 'removing a step',
    next: withDefinition((draft) => {
      draft.steps = (draft.steps as Array<{ stepId: string }>).filter((step) => step.stepId !== 'review')
    }),
    expected: [{ kind: 'stepRemoved', id: 'review' }],
  },
  {
    name: 'changing a step type',
    next: withDefinition((draft) => {
      ;(draft.steps as Array<Record<string, unknown>>)[1].stepType = 'AUTOMATED'
    }),
    expected: [{ kind: 'stepTypeChanged', id: 'review' }],
  },
  {
    name: 'repairing fork wiring',
    next: withDefinition((draft) => {
      ;(draft.steps as Array<Record<string, unknown>>)[1].config = { joinStepId: 'end' }
    }),
    expected: [{ kind: 'stepWiringChanged', id: 'review' }],
  },
  {
    name: 'adding a route',
    next: withDefinition((draft) => {
      ;(draft.transitions as unknown[]).push({
        transitionId: 't_c',
        fromStepId: 'start',
        toStepId: 'end',
        trigger: 'auto',
      })
    }),
    expected: [{ kind: 'transitionAdded', id: 't_c' }],
  },
  {
    name: 'removing a route',
    next: withDefinition((draft) => {
      draft.transitions = (draft.transitions as Array<{ transitionId: string }>).filter(
        (transition) => transition.transitionId !== 't_b',
      )
    }),
    expected: [{ kind: 'transitionRemoved', id: 't_b' }],
  },
  {
    name: 'reattaching a route endpoint',
    next: withDefinition((draft) => {
      ;(draft.transitions as Array<Record<string, unknown>>)[0].toStepId = 'end'
    }),
    expected: [{ kind: 'transitionRetargeted', id: 't_a' }],
  },
  {
    name: 'turning a route into an error route',
    next: withDefinition((draft) => {
      ;(draft.transitions as Array<Record<string, unknown>>)[1].kind = 'error'
    }),
    expected: [{ kind: 'transitionKindChanged', id: 't_b' }],
  },
]

const nonStructuralCases: Array<{ name: string; next: Record<string, unknown> }> = [
  {
    name: 'renaming a step',
    next: withDefinition((draft) => {
      ;(draft.steps as Array<Record<string, unknown>>)[1].stepName = 'Manager review'
    }),
  },
  {
    name: 'moving a node on the canvas',
    next: withDefinition((draft) => {
      ;(draft.steps as Array<Record<string, unknown>>)[1]._editorPosition = { x: 420, y: 96 }
    }),
  },
  {
    name: 'editing activity config',
    next: withDefinition((draft) => {
      ;(draft.transitions as Array<Record<string, unknown>>)[0].activities = [
        { activityId: 'notify', activityType: 'SEND_EMAIL', config: { to: 'ops@example.com' } },
      ]
    }),
  },
  {
    name: 'reprioritising routes',
    next: withDefinition((draft) => {
      ;(draft.transitions as Array<Record<string, unknown>>)[0].priority = 50
    }),
  },
  {
    name: 'tightening a route condition',
    next: withDefinition((draft) => {
      ;(draft.transitions as Array<Record<string, unknown>>)[1].condition = { field: 'total', operator: 'gt', value: 10 }
    }),
  },
  {
    name: 'attaching definition metadata',
    next: withDefinition((draft) => {
      draft.metadata = { editor: { annotations: [] } }
    }),
  },
  {
    name: 'no change at all',
    next: withDefinition(() => {}),
  },
]

describe('diffDefinitionStructure', () => {
  test.each(structuralCases)('reports $name as structural', ({ next, expected }) => {
    expect(diffDefinitionStructure(baseDefinition, next)).toEqual(expected)
    expect(isStructuralDefinitionChange(baseDefinition, next)).toBe(true)
  })

  test.each(nonStructuralCases)('leaves $name in place', ({ next }) => {
    expect(diffDefinitionStructure(baseDefinition, next)).toEqual([])
    expect(isStructuralDefinitionChange(baseDefinition, next)).toBe(false)
  })

  test('reports every change when several land at once', () => {
    const next = withDefinition((draft) => {
      ;(draft.steps as unknown[]).push({ stepId: 'notify', stepName: 'Notify', stepType: 'AUTOMATED' })
      draft.transitions = [
        { transitionId: 't_a', fromStepId: 'start', toStepId: 'notify', trigger: 'auto' },
      ]
    })

    expect(diffDefinitionStructure(baseDefinition, next)).toEqual([
      { kind: 'stepAdded', id: 'notify' },
      { kind: 'transitionRetargeted', id: 't_a' },
      { kind: 'transitionRemoved', id: 't_b' },
    ])
  })

  test('tolerates malformed documents instead of throwing', () => {
    expect(diffDefinitionStructure(null, undefined)).toEqual([])
    expect(diffDefinitionStructure({ steps: 'nope', transitions: 7 }, baseDefinition)).toHaveLength(5)
  })

  test('legacy endpoint-derived route ids diff exactly like opaque ones', () => {
    const legacy = {
      steps: baseDefinition.steps,
      transitions: [
        { transitionId: 'e_start_review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
      ],
    }
    const retargeted = {
      steps: baseDefinition.steps,
      transitions: [
        { transitionId: 'e_start_review', fromStepId: 'start', toStepId: 'end', trigger: 'auto' },
      ],
    }

    expect(diffDefinitionStructure(legacy, retargeted)).toEqual([
      { kind: 'transitionRetargeted', id: 'e_start_review' },
    ])
  })
})

describe('buildStructuralEditConflictBody', () => {
  test('names the remedy so the client can offer one-click versioning', () => {
    const body = buildStructuralEditConflictBody({
      definitionId: '123e4567-e89b-12d3-a456-426614174000',
      activeInstanceCount: 3,
      changes: [{ kind: 'transitionRetargeted', id: 't_a' }],
    })

    expect(body.code).toBe(STRUCTURAL_EDIT_CONFLICT_CODE)
    expect(body.activeInstanceCount).toBe(3)
    expect(body.remedy).toEqual({
      action: 'createVersion',
      method: 'POST',
      endpoint: '/api/workflows/definitions/123e4567-e89b-12d3-a456-426614174000/publish',
    })
    expect(body.activeStatuses).toEqual(ACTIVE_WORKFLOW_INSTANCE_STATUSES)
  })

  test('terminal statuses never count as active', () => {
    for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED', 'COMPENSATED']) {
      expect(ACTIVE_WORKFLOW_INSTANCE_STATUSES).not.toContain(terminal)
    }
  })
})

describe('instances keep executing their pinned definition row', () => {
  test('a minted successor version does not change what a running instance resolves', async () => {
    const versionOne = {
      id: '123e4567-e89b-12d3-a456-426614174100',
      workflowId: 'approval',
      version: 1,
      definition: baseDefinition,
    } as unknown as WorkflowDefinition
    const versionTwo = {
      id: '123e4567-e89b-12d3-a456-426614174200',
      workflowId: 'approval',
      version: 2,
      definition: withDefinition((draft) => {
        ;(draft.transitions as Array<Record<string, unknown>>)[0].toStepId = 'end'
      }),
    } as unknown as WorkflowDefinition

    const rows = [versionOne, versionTwo]
    const em = {
      findOne: async (_entity: unknown, where: { id: string }) =>
        rows.find((row) => row.id === where.id) ?? null,
    } as unknown as EntityManager

    const resolved = await findDefinitionForInstance(em, {
      definitionId: versionOne.id,
      workflowId: 'approval',
      tenantId: '123e4567-e89b-12d3-a456-426614174001',
      organizationId: '123e4567-e89b-12d3-a456-426614174002',
    })

    expect(resolved?.version).toBe(1)
    expect(resolved?.definition.transitions[0].toStepId).toBe('review')
    expect(diffDefinitionStructure(resolved?.definition, versionTwo.definition)).toEqual([
      { kind: 'transitionRetargeted', id: 't_a' },
    ])
  })
})
