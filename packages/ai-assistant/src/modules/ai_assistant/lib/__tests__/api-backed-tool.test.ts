import { z } from 'zod'
import { defineApiBackedAiTool } from '../api-backed-tool'
import {
  createAiApiOperationRunner,
  type AiApiOperationRequest,
  type AiApiOperationResponse,
  type AiToolExecutionContext,
} from '../ai-api-operation-runner'
import type { AiToolDefinition, McpToolContext } from '../types'

jest.mock('../ai-api-operation-runner', () => {
  const actual = jest.requireActual('../ai-api-operation-runner')
  return {
    ...actual,
    createAiApiOperationRunner: jest.fn(),
  }
})

const mockedCreateRunner = jest.mocked(createAiApiOperationRunner)

function makeBaseCtx(): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: {} as McpToolContext['container'],
    userFeatures: ['*'],
    isSuperAdmin: true,
  }
}

function asExecutionCtx(tool: AiToolDefinition, base: McpToolContext = makeBaseCtx()): AiToolExecutionContext {
  return { ...base, tool }
}

function mockRunnerWith(response: AiApiOperationResponse<unknown>): jest.Mock {
  const run = jest.fn(async () => response)
  mockedCreateRunner.mockReturnValue({ run } as unknown as ReturnType<typeof createAiApiOperationRunner>)
  return run
}

