import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  businessAgentRuntimeCliPath,
  businessAgentRuntimeHostConfigPath,
} from '@open-mercato/business-harness/bin-path'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type {
  BusinessHarnessExecutionBundle,
  BusinessHarnessRunResult,
} from './businessHarnessContracts'
import { BusinessHarnessClientError } from './businessHarnessTransportError'
import { readBusinessHarnessNdjson } from './businessHarnessNdjson'
import type { BusinessHarnessRunOptions, BusinessHarnessTransport } from './businessHarnessTransport'

const logger = createLogger('agent_orchestrator').child({ component: 'business-harness-process' })
const DEFAULT_MAX_RESPONSE_BYTES = 10_000_000
const DEFAULT_TERMINATE_GRACE_MS = 2_000
const MAX_STDERR_BYTES = 64_000
const DEFAULT_MAX_CONCURRENT_PROCESSES = 4

/**
 * Process-wide cap on live one-off harness subprocesses. Each one is a fresh Node
 * process that loads the AI SDK and MCP client, so an unbounded count is a memory
 * cliff: `delegate_agent` fan-out runs NESTED, and nested runs deliberately bypass
 * the `acquireAgentRunSlot` admission gate to avoid livelocking the parent. This
 * semaphore is that cohort's only bound (it replaces the OM_OPENCODE_POOL_SIZE
 * lease the shared OpenCode container used to provide).
 *
 * Waiters are FIFO and abortable, so a queued run still honors its own deadline.
 * Standalone HTTP deployments do not use this path; the served harness bounds itself.
 */
const processSemaphore = {
  active: 0,
  waiting: [] as Array<{ admit: () => void }>,
}

function resolveMaxConcurrentProcesses(): number {
  const parsed = Number.parseInt(process.env.OM_BUSINESS_HARNESS_MAX_CONCURRENT_PROCESSES ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_PROCESSES
}

function acquireProcessSlot(signal: AbortSignal | undefined): Promise<() => void> {
  const release = () => {
    processSemaphore.active -= 1
    const next = processSemaphore.waiting.shift()
    if (next) {
      processSemaphore.active += 1
      next.admit()
    }
  }
  if (processSemaphore.active < resolveMaxConcurrentProcesses()) {
    processSemaphore.active += 1
    return Promise.resolve(releaseOnce(release))
  }
  return new Promise<() => void>((resolveSlot, rejectSlot) => {
    const waiter = {
      admit: () => {
        signal?.removeEventListener('abort', onAbort)
        resolveSlot(releaseOnce(release))
      },
    }
    function onAbort() {
      const index = processSemaphore.waiting.indexOf(waiter)
      if (index >= 0) processSemaphore.waiting.splice(index, 1)
      rejectSlot(
        new BusinessHarnessClientError('HARNESS_ABORTED', 'Business harness run was aborted', {
          cause: signal?.reason,
        }),
      )
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    processSemaphore.waiting.push(waiter)
  })
}

function releaseOnce(fn: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    fn()
  }
}

type SpawnImplementation = typeof spawn

export type BusinessHarnessProcessClientOptions = {
  cliPath?: string
  configFile?: string
  credentialBrokerUrl?: string
  spawnImplementation?: SpawnImplementation
  maxResponseBytes?: number
  terminateGraceMs?: number
}

export class BusinessHarnessProcessClient implements BusinessHarnessTransport {
  private readonly cliPath: string
  private readonly configFile: string
  private readonly credentialBrokerUrl: string
  private readonly spawnImplementation: SpawnImplementation
  private readonly maxResponseBytes: number
  private readonly terminateGraceMs: number

  constructor(options: BusinessHarnessProcessClientOptions = {}) {
    this.cliPath = options.cliPath ?? resolveHarnessCliPath()
    this.configFile = options.configFile ?? resolveHarnessConfigFile()
    this.credentialBrokerUrl = options.credentialBrokerUrl ?? resolveCredentialBrokerUrl()
    this.spawnImplementation = options.spawnImplementation ?? spawn
    this.maxResponseBytes = options.maxResponseBytes ?? resolveMaxResponseBytes()
    this.terminateGraceMs = options.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS
  }

  async run(
    bundle: BusinessHarnessExecutionBundle,
    options: BusinessHarnessRunOptions = {},
  ): Promise<BusinessHarnessRunResult> {
    if (options.signal?.aborted) {
      throw new BusinessHarnessClientError('HARNESS_ABORTED', 'Business harness run was aborted', {
        cause: options.signal.reason,
      })
    }

    const releaseProcessSlot = await acquireProcessSlot(options.signal)

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnImplementation(process.execPath, [this.cliPath, 'run', '--stdio'], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildRuntimeEnvironment(this.configFile, this.credentialBrokerUrl),
      })
    } catch (error) {
      releaseProcessSlot()
      throw new BusinessHarnessClientError(
        'HARNESS_UNAVAILABLE',
        'Could not start the business harness process',
        { cause: error },
      )
    }

    const exit = waitForExit(child)
    const stderr = drainStderr(child)
    let killTimer: NodeJS.Timeout | undefined
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGTERM')
      killTimer ??= setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, this.terminateGraceMs)
      killTimer.unref()
    }
    const abort = () => terminate()
    options.signal?.addEventListener('abort', abort, { once: true })

    try {
      const write = new Promise<void>((resolveWrite, rejectWrite) => {
        child.stdin.once('error', rejectWrite)
        child.stdin.end(JSON.stringify(bundle), resolveWrite)
      })
      const resultPromise = readBusinessHarnessNdjson(child.stdout, {
        maxBytes: this.maxResponseBytes,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      })
      await write
      const result = await resultPromise
      const status = await exit
      await stderr
      if (options.signal?.aborted) {
        throw new BusinessHarnessClientError('HARNESS_ABORTED', 'Business harness run was aborted', {
          cause: options.signal.reason,
        })
      }
      if (status.code !== 0) {
        throw new BusinessHarnessClientError(
          'HARNESS_PROCESS_EXITED',
          `Business harness process exited with code ${String(status.code)}`,
        )
      }
      return result
    } catch (error) {
      terminate()
      await exit.catch(() => undefined)
      const diagnostic = await stderr.catch(() => '')
      if (diagnostic) {
        logger.warn('business harness subprocess wrote diagnostics', {
          runId: bundle.runId,
          bytes: Buffer.byteLength(diagnostic),
        })
      }
      if (options.signal?.aborted) {
        throw new BusinessHarnessClientError('HARNESS_ABORTED', 'Business harness run was aborted', {
          cause: options.signal.reason,
        })
      }
      if (error instanceof BusinessHarnessClientError) throw error
      throw new BusinessHarnessClientError('HARNESS_UNAVAILABLE', 'Business harness process failed', {
        cause: error,
      })
    } finally {
      options.signal?.removeEventListener('abort', abort)
      if (killTimer) clearTimeout(killTimer)
      releaseProcessSlot()
    }
  }
}

