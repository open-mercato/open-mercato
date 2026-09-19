import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import cliCommands from '../cli'

const installHookMock = jest.fn(() => true)
const runMcpHttpServerMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({})),
  getDiRegistrars: jest.fn(() => []),
}))

jest.mock('../lib/next-subpath-resolve-hook', () => ({
  installNextSubpathResolveHook: (...args: unknown[]) => installHookMock(...args),
}))

jest.mock('../lib/http-server', () => ({
  runMcpHttpServer: (...args: unknown[]) => runMcpHttpServerMock(...args),
}))

function getCommand(name: string): ModuleCli {
  const cmd = (cliCommands as ModuleCli[]).find((c) => c.command === name)
  if (!cmd) throw new Error(`${name} command not found`)
  return cmd
}

describe('standalone MCP commands install the next/<subpath> resolve hook (#6238 / #6118)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('installs the hook before serving over HTTP', async () => {
    await getCommand('mcp:serve-http').run(['--port', '3999'])

    expect(installHookMock).toHaveBeenCalledTimes(1)
    expect(runMcpHttpServerMock).toHaveBeenCalledTimes(1)
    // The hook must be in place before the server (and the first tool call)
    // can import a route module.
    expect(installHookMock.mock.invocationCallOrder[0]).toBeLessThan(
      runMcpHttpServerMock.mock.invocationCallOrder[0],
    )
  })
})
