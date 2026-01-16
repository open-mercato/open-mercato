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

export type OpenCodeQuestionOption = {
  label: string
  description: string
}

export type OpenCodeQuestion = {
  id: string
  sessionID: string
  questions: Array<{
    question: string
    header: string
    options: OpenCodeQuestionOption[]
  }>
  tool: {
    messageID: string
    callID: string
  }
}

/**
 * SSE Event from OpenCode event stream.
 */
export type OpenCodeSSEEvent = {
  type: string
  properties: Record<string, unknown>
}

/**
 * Callback for SSE events.
 */
export type OpenCodeSSECallback = (event: OpenCodeSSEEvent) => void

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
   * Subscribe to SSE event stream for real-time updates.
   * Returns an abort function to stop the stream.
   */
  subscribeToEvents(
    onEvent: OpenCodeSSECallback,
    onError?: (error: Error) => void
  ): () => void {
    const controller = new AbortController()

    const connect = async () => {
      try {
        const res = await fetch(`${this.baseUrl}/event`, {
          headers: {
            ...this.headers,
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          throw new Error(`SSE connection failed: ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Process complete SSE messages
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                onEvent(data)
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          onError?.(error as Error)
        }
      }
    }

    connect()

    return () => controller.abort()
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

  /**
   * Get pending questions that need user response.
   */
  async getPendingQuestions(): Promise<OpenCodeQuestion[]> {
    const res = await fetch(`${this.baseUrl}/question`, {
      headers: this.headers,
    })

    if (!res.ok) {
      throw new Error(`Failed to get questions: ${res.status}`)
    }

    return res.json()
  }

  /**
   * Answer a pending question.
   * OpenCode expects: POST /question/{requestID}/reply with { answers: [["label"]] }
   * Each answer is an array of selected option labels (for multi-select support).
   */
  async answerQuestion(questionId: string, answerIndex: number): Promise<void> {
    // First get the question to find the selected option label
    const questions = await this.getPendingQuestions()
    const question = questions.find((q) => q.id === questionId)

    if (!question) {
      throw new Error(`Question ${questionId} not found`)
    }

    // Build answers array - each question's answer is an array of selected labels
    const answers: string[][] = []
    for (const q of question.questions) {
      const selectedOption = q.options[answerIndex]
      if (selectedOption) {
        // Each answer is an array of selected labels (supports multi-select)
        answers.push([selectedOption.label])
      }
    }

    const body = { answers }

    console.log('[OpenCode Client] Answering question', questionId, 'with body:', JSON.stringify(body))

    const res = await fetch(`${this.baseUrl}/question/${questionId}/reply`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })

    const responseText = await res.text()
    console.log('[OpenCode Client] Answer response:', res.status, responseText.substring(0, 200))

    if (!res.ok) {
      throw new Error(`Failed to answer question: ${res.status} - ${responseText}`)
    }
  }

  /**
   * Reject a pending question.
   */
  async rejectQuestion(questionId: string): Promise<void> {
    console.log('[OpenCode Client] Rejecting question', questionId)

    const res = await fetch(`${this.baseUrl}/question/${questionId}/reject`, {
      method: 'POST',
      headers: this.headers,
    })

    if (!res.ok) {
      const responseText = await res.text()
      throw new Error(`Failed to reject question: ${res.status} - ${responseText}`)
    }
  }

  /**
   * Get session status (idle, busy, waiting for question).
   * Falls back to inferring status from pending questions if endpoint doesn't exist.
   */
  async getSessionStatus(sessionId: string): Promise<{ status: string; questionId?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/status`, {
        headers: this.headers,
      })

      if (res.ok) {
        const contentType = res.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          return res.json()
        }
      }
    } catch {
      // Endpoint doesn't exist or network error - fall through to inference
    }

    // Fall back to inferring status from pending questions
    // Note: We can't tell if OpenCode is busy without the status endpoint
    // Return 'unknown' to let SSE events determine actual state
    const questions = await this.getPendingQuestions()
    const sessionQuestion = questions.find((q) => q.sessionID === sessionId)
    if (sessionQuestion) {
      return { status: 'waiting', questionId: sessionQuestion.id }
    }
    // Don't assume idle - we can't know without SSE events
    return { status: 'unknown' }
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
