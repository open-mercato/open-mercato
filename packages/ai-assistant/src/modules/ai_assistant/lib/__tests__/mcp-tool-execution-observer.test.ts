import {
  MCP_TOOL_EXECUTION_OBSERVER_DI_KEY,
  runWithMcpToolExecutionObserver,
  type McpToolExecutionObserver,
  type McpToolExecutionObserverContext,
} from '../mcp-tool-execution-observer'

const observerContext: McpToolExecutionObserverContext = {
  sessionId: 'sess_test',
  toolName: 'customers.list_people',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  correlationId: 'corr-1',
}

function containerWith(observer: unknown) {
  return {
    resolve: jest.fn((name: string) => (name === MCP_TOOL_EXECUTION_OBSERVER_DI_KEY ? observer : undefined)),
  }
}

describe('runWithMcpToolExecutionObserver', () => {
  it('calls the tool directly when no observer is registered', async () => {
    const container = {
      resolve: jest.fn(() => {
        throw new Error('not registered')
      }),
    }
    const fn = jest.fn(async () => 'result')
    await expect(runWithMcpToolExecutionObserver(container, observerContext, fn)).resolves.toBe('result')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('treats a resolved value without wrap as no observer', async () => {
    const fn = jest.fn(async () => 'result')
    await expect(runWithMcpToolExecutionObserver(containerWith({}), observerContext, fn)).resolves.toBe('result')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('invokes the observer with the session id and tool context', async () => {
    const wrap = jest.fn(async <T,>(_ctx: McpToolExecutionObserverContext, inner: () => Promise<T>) => inner())
    const observer: McpToolExecutionObserver = { wrap }
    const fn = jest.fn(async () => 'result')
    await expect(runWithMcpToolExecutionObserver(containerWith(observer), observerContext, fn)).resolves.toBe('result')
    expect(wrap).toHaveBeenCalledWith(observerContext, expect.any(Function))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('falls back to a direct call when the observer throws before running the tool', async () => {
    const observer: McpToolExecutionObserver = {
      wrap: async () => {
        throw new Error('hook broken')
      },
    }
    const fn = jest.fn(async () => 'result')
    await expect(runWithMcpToolExecutionObserver(containerWith(observer), observerContext, fn)).resolves.toBe('result')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('keeps the tool result without re-running it when the observer throws afterwards', async () => {
    const observer: McpToolExecutionObserver = {
      wrap: async <T,>(_ctx: McpToolExecutionObserverContext, inner: () => Promise<T>) => {
        await inner()
        throw new Error('post-call write failed')
      },
    }
    const fn = jest.fn(async () => 'result')
    await expect(runWithMcpToolExecutionObserver(containerWith(observer), observerContext, fn)).resolves.toBe('result')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('propagates the tool error without re-running it', async () => {
    const observer: McpToolExecutionObserver = {
      wrap: async <T,>(_ctx: McpToolExecutionObserverContext, inner: () => Promise<T>) => inner(),
    }
    const toolError = new Error('tool failed')
    const fn = jest.fn(async () => {
      throw toolError
    })
    await expect(runWithMcpToolExecutionObserver(containerWith(observer), observerContext, fn)).rejects.toBe(toolError)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
