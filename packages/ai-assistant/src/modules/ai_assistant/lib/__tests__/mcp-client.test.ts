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
      env: process.env,
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
})
