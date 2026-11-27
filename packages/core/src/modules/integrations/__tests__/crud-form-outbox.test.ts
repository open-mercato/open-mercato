import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'
import type { Queue } from '@open-mercato/queue'
import { createModuleQueue } from '@open-mercato/queue'
import { getCrudFormSectionManifest } from '@open-mercato/shared/lib/crud/form-sections/manifest'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isEventDeclared } from '@open-mercato/shared/modules/events'
import { resolveIntegrationCredentialsSchema } from '@open-mercato/shared/modules/integrations/types'
import {
  crudFormSectionOutboxKey, crudFormSectionOutboxQueue, crudFormSectionOutboxServiceKey, crudFormSectionOutboxSweepQueue,
  type CrudFormSectionOutboxIdentity,
} from '@open-mercato/shared/lib/crud/form-sections/outbox'
import { createCrudFormSectionOutboxService } from '../lib/crud-form-outbox'
import sweep from '../workers/crud-form-outbox-sweep'
import deliver from '../workers/crud-form-outbox'

jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/form-sections/manifest', () => ({ getCrudFormSectionManifest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/modules/events', () => ({ isEventDeclared: jest.fn() }))
jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  ...jest.requireActual('@open-mercato/shared/modules/integrations/types'),
  resolveIntegrationCredentialsSchema: jest.fn(),
}))

const scope = { tenantId: '952e4391-f8d8-477c-8725-7090933019d6', organizationId: 'ad6e092f-855e-4ec5-8bbd-ad3059fdc14f' }
const hostId = '7925c9ef-6af4-4c53-9b60-b0e889389585'
const identity: CrudFormSectionOutboxIdentity = { ...scope, hostId, sinkId: 'example.brand_mirror' }
const enqueue = jest.fn(async () => 'queued')
const driver = { enqueue } as unknown as Queue
const context = (container: ReturnType<typeof createContainer>) => ({
  resolve<T>(key: string): T { return container.resolve<T>(key) },
  jobId: 'test-job', attemptNumber: 1, queueName: crudFormSectionOutboxQueue,
})

it('allows an explicitly credential-free provider in an existing scope without a credentials row', async () => {
  const resolve = jest.fn(async () => null)
  const service = createCrudFormSectionOutboxService(createContainer().register({
    integrationCredentialsService: asValue({ resolve }),
  }))
  jest.mocked(resolveIntegrationCredentialsSchema).mockReturnValueOnce({ fields: [] })

  await expect(service.credentials('example_todo_erp', scope)).resolves.toEqual({})
  expect(resolve).toHaveBeenCalledWith('example_todo_erp', scope)
  await expect(service.credentials('unknown_provider', scope)).resolves.toBeNull()
})

it('registers recovery for an upgraded organization once without resetting an existing schedule', async () => {
  const exists = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const register = jest.fn(async () => undefined)
  const service = createCrudFormSectionOutboxService(createContainer().register({
    schedulerService: asValue({ exists, register }),
  }))

  await service.ensureRecovery!(scope)
  await service.ensureRecovery!(scope)

  expect(register).toHaveBeenCalledTimes(1)
  expect(register).toHaveBeenCalledWith(expect.objectContaining({
    ...scope, targetQueue: crudFormSectionOutboxSweepQueue, targetPayload: scope,
  }))
  expect(exists.mock.calls[0]).toEqual(exists.mock.calls[1])
})

it('isolates external mappings and retained tombstones by sink and tenant for the same host and integration', async () => {
  const rows = new Map<string, Record<string, unknown>>()
  const execute = jest.fn(async () => [])
  const em = {
    execute,
    create(_entity: unknown, row: Record<string, unknown>) {
      const { externalId: _id, lastSyncedAt: _synced, syncStatus: _status, ...key } = row
      rows.set(JSON.stringify(key), row)
    },
  } as unknown as EntityManager
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, _entity, where) =>
    (rows.get(JSON.stringify(where)) ?? null) as never)
  const service = createCrudFormSectionOutboxService(createContainer())
  const record = (selected: CrudFormSectionOutboxIdentity, externalId: string | null, operation: 'upsert' | 'delete' | 'restore') =>
    service.recordMapping!(em, {
      identity: selected, externalId, operation, resourceKind: 'example.todo', integrationId: 'example.erp',
    })
  const second = { ...identity, sinkId: 'example.other_mirror' }
  const otherTenant = { ...identity, tenantId: '15f38913-ff23-45ca-9cc8-bd3cb8cfa0d2' }
  await record(identity, 'brand', 'upsert')
  await record(second, 'other object', 'upsert')
  await record(otherTenant, 'other tenant', 'upsert')
  await record(identity, null, 'delete')
  expect([...rows.values()]).toEqual([
    expect.objectContaining({ ...scope, internalEntityType: 'crud_form_section_sink:example.brand_mirror', externalId: 'brand', deletedAt: expect.any(Date) }),
    expect.objectContaining({ ...scope, internalEntityType: 'crud_form_section_sink:example.other_mirror', externalId: 'other object' }),
    expect.objectContaining({ tenantId: otherTenant.tenantId, externalId: 'other tenant' }),
  ])
  expect([...rows.values()][1]).not.toHaveProperty('deletedAt')
  expect([...rows.values()][2]).not.toHaveProperty('deletedAt')
  expect(execute.mock.calls[0]).not.toEqual(execute.mock.calls[1])
  await record(identity, 'restored brand', 'restore')
  expect([...rows.values()][0]).toMatchObject({ externalId: 'restored brand', deletedAt: null })
})

it('delivers each persisted failure effect using its stable scoped identity', async () => {
  const emit = jest.fn(async () => undefined)
  const createBatch = jest.fn(async () => [])
  jest.mocked(isEventDeclared).mockReturnValue(true)
  const container = createContainer().register({
    notificationService: asValue({ createBatch }), eventBus: asValue({ emit }),
  })
  const service = createCrudFormSectionOutboxService(container)
  const reportId = 'db0bbda6-c99b-41b4-8551-ce116e4c7a87'
  const actorId = 'adf1de7b-643b-47ab-a48e-17ca46b98ddd'
  const report = {
    identity, actorId, integrationId: 'example.erp', resourceKind: 'example.todo',
    status: 'failed', code: 'remote_rejected', failureNotificationType: 'example.sync_failed',
  } as const
  await service.reportOutcome!({ ...report, failure: { reportId, effect: 'event' } })
  await service.reportOutcome!({ ...report, failure: { reportId, effect: 'notification' } })
  expect(emit).toHaveBeenCalledWith('example.brand_mirror.sync_failed',
    expect.objectContaining({ ...scope, failureReportId: reportId }), expect.objectContaining({ ...scope, persistent: true }))
  expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
    groupKey: `crud_form_outbox_failure:${reportId}`, recipientUserIds: [actorId], channels: ['in_app'],
  }), scope, { skipExistingGroup: true })
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
