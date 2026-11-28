import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export type RecordedLlmRequest = {
  path: string
  raw: string
  body: Record<string, unknown>
}

export type FakeLlmServerOptions = {
  text?: string
  object?: (request: RecordedLlmRequest) => unknown
}

export type FakeLlmServer = {
  baseUrl: string
  requests: RecordedLlmRequest[]
  reset: () => void
  close: () => Promise<void>
}

const FAKE_PROVIDER_ID = 'litellm'
const FAKE_MODEL_ID = 'om-fake-model'
const FAKE_API_KEY = 'om-fake-llm-key'
const PROVIDER_ENV_PATTERN = /^(OM_AI_|OPENCODE_)|_AI_(MODEL|PROVIDER|BASE_URL)$|^(OPENAI|ANTHROPIC|GOOGLE_GENERATIVE_AI|GOOGLE|GEMINI|AZURE_OPENAI|AZURE|DEEPINFRA|GROQ|TOGETHER|FIREWORKS|LITELLM|OLLAMA|OPENROUTER|REQUESTY|LM_STUDIO)_/

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function parseBody(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function streamChatCompletion(response: ServerResponse, content: string): void {
  const base = { id: 'chatcmpl-om-fake', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: FAKE_MODEL_ID }
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ]
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

function completeChat(response: ServerResponse, content: string): void {
  sendJson(response, 200, {
    id: 'chatcmpl-om-fake',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: FAKE_MODEL_ID,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

/**
 * Local OpenAI-compatible Chat Completions endpoint for in-process runtime specs.
 * Records every request body; streamed calls get `options.text`, non-streamed
 * calls get `options.object` serialized as the message content (or `options.text`).
 */
export async function startFakeLlmServer(options: FakeLlmServerOptions = {}): Promise<FakeLlmServer> {
  const requests: RecordedLlmRequest[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const raw = await readBody(request)
      const path = (request.url ?? '').split('?')[0]
      const recorded: RecordedLlmRequest = { path, raw, body: parseBody(raw) }
      requests.push(recorded)
      if (request.method === 'POST' && path.endsWith('/moderations')) {
        sendJson(response, 200, { id: 'modr-om-fake', model: 'omni-moderation-latest', results: [{ flagged: false, categories: {}, category_scores: {} }] })
        return
      }
      if (request.method !== 'POST' || !path.endsWith('/chat/completions')) {
        sendJson(response, 404, { error: { message: `[internal] fake LLM server does not serve ${request.method} ${path}` } })
        return
      }
      const text = options.text ?? 'ok'
      if (recorded.body.stream === true) streamChatCompletion(response, text)
      else completeChat(response, options.object ? JSON.stringify(options.object(recorded)) : text)
    })().catch((error: unknown) => {
      sendJson(response, 500, { error: { message: error instanceof Error ? error.message : '[internal] fake LLM server failure' } })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    reset: () => { requests.length = 0 },
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

/**
 * Points every model resolution of the in-process runtime at the fake server for
 * the duration of `run`: other provider keys and AI env overrides are removed, the
 * provider allowlist admits only the fake provider, and the environment is restored afterwards.
 */
export async function withFakeLlmEnvironment<T>(server: FakeLlmServer, run: () => Promise<T>): Promise<T> {
  const saved = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (PROVIDER_ENV_PATTERN.test(key)) delete process.env[key]
  }
  Object.assign(process.env, {
    OM_AI_PROVIDER: FAKE_PROVIDER_ID,
    OM_AI_MODEL: FAKE_MODEL_ID,
    OM_AI_AVAILABLE_PROVIDERS: FAKE_PROVIDER_ID,
    OM_AI_INPUT_MODERATION: 'false',
    LITELLM_API_KEY: FAKE_API_KEY,
    LITELLM_BASE_URL: server.baseUrl,
  })
  try {
    return await run()
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key]
    }
    Object.assign(process.env, saved)
  }
}

async function countFakeLlmUsageInDb(): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from ai_token_usage_events where model_id = $1', [FAKE_MODEL_ID],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

/**
 * Removes the token-usage rows the in-process runtime recorded for the fake model.
 * Usage is written without awaiting the turn, so the count is polled until it stops
 * changing before the rows are deleted.
 */
export async function deleteFakeLlmUsageInDb(): Promise<void> {
  let previous = -1
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await countFakeLlmUsageInDb()
    if (current === previous) break
    previous = current
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await withClient(async (client) => {
    await client.query('delete from ai_token_usage_events where model_id = $1', [FAKE_MODEL_ID])
    await client.query('delete from ai_token_usage_daily where model_id = $1', [FAKE_MODEL_ID])
  })
}
