import { z } from 'zod'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { executeTool, type ExecuteToolOptions } from '../tool-executor'
import { mapToolResultToAuditOutcome } from '../mcp-audit'
import type { AiToolDefinition, McpToolContext, McpToolDefinition } from '../types'

const mockRegisteredTools = new Map<string, McpToolDefinition>()

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTool: (name: string) => mockRegisteredTools.get(name),
  }),
}))

const AGENT_TOOL = 'catalog.title_reviewer.run'
const PLAIN_TOOL = 'catalog.list_products'
const agentHandler = jest.fn()
const plainHandler = jest.fn()

type ContainerShape = {
  registered: boolean
  limiter?: unknown
  throwOnResolve?: boolean
}

function buildContainer(shape: ContainerShape): McpToolContext['container'] {
  return {
    hasRegistration: (name: string) => name === 'rateLimiterService' && shape.registered,
    resolve: (name: string) => {
      if (name !== 'rateLimiterService') return {}
      if (shape.throwOnResolve) throw new Error('resolution failed')
      return shape.limiter ?? null
    },
  } as unknown as McpToolContext['container']
}

function buildContext(container: McpToolContext['container'], overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container,
    userFeatures: ['catalog.products.view'],
    isSuperAdmin: false,
    ...overrides,
  }
}

function enabledLimiter(): RateLimiterService {
  return new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test', trustProxyDepth: 0 })
}

const MCP_KEY_CALL: ExecuteToolOptions = { channel: 'mcp', requester: { userId: 'owner-1', apiKeyId: 'key-1' } }

const ORIGINAL_ENV = { ...process.env }

