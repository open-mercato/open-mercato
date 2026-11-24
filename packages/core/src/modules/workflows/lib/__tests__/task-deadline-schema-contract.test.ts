import { describe, test, expect } from '@jest/globals'
import {
  createWorkflowDefinitionInputCheckedSchema,
  createWorkflowDefinitionInputSchema,
  createWorkflowDefinitionSchema,
  taskDeadlineSchema,
  updateWorkflowDefinitionInputCheckedSchema,
  userTaskConfigSchema,
  workflowDefinitionDataSchema,
} from '../../data/validators'
import {
  workflowDefinitionDetailResponseSchema,
  workflowDefinitionListResponseSchema,
  workflowDefinitionMutationResponseSchema,
  workflowDefinitionResponseSchema,
} from '../../api/openapi'
import { evaluateWorkflowDefinition } from '../definition-evaluation'
import { clearCodeWorkflowRegistry, getCodeWorkflow, registerCodeWorkflows } from '../code-registry'

/**
 * Issue #7181 review — an absolute deadline is the optional sibling
 * `userTaskConfig.deadlineAt`. `deadline` keeps its duration-only contract on
 * every schema, so every response a definition route serves still parses with
 * the response schemas those routes have always documented.
 */

function definition(userTaskConfig: Record<string, unknown>) {
  return {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: 'review',
        stepName: 'Review',
        stepType: 'USER_TASK',
        userTaskConfig: { assignedTo: 'clerk@example.com', ...userTaskConfig },
      },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 't1', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
      { transitionId: 't2', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
    ],
  }
}

const absolute = definition({ deadlineAt: '{{context.dueDate}}' })
const atOnlyDeadline = definition({ deadline: { at: '{{context.dueDate}}' } })
const both = definition({ deadline: { duration: 'P3D' }, deadlineAt: '{{context.dueDate}}' })
const createBody = (body: unknown) => ({ workflowId: 'deeds', workflowName: 'Deeds', definition: body })
const responseRow = (body: unknown) => ({
  id: '11111111-1111-4111-8111-111111111111',
  workflowId: 'deeds',
  workflowName: 'Deeds',
  description: null,
  version: 1,
  definition: body,
  metadata: null,
  enabled: true,
  effectiveFrom: null,
  effectiveTo: null,
  tenantId: null,
  organizationId: null,
  grantedFeatures: null,
  createdBy: null,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
  deletedAt: null,
  source: 'user',
  isCodeBased: false,
  codeModuleId: null,
})
const reviewConfig = (value: { steps: Array<{ stepId: string; userTaskConfig?: unknown }> }) =>
  value.steps.find((step) => step.stepId === 'review')?.userTaskConfig

describe('the deadline contract stays duration-only', () => {
  test('taskDeadlineSchema still requires a non-empty duration', () => {
    expect(taskDeadlineSchema.safeParse({ duration: 'P3D' }).success).toBe(true)
    expect(taskDeadlineSchema.safeParse({ duration: '' }).success).toBe(false)
    expect(taskDeadlineSchema.safeParse({ at: '2026-10-20' }).success).toBe(false)
  })

  test('the only key added to userTaskConfig is the optional deadlineAt', () => {
    const preReviewKeys = [
      'allowedActions', 'assignedTo', 'assignedToRoles', 'assigneeKind', 'assignmentRule', 'deadline',
      'decisions', 'editablePrefilled', 'entityBindings', 'escalationRules', 'formKey', 'formSchema',
      'instructions', 'onBreach', 'priority', 'reminders', 'slaDuration',
    ]
    const added = Object.keys(userTaskConfigSchema.shape).filter((key) => !preReviewKeys.includes(key))
    expect(added).toEqual(['deadlineAt'])
    expect(userTaskConfigSchema.shape.deadlineAt.safeParse(undefined).success).toBe(true)
  })

  const atOnlyParsers = [
    ['workflowDefinitionDataSchema', () => workflowDefinitionDataSchema.safeParse(atOnlyDeadline)],
    ['createWorkflowDefinitionInputSchema', () => createWorkflowDefinitionInputSchema.safeParse(createBody(atOnlyDeadline))],
    ['createWorkflowDefinitionInputCheckedSchema', () => createWorkflowDefinitionInputCheckedSchema.safeParse(createBody(atOnlyDeadline))],
    ['updateWorkflowDefinitionInputCheckedSchema', () => updateWorkflowDefinitionInputCheckedSchema.safeParse({ definition: atOnlyDeadline })],
    ['createWorkflowDefinitionSchema', () => createWorkflowDefinitionSchema.safeParse({
      ...createBody(atOnlyDeadline),
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '11111111-1111-4111-8111-111111111111',
    })],
    ['workflowDefinitionResponseSchema', () => workflowDefinitionResponseSchema.safeParse(responseRow(atOnlyDeadline))],
  ] as const

  test.each(atOnlyParsers)('%s refuses an at-only deadline', (_name, parse) => {
    expect(parse().success).toBe(false)
  })

  test('declaring both deadline and deadlineAt is refused on every authoring schema', () => {
    expect(workflowDefinitionDataSchema.safeParse(both).success).toBe(false)
    expect(createWorkflowDefinitionInputCheckedSchema.safeParse(createBody(both)).success).toBe(false)
    expect(updateWorkflowDefinitionInputCheckedSchema.safeParse({ definition: both }).success).toBe(false)
  })
})

describe('the absolute deadline travels as the sibling deadlineAt', () => {
  test('through the definition, create, update and response schemas', () => {
    const expected = { assignedTo: 'clerk@example.com', deadlineAt: '{{context.dueDate}}' }
    expect(reviewConfig(workflowDefinitionDataSchema.parse(absolute))).toEqual(expected)
    expect(reviewConfig(createWorkflowDefinitionInputCheckedSchema.parse(createBody(absolute)).definition)).toEqual(expected)
    expect(reviewConfig(updateWorkflowDefinitionInputCheckedSchema.parse({ definition: absolute }).definition!)).toEqual(expected)
    expect(reviewConfig(workflowDefinitionResponseSchema.parse(responseRow(absolute)).definition)).toEqual(expected)
  })

  test('list, detail and mutation response bodies carrying it parse with the published schemas', () => {
    const row = responseRow(absolute)
    expect(
      workflowDefinitionListResponseSchema.safeParse({
        data: [row],
        pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
      }).success,
    ).toBe(true)
    expect(workflowDefinitionDetailResponseSchema.safeParse({ data: row }).success).toBe(true)
    expect(workflowDefinitionMutationResponseSchema.safeParse({ data: row, message: 'ok' }).success).toBe(true)
  })

  test('the shared evaluator reports no schema problem', () => {
    const evaluation = evaluateWorkflowDefinition(absolute as never, {})
    expect(evaluation.issues.filter((issue) => issue.path.includes('deadline'))).toEqual([])
    expect(evaluation.valid).toBe(true)
  })

  test('a code-defined workflow registers with it, and is refused with both forms', () => {
    clearCodeWorkflowRegistry()
    registerCodeWorkflows([
      { workflowId: 'deeds.code', workflowName: 'Deeds', definition: absolute } as never,
      { workflowId: 'deeds.both', workflowName: 'Deeds', definition: both } as never,
    ])
    expect(getCodeWorkflow('deeds.code')).toBeTruthy()
    expect(getCodeWorkflow('deeds.both')).toBeFalsy()
    clearCodeWorkflowRegistry()
  })
})
