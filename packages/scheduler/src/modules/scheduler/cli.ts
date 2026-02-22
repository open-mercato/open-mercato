import { cliLogger } from '@open-mercato/cli/lib/helpers'
const logger = cliLogger.forModule('core')
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
const logger = cliLogger.forModule('core')
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from './data/entities.js'
const logger = cliLogger.forModule('core')
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

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
const logger = cliLogger.forModule('core')
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
      logger.info('No scheduled jobs found.')
      return
    }

    logger.info(`\nFound ${jobs.length} scheduled job(s):\n`)
    logger.info('ID'.padEnd(38) + 'Name'.padEnd(35) + 'Type'.padEnd(12) + 'Schedule'.padEnd(20) + 'Status'.padEnd(10) + 'Next Run')
    logger.info('-'.repeat(140))

    for (const job of jobs) {
      const id = String(job.id).padEnd(38)
      const name = (job.name || '').substring(0, 33).padEnd(35)
      const type = job.scheduleType.padEnd(12)
      const schedule = (job.scheduleValue || '').substring(0, 18).padEnd(20)
      const status = (job.isEnabled ? '✓ Enabled' : '✗ Disabled').padEnd(10)
      const nextRun = job.nextRunAt ? new Date(job.nextRunAt).toISOString() : 'N/A'
      logger.info(`${id}${name}${type}${schedule}${status}${nextRun}`)
    }

    logger.info('')
  },
}

const statusCommand: ModuleCli = {
const logger = cliLogger.forModule('core')
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

    logger.info('\n📊 Scheduler Status\n')
    logger.info('Strategy:', queueStrategy === 'async' ? 'BullMQ (async)' : 'Local (polling)')
    
    if (queueStrategy === 'local') {
      const pollInterval = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10)
      logger.info('Poll Interval:', `${Math.round(pollInterval / 1000)}s`)
    }
    
    logger.info('')
    logger.info('Schedules:')
    logger.info(`  Total: ${totalCount}`)
    logger.info(`  Enabled: ${enabledCount}`)
    logger.info(`  Due Now: ${dueCount}`)
    logger.info('')
  },
}

const runCommand: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'run',
  async run(rest) {
    const scheduleId = rest[0]
    if (!scheduleId) {
      logger.error('Usage: mercato scheduler run <schedule-id>')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const queueService = resolve('queueService') as { getQueue(name: string): { add(name: string, data: unknown): Promise<unknown> } }

    const job = await em.findOne(ScheduledJob, { id: scheduleId, deletedAt: null })
    if (!job) {
      logger.error(`Schedule not found: ${scheduleId}`)
      return
    }

    logger.info(`\n🚀 Manually triggering schedule: ${job.name}\n`)
    logger.info(`  ID: ${job.id}`)
    logger.info(`  Type: ${job.scheduleType}`)
    logger.info(`  Schedule: ${job.scheduleValue}`)
    logger.info(`  Target: ${job.targetType === 'queue' ? job.targetQueue : job.targetCommand}`)
    logger.info('')

    try {
      // Manually enqueue the job (triggering the scheduler-execution worker)
      const schedulerQueue = queueService.getQueue('scheduler-execution')
      await schedulerQueue.add('execute-schedule', { scheduleId: job.id })

      logger.info('✓ Job successfully triggered via scheduler-execution queue')
      logger.info('  The worker will pick it up and enqueue to:', 
        job.targetType === 'queue' ? job.targetQueue : job.targetCommand)
      logger.info('✓ Manual trigger completed\n')
    } catch (error: unknown) {
      logger.error('✗ Failed to trigger job:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
}

const startCommand: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'start',
  async run() {
    const { resolve } = await createRequestContainer()
    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'

    logger.info(`🚀 Starting scheduler (strategy: ${queueStrategy})...\n`)

    if (queueStrategy === 'async') {
      // BullMQ strategy: Sync schedules with BullMQ repeatable jobs
      try {
        const bullmqService = resolve('bullmqSchedulerService') as { syncAll(): Promise<void> } | undefined
        
        if (!bullmqService) {
          logger.error('❌ BullMQSchedulerService not available.')
          logger.error('   Set QUEUE_STRATEGY=async and configure REDIS_URL.')
          process.exit(1)
        }

        // Sync all enabled schedules with BullMQ
        await bullmqService.syncAll()

        logger.info('✓ Scheduler sync completed')
        logger.info('')
        logger.info('BullMQ is managing all schedules.')
        logger.info('Start workers to process jobs:')
        logger.info('  yarn mercato worker:start')
        logger.info('')
      } catch (error: unknown) {
        logger.error('❌ Failed to sync schedules:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    } else {
      // Local strategy: Start polling engine
      try {
        const localService = resolve('localSchedulerService') as { start(): Promise<void>; stop(): Promise<void> } | undefined
        
        if (!localService) {
          logger.error('❌ LocalSchedulerService not available.')
          logger.error('   This should not happen in local mode.')
          process.exit(1)
        }

        const pollInterval = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10)

        // Start the local polling engine
        await localService.start()

        logger.info('✓ Local scheduler started (polling every', Math.round(pollInterval / 1000), 'seconds)')
        logger.info('Press Ctrl+C to stop.')
        logger.info('')
        logger.info('💡 Tip: For production, use QUEUE_STRATEGY=async with Redis.')
        logger.info('')

        // Keep the process alive and handle graceful shutdown
        const gracefulShutdown = async () => {
          logger.info('\n📛 Shutting down...')
          await localService.stop()
          logger.info('✓ Stopped')
          process.exit(0)
        }

        process.on('SIGINT', gracefulShutdown)
        process.on('SIGTERM', gracefulShutdown)

        // Keep process alive
        await new Promise(() => {}) // Never resolves
      } catch (error: unknown) {
        logger.error('❌ Failed to start local scheduler:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    }
  },
}

export default [listCommand, statusCommand, runCommand, startCommand]
