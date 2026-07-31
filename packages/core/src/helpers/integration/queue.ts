import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { drainQueueFromAppRoot } from './queue-runner'

type DrainQueueOptions = {
  appRoot?: string
  jobLimit?: number
}

const DEFAULT_JOB_LIMIT = 100

function resolveAppRoot(input?: string): string {
  return path.resolve(input?.trim() || process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
}

async function drainQueueInCurrentProcess(queueName: string, options: Required<DrainQueueOptions>): Promise<number> {
  return drainQueueFromAppRoot(queueName, options)
}

function resolveAppRunnerPath(appRoot: string): string {
  const requireFromApp = createRequire(path.join(appRoot, 'package.json'))
  return requireFromApp.resolve('@open-mercato/core/helpers/integration/queue-runner')
}

function drainQueueInAppProcess(queueName: string, options: Required<DrainQueueOptions>): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolveAppRunnerPath(options.appRoot)], {
      cwd: options.appRoot,
      env: {
        ...process.env,
        OM_INTEGRATION_APP_ROOT: options.appRoot,
        OM_INTEGRATION_QUEUE_NAME: queueName,
        OM_INTEGRATION_QUEUE_JOB_LIMIT: String(options.jobLimit),
        QUEUE_BASE_DIR: process.env.QUEUE_BASE_DIR?.trim() || path.resolve(options.appRoot, '.mercato/queue'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      // The child's diagnostics (pino job logs on stdout, cache-fallback
      // console.warn on stderr) are otherwise discarded on exit 0, which makes
      // silently-failing jobs and silent memory-cache fallbacks in the drain
      // child undebuggable from CI logs. OM_DRAIN_DEBUG=1 forwards everything;
      // a non-empty stderr is forwarded unconditionally because it only carries
      // warning/error-class output.
      if (process.env.OM_DRAIN_DEBUG === '1') {
        process.stderr.write(`[drain-child ${queueName} exit=${code}] STDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`)
      } else if (stderr.trim().length > 0) {
        process.stderr.write(`[drain-child ${queueName} exit=${code}] STDERR:\n${stderr}\n`)
      }
      if (code !== 0) {
        reject(new Error(`Queue drain failed for "${queueName}" in ${options.appRoot} (exit ${code}).\n${stderr || stdout}`))
        return
      }
      const lastLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{')) ?? '{}'
      try {
        const parsed = JSON.parse(lastLine) as { processed?: unknown }
        resolve(Number(parsed.processed ?? 0))
      } catch {
        resolve(0)
      }
    })
  })
}

export async function drainIntegrationQueue(queueName: string, options: DrainQueueOptions = {}): Promise<number> {
  const resolved = {
    appRoot: resolveAppRoot(options.appRoot),
    jobLimit: options.jobLimit ?? DEFAULT_JOB_LIMIT,
  }
  if (process.env.OM_TEST_APP_ROOT?.trim()) {
    return drainQueueInAppProcess(queueName, resolved)
  }
  return drainQueueInCurrentProcess(queueName, resolved)
}
