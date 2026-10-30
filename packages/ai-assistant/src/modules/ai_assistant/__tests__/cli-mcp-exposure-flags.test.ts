import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import cliCommands from '../cli'

type RegistryTool = {
  name: string
  description: string
  requiredFeatures?: string[]
  isMutation?: boolean
}

const mockRunMcpServer = jest.fn(async (_options: unknown) => undefined)
const mockRunMcpHttpServer = jest.fn(async (_options: unknown) => undefined)
const mockResolveApiKeyListCaller = jest.fn(
  async (_container: unknown, _secret: string): Promise<{ features: string[]; isSuperAdmin: boolean } | null> => null,
)
const mockLoadAllModuleTools = jest.fn(async () => undefined)
const mockRegistryTools = new Map<string, RegistryTool>()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({})),
  getDiRegistrars: jest.fn(() => []),
}))

jest.mock('../lib/mcp-server', () => ({
  runMcpServer: (options: unknown) => mockRunMcpServer(options),
}))

jest.mock('../lib/http-server', () => ({
  runMcpHttpServer: (options: unknown) => mockRunMcpHttpServer(options),
  resolveApiKeyListCaller: (container: unknown, secret: string) => mockResolveApiKeyListCaller(container, secret),
}))

jest.mock('../lib/tool-loader', () => ({
  loadAllModuleTools: () => mockLoadAllModuleTools(),
}))

jest.mock('../lib/tool-registry', () => ({
  getToolRegistry: () => ({
    listToolNames: () => Array.from(mockRegistryTools.keys()),
    getTools: () => mockRegistryTools,
    getTool: (name: string) => mockRegistryTools.get(name),
  }),
}))

function getCommand(name: string): ModuleCli {
  const command = (cliCommands as ModuleCli[]).find((entry) => entry.command === name)
  if (!command) throw new Error(`${name} command not found`)
  return command
}

function printedLines(spy: jest.SpyInstance): string[] {
  return spy.mock.calls.map((call) => call.map((part: unknown) => String(part)).join(' '))
}

const EXPOSURE_ENV_KEYS = ['OM_MCP_TOOL_ALLOWLIST', 'OM_MCP_TOOL_DENYLIST', 'OM_MCP_MUTATION_MODE', 'OM_MCP_AGENT_TOOLS']

