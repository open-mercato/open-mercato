import type { AwilixContainer } from 'awilix'
import type { McpClientInterface } from './types'

/**
 * Client connection mode.
 */
export type ClientMode = 'in-process' | 'stdio' | 'http'

/**
 * Options for creating an MCP client.
 */
export type CreateClientOptions = {
  /** Connection mode */
  mode: ClientMode
  /** API key secret for authentication */
  apiKeySecret: string
  /** DI container (required for in-process mode) */
  container?: AwilixContainer
  /** HTTP server URL (required for http mode) */
  httpUrl?: string
  /** Custom command for stdio mode (default: 'yarn') */
  stdioCommand?: string
  /** Custom args for stdio mode (default: mercato mcp:serve) */
  stdioArgs?: string[]
  /** Working directory for stdio mode */
  cwd?: string
}

/**
 * Create an MCP client with the specified connection mode.
 *
 * All modes authenticate via API key, ensuring consistent ACL enforcement.
 *
 * @example
 * ```typescript
 * // In-process mode (fastest, same process)
 * const client = await createMcpClient({
 *   mode: 'in-process',
 *   apiKeySecret: 'omk_xxx.yyy',
 *   container: diContainer,
 * })
 *
 * // Stdio mode (subprocess)
 * const client = await createMcpClient({
 *   mode: 'stdio',
 *   apiKeySecret: 'omk_xxx.yyy',
 * })
 *
 * // HTTP mode (network)
 * const client = await createMcpClient({
 *   mode: 'http',
 *   apiKeySecret: 'omk_xxx.yyy',
 *   httpUrl: 'http://localhost:3001/mcp',
 * })
 *
 * // Use client (same interface for all modes)
 * const tools = await client.listTools()
 * const result = await client.callTool('search.query', { query: 'test' })
 * await client.close()
 * ```
 */
export async function createMcpClient(options: CreateClientOptions): Promise<McpClientInterface> {
  const { mode, apiKeySecret } = options

  if (!apiKeySecret) {
    throw new Error('API key secret is required')
  }

  switch (mode) {
    case 'in-process': {
      if (!options.container) {
        throw new Error('DI container is required for in-process mode')
      }

      const { InProcessMcpClient } = await import('./in-process-client')
      return InProcessMcpClient.create({
        apiKeySecret,
        container: options.container,
      })
    }

    case 'stdio': {
      const { McpClient } = await import('./mcp-client')

      const stdioOptions: any = {
        transport: 'stdio' as const,
        apiKeySecret,
      }

      if (options.stdioCommand) {
        stdioOptions.command = options.stdioCommand
      }

      if (options.stdioArgs) {
        stdioOptions.args = options.stdioArgs
      } else {
        // Default args include the API key
        stdioOptions.args = [
          'mercato',
          'ai_assistant',
          'mcp:serve',
          '--api-key',
          apiKeySecret,
        ]
      }

      if (options.cwd) {
        stdioOptions.cwd = options.cwd
      }

      return McpClient.connect(stdioOptions)
    }

    case 'http': {
      if (!options.httpUrl) {
        throw new Error('HTTP URL is required for http mode')
      }

      const { McpClient } = await import('./mcp-client')
      return McpClient.connect({
        transport: 'http',
        apiKeySecret,
        url: options.httpUrl,
      })
    }

    default:
      throw new Error(`Unknown client mode: ${mode}`)
  }
}
