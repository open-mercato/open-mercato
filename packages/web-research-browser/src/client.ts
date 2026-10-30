import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SidecarError, decodeLine, encodeLine, isReply, type SidecarReply } from './protocol'

export type SidecarStream = {
  stdin: { write(chunk: string): unknown; on?(event: 'error', handler: (error: NodeJS.ErrnoException) => void): unknown }
  stdout: { setEncoding?(encoding: string): unknown; on(event: 'data', handler: (chunk: string) => void): unknown }
  stderr: { setEncoding?(encoding: string): unknown; on(event: 'data', handler: (chunk: string) => void): unknown }
  once(event: 'exit', handler: (code: number | null) => void): unknown
  kill(signal?: NodeJS.Signals): unknown
}

export type SpawnFn = (scriptPath: string) => SidecarStream

export type SidecarOptions = {
  readonly sidecarPath?: string
  readonly spawnFn?: SpawnFn
  readonly callTimeoutMs?: number
  readonly closeTimeoutMs?: number
  readonly maxPending?: number
}

const DEFAULT_CALL_TIMEOUT_MS = 150_000
/**
 * Deliberately short and separate from the call timeout: shutdown must not block
 * for minutes on a wedged child before SIGTERM is even attempted.
 */
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000
const DEFAULT_MAX_PENDING = 128
const SIGKILL_GRACE_MS = 2_000
/** A full-page screenshot or a large DOM fits comfortably; a runaway does not. */
const MAX_STDOUT_BUFFER = 64 * 1024 * 1024
const STDERR_RING = 24

function defaultSidecarPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'sidecar.js')
}

function defaultSpawn(scriptPath: string): SidecarStream {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return child as unknown as SidecarStream
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class Sidecar {
  private child: SidecarStream | null = null
  private startError: Error | null = null
  private buffer = ''
  private recentStderr: string[] = []
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly sidecarPath: string,
    private readonly spawnFn: SpawnFn,
    private readonly callTimeoutMs: number,
    private readonly closeTimeoutMs: number,
    private readonly maxPending: number,
  ) {}

  private ensure(): void {
    if (this.child) return
    if (this.startError) throw this.startError
    try {
      this.child = this.spawnFn(this.sidecarPath)
    } catch (error) {
      this.startError = error instanceof Error ? error : new Error(String(error))
      throw this.startError
    }
    // Reset per-process state on every spawn. A child that died mid-line would
    // otherwise leave a JSON fragment that corrupts the next spawn's first
    // reply — which then parses as garbage and hangs that call until timeout.
    this.buffer = ''
    this.recentStderr = []

    this.child.stdout.setEncoding?.('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline = this.buffer.indexOf('\n')
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim()) this.handleLine(line)
        newline = this.buffer.indexOf('\n')
      }
      if (this.buffer.length > MAX_STDOUT_BUFFER) {
        this.recentStderr.push(`dropped ${this.buffer.length} bytes of un-delimited sidecar output`)
        this.buffer = ''
      }
    })

    // A dead child leaves its stdin pipe broken, and Node reports that as an
    // asynchronous 'error' event (EPIPE) rather than as a throw from write() —
    // so the try/catch around the write in `call` never sees it. Unhandled, a
    // stream 'error' escalates past the adapter and the call throws instead of
    // resolving to an outcome. Recording it keeps the event handled; the 'exit'
    // handler below is what rejects the calls still in flight.
    this.child.stdin.on?.('error', (error: NodeJS.ErrnoException) => {
      this.recentStderr.push(`sidecar stdin ${error.code ?? 'error'}: ${error.message}`)
      if (this.recentStderr.length > STDERR_RING) this.recentStderr.shift()
    })

    this.child.stderr.setEncoding?.('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue
        this.recentStderr.push(line)
        if (this.recentStderr.length > STDERR_RING) this.recentStderr.shift()
      }
    })

    this.child.once('exit', (code) => {
      const tail = this.recentStderr.slice(-8).join('\n').trim()
      const error = new SidecarError(
        `browser sidecar exited unexpectedly (code=${code ?? 'null'})${tail ? `:\n${tail}` : ''}`,
        'init',
      )
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer)
        entry.reject(error)
      }
      this.pending.clear()
      this.child = null
    })
  }

  private handleLine(line: string): void {
    const parsed = decodeLine(line)
    if (!isReply(parsed)) return
    const entry = this.pending.get(parsed.id)
    if (!entry) return
    this.pending.delete(parsed.id)
    clearTimeout(entry.timer)
    if (parsed.ok) {
      entry.resolve(parsed.result)
      return
    }
    entry.reject(new SidecarError(parsed.error.message, parsed.error.kind))
  }

  async call(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    this.ensure()
    const child = this.child
    if (!child) throw new SidecarError('browser sidecar is not running', 'init')
    if (this.pending.size >= this.maxPending) {
      throw new SidecarError(`browser sidecar busy (${this.pending.size} in flight)`, 'runtime')
    }

    const id = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        reject(new SidecarError(`browser sidecar call "${method}" timed out`, 'timeout'))
      }, this.callTimeoutMs)
      timer.unref?.()

      // Abort rejects THIS call only. The sidecar is shared, so killing it would
      // take healthy concurrent leases down with it; a late reply is ignored
      // because its id is no longer pending.
      const onAbort = (): void => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        reject(new SidecarError(`browser sidecar call "${method}" was aborted`, 'timeout'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
        timer,
      })

      try {
        child.stdin.write(encodeLine({ id, method, params }))
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async close(): Promise<void> {
    const child = this.child
    if (!child) return
    try {
      const closeSignal = AbortSignal.timeout(this.closeTimeoutMs)
      await this.call('close', {}, closeSignal)
    } catch {
      // Wedged or already gone; escalate below.
    }
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      child.once('exit', done)
      // Armed before the kill so a synchronous exit still finds the timer set.
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone.
        }
        done()
      }, SIGKILL_GRACE_MS)
      timer.unref?.()
      try {
        child.kill('SIGTERM')
      } catch {
        done()
      }
    })
    this.child = null
  }
}

export function createSidecar(options: SidecarOptions = {}): Sidecar {
  return new Sidecar(
    options.sidecarPath ?? defaultSidecarPath(),
    options.spawnFn ?? defaultSpawn,
    options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
    options.maxPending ?? DEFAULT_MAX_PENDING,
  )
}