describe('MCP exposure CLI flags', () => {
  const originalEnv: Record<string, string | undefined> = {}
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.exitCode = undefined
    for (const key of [...EXPOSURE_ENV_KEYS, 'OPEN_MERCATO_API_KEY']) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
    mockRegistryTools.clear()
    for (const entry of [
      { name: 'customers.list_people', description: 'List people', requiredFeatures: ['customers.people.view'] },
      {
        name: 'customers.update_person',
        description: 'Update person',
        requiredFeatures: ['customers.people.manage'],
        isMutation: true,
      },
      { name: 'catalog.list_products', description: 'List products', requiredFeatures: ['catalog.products.view'] },
    ]) {
      mockRegistryTools.set(entry.name, entry)
    }
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    logSpy.mockRestore()
    errorSpy.mockRestore()
    process.exitCode = undefined
  })

  describe('mcp:serve', () => {
    it('passes exposure flags through as cliArgs', async () => {
      await getCommand('mcp:serve').run([
        '--api-key',
        'omk_flag.secret',
        '--tools',
        'customers.*,search',
        '--exclude-tools=customers.delete_*',
        '--mutation-mode',
        'Approval',
        '--no-agent-tools',
      ])

      expect(mockRunMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeySecret: 'omk_flag.secret',
          cliArgs: {
            tools: 'customers.*,search',
            'exclude-tools': 'customers.delete_*',
            'mutation-mode': 'approval',
            'no-agent-tools': true,
          },
        }),
      )
    })

    it('passes an empty cliArgs object when no exposure flags are given', async () => {
      await getCommand('mcp:serve').run(['--tenant', 'tenant-1', '--user', 'user-1'])

      expect(mockRunMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({ context: expect.objectContaining({ tenantId: 'tenant-1' }), cliArgs: {} }),
      )
    })

    it('rejects an invalid mutation mode without starting the server', async () => {
      await getCommand('mcp:serve').run(['--api-key', 'omk_flag.secret', '--mutation-mode', 'aproval'])

      expect(mockRunMcpServer).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
      const output = printedLines(errorSpy).join('\n')
      expect(output).toContain('Invalid --mutation-mode "aproval"')
      expect(output).toContain('direct, deny, approval')
    })
  })

  describe('mcp:serve-http', () => {
    it('passes exposure flags through as cliArgs', async () => {
      await getCommand('mcp:serve-http').run(['--port', '4001', '--mutation-mode', 'deny', '--tools', 'catalog.*'])

      expect(mockRunMcpHttpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 4001,
          cliArgs: { tools: 'catalog.*', 'mutation-mode': 'deny' },
        }),
      )
    })

    it('rejects a mutation mode flag without a value', async () => {
      await getCommand('mcp:serve-http').run(['--mutation-mode'])

      expect(mockRunMcpHttpServer).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
      expect(printedLines(errorSpy).join('\n')).toContain('Invalid --mutation-mode (missing value)')
    })
  })

  describe('mcp:list-tools', () => {
    it('lists every registered tool without --effective, ignoring exposure env', async () => {
      process.env.OM_MCP_TOOL_ALLOWLIST = 'catalog.*'

      await getCommand('mcp:list-tools').run([])

      const output = printedLines(logSpy).join('\n')
      expect(output).toContain('Registered MCP Tools (3)')
      expect(output).toContain('customers.list_people')
      expect(output).toContain('catalog.list_products')
      expect(mockResolveApiKeyListCaller).not.toHaveBeenCalled()
    })

    it('applies env and flags with --effective', async () => {
      process.env.OM_MCP_TOOL_ALLOWLIST = 'customers.*'

      await getCommand('mcp:list-tools').run(['--effective', '--mutation-mode', 'deny'])

      const output = printedLines(logSpy).join('\n')
      expect(output).toContain('Effective MCP Tools (1 of 3)')
      expect(output).toContain('customers.list_people')
      expect(output).not.toContain('customers.update_person')
      expect(output).not.toContain('catalog.list_products')
    })

    it('applies the API key ACL with --as-api-key and never prints the secret', async () => {
      mockResolveApiKeyListCaller.mockResolvedValueOnce({
        features: ['customers.people.view', 'catalog.products.view'],
        isSuperAdmin: false,
      })

      await getCommand('mcp:list-tools').run(['--effective', '--as-api-key', 'omk_list.secret'])

      expect(mockResolveApiKeyListCaller).toHaveBeenCalledWith(expect.anything(), 'omk_list.secret')
      const output = [...printedLines(logSpy), ...printedLines(errorSpy)].join('\n')
      expect(output).toContain('Effective MCP Tools (2 of 3)')
      expect(output).toContain('customers.list_people')
      expect(output).toContain('catalog.list_products')
      expect(output).not.toContain('customers.update_person')
      expect(output).not.toContain('omk_list.secret')
    })

    it('fails when the API key cannot be resolved', async () => {
      mockResolveApiKeyListCaller.mockResolvedValueOnce(null)

      await getCommand('mcp:list-tools').run(['--as-api-key', 'omk_bad.secret'])

      expect(process.exitCode).toBe(1)
      const output = [...printedLines(logSpy), ...printedLines(errorSpy)].join('\n')
      expect(output).toContain('Invalid or expired API key')
      expect(output).not.toContain('omk_bad.secret')
    })

    it('warns about an invalid env mutation mode', async () => {
      process.env.OM_MCP_MUTATION_MODE = 'yolo'

      await getCommand('mcp:list-tools').run(['--effective'])

      expect(printedLines(errorSpy).join('\n')).toContain('Invalid OM_MCP_MUTATION_MODE "yolo"')
      expect(printedLines(logSpy).join('\n')).toContain('Effective MCP Tools (3 of 3)')
    })

    it('rejects an invalid mutation mode with --effective', async () => {
      await getCommand('mcp:list-tools').run(['--effective', '--mutation-mode', 'nope'])

      expect(process.exitCode).toBe(1)
      expect(mockLoadAllModuleTools).not.toHaveBeenCalled()
    })
  })
})
