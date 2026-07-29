/**
 * Playwright sidecar entry point.
 *
 * Runs as a child process so Playwright never enters the app or MCP bundle and a
 * crashed browser cannot take the server down. Speaks line-delimited JSON on
 * stdio; every request is serialized per lease so a `goto` cannot race a
 * `release` on the same context.
 */

import { createState, dispatch, teardown, type SidecarState } from './dispatch'
import { decodeLine, encodeLine, type SidecarReply, type SidecarRequest } from './protocol'

const state: SidecarState = createState()

function write(reply: SidecarReply): void {
  try {
    process.stdout.write(encodeLine(reply))
  } catch {
    // stdout is gone; the parent will time the call out and reap us.
  }
}

/** Per-lease chains: work on different contexts proceeds concurrently. */
const chains = new Map<string, Promise<void>>()

function chainKey(request: SidecarRequest): string {
  const leaseId = request.params?.leaseId
  return typeof leaseId === 'string' ? leaseId : '__global__'
}

export function enqueue(line: string): void {
  const parsed = decodeLine(line)
  if (typeof parsed !== 'object' || parsed === null) return
  const request = parsed as SidecarRequest
  if (typeof request.id !== 'string' || typeof request.method !== 'string') return

  const key = chainKey(request)
  const previous = chains.get(key) ?? Promise.resolve()
  const next: Promise<void> = previous
    .then(async () => {
      write(await dispatch(state, request))
    })
    .catch((error: unknown) => {
      write({
        id: request.id,
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error), kind: 'unknown' },
      })
    })
    .finally(() => {
      // Every render takes a fresh lease id, so without this the map grows one
      // settled promise per request for the life of the process. Only the tail is
      // dropped; a later request on the same lease owns the entry by then.
      if (chains.get(key) === next) chains.delete(key)
    })
  chains.set(key, next)
}

async function shutdownAndExit(code: number): Promise<void> {
  try {
    await teardown(state)
  } catch {
    // Exiting regardless.
  }
  process.exit(code)
}

/**
 * A SIGKILL'd parent produces no stdin EOF, so without this poll a Chromium can
 * outlive the server that spawned it and leak memory until the box is restarted.
 */
function startParentWatchdog(): void {
  const parentPid = process.ppid
  if (!parentPid || parentPid <= 1) return
  const interval = setInterval(() => {
    try {
      process.kill(parentPid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        clearInterval(interval)
        void shutdownAndExit(0)
      }
      // EPERM means it exists but we may not signal it — still alive.
    }
  }, 2000)
  interval.unref?.()
}

export function main(): void {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim()) enqueue(line)
      newline = buffer.indexOf('\n')
    }
  })
  process.stdin.on('end', () => void shutdownAndExit(0))
  process.stdout.on('error', () => void shutdownAndExit(0))
  startParentWatchdog()
}

// Guarded so tests can import the module without starting the stdio loop.
if (process.env.OM_WEB_RESEARCH_SIDECAR_TEST !== '1') main()
