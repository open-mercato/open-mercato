/**
 * Rerun from step (spec §8.4) — route behaviour.
 *
 * The load-bearing assertion is the LAST one: the previous attempt's
 * `StepInstance` is never mutated. That is what keeps this feature inside the
 * documented step state machine ("never set status out of order") without
 * changing it.
 */

import { NextRequest } from 'next/server'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

const findDefinitionForInstance = jest.fn()
jest.mock('../../lib/find-definition', () => ({
  findDefinitionForInstance: (...args: unknown[]) => findDefinitionForInstance(...(args as [])),
}))

const logWorkflowEvent = jest.fn(async () => ({}))
jest.mock('../../lib/event-logger', () => {
  const actual = jest.requireActual('../../lib/event-logger')
  return {
    ...(actual as Record<string, unknown>),
    logWorkflowEvent: (...args: unknown[]) => logWorkflowEvent(...(args as [])),
  }
})

const executeStep = jest.fn(async () => ({ status: 'COMPLETED' }))
jest.mock('../../lib/step-handler', () => ({
  executeStep: (...args: unknown[]) => executeStep(...(args as [])),
}))

class WorkflowExecutionError extends Error {}
const executeWorkflow = jest.fn(async () => ({ status: 'RUNNING' }))
jest.mock('../../lib/workflow-executor', () => ({
  executeWorkflow: (...args: unknown[]) => executeWorkflow(...(args as [])),
  WorkflowExecutionError,
}))

import { POST as rerunStep } from '../instances/[id]/rerun-step/route'
import { WorkflowEventTypes } from '../../lib/event-logger'

const tenantId = 'tenant-1'
const orgId = 'org-1'
const userId = 'user-1'
const instanceId = '11111111-1111-4111-8111-111111111111'

type TerminalStepRow = {
  id: string
  stepId: string
  stepType: string
  status: string
  enteredAt: Date
  exitedAt: Date
  createdAt: Date
}

let terminalStep: TerminalStepRow
let instance: Record<string, unknown>
let mockEm: { findOne: jest.Mock; find: jest.Mock; flush: jest.Mock; refresh: jest.Mock }
let mockRbac: { userHasAllFeatures: jest.Mock }

function makeRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/workflows/instances/${instanceId}/rerun-step`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const routeContext = { params: Promise.resolve({ id: instanceId }) }

beforeEach(() => {
  jest.clearAllMocks()

  terminalStep = {
    id: 'si-1',
    stepId: 'charge',
    stepType: 'AUTOMATED',
    status: 'FAILED',
    enteredAt: new Date('2026-07-29T10:00:00.000Z'),
    exitedAt: new Date('2026-07-29T10:00:01.000Z'),
    createdAt: new Date('2026-07-29T10:00:00.000Z'),
  }

  instance = {
    id: instanceId,
    tenantId,
    organizationId: orgId,
    status: 'FAILED',
    currentStepId: 'charge',
    context: { amount: 100 },
    metadata: { attention: { reason: 'ERROR_DIRECTIVE' }, labels: { k: 'v' } },
    pendingTransition: { transitionId: 't_1' },
    retryCount: 0,
    errorMessage: 'gateway down',
    errorDetails: { stack: 'x' },
    updatedAt: new Date(0),
  }

  mockEm = {
    findOne: jest.fn(async () => instance),
    find: jest.fn(async () => [terminalStep]),
    flush: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
  }
  mockRbac = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }

  const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => (name === 'em' ? mockEm : name === 'rbacService' ? mockRbac : null),
  })

  const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
  getAuthFromRequest.mockResolvedValue({ sub: userId, tenantId, orgId })

  const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
  resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: orgId })

  findDefinitionForInstance.mockResolvedValue({
    definition: {
      steps: [
        { stepId: 'start', stepType: 'START' },
        { stepId: 'charge', stepType: 'AUTOMATED' },
      ],
    },
  })
})

describe('POST /api/workflows/instances/[id]/rerun-step', () => {
  test('is gated on its own ACL feature, not on plain retry', () => {
    const { metadata } = require('../instances/[id]/rerun-step/route')
    expect(metadata.requireFeatures).toEqual(['workflows.instances.rerun_step'])
  })

  test('replays the step and drives the run onward', async () => {
    const response = await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)

    expect(response.status).toBe(200)
    expect(executeStep).toHaveBeenCalledWith(
      mockEm,
      instance,
      'charge',
      expect.objectContaining({ userId }),
      expect.anything()
    )
    expect(executeWorkflow).toHaveBeenCalled()
  })

  /**
   * The mitigation, asserted. `workflows/AGENTS.md`: steps go
   * `PENDING → ACTIVE → COMPLETED|FAILED|SKIPPED|CANCELLED` and are "never set
   * out of order". The previous attempt keeps its terminal row verbatim; the
   * replay's row is created by `enterStep` inside `executeStep`.
   */
  test('never mutates the terminal StepInstance of the previous attempt', async () => {
    const before = JSON.stringify(terminalStep)
    await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)
    expect(JSON.stringify(terminalStep)).toBe(before)
    expect(terminalStep.status).toBe('FAILED')
  })

  test('audits the rerun as STEP_RERUN with the edited context diff and the actor', async () => {
    await rerunStep(makeRequest({ stepId: 'charge', contextPatch: { amount: 250 } }), routeContext)

    expect(logWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({
        eventType: WorkflowEventTypes.STEP_RERUN,
        eventData: expect.objectContaining({
          stepId: 'charge',
          by: userId,
          supersededStepInstanceId: 'si-1',
          editedContextDiff: { amount: { from: 100, to: 250 } },
        }),
      })
    )
  })

  test('applies the context patch before the step runs', async () => {
    await rerunStep(makeRequest({ stepId: 'charge', contextPatch: { amount: 250 } }), routeContext)
    expect(instance.context).toEqual({ amount: 250 })
  })

  test('clears the attention marker, the pending transition and the error, and repoints the cursor', async () => {
    await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)

    expect(instance.metadata).toEqual({ attention: null, labels: { k: 'v' } })
    expect(instance.pendingTransition).toBeNull()
    expect(instance.currentStepId).toBe('charge')
    expect(instance.status).toBe('RUNNING')
    expect(instance.retryCount).toBe(1)
    expect(instance.errorMessage).toBeNull()
  })

  test('409s while the step is still parked, and executes nothing', async () => {
    terminalStep.status = 'ACTIVE'

    const response = await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('WORKFLOW_STEP_STILL_PARKED')
    expect(executeStep).not.toHaveBeenCalled()
    expect(logWorkflowEvent).not.toHaveBeenCalled()
  })

  test('409s when the step changed type since the run started', async () => {
    findDefinitionForInstance.mockResolvedValue({
      definition: { steps: [{ stepId: 'charge', stepType: 'USER_TASK' }] },
    })

    const response = await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('WORKFLOW_STEP_TYPE_CHANGED')
  })

  test('409s a RUNNING instance rather than racing the execution loop', async () => {
    instance.status = 'RUNNING'

    const response = await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('WORKFLOW_INSTANCE_NOT_RERUNNABLE')
  })

  test('404s an instance from another tenant instead of acting on it', async () => {
    mockEm.findOne.mockResolvedValue(null)

    const response = await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)

    expect(response.status).toBe(404)
    expect(mockEm.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: instanceId, tenantId, organizationId: orgId })
    )
  })

  test('403s a caller without the feature', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    const response = await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)

    expect(response.status).toBe(403)
    expect(executeStep).not.toHaveBeenCalled()
  })

  test('400s a payload with no stepId', async () => {
    const response = await rerunStep(makeRequest({}), routeContext)
    expect(response.status).toBe(400)
  })

  test('401s an unauthenticated caller', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    const response = await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)
    expect(response.status).toBe(401)
  })

  test('scopes the step lookup to the caller tenant and organization', async () => {
    await rerunStep(makeRequest({ stepId: 'charge' }), routeContext)

    expect(mockEm.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workflowInstanceId: instanceId,
        stepId: 'charge',
        tenantId,
        organizationId: orgId,
      })
    )
  })
})
