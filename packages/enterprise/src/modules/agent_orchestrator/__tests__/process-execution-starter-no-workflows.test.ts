const mockCreateRequestContainer = jest.fn()
const mockEmitEvent = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../lib/queue', () => ({
  AGENT_ORCHESTRATOR_PROCESS_EXECUTION_QUEUE: 'agent-process-executions',
}))

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: (...args: unknown[]) => mockEmitEvent(...args),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ProcessDefinition, ProcessInstance } from '../data/entities'
import handle from '../workers/process-execution-starter'

function buildHarness(registrations: Record<string, unknown>) {
  const execution = {
    id: 'exec-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    processDefinitionId: 'def-1',
    workflowId: 'wf-1',
    workflowInstanceId: null,
    status: 'running',
    input: {},
    triggeredBy: null,
    failureReason: null as string | null,
    completedAt: null as Date | null,
  }
  const definition = { id: 'def-1', workflowId: 'wf-1' }
  const em = {
    fork: jest.fn(),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === ProcessInstance) return execution
      if (entity === ProcessDefinition) return definition
      return null
    }),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  em.fork.mockReturnValue(em)
  const all: Record<string, unknown> = { em, ...registrations }
  const container = {
    hasRegistration: jest.fn((name: string) => name in all),
    resolve: jest.fn((name: string) => {
      if (!(name in all)) throw new Error(`Could not resolve '${name}'`)
      return all[name]
    }),
  }
  mockCreateRequestContainer.mockResolvedValue(container)
  jest.mocked(findOneWithDecryption).mockResolvedValue(execution as never)
  return { execution, em, container }
}

type HandlerArgs = Parameters<typeof handle>
const job = { payload: { executionId: 'exec-1' } } as unknown as HandlerArgs[0]
const ctx = {} as HandlerArgs[1]

describe('process-execution-starter without the workflows module (#9188)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('marks the execution failed with a readable reason instead of throwing', async () => {
    const { execution, em, container } = buildHarness({})

    await expect(handle(job, ctx)).resolves.toBeUndefined()

    expect(container.resolve).not.toHaveBeenCalledWith('workflowExecutor')
    expect(execution.status).toBe('failed')
    expect(execution.failureReason).toBe('Workflows module is not enabled')
    expect(execution.completedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'agent_orchestrator.process.execution.failed',
      expect.objectContaining({ id: 'exec-1', status: 'failed' }),
      { persistent: true },
    )
  })

  test('starts the workflow when the executor is registered', async () => {
    const workflowExecutor = {
      startWorkflow: jest.fn().mockResolvedValue({ id: 'instance-1', version: 3 }),
      executeWorkflow: jest.fn().mockResolvedValue(undefined),
    }
    const { execution } = buildHarness({ workflowExecutor })

    await handle(job, ctx)

    expect(workflowExecutor.startWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workflowId: 'wf-1', correlationKey: 'process_execution:exec-1' }),
    )
    expect(workflowExecutor.executeWorkflow).toHaveBeenCalled()
    expect(execution.workflowInstanceId).toBe('instance-1')
    expect(execution.status).toBe('running')
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })
})
