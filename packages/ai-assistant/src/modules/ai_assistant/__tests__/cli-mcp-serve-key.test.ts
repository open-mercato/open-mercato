import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import cliCommands from '../cli'

const mockRunMcpServer = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({})),
  getDiRegistrars: jest.fn(() => []),
}))

jest.mock('../lib/mcp-server', () => ({
  runMcpServer: (...args: unknown[]) => mockRunMcpServer(...args),
}))

function getMcpServe(): ModuleCli {
  const cmd = (cliCommands as ModuleCli[]).find((c) => c.command === 'mcp:serve')
  if (!cmd) throw new Error('mcp:serve command not found')
  return cmd
}

describe('mcp:serve API key resolution (issue #2669)', () => {
  const originalEnv = process.env.OPEN_MERCATO_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OPEN_MERCATO_API_KEY
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OPEN_MERCATO_API_KEY
    else process.env.OPEN_MERCATO_API_KEY = originalEnv
  })

  it('reads the key from OPEN_MERCATO_API_KEY when --api-key is absent', async () => {
    process.env.OPEN_MERCATO_API_KEY = 'omk_env.secret'

    await getMcpServe().run([])

    expect(mockRunMcpServer).toHaveBeenCalledTimes(1)
    expect(mockRunMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeySecret: 'omk_env.secret' }),
    )
  })

  it('still accepts the --api-key flag and prefers it over the env var', async () => {
    process.env.OPEN_MERCATO_API_KEY = 'omk_env.secret'

    await getMcpServe().run(['--api-key', 'omk_flag.secret'])

    expect(mockRunMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeySecret: 'omk_flag.secret' }),
    )
  })

  it('prints usage and does not start the server when neither key nor tenant is provided', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await getMcpServe().run([])

    expect(mockRunMcpServer).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