function buildRuntimeEnvironment(configFile: string, credentialBrokerUrl: string): NodeJS.ProcessEnv {
  const inherited = ['PATH', 'NODE_EXTRA_CA_CERTS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  }
  for (const key of inherited) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  env.HARNESS_CREDENTIAL_MODE = 'broker'
  env.HARNESS_CREDENTIAL_BROKER_URL = credentialBrokerUrl
  env.HARNESS_CONFIG_FILE = configFile
  return env
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('close', (code, signal) => resolveExit({ code, signal }))
  })
}

async function drainStderr(child: ChildProcessWithoutNullStreams): Promise<string> {
  let value = ''
  for await (const chunk of child.stderr) {
    if (Buffer.byteLength(value) >= MAX_STDERR_BYTES) continue
    value += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (Buffer.byteLength(value) > MAX_STDERR_BYTES) {
      value = Buffer.from(value).subarray(0, MAX_STDERR_BYTES).toString('utf8')
    }
  }
  return value
}

function resolveHarnessCliPath(): string {
  return process.env.OM_BUSINESS_HARNESS_CLI_PATH?.trim() || businessAgentRuntimeCliPath
}

function resolveHarnessConfigFile(): string {
  return (
    process.env.OM_BUSINESS_HARNESS_CONFIG_FILE?.trim() ||
    businessAgentRuntimeHostConfigPath
  )
}

function resolveCredentialBrokerUrl(): string {
  const configured = process.env.OM_BUSINESS_HARNESS_CREDENTIAL_BROKER_URL?.trim()
  if (configured) return configured
  const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000
  return `http://127.0.0.1:${port}/api/agent_orchestrator/internal/credentials/exchange`
}

function resolveMaxResponseBytes(): number {
  const parsed = Number.parseInt(process.env.OM_BUSINESS_HARNESS_RESPONSE_MAX_BYTES ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESPONSE_BYTES
}
