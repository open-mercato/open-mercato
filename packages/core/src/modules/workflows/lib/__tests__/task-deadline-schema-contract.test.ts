import { describe, test, expect } from '@jest/globals'
import {
  createWorkflowDefinitionInputCheckedSchema,
  createWorkflowDefinitionInputSchema,
  createWorkflowDefinitionInputSpecCheckedSchema,
  createWorkflowDefinitionSchema,
  updateWorkflowDefinitionInputCheckedSchema,
  updateWorkflowDefinitionInputSpecCheckedSchema,
  workflowDefinitionDataSchema,
  workflowDefinitionDataSpecSchema,
  workflowStepSchema,
  workflowStepSpecSchema,
} from '../../data/validators'
import {
  workflowDefinitionDetailResponseSchema,
  workflowDefinitionResponseSchema,
  workflowDefinitionSpecDetailResponseSchema,
  workflowDefinitionSpecResponseSchema,
} from '../../api/openapi'
import { evaluateWorkflowDefinition } from '../definition-evaluation'
import { clearCodeWorkflowRegistry, getCodeWorkflow, registerCodeWorkflows } from '../code-registry'

/**
 * Issue #7181 review — every existing schema keeps its duration-only result, and
 * the `at`-capable `*Spec` schemas are what the feature paths validate with.
 */

function definition(deadline: Record<string, unknown>) {
  return {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: 'review',
        stepName: 'Review',
        stepType: 'USER_TASK',
        userTaskConfig: { assignedTo: 'clerk@example.com', deadline },
      },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 't1', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
      { transitionId: 't2', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
    ],
  }
}

const absolute = definition({ at: '{{context.dueDate}}' })
const duration = definition({ duration: 'P3D' })
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

describe('the existing schemas keep their duration-only result', () => {
  const legacyParsers = [
    ['workflowDefinitionDataSchema', () => workflowDefinitionDataSchema.safeParse(absolute)],
    ['createWorkflowDefinitionInputSchema', () => createWorkflowDefinitionInputSchema.safeParse(createBody(absolute))],
    ['createWorkflowDefinitionInputCheckedSchema', () => createWorkflowDefinitionInputCheckedSchema.safeParse(createBody(absolute))],
    ['updateWorkflowDefinitionInputCheckedSchema', () => updateWorkflowDefinitionInputCheckedSchema.safeParse({ definition: absolute })],
    ['createWorkflowDefinitionSchema', () => createWorkflowDefinitionSchema.safeParse({
      ...createBody(absolute),
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '11111111-1111-4111-8111-111111111111',
    })],
    ['workflowDefinitionResponseSchema', () => workflowDefinitionResponseSchema.safeParse(responseRow(absolute))],
    ['workflowDefinitionDetailResponseSchema', () => workflowDefinitionDetailResponseSchema.safeParse({ data: responseRow(absolute) })],
  ] as const

  test.each(legacyParsers)('%s refuses an absolute deadline', (_name, parse) => {
    expect(parse().success).toBe(false)
  })

  test('a parsed duration deadline is the same through both generations', () => {
    expect(workflowDefinitionDataSpecSchema.parse(duration)).toEqual(workflowDefinitionDataSchema.parse(duration))
    const step = duration.steps[1]
    expect(workflowStepSpecSchema.parse(step)).toEqual(workflowStepSchema.parse(step))
  })
})

describe('the *Spec schemas carry the absolute deadline', () => {
  test('through the definition, create, update and response schemas', () => {
    const steps = (value: { steps: Array<{ userTaskConfig?: { deadline?: unknown } }> }) =>
      value.steps[1].userTaskConfig?.deadline
    expect(steps(workflowDefinitionDataSpecSchema.parse(absolute))).toEqual({ at: '{{context.dueDate}}' })
    expect(steps(createWorkflowDefinitionInputSpecCheckedSchema.parse(createBody(absolute)).definition)).toEqual({
      at: '{{context.dueDate}}',
    })
    const updated = updateWorkflowDefinitionInputSpecCheckedSchema.parse({ definition: absolute })
    expect(steps(updated.definition!)).toEqual({ at: '{{context.dueDate}}' })
    expect(steps(workflowDefinitionSpecResponseSchema.parse(responseRow(absolute)).definition)).toEqual({
      at: '{{context.dueDate}}',
    })
    expect(workflowDefinitionSpecDetailResponseSchema.safeParse({ data: responseRow(absolute) }).success).toBe(true)
  })

  test('the refinements of the schemas they extend still run', () => {
    expect(
      workflowStepSpecSchema.safeParse({ stepId: 'wait', stepName: 'Wait', stepType: 'WAIT_FOR_TIMER' }).success,
    ).toBe(false)
    const stranded = {
      ...absolute,
      steps: [
        ...absolute.steps,
        { stepId: 'wait', stepName: 'Wait', stepType: 'WAIT_FOR_CONDITION', config: {} },
      ],
    }
    const result = workflowDefinitionDataSpecSchema.safeParse(stranded)
    expect(result.success).toBe(false)
    expect(
      createWorkflowDefinitionInputSpecCheckedSchema.safeParse({
        ...createBody({
          ...absolute,
          triggers: [{ triggerId: 'on-event', name: 'On event', eventPattern: 'a.b.c' }],
        }),
        kind: 'component',
      }).success,
    ).toBe(false)
  })

  test('the update input stays strict', () => {
    expect(updateWorkflowDefinitionInputSpecCheckedSchema.safeParse({ unknownKey: true }).success).toBe(false)
  })
})

describe('the feature paths accept the absolute deadline', () => {
  test('the shared evaluator reports no schema problem', () => {
    const evaluation = evaluateWorkflowDefinition(absolute as never, {})
    expect(evaluation.issues.filter((issue) => issue.path.includes('deadline'))).toEqual([])
    expect(evaluation.valid).toBe(true)
  })

  test('a code-defined workflow registers', () => {
    clearCodeWorkflowRegistry()
    registerCodeWorkflows([{ workflowId: 'deeds.code', workflowName: 'Deeds', definition: absolute } as never])
    expect(getCodeWorkflow('deeds.code')).toBeTruthy()
    clearCodeWorkflowRegistry()
  })
})
