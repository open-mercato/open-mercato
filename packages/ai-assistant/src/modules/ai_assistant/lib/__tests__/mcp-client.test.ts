import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpClient } from '../mcp-client'

const mockClientConnect = jest.fn(async () => undefined)
const mockClientClose = jest.fn(async () => undefined)
const mockClientListTools = jest.fn(async () => ({ tools: [] }))
const mockTransportClose = jest.fn(async () => undefined)
const mockTransportStderr = new EventEmitter()
const mockManualChildKill = jest.fn()

jest.mock('node:child_process', () => ({
  spawn: jest.fn(() => ({
    stderr: new EventEmitter(),
    kill: mockManualChildKill,
  })),
}))

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    close: mockClientClose,
    listTools: mockClientListTools,
  })),
}))

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: mockTransportClose,
    stderr: mockTransportStderr,
  })),
}))

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn(async () => undefined),
  })),
}))

describe('McpClient stdio transport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('delegates process spawning to StdioClientTransport without a manual duplicate spawn', async () => {
    const client = await McpClient.connect({
      transport: 'stdio',
      apiKeySecret: 'test-secret',
      command: 'node',
      args: ['server.js'],
      cwd: '/tmp/open-mercato',
    })

    expect(Client).toHaveBeenCalledTimes(1)
    expect(StdioClientTransport).toHaveBeenCalledWith({
      command: 'node',
      args: ['server.js'],
      cwd: '/tmp/open-mercato',
      env: { ...process.env, OPEN_MERCATO_API_KEY: 'test-secret' },
      stderr: 'pipe',
    })
    expect(mockClientConnect).toHaveBeenCalledTimes(1)
    expect(mockClientConnect).toHaveBeenCalledWith(expect.any(Object))
    expect(spawn).not.toHaveBeenCalled()

    await client.close()

    expect(mockClientClose).toHaveBeenCalledTimes(1)
    expect(mockTransportClose).toHaveBeenCalledTimes(1)
    expect(mockManualChildKill).not.toHaveBeenCalled()
  })

  it('passes the API key via OPEN_MERCATO_API_KEY env, never on argv (issue #2669)', async () => {
    await McpClient.connect({
      transport: 'stdio',
      apiKeySecret: 'omk_secret.value',
    })

    expect(StdioClientTransport).toHaveBeenCalledTimes(1)
    const transportArgs = (StdioClientTransport as jest.Mock).mock.calls[0][0]

    // The secret must reach the child process exclusively through the env var.
    expect(transportArgs.env.OPEN_MERCATO_API_KEY).toBe('omk_secret.value')

    // It must NOT appear on argv (world-readable via ps / /proc/<pid>/cmdline).
    expect(transportArgs.args).toEqual(['mercato', 'ai_assistant', 'mcp:serve'])
    expect(transportArgs.args).not.toContain('--api-key')
    expect(transportArgs.args).not.toContain('omk_secret.value')
    expect(JSON.stringify(transportArgs.args)).not.toContain('omk_secret.value')
  })
})
