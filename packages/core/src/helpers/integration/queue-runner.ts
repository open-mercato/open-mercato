import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createQueue } from '@open-mercato/queue'

export type QueueDrainRunnerOptions = {
  appRoot: string
  jobLimit: number
  queueBaseDir?: string
}

type BootstrapData = Awaited<ReturnType<typeof bootstrapFromAppRoot>>

const bootstrapCache = new Map<string, Promise<BootstrapData>>()

function getBootstrapData(appRoot: string): Promise<BootstrapData> {
  const resolvedAppRoot = path.resolve(appRoot)
  const cached = bootstrapCache.get(resolvedAppRoot)
  if (cached) return cached
  const promise = bootstrapFromAppRoot(resolvedAppRoot)
  bootstrapCache.set(resolvedAppRoot, promise)
  return promise
}

export async function drainQueueFromAppRoot(
  queueName: string,
  options: QueueDrainRunnerOptions,
): Promise<number> {
  const data = await getBootstrapData(options.appRoot)
  const worker = data.modules
    .flatMap((module) => module.workers ?? [])
    .find((entry) => entry.queue === queueName)
  if (!worker) return 0

  const container = await createRequestContainer()
  const queue = createQueue(queueName, 'local', {
    baseDir: path.resolve(
      options.queueBaseDir?.trim()
      || process.env.QUEUE_BASE_DIR?.trim()
      || path.resolve(options.appRoot, '.mercato/queue'),
    ),
    concurrency: 1,
  })
  const resolve = <T = unknown>(name: string): T => container.resolve(name) as T

  try {
    let processedJobs = 0
    while (true) {
      const result = await queue.process(
        async (job, ctx) => {
          await Promise.resolve(worker.handler(job, { ...ctx, resolve }))
        },
        { limit: options.jobLimit },
      )
      const handled = result.processed + result.failed
      processedJobs += handled
      if (handled === 0) return processedJobs
    }
  } finally {
    await queue.close()
  }
}

export async function runQueueDrainFromEnv(): Promise<void> {
  const queueName = process.env.OM_INTEGRATION_QUEUE_NAME?.trim()
  const appRoot = process.env.OM_INTEGRATION_APP_ROOT?.trim()
  const jobLimit = Number.parseInt(process.env.OM_INTEGRATION_QUEUE_JOB_LIMIT || '100', 10) || 100
  if (!queueName || !appRoot) throw new Error('Missing queue drain environment')

  const processed = await drainQueueFromAppRoot(queueName, {
    appRoot: path.resolve(appRoot),
    jobLimit,
    queueBaseDir: process.env.QUEUE_BASE_DIR,
  })
  console.log(JSON.stringify({ processed }))
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null

if (invokedFile === currentFile) {
  runQueueDrainFromEnv()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
