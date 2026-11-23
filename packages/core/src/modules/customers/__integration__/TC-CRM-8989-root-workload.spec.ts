import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { asFunction, asValue } from 'awilix'
import type { EventBus } from '@open-mercato/events'
import type { JobContext } from '@open-mercato/queue'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'

test('TC-CRM-8989: cold concurrent and warm callers reuse bootstrap while isolating owned services', async ({}, testInfo) => {
  const [{ bootstrapFromAppRoot }, runtime] = await Promise.all([
    importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')>('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
    importFromAppRuntime<typeof import('@open-mercato/shared/lib/di/container')>('@open-mercato/shared/lib/di/container'),
  ])
  await bootstrapFromAppRoot(resolveAppRoot())
  runtime.invalidateProcessContainer()
  const before = runtime.getProcessContainerStats()
  const containers: AppContainer[] = []
  const entityManagers = new Set<EntityManager>()
  let disposedServices = 0
  const createCaller = async () => {
    const container = await runtime.createRequestContainer()
    containers.push(container)
    entityManagers.add(container.resolve<EntityManager>('em'))
    container.register({
      integrationOwnedService: asFunction(() => ({ container })).singleton().disposer(() => { disposedServices += 1 }),
    })
    const nested = container.createScope()
    expect(nested.resolve('integrationOwnedService')).toBe(container.resolve('integrationOwnedService'))
    await nested.dispose()
    return container
  }
  try {
    const coldStart = performance.now()
    await Promise.all(Array.from({ length: 20 }, createCaller))
    const coldMs = performance.now() - coldStart
    const afterCold = runtime.getProcessContainerStats()
    expect(entityManagers.size).toBe(20)
    const warmMs: number[] = []
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now()
      await createCaller()
      warmMs.push(performance.now() - started)
    }
    const afterWarm = runtime.getProcessContainerStats()
    expect(entityManagers.size).toBe(120)
    expect(disposedServices).toBe(0)
    if (runtime.isProcessContainerRootEnabled()) {
      expect(afterCold.compatibilityReason).toBeNull()
      expect(afterCold.rootInitializations - before.rootInitializations).toBe(1)
      expect(afterCold.registrarExecutions - before.registrarExecutions).toBe(runtime.getDiRegistrars().length + 1)
      expect(afterCold.callerScopes - before.callerScopes).toBe(20)
      expect(afterWarm.callerScopes - afterCold.callerScopes).toBe(100)
      expect(afterWarm.rootInitializations).toBe(afterCold.rootInitializations)
      expect(afterWarm.registrarExecutions).toBe(afterCold.registrarExecutions)
      expect(afterWarm.legacyContainers).toBe(before.legacyContainers)
    } else {
      expect(afterCold.legacyContainers - before.legacyContainers).toBe(20)
      expect(afterWarm.legacyContainers - afterCold.legacyContainers).toBe(100)
      expect(afterWarm.registrarExecutions - before.registrarExecutions).toBe((runtime.getDiRegistrars().length + 1) * 120)
    }
    const sorted = [...warmMs].sort((left, right) => left - right)
    await testInfo.attach('process-root-workload', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({
        enabled: runtime.isProcessContainerRootEnabled(), coldCallers: 20, coldMs,
        warmCallers: warmMs.length, warmMedianMs: sorted[50], warmP95Ms: sorted[94],
        before, afterCold, afterWarm, distinctEntityManagers: entityManagers.size,
      }, null, 2)),
    })
  } finally {
    for (const container of containers) {
      container.resolve<EntityManager>('em').clear()
      await container.dispose()
    }
    expect(disposedServices).toBe(containers.length)
  }
})

