/**
 * OpenCode Agent Client
 *
 * Client for communicating with OpenCode server running in headless mode.
 * OpenCode is used as an AI agent that can execute MCP tools.
 */

export type OpenCodeClientConfig = {
  baseUrl: string
  password?: string
}

export type OpenCodeSession = {
  id: string
  slug: string
  version: string
  projectID: string
  directory: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type OpenCodeMessagePart = {
  type: 'text'
  text: string
}

export type OpenCodeMessageInfo = {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  time: {
    created: number
    completed?: number
  }
  modelID?: string
  providerID?: string
  tokens?: {
    input: number
    output: number
  }
  error?: {
    name: string
    data: Record<string, unknown>
  }
}

export type OpenCodeMessage = {
  info: OpenCodeMessageInfo
  parts: Array<{
    id: string
    type: string
    text?: string
    [key: string]: unknown
  }>
}

export type OpenCodeHealth = {
  healthy: boolean
  version: string
}

export type OpenCodeMcpStatus = Record<
  string,
  {
    status: 'connected' | 'failed' | 'connecting'
    error?: string
  }
>

/**
 * Client for OpenCode server API.
 */
export class OpenCodeClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(config: OpenCodeClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.headers = {
      'Content-Type': 'application/json',
    }

    if (config.password) {
      const credentials = Buffer.from(`opencode:${config.password}`).toString('base64')
      this.headers['Authorization'] = `Basic ${credentials}`
    }
  }

  /**
   * Check OpenCode server health.
   */
  async health(): Promise<OpenCodeHealth> {
    const res = await fetch(`${this.baseUrl}/global/health`, {
      headers: this.headers,
    })

    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status}`)
    }

    return res.json()
  }

  /**
   * Get MCP server connection status.
   */
  async mcpStatus(): Promise<OpenCodeMcpStatus> {
    const res = await fetch(`${this.baseUrl}/mcp`, {
      headers: this.headers,
    })

    if (!res.ok) {
      throw new Error(`MCP status check failed: ${res.status}`)
    }

    return res.json()
  }

  /**
   * Create a new conversation session.
   */
  async createSession(): Promise<OpenCodeSession> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({}),
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Failed to create session: ${error}`)
    }

    return res.json()
  }

  /**
   * Get an existing session by ID.
   */
  async getSession(sessionId: string): Promise<OpenCodeSession> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      headers: this.headers,
    })

    if (!res.ok) {
      throw new Error(`Failed to get session: ${res.status}`)
    }

    return res.json()
  }

  /**
   * Send a message to a session and wait for response.
   */
  async sendMessage(
    sessionId: string,
    message: string,
    options?: {
      model?: { providerID: string; modelID: string }
    }
  ): Promise<OpenCodeMessage> {
    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text: message }],
    }

    if (options?.model) {
      body.model = options.model
    }

    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Failed to send message: ${error}`)
    }

    return res.json()
  }

  /**
   * Set authentication credentials for a provider.
   */
  async setAuth(providerId: string, apiKey: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/${providerId}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ type: 'api', key: apiKey }),
    })

    if (!res.ok) {
      throw new Error(`Failed to set auth: ${res.status}`)
    }
  }

  /**
   * Get current configuration.
   */
  async getConfig(): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/config`, {
      headers: this.headers,
    })

    if (!res.ok) {
      throw new Error(`Failed to get config: ${res.status}`)
    }

    return res.json()
  }
}

/**
 * Create an OpenCode client with default configuration from environment.
 */
export function createOpenCodeClient(config?: Partial<OpenCodeClientConfig>): OpenCodeClient {
  return new OpenCodeClient({
    baseUrl: config?.baseUrl ?? process.env.OPENCODE_URL ?? 'http://localhost:4096',
    password: config?.password ?? process.env.OPENCODE_PASSWORD,
  })
}
