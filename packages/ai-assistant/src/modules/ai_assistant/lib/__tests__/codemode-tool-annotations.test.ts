import { loadCodeModeTools } from '../codemode-tools'
import { buildMcpToolAnnotations } from '../mcp-tool-annotations'
import { registerMcpTool } from '../tool-registry'
import type { McpToolDefinition } from '../types'

jest.mock('../api-endpoint-index', () => ({
  getApiEndpoints: jest.fn(async () => []),
  getRawOpenApiSpec: jest.fn(async () => null),
}))

jest.mock('../tool-registry', () => ({
  registerMcpTool: jest.fn(),
}))

const mockedRegisterMcpTool = jest.mocked(registerMcpTool)

async function loadRegisteredCodeModeTools(): Promise<Map<string, McpToolDefinition>> {
  await loadCodeModeTools()
  const tools = new Map<string, McpToolDefinition>()
  for (const call of mockedRegisterMcpTool.mock.calls) {
    const tool = call[0] as McpToolDefinition
    tools.set(tool.name, tool)
  }
  return tools
}

describe('issue #5283 — Code Mode tools declare their mutation surface', () => {
  beforeEach(() => {
    mockedRegisterMcpTool.mockClear()
  })

  it('advertises the spec-querying search tool as read-only', async () => {
    const tools = await loadRegisteredCodeModeTools()
    const search = tools.get('search')

    expect(search).toBeDefined()
    expect(buildMcpToolAnnotations(search!)).toEqual({ readOnlyHint: true })
  })

  it('never advertises the api.request() execute tool as read-only', async () => {
    const tools = await loadRegisteredCodeModeTools()
    const execute = tools.get('execute')

    expect(execute).toBeDefined()
    expect(buildMcpToolAnnotations(execute!)).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    })
  })

  it('registers both Code Mode tools under the codemode module id', async () => {
    await loadRegisteredCodeModeTools()

    for (const call of mockedRegisterMcpTool.mock.calls) {
      expect(call[1]).toEqual({ moduleId: 'codemode' })
    }
  })
})
