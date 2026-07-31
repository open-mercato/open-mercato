import { createMcpClient } from '../client-factory'

const mockConnect = jest.fn(async () => ({ listTools: jest.fn(), callTool: jest.fn(), close: jest.fn() }))

jest.mock('../mcp-client', () => ({
  McpClient: {
    connect: (...args: unknown[]) => mockConnect(...args),
  },
}))

describe('createMcpClient stdio mode (issue #2669)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('never places the API key on the default argv', async () => {
    await createMcpClient({ mode: 'stdio', apiKeySecret: 'omk_secret.value' })

    expect(mockConnect).toHaveBeenCalledTimes(1)
    const options = mockConnect.mock.calls[0][0] as { apiKeySecret: string; args?: string[] }

    // The secret is forwarded to McpClient.connect, which delivers it via env.
    expect(options.apiKeySecret).toBe('omk_secret.value')

    // The factory must not build default args that embed the secret. Leaving
    // args undefined lets connectStdio use its secret-free default.
    expect(options.args).toBeUndefined()
    expect(JSON.stringify(options.args ?? [])).not.toContain('--api-key')
    expect(JSON.stringify(options.args ?? [])).not.toContain('omk_secret.value')
  })

  it('honors explicitly provided stdio args without injecting the secret', async () => {
    await createMcpClient({
      mode: 'stdio',
      apiKeySecret: 'omk_secret.value',
      stdioArgs: ['node', 'custom-server.js'],
    })

    const options = mockConnect.mock.calls[0][0] as { args?: string[] }
    expect(options.args).toEqual(['node', 'custom-server.js'])
  })
})
