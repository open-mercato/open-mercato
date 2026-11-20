import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'
import type { Queue } from '@open-mercato/queue'
import { createModuleQueue } from '@open-mercato/queue'
import { getCrudFormSectionManifest } from '@open-mercato/shared/lib/crud/form-sections/manifest'
import {
  crudFormSectionOutboxKey, crudFormSectionOutboxQueue, crudFormSectionOutboxServiceKey,
  type CrudFormSectionOutboxIdentity,
} from '@open-mercato/shared/lib/crud/form-sections/outbox'
import { createCrudFormSectionOutboxService } from '../lib/crud-form-outbox'
import sweep from '../workers/crud-form-outbox-sweep'
import deliver from '../workers/crud-form-outbox'

jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/form-sections/manifest', () => ({ getCrudFormSectionManifest: jest.fn() }))

const scope = { tenantId: '952e4391-f8d8-477c-8725-7090933019d6', organizationId: 'ad6e092f-855e-4ec5-8bbd-ad3059fdc14f' }
const hostId = '7925c9ef-6af4-4c53-9b60-b0e889389585'
const identity: CrudFormSectionOutboxIdentity = { ...scope, hostId, sinkId: 'example.brand_mirror' }
const enqueue = jest.fn(async () => 'queued')
const driver = { enqueue } as unknown as Queue
const context = (container: ReturnType<typeof createContainer>) => ({
  resolve<T>(key: string): T { return container.resolve<T>(key) },
  jobId: 'test-job', attemptNumber: 1, queueName: crudFormSectionOutboxQueue,
})
const makeJob = <Payload>(payload: Payload) => ({ id: 'test-job', payload, createdAt: new Date().toISOString() })

it('recovers due work from the scoped persistent mirror without spreading data into the job', async () => {
  jest.mocked(createModuleQueue).mockReturnValue(driver)
  const listDue = jest.fn(async () => [hostId])
  const manifest = {
    sinkRuntimes: new Map([['example.brand-update', {
      hostDetailEntityId: 'example.todo',
      fact: { id: 'example.brand-update', targetEntityId: identity.sinkId, externalDelivery: { integrationId: 'example.erp' } },
      outbox: { mirror: { listDue } },
    }]]),
  } as unknown as ReturnType<typeof getCrudFormSectionManifest>
  jest.mocked(getCrudFormSectionManifest).mockReturnValue(manifest)
  const em = {} as EntityManager
  const container = createContainer().register('em', asValue(em))
  container.register(crudFormSectionOutboxServiceKey, asValue(createCrudFormSectionOutboxService(container)))
  await sweep(makeJob({ ...scope, scope: { tenantId: 'ignored' }, _jobOrigin: 'scheduler', _idempotencyKey: 'test' }), context(container))

  expect(listDue).toHaveBeenCalledWith(em, scope, expect.any(Date), 100)
  expect(jest.mocked(createModuleQueue)).toHaveBeenCalledWith(crudFormSectionOutboxQueue, {
    coalesceBy: crudFormSectionOutboxKey, concurrency: 3,
  })
  expect(enqueue).toHaveBeenCalledWith(identity, { delayMs: undefined })
  expect(crudFormSectionOutboxKey(identity)).not.toBe(crudFormSectionOutboxKey({ ...identity, organizationId: scope.tenantId }))
  await deliver(makeJob({ ...identity, credentials: 'unexpected' }), context(container))
  expect(enqueue).toHaveBeenCalledTimes(1)
})
