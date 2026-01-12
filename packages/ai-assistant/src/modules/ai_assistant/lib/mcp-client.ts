import { spawn, type ChildProcess } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpClientInterface, ToolInfo, ToolResult } from './types'

/**
 * Options for stdio transport.
 */
export type StdioClientOptions = {
  transport: 'stdio'
  /** API key secret (passed to server via --api-key) */
  apiKeySecret: string
  /** Command to run (default: 'yarn') */
  command?: string
  /** Arguments for the command (default: mercato mcp:serve with api-key) */
  args?: string[]
  /** Working directory (default: process.cwd()) */
  cwd?: string
}

/**
 * Options for HTTP transport.
 */
export type HttpClientOptions = {
  transport: 'http'
  /** API key secret (sent via x-api-key header) */
  apiKeySecret: string
  /** MCP server URL (e.g., 'http://localhost:3001/mcp') */
  url: string
}

/**
 * Combined options for McpClient.
 */
export type McpClientOptions = StdioClientOptions | HttpClientOptions

/**
 * MCP protocol client for connecting to MCP servers.
 *
 * Supports two transport modes:
 * - stdio: Spawns server as subprocess
 * - http: Connects to HTTP server
 */
export class McpClient implements McpClientInterface {
  private client: Client
  private transport: StdioClientTransport | StreamableHTTPClientTransport
  private childProcess?: ChildProcess
  private apiKeySecret: string

  private constructor(
    client: Client,
    transport: StdioClientTransport | StreamableHTTPClientTransport,
    apiKeySecret: string,
    childProcess?: ChildProcess
  ) {
    this.client = client
    this.transport = transport
    this.apiKeySecret = apiKeySecret
    this.childProcess = childProcess
  }

  /**
   * Connect to an MCP server via the specified transport.
   */
  static async connect(options: McpClientOptions): Promise<McpClient> {
    if (options.transport === 'stdio') {
      return McpClient.connectStdio(options)
    } else {
      return McpClient.connectHttp(options)
    }
  }

  /**
   * Connect via stdio transport (spawn subprocess).
   */
  private static async connectStdio(options: StdioClientOptions): Promise<McpClient> {
    const command = options.command ?? 'yarn'
    const args = options.args ?? [
      'mercato',
      'ai_assistant',
      'mcp:serve',
      '--api-key',
      options.apiKeySecret,
    ]
    const cwd = options.cwd ?? process.cwd()

    const childProcess = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    // Forward stderr for debugging
    childProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        console.error(`[MCP Client] ${message}`)
      }
    })

    const transport = new StdioClientTransport({
      command,
      args,
      cwd,
      env: process.env as Record<string, string>,
    })

    const client = new Client(
      { name: 'open-mercato-client', version: '0.1.0' },
      { capabilities: {} }
    )

    await client.connect(transport)

    return new McpClient(client, transport, options.apiKeySecret, childProcess)
  }

  /**
   * Connect via HTTP transport.
   */
  private static async connectHttp(options: HttpClientOptions): Promise<McpClient> {
    const transport = new StreamableHTTPClientTransport(
      new URL(options.url),
      {
        requestInit: {
          headers: {
            'x-api-key': options.apiKeySecret,
          },
        },
      }
    )

    const client = new Client(
      { name: 'open-mercato-client', version: '0.1.0' },
      { capabilities: {} }
    )

    await client.connect(transport)

    return new McpClient(client, transport, options.apiKeySecret)
  }

  /**
   * List available tools from the server.
   */
  async listTools(): Promise<ToolInfo[]> {
    const response = await this.client.listTools()

    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
    }))
  }

  /**
   * Call a tool on the server.
   */
  async callTool(name: string, args: unknown): Promise<ToolResult> {
    try {
      const response = await this.client.callTool({
        name,
        arguments: args as Record<string, unknown>,
      })

      // Parse content from response
      const content = response.content
      if (!Array.isArray(content) || content.length === 0) {
        return { success: true, result: null }
      }

      const firstContent = content[0]
      if (firstContent.type === 'text') {
        try {
          const parsed = JSON.parse(firstContent.text)

          // Check if it's an error response
          if (response.isError || parsed.error) {
            return {
              success: false,
              error: parsed.error ?? 'Unknown error',
            }
          }

          return { success: true, result: parsed }
        } catch {
          // Not JSON, return as-is
          return { success: true, result: firstContent.text }
        }
      }

      return { success: true, result: content }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  }

  /**
   * Close the client and release resources.
   */
  async close(): Promise<void> {
    try {
      await this.client.close()
    } catch {
      // Ignore close errors
    }

    try {
      await this.transport.close()
    } catch {
      // Ignore close errors
    }

    if (this.childProcess) {
      this.childProcess.kill()
      this.childProcess = undefined
    }
  }
}
