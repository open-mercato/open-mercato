import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from './data/entities'

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

    const where: any = { deletedAt: null }

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
      where.isEnabled = args.enabled === 'true' || args.enabled === '1'
    }

    const jobs = await em.find(ScheduledJob, where, {
      orderBy: { isEnabled: 'DESC', name: 'ASC' },
    })

    if (jobs.length === 0) {
      console.log('No scheduled jobs found.')
      return
    }

    console.log(`\nFound ${jobs.length} scheduled job(s):\n`)
    console.log('ID'.padEnd(38) + 'Name'.padEnd(35) + 'Type'.padEnd(12) + 'Schedule'.padEnd(20) + 'Status'.padEnd(10) + 'Next Run')
    console.log('-'.repeat(140))

    for (const job of jobs) {
      const id = String(job.id).padEnd(38)
      const name = (job.name || '').substring(0, 33).padEnd(35)
      const type = job.scheduleType.padEnd(12)
      const schedule = (job.scheduleValue || '').substring(0, 18).padEnd(20)
      const status = (job.isEnabled ? '✓ Enabled' : '✗ Disabled').padEnd(10)
      const nextRun = job.nextRunAt ? new Date(job.nextRunAt).toISOString() : 'N/A'
      console.log(`${id}${name}${type}${schedule}${status}${nextRun}`)
    }

    console.log('')
  },
}

const statusCommand: ModuleCli = {
  command: 'status',
  async run() {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager

    const totalCount = await em.count(ScheduledJob, { deletedAt: null })
    const enabledCount = await em.count(ScheduledJob, { isEnabled: true, deletedAt: null })
    const disabledCount = await em.count(ScheduledJob, { isEnabled: false, deletedAt: null })

    const dueCount = await em.count(ScheduledJob, {
      isEnabled: true,
      deletedAt: null,
      nextRunAt: { $lte: new Date() },
    })

    const strategy = process.env.SCHEDULER_STRATEGY || 'local'
    const pollInterval = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10)
    const enabled = process.env.SCHEDULER_ENABLED !== 'false'

    console.log('\n📊 Scheduler Status\n')
    console.log('Configuration:')
    console.log(`  Strategy: ${strategy}`)
    console.log(`  Poll Interval: ${pollInterval}ms (${Math.round(pollInterval / 1000)}s)`)
    console.log(`  Engine Enabled: ${enabled ? '✓ Yes' : '✗ No'}`)
    console.log('')
    console.log('Schedules:')
    console.log(`  Total: ${totalCount}`)
    console.log(`  Enabled: ${enabledCount}`)
    console.log(`  Disabled: ${disabledCount}`)
    console.log(`  Due Now: ${dueCount}`)
    console.log('')
  },
}

const runCommand: ModuleCli = {
  command: 'run',
  async run(rest) {
    const scheduleId = rest[0]
    if (!scheduleId) {
      console.error('Usage: mercato scheduler run <schedule-id>')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const eventBus = resolve('eventBus') as any
    const queueService = resolve('queueService') as any
    const rbacService = resolve('rbacService') as any

    const job = await em.findOne(ScheduledJob, { id: scheduleId, deletedAt: null })
    if (!job) {
      console.error(`Schedule not found: ${scheduleId}`)
      return
    }

    console.log(`\n🚀 Manually triggering schedule: ${job.name}\n`)
    console.log(`  ID: ${job.id}`)
    console.log(`  Type: ${job.scheduleType}`)
    console.log(`  Schedule: ${job.scheduleValue}`)
    console.log(`  Target: ${job.targetType === 'queue' ? job.targetQueue : job.targetCommand}`)
    console.log('')

    try {
      // Manually enqueue the job (triggering the scheduler-execution worker)
      const schedulerQueue = queueService.getQueue('scheduler-execution')
      await schedulerQueue.add('execute-schedule', { scheduleId: job.id })

      console.log('✓ Job successfully triggered via scheduler-execution queue')
      console.log('  The worker will pick it up and enqueue to:', 
        job.targetType === 'queue' ? job.targetQueue : job.targetCommand)
      console.log('✓ Manual trigger completed\n')
    } catch (error: any) {
      console.error('✗ Failed to trigger job:', error.message)
      process.exit(1)
    }
  },
}

const startCommand: ModuleCli = {
  command: 'start',
  async run() {
    console.log('🚀 Syncing schedules with BullMQ...\n')

    const { resolve } = await createRequestContainer()
    
    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
    
    if (queueStrategy !== 'async') {
      console.error('❌ Error: BullMQ scheduler requires QUEUE_STRATEGY=async')
      console.error('   The scheduler now uses BullMQ repeatable jobs.')
      console.error('   For local development, you can still use QUEUE_STRATEGY=local,')
      console.error('   but schedules will only work if workers are running.')
      console.error('')
      console.error('   To use the scheduler:')
      console.error('   1. Set QUEUE_STRATEGY=async in your .env')
      console.error('   2. Ensure Redis is running')
      console.error('   3. Run: yarn mercato scheduler start')
      console.error('   4. Run workers: yarn mercato worker:start')
      console.error('')
      process.exit(1)
    }

    try {
      const bullmqService = resolve('bullmqSchedulerService') as any
      
      if (!bullmqService) {
        console.error('❌ BullMQSchedulerService not registered.')
        console.error('   Make sure QUEUE_STRATEGY=async is set.')
        process.exit(1)
      }

      console.log('Configuration:')
      console.log(`  Queue Strategy: ${queueStrategy}`)
      console.log(`  Redis URL: ${process.env.REDIS_URL || process.env.QUEUE_REDIS_URL || 'default'}`)
      console.log('')

      // Sync all enabled schedules with BullMQ
      await bullmqService.syncAll()

      console.log('✓ Scheduler sync completed')
      console.log('')
      console.log('BullMQ is now managing all schedules.')
      console.log('Make sure workers are running to process scheduled jobs:')
      console.log('  yarn mercato worker:start')
      console.log('')
    } catch (error: any) {
      console.error('❌ Failed to sync schedules:', error.message)
      process.exit(1)
    }
  },
}

export default {
  commands: [listCommand, statusCommand, runCommand, startCommand],
}
