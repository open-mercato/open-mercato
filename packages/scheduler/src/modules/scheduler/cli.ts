import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from './data/entities.js'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const writeLine = (text = '') => {
  process.stdout.write(`${text}\n`)
}

const writeErrorLine = (text: string) => {
  process.stderr.write(`${text}\n`)
}

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '')
    const value = rest[i + 1]
    if (key) args[key] = value ?? ''
  }
  return args
}

const listCommand: ModuleCli = {
  command: 'list',
  async run(rest) {
    const args = parseArgs(rest)
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager

    const where: Record<string, unknown> = { deletedAt: null }

    // Filter by tenant if provided
    if (args.tenant || args.tenantId) {
      where.tenantId = args.tenant || args.tenantId
    }

    // Filter by scope type if provided
    if (args.scope || args.scopeType) {
      where.scopeType = args.scope || args.scopeType
    }

    // Filter by enabled status if provided
    if (args.enabled) {
      const parsed = parseBooleanToken(args.enabled)
      if (parsed !== null) {
        where.isEnabled = parsed
      }
    }

    const jobs = await em.find(ScheduledJob, where, {
      orderBy: { isEnabled: 'DESC', name: 'ASC' },
    })

    if (jobs.length === 0) {
      writeLine('No scheduled jobs found.')
      return
    }

    writeLine(`\nFound ${jobs.length} scheduled job(s):\n`)
    writeLine('ID'.padEnd(38) + 'Name'.padEnd(35) + 'Type'.padEnd(12) + 'Schedule'.padEnd(20) + 'Status'.padEnd(10) + 'Next Run')
    writeLine('-'.repeat(140))

    for (const job of jobs) {
      const id = String(job.id).padEnd(38)
      const name = (job.name || '').substring(0, 33).padEnd(35)
      const type = job.scheduleType.padEnd(12)
      const schedule = (job.scheduleValue || '').substring(0, 18).padEnd(20)
      const status = (job.isEnabled ? '✓ Enabled' : '✗ Disabled').padEnd(10)
      const nextRun = job.nextRunAt ? new Date(job.nextRunAt).toISOString() : 'N/A'
      writeLine(`${id}${name}${type}${schedule}${status}${nextRun}`)
    }

    writeLine('')
  },
}

const statusCommand: ModuleCli = {
  command: 'status',
  async run() {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager

    const totalCount = await em.count(ScheduledJob, { deletedAt: null })
    const enabledCount = await em.count(ScheduledJob, { isEnabled: true, deletedAt: null })
    const dueCount = await em.count(ScheduledJob, {
      isEnabled: true,
      deletedAt: null,
      nextRunAt: { $lte: new Date() },
    })

    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'

    writeLine('\n📊 Scheduler Status\n')
    writeLine(`Strategy: ${queueStrategy === 'async' ? 'BullMQ (async)' : 'Local (polling)'}`)
    
    if (queueStrategy === 'local') {
      const pollInterval = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10)
      writeLine(`Poll Interval: ${Math.round(pollInterval / 1000)}s`)
    }
    
    writeLine('')
    writeLine('Schedules:')
    writeLine(`  Total: ${totalCount}`)
    writeLine(`  Enabled: ${enabledCount}`)
    writeLine(`  Due Now: ${dueCount}`)
    writeLine('')
  },
}

const runCommand: ModuleCli = {
  command: 'run',
  async run(rest) {
    const scheduleId = rest[0]
    if (!scheduleId) {
      writeErrorLine('Usage: mercato scheduler run <schedule-id>')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const queueService = resolve('queueService') as { getQueue(name: string): { add(name: string, data: unknown): Promise<unknown> } }

    const job = await em.findOne(ScheduledJob, { id: scheduleId, deletedAt: null })
    if (!job) {
      writeErrorLine(`Schedule not found: ${scheduleId}`)
      return
    }

    writeLine(`\n🚀 Manually triggering schedule: ${job.name}\n`)
    writeLine(`  ID: ${job.id}`)
    writeLine(`  Type: ${job.scheduleType}`)
    writeLine(`  Schedule: ${job.scheduleValue}`)
    writeLine(`  Target: ${job.targetType === 'queue' ? job.targetQueue : job.targetCommand}`)
    writeLine('')

    try {
      // Manually enqueue the job (triggering the scheduler-execution worker)
      const schedulerQueue = queueService.getQueue('scheduler-execution')
      await schedulerQueue.add('execute-schedule', { scheduleId: job.id })

      writeLine('✓ Job successfully triggered via scheduler-execution queue')
      writeLine(`  The worker will pick it up and enqueue to: ${job.targetType === 'queue' ? job.targetQueue : job.targetCommand}`)
      writeLine('✓ Manual trigger completed\n')
    } catch (error: unknown) {
      writeErrorLine(`✗ Failed to trigger job: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  },
}

const startCommand: ModuleCli = {
  command: 'start',
  async run() {
    const { resolve } = await createRequestContainer()
    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'

    writeLine(`🚀 Starting scheduler (strategy: ${queueStrategy})...\n`)

    if (queueStrategy === 'async') {
      // BullMQ strategy: Sync schedules with BullMQ repeatable jobs
      try {
        const bullmqService = resolve('bullmqSchedulerService') as { syncAll(): Promise<void> } | undefined
        
        if (!bullmqService) {
          writeErrorLine('❌ BullMQSchedulerService not available.')
          writeErrorLine('   Set QUEUE_STRATEGY=async and configure REDIS_URL.')
          process.exit(1)
        }

        // Sync all enabled schedules with BullMQ
        await bullmqService.syncAll()

        writeLine('✓ Scheduler sync completed')
        writeLine('')
        writeLine('BullMQ is managing all schedules.')
        writeLine('Start workers to process jobs:')
        writeLine('  yarn mercato worker:start')
        writeLine('')
      } catch (error: unknown) {
        writeErrorLine(`❌ Failed to sync schedules: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    } else {
      // Local strategy: Start polling engine
      try {
        const localService = resolve('localSchedulerService') as { start(): Promise<void>; stop(): Promise<void> } | undefined
        
        if (!localService) {
          writeErrorLine('❌ LocalSchedulerService not available.')
          writeErrorLine('   This should not happen in local mode.')
          process.exit(1)
        }

        const pollInterval = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10)

        // Start the local polling engine
        await localService.start()

        writeLine(`✓ Local scheduler started (polling every ${Math.round(pollInterval / 1000)} seconds)`)
        writeLine('Press Ctrl+C to stop.')
        writeLine('')
        writeLine('💡 Tip: For production, use QUEUE_STRATEGY=async with Redis.')
        writeLine('')

        // Keep the process alive and handle graceful shutdown
        const gracefulShutdown = async () => {
          writeLine('\n📛 Shutting down...')
          await localService.stop()
          writeLine('✓ Stopped')
          process.exit(0)
        }

        process.on('SIGINT', gracefulShutdown)
        process.on('SIGTERM', gracefulShutdown)

        // Keep process alive
        await new Promise(() => {}) // Never resolves
      } catch (error: unknown) {
        writeErrorLine(`❌ Failed to start local scheduler: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    }
  },
}

export default [listCommand, statusCommand, runCommand, startCommand]
