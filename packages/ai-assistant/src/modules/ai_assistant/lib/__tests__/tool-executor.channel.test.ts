import { z } from 'zod'
import { executeTool, type ExecuteToolOptions } from '../tool-executor'
import type { AiToolDefinition, McpToolContext, McpToolDefinition } from '../types'

const mockRegisteredTools = new Map<string, McpToolDefinition>()

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTool: (name: string) => mockRegisteredTools.get(name),
  }),
}))

const mutationHandler = jest.fn(async () => ({ updated: true }))
const readHandler = jest.fn(async () => ({ items: [] }))

function registerTool(definition: Partial<AiToolDefinition> & { name: string }): void {
  mockRegisteredTools.set(definition.name, {
    description: `${definition.name} description`,
    inputSchema: z.object({ id: z.string() }),
    handler: async () => ({}),
    ...definition,
  } as McpToolDefinition)
}

function buildContext(userFeatures: string[] = ['customers.*']): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: {
      resolve: () => ({}),
    } as unknown as McpToolContext['container'],
    userFeatures,
    isSuperAdmin: false,
  }
}

const MUTATION_TOOL = 'customers.update_person'
const READ_TOOL = 'customers.list_people'

describe('executeTool channel + mutation mode gate', () => {
  beforeEach(() => {
    mockRegisteredTools.clear()
    mutationHandler.mockClear()
    readHandler.mockClear()
    registerTool({
      name: MUTATION_TOOL,
      requiredFeatures: ['customers.people.manage'],
      isMutation: true,
      handler: mutationHandler,
    })
    registerTool({
      name: READ_TOOL,
      requiredFeatures: ['customers.people.view'],
      handler: readHandler,
    })
  })

  it.each<ExecuteToolOptions['channel']>(['mcp', 'tools-api'])(
    'deny blocks mutation tools on the %s channel without running the handler',
    async (channel) => {
      const result = await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), {
        channel,
        mutationMode: 'deny',
      })

      expect(result).toMatchObject({ success: false, errorCode: 'MUTATION_REQUIRES_APPROVAL' })
      expect(result.pendingApproval).toBeUndefined()
      expect(mutationHandler).not.toHaveBeenCalled()
    },
  )

  it('approval blocks mutation tools on mcp with MUTATION_REQUIRES_APPROVAL', async () => {
    const result = await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), {
      channel: 'mcp',
      mutationMode: 'approval',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'MUTATION_REQUIRES_APPROVAL' })
    expect(mutationHandler).not.toHaveBeenCalled()
  })

  it('deny does not affect the agent channel', async () => {
    const result = await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), {
      channel: 'agent',
      mutationMode: 'deny',
    })

    expect(result).toEqual({ success: true, result: { updated: true } })
    expect(mutationHandler).toHaveBeenCalledTimes(1)
  })

  it('defaults to the agent channel when no options are passed', async () => {
    const result = await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext())

    expect(result).toEqual({ success: true, result: { updated: true } })
    expect(mutationHandler).toHaveBeenCalledTimes(1)
  })

  it.each<ExecuteToolOptions['channel']>(['mcp', 'tools-api'])(
    'direct runs mutation tools on the %s channel',
    async (channel) => {
      const result = await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), {
        channel,
        mutationMode: 'direct',
      })

      expect(result).toEqual({ success: true, result: { updated: true } })
      expect(mutationHandler).toHaveBeenCalledTimes(1)
    },
  )

  it('leaves non-mutation tools unaffected in deny mode', async () => {
    const result = await executeTool(READ_TOOL, { id: 'p-1' }, buildContext(), {
      channel: 'mcp',
      mutationMode: 'deny',
    })

    expect(result).toEqual({ success: true, result: { items: [] } })
    expect(readHandler).toHaveBeenCalledTimes(1)
  })

  it('reports an ACL failure before the mutation gate', async () => {
    const result = await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(['customers.people.view']), {
      channel: 'mcp',
      mutationMode: 'deny',
    })

    expect(result.errorCode).toBe('UNAUTHORIZED')
    expect(mutationHandler).not.toHaveBeenCalled()
  })

  it('reports a validation failure before the mutation gate', async () => {
    const result = await executeTool(MUTATION_TOOL, { id: 42 }, buildContext(), {
      channel: 'tools-api',
      mutationMode: 'deny',
    })

    expect(result.errorCode).toBe('VALIDATION_ERROR')
    expect(mutationHandler).not.toHaveBeenCalled()
  })
})
