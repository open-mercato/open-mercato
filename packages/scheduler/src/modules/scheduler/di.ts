import { asClass } from 'awilix'
import { asScopedService, defineProcessDiRegistrar, registerCallerSetup, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { runInRequestScope, runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { EntityManager } from '@mikro-orm/core'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createQueue } from '@open-mercato/queue'
import { SchedulerService } from './services/schedulerService.js'
import { BullMQSchedulerService } from './services/bullmqSchedulerService.js'
import { LocalSchedulerService } from './services/localSchedulerService.js'
import { ScheduledJobSubscriber } from './lib/scheduledJobSubscriber.js'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('scheduler')

// Process-level guard: ensures BullMQ sync runs at most once per process lifetime.
let schedulerSynced = false

async function reconcileScheduler(): Promise<void> {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const scope = await createRequestContainer()
  try {
    await runWithRequestScopeContainer(scope, () => scope.resolve<BullMQSchedulerService>('bullmqSchedulerService').syncAll())
    logger.info('BullMQ cold start sync complete')
  } finally {
    try {
      scope.resolve<EntityManager>('em').clear()
    } finally {
      await scope.dispose()
    }
  }
}

/**
 * Scheduler module DI registration
 * 
 * Supports two modes:
 * - async (production): BullMQ-based scheduling with Redis
 * - local (development): Simple polling for local dev without Redis
 * 
 * Set QUEUE_STRATEGY=async for production use.
 */
function registerLegacy(container: AppContainer) {
  const queueStrategy = process.env.QUEUE_STRATEGY || 'local'

  if (queueStrategy === 'async') {
    // Register BullMQ scheduler service for production (requires Redis)
    container.register({
      bullmqSchedulerService: asClass(BullMQSchedulerService)
        .singleton()
        .disposer((service) => service.destroy())
        .inject(() => ({
          em: () => container.resolve('em'),
        })),
    })
    // Register MikroORM subscriber for automatic BullMQ sync
    try {
      const em = container.resolve<{ getEventManager?: () => { registerSubscriber(s: ScheduledJobSubscriber): void } }>('em')
      if (em && em.getEventManager) {
        const subscriber = new ScheduledJobSubscriber()
        subscriber.setContainer(container)
        em.getEventManager().registerSubscriber(subscriber)
      }
    } catch (error) {
      // Best-effort registration - don't break if EM not available yet
      logger.warn('Could not register subscriber', { err: error })
    }

    // Cold start sync: reconcile DB schedules with BullMQ repeatable jobs.
    // Deferred so it doesn't block DI registration. Runs once per process.
    if (!schedulerSynced) {
      schedulerSynced = true
      setImmediate(() => {
        const service = container.resolve('bullmqSchedulerService') as BullMQSchedulerService
        service.syncAll()
          .then(() => logger.info('BullMQ cold start sync complete'))
          .catch((err: Error) => logger.error('BullMQ cold start sync failed', { err }))
      })
    }
  } else {
    // Register local scheduler service for development (no Redis required)
    const queueFactory = (name: string) => createQueue(name, 'local')
    
    container.register({
      localSchedulerService: asClass(LocalSchedulerService)
        .singleton()
        .inject(() => ({
          em: () => container.resolve('em'),
          queueFactory,
          rbacService: container.resolve('rbacService'),
          config: {
            pollIntervalMs: parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10),
          },
        })),
    })
  }

  // Register common API service
  container.register({
    schedulerService: asClass(SchedulerService)
      .singleton()
      .inject(() => ({
        em: () => container.resolve('em'),
        bullmqService: queueStrategy === 'async' 
          ? container.resolve('bullmqSchedulerService')
          : undefined,
      })),
  })
}


export const register = defineProcessDiRegistrar((container: AppContainer) => {
  const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
  if (queueStrategy === 'async') {
    container.register({
      bullmqSchedulerService: asScopedService((scope) =>
        new BullMQSchedulerService(() => scope.resolve<EntityManager>('em')),
      ).disposer((service) => service.destroy()),
    })
    registerCallerSetup(container, (scope) => {
      const em = scope.resolve<EntityManager>('em')
      const subscriber = new ScheduledJobSubscriber()
      subscriber.setContainer(scope)
      em.getEventManager().registerSubscriber(subscriber)
    })
    registerProcessActivation(container, () => {
      if (schedulerSynced) return
      schedulerSynced = true
      setImmediate(() => {
        void runInRequestScope(reconcileScheduler).catch((error: unknown) => {
          logger.error('BullMQ cold start sync failed', { err: error })
          getTelemetryRuntime()?.reportError(error, { module: 'scheduler', code: 'scheduler.cold_start_failed' })
        })
      })
    })
  } else {
    container.register({
      localSchedulerService: asScopedService((scope) => new LocalSchedulerService(
        () => scope.resolve<EntityManager>('em'),
        (name: string) => createQueue(name, 'local'),
        scope.resolve('rbacService'),
        { pollIntervalMs: parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10) },
      )).disposer((service) => service.stop()),
    })
  }
  container.register({
    schedulerService: asScopedService((scope) => new SchedulerService(
      () => scope.resolve<EntityManager>('em'),
      queueStrategy === 'async' ? scope.resolve<BullMQSchedulerService>('bullmqSchedulerService') : undefined,
    )),
  })
}, { legacy: registerLegacy })