describe('defineApiBackedAiTool', () => {
  beforeEach(() => {
    mockedCreateRunner.mockReset()
  })

  it('returns an AiToolDefinition forwarding name/description/inputSchema/requiredFeatures and isMutation defaults', () => {
    const inputSchema = z.object({ id: z.string() })
    const tool = defineApiBackedAiTool({
      name: 'customers.list_people',
      description: 'List people',
      inputSchema,
      requiredFeatures: ['customers.people.view'],
      toOperation: () => ({ method: 'GET', path: '/customers/people' }),
      mapResponse: (response) => response.data ?? null,
    })

    expect(tool.name).toBe('customers.list_people')
    expect(tool.description).toBe('List people')
    expect(tool.inputSchema).toBe(inputSchema)
    expect(tool.requiredFeatures).toEqual(['customers.people.view'])
    expect(tool.isMutation).toBeUndefined()
    expect(tool.displayName).toBeUndefined()
    expect(typeof tool.handler).toBe('function')
  })

  it('forwards displayName when provided', () => {
    const tool = defineApiBackedAiTool({
      name: 'customers.list_people',
      displayName: 'List people',
      description: 'desc',
      inputSchema: z.object({}),
      requiredFeatures: ['customers.people.view'],
      toOperation: () => ({ method: 'GET', path: '/customers/people' }),
      mapResponse: () => null,
    })
    expect(tool.displayName).toBe('List people')
  })

  it('preserves loadBeforeRecord and loadBeforeRecords pass-through', () => {
    const loadBeforeRecord = jest.fn(async () => ({
      recordId: 'r-1',
      entityType: 'customers:person',
      recordVersion: '1',
      before: {},
    }))
    const loadBeforeRecords = jest.fn(async () => [
      { recordId: 'r-1', entityType: 'catalog:product', label: 'Hat', recordVersion: '1', before: {} },
    ])

    const tool = defineApiBackedAiTool({
      name: 'catalog.update_product',
      description: 'desc',
      inputSchema: z.object({}),
      requiredFeatures: ['catalog.products.manage'],
      isMutation: true,
      loadBeforeRecord,
      loadBeforeRecords,
      toOperation: () => ({ method: 'PUT', path: '/catalog/products', body: {} }),
      mapResponse: () => null,
    })

    expect(tool.isMutation).toBe(true)
    expect(tool.loadBeforeRecord).toBe(loadBeforeRecord)
    expect(tool.loadBeforeRecords).toBe(loadBeforeRecords)
  })

  it('invokes toOperation with the parsed input and the same ctx, passing the operation to runner.run', async () => {
    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/customers/people',
      query: { search: 'taylor' },
    }
    const toOperation = jest.fn(() => operation)
    const mapResponse = jest.fn((response: AiApiOperationResponse<{ items: unknown[] }>) => response.data?.items ?? [])
    const run = mockRunnerWith({ success: true, statusCode: 200, data: { items: [{ id: 'p1' }] } })

    const tool = defineApiBackedAiTool<{ search: string }, { items: unknown[] }, unknown[]>({
      name: 'customers.list_people',
      description: 'List people',
      inputSchema: z.object({ search: z.string() }),
      requiredFeatures: ['customers.people.view'],
      toOperation,
      mapResponse,
    })

    const baseCtx = makeBaseCtx()
    const result = await tool.handler({ search: 'taylor' }, baseCtx)

    expect(toOperation).toHaveBeenCalledTimes(1)
    const [opInput, opCtx] = toOperation.mock.calls[0]
    expect(opInput).toEqual({ search: 'taylor' })
    expect(opCtx.tenantId).toBe(baseCtx.tenantId)
    expect(opCtx.organizationId).toBe(baseCtx.organizationId)
    expect(opCtx.userId).toBe(baseCtx.userId)
    expect(opCtx.tool).toBe(tool)

    expect(mockedCreateRunner).toHaveBeenCalledTimes(1)
    expect(mockedCreateRunner.mock.calls[0][0].tool).toBe(tool)
    expect(run).toHaveBeenCalledWith(operation)

    expect(mapResponse).toHaveBeenCalledTimes(1)
    const [mappedResponse, mappedInput, mappedCtx] = mapResponse.mock.calls[0]
    expect(mappedResponse).toEqual({ success: true, statusCode: 200, data: { items: [{ id: 'p1' }] } })
    expect(mappedInput).toEqual({ search: 'taylor' })
    expect(mappedCtx.tool).toBe(tool)

    expect(result).toEqual([{ id: 'p1' }])
  })

  it('returns mapResponse output on a successful runner response', async () => {
    mockRunnerWith({ success: true, statusCode: 200, data: { count: 7 } })

    const tool = defineApiBackedAiTool<{}, { count: number }, { total: number }>({
      name: 'customers.count_people',
      description: 'Count',
      inputSchema: z.object({}),
      requiredFeatures: ['customers.people.view'],
      toOperation: () => ({ method: 'GET', path: '/customers/people' }),
      mapResponse: (response) => ({ total: response.data?.count ?? 0 }),
    })

    const result = await tool.handler({}, makeBaseCtx())
    expect(result).toEqual({ total: 7 })
  })

  it('throws an Error using response.error when the runner reports failure', async () => {
    mockRunnerWith({ success: false, statusCode: 403, error: 'forbidden by route policy' })

    const mapResponse = jest.fn()
    const tool = defineApiBackedAiTool({
      name: 'customers.list_people',
      description: 'List',
      inputSchema: z.object({}),
      requiredFeatures: ['customers.people.view'],
      toOperation: () => ({ method: 'GET', path: '/customers/people' }),
      mapResponse,
    })

    await expect(tool.handler({}, makeBaseCtx())).rejects.toThrow('forbidden by route policy')
    expect(mapResponse).not.toHaveBeenCalled()
  })

  it('throws a fallback Error message when the runner reports failure without an error string', async () => {
    mockRunnerWith({ success: false, statusCode: 500 })

    const tool = defineApiBackedAiTool({
      name: 'customers.list_people',
      description: 'List',
      inputSchema: z.object({}),
      requiredFeatures: ['customers.people.view'],
      toOperation: () => ({ method: 'GET', path: '/customers/people' }),
      mapResponse: () => null,
    })

    await expect(tool.handler({}, makeBaseCtx())).rejects.toThrow(/customers\.list_people/)
  })

  it('awaits async toOperation and async mapResponse', async () => {
    const operation: AiApiOperationRequest = { method: 'GET', path: '/catalog/products' }
    const toOperation = jest.fn(async () => {
      await Promise.resolve()
      return operation
    })
    const mapResponse = jest.fn(async (response: AiApiOperationResponse<{ value: number }>) => {
      await Promise.resolve()
      return (response.data?.value ?? 0) * 2
    })
    const run = mockRunnerWith({ success: true, statusCode: 200, data: { value: 21 } })

    const tool = defineApiBackedAiTool<{}, { value: number }, number>({
      name: 'catalog.compute',
      description: 'Compute',
      inputSchema: z.object({}),
      requiredFeatures: ['catalog.products.view'],
      toOperation,
      mapResponse,
    })

    const result = await tool.handler({}, makeBaseCtx())
    expect(result).toBe(42)
    expect(toOperation).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(operation)
    expect(mapResponse).toHaveBeenCalledTimes(1)
  })

  it('round-trips read-tool metadata (no isMutation)', () => {
    const tool = defineApiBackedAiTool({
      name: 'customers.list_people',
      description: 'List',
      inputSchema: z.object({}),
      requiredFeatures: ['customers.people.view'],
      toOperation: () => ({ method: 'GET', path: '/customers/people' }),
      mapResponse: () => null,
    })

    expect(tool.isMutation).toBeUndefined()
    expect(tool.loadBeforeRecord).toBeUndefined()
    expect(tool.loadBeforeRecords).toBeUndefined()
  })

  it('round-trips mutation-tool metadata with isMutation: true', () => {
    const tool = defineApiBackedAiTool({
      name: 'customers.update_deal_stage',
      description: 'Update deal stage',
      inputSchema: z.object({ dealId: z.string(), toPipelineStageId: z.string() }),
      requiredFeatures: ['customers.deals.manage'],
      isMutation: true,
      toOperation: (input) => ({
        method: 'PUT',
        path: '/customers/deals',
        body: { id: input.dealId, pipelineStageId: input.toPipelineStageId },
      }),
      mapResponse: (response) => response.data,
    })

    expect(tool.isMutation).toBe(true)
    expect(tool.requiredFeatures).toEqual(['customers.deals.manage'])
  })

  it('does not invoke the runner if toOperation throws', async () => {
    const run = jest.fn()
    mockedCreateRunner.mockReturnValue({ run } as unknown as ReturnType<typeof createAiApiOperationRunner>)

    const tool = defineApiBackedAiTool({
      name: 'customers.broken',
      description: 'Broken',
      inputSchema: z.object({}),
      requiredFeatures: ['customers.people.view'],
      toOperation: () => {
        throw new Error('cannot build operation')
      },
      mapResponse: () => null,
    })

    await expect(tool.handler({}, makeBaseCtx())).rejects.toThrow('cannot build operation')
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the synthesized AiToolExecutionContext (with tool reference) to the runner factory', async () => {
    mockRunnerWith({ success: true, statusCode: 200, data: null })

    const tool = defineApiBackedAiTool({
      name: 'customers.ctx_check',
      description: 'desc',
      inputSchema: z.object({}),
      requiredFeatures: ['customers.people.view'],
      toOperation: () => ({ method: 'GET', path: '/customers/people' }),
      mapResponse: () => null,
    })

    const baseCtx = makeBaseCtx()
    await tool.handler({}, baseCtx)

    const factoryCtx = mockedCreateRunner.mock.calls[0][0]
    const expected = asExecutionCtx(tool, baseCtx)
    expect(factoryCtx.tenantId).toBe(expected.tenantId)
    expect(factoryCtx.organizationId).toBe(expected.organizationId)
    expect(factoryCtx.userId).toBe(expected.userId)
    expect(factoryCtx.tool).toBe(tool)
  })
})