test('TC-CRM-8989: real concurrent worker callers keep auth, entity managers and event delivery isolated', async () => {
  const [{ bootstrapFromAppRoot }, runtime, requestScope, { createPerJobWorkerHandler }] = await Promise.all([
    importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')>('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
    importFromAppRuntime<typeof import('@open-mercato/shared/lib/di/container')>('@open-mercato/shared/lib/di/container'),
    importFromAppRuntime<typeof import('@open-mercato/shared/lib/di/request-scope')>('@open-mercato/shared/lib/di/request-scope'),
    importFromAppRuntime<typeof import('@open-mercato/cli/lib/worker-job-handler')>('@open-mercato/cli/lib/worker-job-handler'),
  ])
  await bootstrapFromAppRoot(resolveAppRoot())
  const containers: AppContainer[] = []
  const before = runtime.getProcessContainerStats()
  const jobEms = new Set<EntityManager>()
  const event = `customers.integration.${randomUUID()}`
  const owners = new Map<string, AppContainer>()
  const delivered: { subscriber: string; emitter: unknown; auth: unknown; em: unknown; owner: unknown }[] = []
  let entered = 0
  let release!: () => void
  const bothEntered = new Promise<void>((resolve) => { release = resolve })
  const createCaller = async () => {
    const container = await runtime.createRequestContainer()
    containers.push(container)
    return container
  }
  const worker: ModuleWorker = {
    id: 'customers.integration_scope', queue: 'integration-scope', concurrency: 2,
    handler: async (_job, context) => {
      const { jobId, resolve } = context as JobContext & { resolve: AppContainer['resolve'] }
      const owner = requestScope.getRequestScopeContainer() as AppContainer
      owners.set(jobId, owner)
      owner.register({ auth: asValue({ sub: jobId }) })
      const em = resolve<EntityManager>('em')
      jobEms.add(em)
      const helper = await createCaller()
      expect(helper.resolve('em')).not.toBe(em)
      expect(requestScope.getRequestScopeContainer()).toBe(owner)
      expect(resolve<{ sub: string }>('auth').sub).toBe(jobId)
      const eventBus = resolve<EventBus>('eventBus')
      eventBus.on(event, async (payload, eventContext) => {
        await Promise.resolve()
        delivered.push({
          subscriber: jobId, emitter: payload,
          auth: eventContext.resolve('auth'), em: eventContext.resolve('em'),
          owner: requestScope.getRequestScopeContainer(),
        })
      })
      entered += 1
      if (entered === 2) release()
      await bothEntered
      await eventBus.emit(event, jobId, { persistent: false })
      expect(requestScope.getRequestScopeContainer()).toBe(owner)
    },
  }
  const handler = createPerJobWorkerHandler([worker], createCaller)
  try {
    const outcomes = await Promise.allSettled(['first', 'second'].map(async (jobId) => {
      try {
        await handler(
          { id: jobId, payload: {}, createdAt: new Date().toISOString() },
          { jobId, attemptNumber: 1, queueName: worker.queue },
        )
      } catch (error) {
        release()
        throw error
      }
    }))
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason
    }
    expect(jobEms.size).toBe(2)
    expect(delivered).toHaveLength(2)
    expect(delivered.map((entry) => entry.subscriber).sort()).toEqual(['first', 'second'])
    for (const entry of delivered) {
      expect(entry.emitter).toBe(entry.subscriber)
      expect(entry.auth).toEqual({ sub: entry.subscriber })
      expect(entry.em).toBe(owners.get(entry.subscriber)!.resolve('em'))
      expect(entry.owner).toBe(owners.get(entry.subscriber))
    }
    expect(requestScope.getRequestScopeContainer()).toBeNull()
    const after = runtime.getProcessContainerStats()
    if (runtime.isProcessContainerRootEnabled()) {
      expect(after.compatibilityReason).toBeNull()
      expect(after.callerScopes - before.callerScopes).toBe(4)
    } else {
      expect(after.legacyContainers - before.legacyContainers).toBe(4)
    }
  } finally {
    for (const container of containers) {
      container.resolve<EntityManager>('em').clear()
      await container.dispose()
    }
    runtime.invalidateProcessContainer()
  }
})
