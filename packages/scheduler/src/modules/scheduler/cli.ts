import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from './data/entities'
import { SchedulerEngine } from './services/schedulerEngine'

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

    // Create a minimal engine instance to trigger the job
    const engine = new SchedulerEngine(
      () => em,
      eventBus,
      queueService,
      rbacService,
      { strategy: 'local', pollIntervalMs: 30000 }
    )

    try {
      // Manually enqueue the job (bypassing the schedule check)
      if (job.targetType === 'queue' && job.targetQueue) {
        const queue = queueService.getQueue(job.targetQueue)
        const payload = {
          ...((job.targetPayload as any) || {}),
          tenantId: job.tenantId,
          organizationId: job.organizationId,
        }
        
        await queue.add(job.targetQueue, payload)
        
        await eventBus.emit('scheduler.job.started', {
          scheduleId: job.id,
          scheduleName: job.name,
          tenantId: job.tenantId,
          organizationId: job.organizationId,
          triggerType: 'manual',
        })

        console.log('✓ Job successfully enqueued to:', job.targetQueue)
      } else if (job.targetType === 'command' && job.targetCommand) {
        console.error('✗ Command execution not yet implemented')
        return
      }

      // Update last run time
      job.lastRunAt = new Date()
      await em.flush()

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
    console.log('🚀 Starting scheduler engine...\n')

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const eventBus = resolve('eventBus') as any
    const queueService = resolve('queueService') as any
    const rbacService = resolve('rbacService') as any

    const strategyEnv = process.env.SCHEDULER_STRATEGY || 'local'
    const strategy = (strategyEnv === 'async' ? 'async' : 'local') as 'local' | 'async'
    const pollInterval = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10)

    console.log('Configuration:')
    console.log(`  Strategy: ${strategy}`)
    console.log(`  Poll Interval: ${pollInterval}ms (${Math.round(pollInterval / 1000)}s)`)
    console.log('')

    const engine = new SchedulerEngine(
      () => em,
      eventBus,
      queueService,
      rbacService,
      { strategy, pollIntervalMs: pollInterval }
    )

    await engine.start()

    console.log('✓ Scheduler engine started')
    console.log('  Press Ctrl+C to stop\n')

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n⏸  Stopping scheduler engine...')
      await engine.stop()
      console.log('✓ Scheduler engine stopped\n')
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      console.log('\n\n⏸  Stopping scheduler engine...')
      await engine.stop()
      console.log('✓ Scheduler engine stopped\n')
      process.exit(0)
    })

    // Keep the process alive
    await new Promise(() => {}) // Never resolves
  },
}

export default {
  commands: [listCommand, statusCommand, runCommand, startCommand],
}
