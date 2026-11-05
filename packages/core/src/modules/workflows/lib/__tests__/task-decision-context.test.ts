/**
 * The pinned definition behind a task is read inside the task's own tenant AND
 * organization (issue #7178). `find-definition` runs for real here, against an
 * `em` that honours the predicates it is given, so a same-tenant definition from
 * another organization has to be refused by the read itself.
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { clearCodeWorkflowRegistry, registerCodeWorkflows } from '../code-registry'
import { codeWorkflowUuid } from '../find-definition'
import {
  clearTaskCompletionGuards,
  evaluateTaskCompletionGuards,
  loadTaskCompletionGuardTarget,
  registerTaskCompletionGuards,
} from '../task-completion-guards'
import type { TaskCompletionGuard } from '../task-completion-guards'
import { loadTaskDecisionContext } from '../task-decision-context'
import type { UserTask } from '../../data/entities'

const TENANT = '11111111-1111-1111-1111-111111111111'
const FOREIGN_TENANT = '22222222-2222-2222-2222-222222222222'
const ORG = '33333333-3333-3333-3333-333333333333'
const FOREIGN_ORG = '44444444-4444-4444-4444-444444444444'
const INSTANCE_ID = '88888888-8888-8888-8888-888888888888'
const STEP_INSTANCE_ID = '99999999-9999-9999-9999-999999999999'
const DEFINITION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKFLOW_ID = 'contract-approval'

const SCOPE = { tenantId: TENANT, organizationId: ORG }

const authoredDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    {
      stepId: 'review',
      stepName: 'Review',
      stepType: 'USER_TASK',
      userTaskConfig: {
        formKey: 'contract-review',
        decisions: [{ id: 'approve', label: 'Approve', transitionId: 'to_end' }],
      },
    },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 'to_review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
    { transitionId: 'to_end', fromStepId: 'review', toStepId: 'end', trigger: 'manual' },
  ],
}

type Row = Record<string, unknown>

function makeEm(definitionRow: Row | null, definitionId = DEFINITION_ID) {
  const tables: Record<string, Row[]> = {
    WorkflowInstance: [
      { id: INSTANCE_ID, workflowId: WORKFLOW_ID, definitionId, context: {}, ...SCOPE },
    ],
    StepInstance: [{ id: STEP_INSTANCE_ID, stepId: 'review', ...SCOPE }],
    WorkflowDefinition: definitionRow ? [definitionRow] : [],
  }
  const findOne = jest.fn(async (entity: { name?: string }, where: Row) => {
    const rows = tables[entity?.name ?? ''] ?? []
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null
  })
  const em = { findOne, fork: () => em } as unknown as EntityManager
  return em
}

function definitionRow(overrides: Row = {}): Row {
  return { id: DEFINITION_ID, definition: authoredDefinition, ...SCOPE, ...overrides }
}

const task = {
  id: '77777777-7777-7777-7777-777777777777',
  workflowInstanceId: INSTANCE_ID,
  stepInstanceId: STEP_INSTANCE_ID,
  ...SCOPE,
} as unknown as UserTask

function formKeyGuard(): TaskCompletionGuard {
  return {
    id: 'host.form_key',
    formKey: 'contract-review',
    evaluate: jest.fn(async () => ({ ok: false as const, code: 'CONTRACT_NOT_SIGNED' })),
  }
}

describe('pinned definition scope', () => {
  beforeEach(() => {
    clearTaskCompletionGuards()
    clearCodeWorkflowRegistry()
  })

  afterEach(() => {
    clearTaskCompletionGuards()
    clearCodeWorkflowRegistry()
  })

  test('a definition inside the task scope supplies the form key and decisions', async () => {
    const context = await loadTaskDecisionContext(makeEm(definitionRow()), task, SCOPE)

    expect(context.formKey).toBe('contract-review')
    expect(context.decisions.map((decision) => decision.id)).toEqual(['approve'])
  })

  test('a soft-deleted definition still resolves for the instance pinned to it', async () => {
    const em = makeEm(definitionRow({ deletedAt: new Date() }))

    const context = await loadTaskDecisionContext(em, task, SCOPE)

    expect(context.formKey).toBe('contract-review')
  })

  test.each([
    ['another organization of the same tenant', { organizationId: FOREIGN_ORG }],
    ['another tenant', { tenantId: FOREIGN_TENANT }],
  ])('a definition in %s supplies neither form key nor decisions', async (_label, foreignScope) => {
    const em = makeEm(definitionRow(foreignScope))

    await expect(loadTaskDecisionContext(em, task, SCOPE)).resolves.toEqual({
      stepId: 'review',
      decisions: [],
      formKey: null,
    })
  })

  test('without an explicit scope the definition is still held to the instance scope', async () => {
    const em = makeEm(definitionRow({ organizationId: FOREIGN_ORG }))

    const context = await loadTaskDecisionContext(em, task)

    expect(context.formKey).toBeNull()
    expect(context.decisions).toEqual([])
  })

  test('a same-tenant foreign-organization definition cannot select a completion guard', async () => {
    const em = makeEm(definitionRow({ organizationId: FOREIGN_ORG }))
    const guard = formKeyGuard()
    registerTaskCompletionGuards([{ moduleId: 'host', guards: [guard] }])

    const target = await loadTaskCompletionGuardTarget(em, task)
    const block = await evaluateTaskCompletionGuards(em, {} as AwilixContainer, task, {
      mode: 'preview',
      userId: null,
    })

    expect(target).toEqual({
      workflowId: WORKFLOW_ID,
      workflowInstanceId: INSTANCE_ID,
      stepId: 'review',
      formKey: null,
    })
    expect(block).toBeNull()
    expect(guard.evaluate).not.toHaveBeenCalled()
  })

  test('an unpersisted code definition still resolves through the fallback', async () => {
    const codeDefinition: CodeWorkflowDefinition = {
      workflowId: WORKFLOW_ID,
      workflowName: 'Contract approval',
      description: null,
      version: 1,
      enabled: true,
      metadata: null,
      moduleId: 'host',
      definition: authoredDefinition,
    } as unknown as CodeWorkflowDefinition
    registerCodeWorkflows([codeDefinition])

    const context = await loadTaskDecisionContext(makeEm(null, codeWorkflowUuid(WORKFLOW_ID)), task, SCOPE)

    expect(context.formKey).toBe('contract-review')
  })
})
