import { spawn } from 'node:child_process'
import path from 'node:path'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createQueue } from '@open-mercato/queue'

type DrainQueueOptions = {
  appRoot?: string
  batchLimit?: number
}

const DEFAULT_BATCH_LIMIT = 100

function resolveAppRoot(input?: string): string {
  return path.resolve(input?.trim() || process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
}

async function drainQueueInCurrentProcess(queueName: string, options: Required<DrainQueueOptions>): Promise<number> {
  const data = await bootstrapFromAppRoot(options.appRoot)
  const worker = data.modules
    .flatMap((module) => module.workers ?? [])
    .find((entry) => entry.queue === queueName)
  if (!worker) return 0

  const container = await createRequestContainer()
  const queue = createQueue(queueName, 'local', {
    baseDir: path.resolve(options.appRoot, '.mercato/queue'),
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
        { limit: options.batchLimit },
      )
      const handled = result.processed + result.failed
      processedJobs += handled
      if (handled === 0) return processedJobs
    }
  } finally {
    await queue.close()
  }
}

function drainQueueInAppProcess(queueName: string, options: Required<DrainQueueOptions>): Promise<number> {
  const script = `
    import path from 'node:path';
    import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader';
    import { createRequestContainer } from '@open-mercato/shared/lib/di/container';
    import { createQueue } from '@open-mercato/queue';

    const queueName = process.env.OM_INTEGRATION_QUEUE_NAME;
    const appRoot = process.env.OM_INTEGRATION_APP_ROOT;
    const batchLimit = Number.parseInt(process.env.OM_INTEGRATION_QUEUE_BATCH_LIMIT || '100', 10) || 100;
    if (!queueName || !appRoot) throw new Error('Missing queue drain environment');

    const data = await bootstrapFromAppRoot(appRoot);
    const worker = data.modules.flatMap((module) => module.workers || []).find((entry) => entry.queue === queueName);
    if (!worker) {
      console.log(JSON.stringify({ processed: 0 }));
      process.exit(0);
    }

    const container = await createRequestContainer();
    const queue = createQueue(queueName, 'local', {
      baseDir: path.resolve(appRoot, '.mercato/queue'),
      concurrency: 1,
    });
    const resolve = (name) => container.resolve(name);
    let processedJobs = 0;
    try {
      while (true) {
        const result = await queue.process(
          async (job, ctx) => {
            await Promise.resolve(worker.handler(job, { ...ctx, resolve }));
          },
          { limit: batchLimit },
        );
        const handled = result.processed + result.failed;
        processedJobs += handled;
        if (handled === 0) break;
      }
    } finally {
      await queue.close();
    }
    console.log(JSON.stringify({ processed: processedJobs }));
  `

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: options.appRoot,
      env: {
        ...process.env,
        OM_INTEGRATION_APP_ROOT: options.appRoot,
        OM_INTEGRATION_QUEUE_NAME: queueName,
        OM_INTEGRATION_QUEUE_BATCH_LIMIT: String(options.batchLimit),
        QUEUE_BASE_DIR: path.resolve(options.appRoot, '.mercato/queue'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
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
    batchLimit: options.batchLimit ?? DEFAULT_BATCH_LIMIT,
  }
  if (process.env.OM_TEST_APP_ROOT?.trim()) {
    return drainQueueInAppProcess(queueName, resolved)
  }
  return drainQueueInCurrentProcess(queueName, resolved)
}