describe('executeTool agent-tool rate limit (C-3)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, RATE_LIMIT_AI_AGENT_TOOL_POINTS: '2', RATE_LIMIT_AI_AGENT_TOOL_DURATION: '60' }
    agentHandler.mockReset().mockResolvedValue({ result: { ok: true }, agentId: 'catalog.title_reviewer', runId: null, agentRunId: null })
    plainHandler.mockReset().mockResolvedValue({ items: [] })
    mockRegisteredTools.clear()
    const agentTool: AiToolDefinition = {
      name: AGENT_TOOL,
      description: 'Review a product title',
      inputSchema: z.object({ input: z.string() }),
      requiredFeatures: ['catalog.products.view'],
      agentRef: { agentId: 'catalog.title_reviewer', engine: 'ai-assistant' },
      handler: agentHandler,
    }
    mockRegisteredTools.set(AGENT_TOOL, agentTool as McpToolDefinition)
    mockRegisteredTools.set(PLAIN_TOOL, {
      name: PLAIN_TOOL,
      description: 'List products',
      inputSchema: z.object({}),
      requiredFeatures: ['catalog.products.view'],
      handler: plainHandler,
    })
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('refuses agent-tool calls over the per-key ceiling on the mcp channel without running the agent', async () => {
    const context = buildContext(buildContainer({ registered: true, limiter: enabledLimiter() }))
    const first = await executeTool(AGENT_TOOL, { input: 'a' }, context, MCP_KEY_CALL)
    const second = await executeTool(AGENT_TOOL, { input: 'b' }, context, MCP_KEY_CALL)
    const third = await executeTool(AGENT_TOOL, { input: 'c' }, context, MCP_KEY_CALL)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(third).toMatchObject({ success: false, errorCode: 'RATE_LIMITED' })
    expect(third.retryAfterSeconds).toBeGreaterThan(0)
    expect(agentHandler).toHaveBeenCalledTimes(2)
    expect(mapToolResultToAuditOutcome(third)).toBe('denied')
  })

  it('applies the same ceiling on the tools-api channel', async () => {
    const context = buildContext(buildContainer({ registered: true, limiter: enabledLimiter() }))
    const options: ExecuteToolOptions = { channel: 'tools-api', requester: { userId: 'user-1', apiKeyId: null } }
    await executeTool(AGENT_TOOL, { input: 'a' }, context, options)
    await executeTool(AGENT_TOOL, { input: 'b' }, context, options)
    const third = await executeTool(AGENT_TOOL, { input: 'c' }, context, options)
    expect(third).toMatchObject({ success: false, errorCode: 'RATE_LIMITED' })
    expect(agentHandler).toHaveBeenCalledTimes(2)
  })

  it('limits direct Code Mode search before calling its sandbox handler', async () => {
    mockRegisteredTools.set('search', {
      name: 'search',
      description: 'Search runtime metadata',
      inputSchema: z.object({ code: z.string() }),
      handler: plainHandler,
    })
    const context = buildContext(buildContainer({ registered: true, limiter: enabledLimiter() }))
    const options: ExecuteToolOptions = { channel: 'tools-api', requester: { userId: 'user-1', apiKeyId: null } }
    await executeTool('search', { code: 'normal search expression' }, context, options)
    await executeTool('search', { code: 'normal search expression' }, context, options)
    const third = await executeTool('search', { code: 'normal search expression' }, context, options)

    expect(third).toMatchObject({ success: false, errorCode: 'RATE_LIMITED' })
    expect(plainHandler).toHaveBeenCalledTimes(2)
  })

  it('keeps separate buckets per API key, per session user and per tenant', async () => {
    const limiter = enabledLimiter()
    const context = buildContext(buildContainer({ registered: true, limiter }))
    await executeTool(AGENT_TOOL, { input: 'a' }, context, MCP_KEY_CALL)
    await executeTool(AGENT_TOOL, { input: 'b' }, context, MCP_KEY_CALL)
    expect((await executeTool(AGENT_TOOL, { input: 'c' }, context, MCP_KEY_CALL)).errorCode).toBe('RATE_LIMITED')

    const otherKey = await executeTool(AGENT_TOOL, { input: 'd' }, context, {
      channel: 'mcp',
      requester: { userId: 'owner-1', apiKeyId: 'key-2' },
    })
    const sessionUser = await executeTool(AGENT_TOOL, { input: 'e' }, context, {
      channel: 'mcp',
      requester: { userId: 'owner-1', apiKeyId: null },
    })
    const otherTenant = await executeTool(
      AGENT_TOOL,
      { input: 'f' },
      buildContext(buildContainer({ registered: true, limiter }), { tenantId: 'tenant-2' }),
      MCP_KEY_CALL,
    )
    expect(otherKey.success).toBe(true)
    expect(sessionUser.success).toBe(true)
    expect(otherTenant.success).toBe(true)
  })

  it('does not limit non-agent tools or agent tools on the in-process agent channel', async () => {
    const context = buildContext(buildContainer({ registered: true, limiter: enabledLimiter() }))
    for (let index = 0; index < 4; index += 1) {
      expect((await executeTool(PLAIN_TOOL, {}, context, MCP_KEY_CALL)).success).toBe(true)
      expect((await executeTool(AGENT_TOOL, { input: 'x' }, context)).success).toBe(true)
    }
    expect(plainHandler).toHaveBeenCalledTimes(4)
    expect(agentHandler).toHaveBeenCalledTimes(4)
  })

  it('allows calls when no limiter is registered or limits are globally disabled', async () => {
    const unregistered = buildContext(buildContainer({ registered: false }))
    const disabled = buildContext(
      buildContainer({
        registered: true,
        limiter: new RateLimiterService({ enabled: false, strategy: 'memory', keyPrefix: 'test', trustProxyDepth: 0 }),
      }),
    )
    const structural = buildContext({
      resolve: (name: string) => {
        if (name === 'rbacService') return {}
        throw new Error(`[internal] ${name} is not registered`)
      },
    } as unknown as McpToolContext['container'])
    for (let index = 0; index < 4; index += 1) {
      expect((await executeTool(AGENT_TOOL, { input: 'x' }, structural, MCP_KEY_CALL)).success).toBe(true)
      expect((await executeTool(AGENT_TOOL, { input: 'x' }, unregistered, MCP_KEY_CALL)).success).toBe(true)
      expect((await executeTool(AGENT_TOOL, { input: 'x' }, disabled, MCP_KEY_CALL)).success).toBe(true)
    }
  })

  it('fails closed when a registered limiter cannot be resolved or cannot decide', async () => {
    const broken = buildContext(buildContainer({ registered: true, throwOnResolve: true }))
    const degraded = buildContext(
      buildContainer({
        registered: true,
        limiter: { consume: async () => ({ allowed: true, remainingPoints: 0, msBeforeNext: 0, consumedPoints: 0, degraded: true }) },
      }),
    )
    const throwing = buildContext(
      buildContainer({ registered: true, limiter: { consume: async () => { throw new Error('store down') } } }),
    )
    for (const context of [broken, degraded, throwing]) {
      const result = await executeTool(AGENT_TOOL, { input: 'x' }, context, MCP_KEY_CALL)
      expect(result).toMatchObject({ success: false, errorCode: 'RATE_LIMIT_UNAVAILABLE' })
      expect(mapToolResultToAuditOutcome(result)).toBe('error')
    }
    expect(agentHandler).not.toHaveBeenCalled()
  })

  it('does not consume points for calls refused by ACL', async () => {
    const context = buildContext(buildContainer({ registered: true, limiter: enabledLimiter() }), {
      userFeatures: [],
    })
    const rbacContainer = context.container as unknown as { resolve: (name: string) => unknown }
    const originalResolve = rbacContainer.resolve
    rbacContainer.resolve = (name: string) => (name === 'rbacService' ? {} : originalResolve(name))
    for (let index = 0; index < 3; index += 1) {
      expect((await executeTool(AGENT_TOOL, { input: 'x' }, context, MCP_KEY_CALL)).errorCode).toBe('UNAUTHORIZED')
    }
    const allowedContext = { ...context, userFeatures: ['catalog.products.view'] }
    expect((await executeTool(AGENT_TOOL, { input: 'x' }, allowedContext, MCP_KEY_CALL)).success).toBe(true)
  })
})
