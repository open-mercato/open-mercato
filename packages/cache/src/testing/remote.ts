import { spawn } from 'node:child_process'
import type { CacheStrategy } from '../types'
import { runWithCacheTenant } from '../tenantContext'

export type ConformanceRemoteOp =
  | { op: 'get'; tenant: string | null; key: string; returnExpired?: boolean }
  | { op: 'set'; tenant: string | null; key: string; value: unknown; tags?: string[]; ttl?: number }
  | { op: 'has'; tenant: string | null; key: string }
  | { op: 'delete'; tenant: string | null; key: string }
  | { op: 'deleteByTags'; tenant: string | null; tags: string[] }
  | { op: 'clear'; tenant: string | null }
  | { op: 'keys'; tenant: string | null; pattern?: string }
  | { op: 'stats'; tenant: string | null }

export type ConformanceRemoteProcess = {
  run(operation: ConformanceRemoteOp): Promise<unknown>
  close(): Promise<void>
}

export type ConformanceRemoteRequest = { id: number; operation: ConformanceRemoteOp }

export type ConformanceRemoteResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

/**
 * Execute one serializable conformance operation against a cache service inside
 * the operation's tenant scope. Child-process runners use this so the parent
 * suite can drive an independent process with the same semantics.
 */
export function executeConformanceRemoteOp(service: CacheStrategy, operation: ConformanceRemoteOp): Promise<unknown> {
  return runWithCacheTenant(operation.tenant, async (): Promise<unknown> => {
    switch (operation.op) {
      case 'get':
        return service.get(operation.key, operation.returnExpired ? { returnExpired: true } : undefined)
      case 'set':
        await service.set(operation.key, operation.value, {
          ...(operation.tags ? { tags: operation.tags } : {}),
          ...(operation.ttl !== undefined ? { ttl: operation.ttl } : {}),
        })
        return null
      case 'has':
        return service.has(operation.key)
      case 'delete':
        return service.delete(operation.key)
      case 'deleteByTags':
        return service.deleteByTags(operation.tags)
      case 'clear':
        return service.clear()
      case 'keys':
        return service.keys(operation.pattern)
      case 'stats':
        return service.stats()
      default:
        throw new Error('[internal] unknown conformance remote operation')
    }
  })
}

/**
 * Serve conformance operations over newline-delimited JSON (one request per
 * line on `input`, one response per line on `output`). Resolves when `input`
 * ends. Used by independent-process runners.
 */
export async function serveConformanceRemoteOps(
  service: CacheStrategy,
  input: AsyncIterable<string | Buffer>,
  write: (line: string) => void,
): Promise<void> {
  let buffer = ''
  const handleLine = async (line: string) => {
    if (!line.trim()) return
    const request = JSON.parse(line) as ConformanceRemoteRequest
    let response: ConformanceRemoteResponse
    try {
      const result = await executeConformanceRemoteOp(service, request.operation)
      response = { id: request.id, ok: true, result: result === undefined ? null : result }
    } catch (error) {
      response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    write(`${JSON.stringify(response)}\n`)
  }
  for await (const chunk of input) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      await handleLine(line)
      newline = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) await handleLine(buffer)
}

export type SpawnConformanceRemoteOptions = {
  command: string
  args: string[]
  env?: Record<string, string | undefined>
  cwd?: string
  readyTimeoutMs?: number
  operationTimeoutMs?: number
}

type PendingRemoteCall = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Spawn a child process that serves `serveConformanceRemoteOps` over stdio and
 * return a `ConformanceRemoteProcess` handle for `createIndependentProcess`.
 * The child must print the line `ready` on stdout once its service is built.
 */
export async function spawnConformanceRemoteProcess(options: SpawnConformanceRemoteOptions): Promise<ConformanceRemoteProcess> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const operationTimeoutMs = options.operationTimeoutMs ?? 30_000
  const pending = new Map<number, PendingRemoteCall>()
  let stderr = ''
  let stdoutBuffer = ''
  let ready = false
  let exited = false
  let nextId = 1
  let settleReady: { resolve(): void; reject(error: Error): void } | null = null
  const readyPromise = new Promise<void>((resolve, reject) => {
    settleReady = { resolve, reject }
  })

  const failAll = (error: Error) => {
    settleReady?.reject(error)
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  const handleLine = (line: string) => {
    if (!line) return
    if (!ready) {
      if (line === 'ready') {
        ready = true
        settleReady?.resolve()
      }
      return
    }
    let response: ConformanceRemoteResponse
    try {
      response = JSON.parse(line) as ConformanceRemoteResponse
    } catch {
      return
    }
    const entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    clearTimeout(entry.timer)
    if (response.ok) entry.resolve(response.result)
    else entry.reject(new Error(`[internal] remote conformance operation failed: ${response.error}`))
  }

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4000)
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    let newline = stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      newline = stdoutBuffer.indexOf('\n')
      handleLine(line)
    }
  })
  child.on('exit', (code) => {
    exited = true
    failAll(new Error(`[internal] conformance remote process exited with code ${code}: ${stderr.trim()}`))
  })
  child.on('error', (error) => {
    exited = true
    failAll(error)
  })

  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      readyPromise,
      new Promise<never>((_, reject) => {
        readyTimer = setTimeout(
          () => reject(new Error(`[internal] conformance remote process not ready within ${readyTimeoutMs}ms: ${stderr.trim()}`)),
          readyTimeoutMs,
        )
      }),
    ])
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  } finally {
    if (readyTimer) clearTimeout(readyTimer)
  }

  let closing: Promise<void> | null = null
  return {
    run(operation) {
      if (exited || closing) return Promise.reject(new Error('[internal] conformance remote process is closed'))
      const id = nextId++
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`[internal] conformance remote operation "${operation.op}" timed out after ${operationTimeoutMs}ms`))
        }, operationTimeoutMs)
        pending.set(id, { resolve, reject, timer })
        const request: ConformanceRemoteRequest = { id, operation }
        child.stdin.write(`${JSON.stringify(request)}\n`)
      })
    },
    close() {
      if (!closing) {
        closing = exited
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
            const killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
            child.once('exit', () => {
              clearTimeout(killTimer)
              resolve()
            })
            child.stdin.end()
          })
      }
      return closing
    },
  }
}
