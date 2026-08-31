import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpHttpConnectorConfig } from '../config.js';
import { HarnessError } from '../errors.js';
import type {
  CapabilityProvider,
  CapabilitySession,
  CapabilityTool,
  OpenCapabilitySessionOptions,
} from './types.js';

export class McpHttpCapabilityProvider implements CapabilityProvider {
  async open(options: OpenCapabilitySessionOptions): Promise<CapabilitySession> {
    if (options.config.driver !== 'mcp-http') {
      throw new HarnessError('CONFIGURATION_ERROR', 'MCP provider received a non-MCP connector');
    }
    return McpHttpSession.connect(options.config, options.credential.value, options.signal);
  }
}

class McpHttpSession implements CapabilitySession {
  private constructor(
    private readonly client: Client,
    private readonly requestTimeoutMs: number,
  ) {}

  static async connect(
    config: McpHttpConnectorConfig,
    credential: string,
    signal?: AbortSignal,
  ): Promise<McpHttpSession> {
    const client = new Client({ name: 'openmercato-business-agent-runtime', version: '0.1.0' });
    const headers = new Headers(config.headers);
    if (config.auth) {
      headers.set(
        config.auth.headerName,
        config.auth.scheme ? `${config.auth.scheme} ${credential}` : credential,
      );
    }
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
    });
    try {
      await client.connect(
        transport as Parameters<Client['connect']>[0],
        signal ? { signal } : undefined,
      );
      return new McpHttpSession(client, config.requestTimeoutMs);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw new HarnessError('CONNECTOR_FAILED', 'Could not connect to the MCP endpoint', {
        cause: error,
      });
    }
  }

  async listTools(signal?: AbortSignal): Promise<CapabilityTool[]> {
    try {
      const result = await this.client.listTools(undefined, {
        timeout: this.requestTimeoutMs,
        ...(signal ? { signal } : {}),
      });
      return result.tools.map((tool) => {
        const annotations = tool.annotations
          ? {
              ...(tool.annotations.readOnlyHint !== undefined
                ? { readOnlyHint: tool.annotations.readOnlyHint }
                : {}),
              ...(tool.annotations.destructiveHint !== undefined
                ? { destructiveHint: tool.annotations.destructiveHint }
                : {}),
              ...(tool.annotations.idempotentHint !== undefined
                ? { idempotentHint: tool.annotations.idempotentHint }
                : {}),
              ...(tool.annotations.openWorldHint !== undefined
                ? { openWorldHint: tool.annotations.openWorldHint }
                : {}),
            }
          : undefined;
        return {
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          ...(annotations ? { annotations } : {}),
        };
      });
    } catch (error) {
      throw new HarnessError('CONNECTOR_FAILED', 'Could not list MCP tools', { cause: error });
    }
  }

  async callTool(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    try {
      return await this.client.callTool(
        { name, arguments: input },
        undefined,
        {
          timeout: this.requestTimeoutMs,
          ...(signal ? { signal } : {}),
        },
      );
    } catch (error) {
      throw new HarnessError('CONNECTOR_FAILED', `MCP tool ${name} failed`, { cause: error });
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

