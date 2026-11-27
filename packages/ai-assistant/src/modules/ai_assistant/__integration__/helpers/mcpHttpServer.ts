import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Runs the HTTP MCP server (`mercato ai_assistant mcp:serve-http`) as its own
 * process against the app's database, the way it runs in production next to
 * the app. The child inherits the spec's environment, as the queue-drain
 * runners do, so it reads the same `DATABASE_URL` and tenant encryption key as
 * the app under test and can decrypt the session secrets the app issued.
 */

const READY_TIMEOUT_MS = 180_000
const STOP_TIMEOUT_MS = 10_000
const OUTPUT_LIMIT = 8_000

export type McpToolCallOutcome = {
  isError: boolean
  payload: unknown
}

export type McpHttpServerHandle = {
  url: string
  callTool: (serverApiKey: string, name: string, args: Record<string, unknown>) => Promise<McpToolCallOutcome>
  stop: () => Promise<void>
}

type JsonRpcToolResult = {
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
  error?: { code?: number; message?: string }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close()
        reject(new Error('[internal] Could not allocate a port for the MCP HTTP server'))
        return
      }
      probe.close(() => resolve(address.port))
    })
  })
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || hasExited(child)) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try { child.kill(signal) } catch { return }
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return true
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function parseToolText(text: string | undefined): unknown {
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function startMcpHttpServer(delegationKey: string): Promise<McpHttpServerHandle> {
  const port = await findFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn('yarn', ['mercato', 'ai_assistant', 'mcp:serve-http', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: resolveAppRoot(),
    env: { ...process.env, MCP_SERVER_API_KEY: delegationKey, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-OUTPUT_LIMIT)
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)

  const killOnWorkerExit = () => signalGroup(child, 'SIGKILL')
  process.once('exit', killOnWorkerExit)

  const stop = async () => {
    process.removeListener('exit', killOnWorkerExit)
    signalGroup(child, 'SIGTERM')
    if (!(await waitForExit(child, STOP_TIMEOUT_MS))) {
      signalGroup(child, 'SIGKILL')
      await waitForExit(child, STOP_TIMEOUT_MS)
    }
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  let ready = false
  while (!ready && Date.now() < deadline) {
    if (hasExited(child)) break
    try {
      const health = await fetch(`${baseUrl}/health`)
      ready = health.ok
    } catch {
      ready = false
    }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!ready) {
    await stop()
    throw new Error(`[internal] The MCP HTTP server did not become ready on port ${port}.\n${output}`)
  }

  let requestId = 0
  const callTool: McpHttpServerHandle['callTool'] = async (serverApiKey, name, args) => {
    requestId += 1
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-api-key': serverApiKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } }),
    })
    const raw = await response.text()
    if (response.status !== 200) {
      throw new Error(`[internal] MCP tools/call ${name} answered ${response.status}: ${raw}`)
    }
    const body = JSON.parse(raw) as JsonRpcToolResult
    if (body.error || !body.result) {
      throw new Error(`[internal] MCP tools/call ${name} returned a JSON-RPC error: ${raw}`)
    }
    const text = body.result.content?.find((part) => part.type === 'text')?.text
    return { isError: body.result.isError === true, payload: parseToolText(text) }
  }

  return { url: `${baseUrl}/mcp`, callTool, stop }
}

/** Issues a chat session token (`sess_…`) for the user behind `token`, as the chat does. */
export async function issueSessionToken(request: APIRequestContext, token: string): Promise<string> {
  const issued = await apiRequest(request, 'POST', '/api/ai_assistant/session-key', { token, data: {} })
  expect(issued.status()).toBe(200)
  const body = await readJsonSafe<{ sessionToken?: string }>(issued)
  expect(body?.sessionToken).toMatch(/^sess_[a-f0-9]{32}$/)
  return body!.sessionToken!
}

export async function deleteSessionKeysInDb(userIds: string[], tenantId: string): Promise<void> {
  if (userIds.length === 0) return
  await withClient((client) => client.query(
    'delete from api_keys where session_user_id = any($1::uuid[]) and tenant_id = $2', [userIds, tenantId],
  ))
}
