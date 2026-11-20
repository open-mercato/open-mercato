import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { withAtomicFlush } from '../../../commands/flush'
import type { CrudFormSectionSink } from '../../../../modules/form-sections'
import {
  assertPrevalidatedCrudFormSectionOutbox,
  collectCrudFormSectionOutboxRuntimes,
  crudFormSectionOutboxServiceKey,
  defineCrudFormSectionOutboxSink,
  deliverCrudFormSectionOutbox,
  preflightCrudFormSectionOutboxIntent,
  prevalidateCrudFormSectionOutbox,
  retryCrudFormSectionOutbox,
  validCrudFormSectionExternalDelivery,
  type CrudFormSectionOutboxDelivery,
  type CrudFormSectionOutboxIdentity,
  type CrudFormSectionOutboxMirror,
  type CrudFormSectionOutboxRow,
  type CrudFormSectionOutboxServices,
} from '../outbox'

const tenantId = '952e4391-f8d8-477c-8725-7090933019d6'
const organizationId = 'ad6e092f-855e-4ec5-8bbd-ad3059fdc14f'
const actorId = '04f783aa-e15c-4859-a3f9-dd6f2b2cd704'
const hostId = '7925c9ef-6af4-4c53-9b60-b0e889389585'
const identity: CrudFormSectionOutboxIdentity = { tenantId, organizationId, hostId, sinkId: 'example.brand_mirror' }
const scope = { tenantId, organizationId }
const testNow = new Date(Date.now() + 60_000)
const conflict = { status: 409, body: { code: 'extension_policy_mismatch' } }

function fixture(delivery: Partial<CrudFormSectionOutboxDelivery<{ brand: string }>> = {}) {
  let current: CrudFormSectionOutboxRow | null = null
  const staged = new Map<EntityManager, CrudFormSectionOutboxRow | null>()
  function makeEm(): EntityManager {
    const em = {
      fork: makeEm,
      isInTransaction: () => staged.has(em),
      execute: jest.fn(async () => []),
      async begin() { staged.set(em, structuredClone(current)) },
      async commit() { current = staged.get(em) ?? null; staged.delete(em) },
      async rollback() { staged.delete(em) },
      async flush() {},
    } as unknown as EntityManager
    return em
  }
  const em = makeEm()
  const scoped = (wanted: CrudFormSectionOutboxIdentity) => wanted.tenantId === tenantId
    && wanted.organizationId === organizationId && wanted.hostId === hostId && wanted.sinkId === identity.sinkId
  const write = jest.fn<ReturnType<CrudFormSectionOutboxMirror['write']>, Parameters<CrudFormSectionOutboxMirror['write']>>(
    async (em, wanted, row, intent) => {
      if (!scoped(wanted) || !em.isInTransaction()) throw new Error('[internal] Invalid scope')
      staged.set(em, { ...wanted, ...intent, id: 'mirror-id',
        failureReports: row?.failureReports ?? [], nextFailureReportAt: row?.nextFailureReportAt ?? null,
      })
    },
  )
  const mirror: CrudFormSectionOutboxMirror = {
    read: async (em, wanted) => scoped(wanted) ? structuredClone(staged.has(em) ? staged.get(em) ?? null : current) : null,
    write,
    async compareAndSet(em, wanted, row, status, changes) {
      const actual = staged.get(em)
      if (!scoped(wanted) || !actual || actual.id !== row.id || actual.syncStatus !== status
          || actual.deliveryRevision !== row.deliveryRevision || actual.syncAttempts !== row.syncAttempts
          || actual.idempotencyKey !== row.idempotencyKey || actual.pendingOperation !== row.pendingOperation
          || actual.deliveryIntegrationId !== row.deliveryIntegrationId || actual.deliveryContractId !== row.deliveryContractId
          || actual.lastAttemptAt?.getTime() !== row.lastAttemptAt?.getTime()
          || actual.nextFailureReportAt?.getTime() !== row.nextFailureReportAt?.getTime()
          || actual.nextAttemptAt?.getTime() !== row.nextAttemptAt?.getTime()) return false
      staged.set(em, { ...actual, ...changes })
      return true
    },
    listDue: async () => [],
  }
  const externalDelivery = {
    integrationId: 'example.erp', contractId: `${identity.sinkId}@v1`,
    maxAttempts: 2, preCommitValidation: delivery.validateExternal ? 'read-only' : 'none',
    coalesce: 'latest-state', fencing: 'remote-monotonic-revision/v1',
  } as const
  function makeSink(formOperation: 'create' | 'update') {
    const id = `example.brand-${formOperation}`
    return defineCrudFormSectionOutboxSink({
      fact: {
        id, roundTripId: `${id}@v1`, ownerModuleId: 'example',
        hostId: 'example.todo', formVariant: 'showcase', formOperation,
        atomicity: 'outbox', targetEntityId: identity.sinkId,
        payloadPaths: ['extensions.example.brand'], optimisticLock: 'sink-version', undo: 'snapshot', externalDelivery,
      },
      capabilityId: 'example.brand',
      hostDetailEntityId: 'example.todo',
      schema: z.object({ brand: z.string() }).strict(),
      outbox: { ...deliveryDefaults, ...delivery },
    })
  }
  const deliveryDefaults = {
    mirror,
    deliver: jest.fn(async () => ({ status: 'applied', externalId: 'erp-1' } as const)),
    failureNotificationType: 'example.brand_sync_failed',
  }
  const sink = makeSink('update')
  const service = {
    credentials: jest.fn(async () => ({ secret: 'test-secret' })),
    enqueue: jest.fn<ReturnType<CrudFormSectionOutboxServices['enqueue']>, Parameters<CrudFormSectionOutboxServices['enqueue']>>(async () => undefined),
    recordMapping: jest.fn(async () => undefined),
    reportOutcome: jest.fn<ReturnType<NonNullable<CrudFormSectionOutboxServices['reportOutcome']>>,
      Parameters<NonNullable<CrudFormSectionOutboxServices['reportOutcome']>>>(async () => undefined),
  }
  const container = createContainer().register(crudFormSectionOutboxServiceKey, asValue(service))
  const context = { container, em, scope, auth: { tenantId, orgId: organizationId, sub: actorId }, hostResourceId: hostId }
  const writeWith = (
    selected: CrudFormSectionSink,
    brand: string,
    afterWrite?: () => void,
  ) => withAtomicFlush(em, [async () => {
    await selected.persist({ ...context, values: { brand }, hostOperation: selected.fact.formOperation, lockedRow: null })
    afterWrite?.()
  }], { transaction: true })
  const deliver = (selected = sink, now = testNow) => deliverCrudFormSectionOutbox({ em, identity, sink: selected, service, now })
  return { em, sink, service, mirror, context, writeWith, makeSink, deliver, write,
    read: () => current, replace: (row: CrudFormSectionOutboxRow) => { current = row } }
}

function barrier() {
  let open!: () => void
  const wait = new Promise<void>((resolve) => { open = resolve })
  return { open, wait }
}

it('retains a single monotonic fence across create, update, delete, and undo and enqueues only committed intent', async () => {
  const setup = fixture()
  const created = setup.makeSink('create')
  expect(collectCrudFormSectionOutboxRuntimes([created, setup.sink]).get(identity.sinkId)).toBe(created)
  await expect(setup.writeWith(created, 'uncommitted', () => { throw Error('[internal] local rollback') })).rejects.toThrow('local rollback')
  expect(setup.read()).toBeNull()
  expect(setup.service.enqueue).not.toHaveBeenCalled()

  await setup.writeWith(created, 'one', () => expect(setup.service.enqueue).not.toHaveBeenCalled())
  expect(setup.service.enqueue).toHaveBeenLastCalledWith(identity, undefined)
  expect(Object.keys(setup.service.enqueue.mock.calls[0]![0]).sort()).toEqual(['hostId', 'organizationId', 'sinkId', 'tenantId'])
  expect(setup.read()).toMatchObject({ deliveryRevision: '1', pendingOperation: 'upsert' })

  await setup.writeWith(setup.sink, 'two')
  const beforeDelete = setup.read()!
  expect(beforeDelete.deliveryRevision).toBe('2')
  expect(beforeDelete.idempotencyKey).toBe([tenantId, organizationId, identity.sinkId, hostId, '2'].join(':'))
  let snapshot: Awaited<ReturnType<NonNullable<CrudFormSectionSink['onHostDeleted']>>> | undefined
  await withAtomicFlush(setup.em, [async () => {
    snapshot = await setup.sink.onHostDeleted!(setup.context)
  }], { transaction: true })
  expect(setup.read()).toMatchObject({ deliveryRevision: '3', pendingOperation: 'delete', values: { brand: 'two' } })
  await expect(setup.sink.load({ ...setup.context, userId: actorId })).resolves.toEqual({
    values: {}, sync: { status: 'pending', lastAttemptAt: null, errorCode: null },
  })
  expect(snapshot).toEqual({ before: { brand: 'two' }, after: null, outboxAfterRevision: '3' })
  await withAtomicFlush(setup.em, [async () => {
    await setup.sink.undo!({ ...setup.context, snapshot: snapshot! })
  }], { transaction: true })
  expect(setup.read()).toMatchObject({ deliveryRevision: '4', pendingOperation: 'restore', values: { brand: 'two' } })
  await expect(withAtomicFlush(setup.em, [async () => {
    await setup.sink.undo!({ ...setup.context, snapshot: snapshot! })
  }], { transaction: true })).rejects.toMatchObject(conflict)
  expect(setup.read()).toMatchObject({ deliveryRevision: '4', pendingOperation: 'restore' })

  setup.replace({ ...setup.read()!, deliveryRevision: '9223372036854775807' })
  const writes = setup.write.mock.calls.length
  await expect(withAtomicFlush(setup.em, [async () => {
    await preflightCrudFormSectionOutboxIntent(setup.sink, setup.context)
  }], { transaction: true })).rejects.toMatchObject(conflict)
  expect(setup.write).toHaveBeenCalledTimes(writes)
})

it('never downgrades a newer mirrored revision when the older delivery returns after it', async () => {
  const entered = barrier()
  const release = barrier()
  let remote: { revision: string; operation: string; values: unknown } | undefined
  const deliver: CrudFormSectionOutboxDelivery<{ brand: string }>['deliver'] = async ({ revision, operation, values }) => {
    if (revision === '1') { entered.open(); await release.wait }
    if (remote && BigInt(revision) < BigInt(remote.revision)) {
      return { status: 'stale', currentRevision: remote.revision }
    }
    if (remote?.revision === revision) {
      return remote.operation === operation && JSON.stringify(remote.values) === JSON.stringify(values)
        ? { status: 'identical', externalId: 'stable' }
        : { status: 'rejected' }
    }
    remote = { revision, operation, values }
    return { status: 'applied', externalId: 'stable' }
  }
  const setup = fixture({ deliver })
  await setup.writeWith(setup.sink, 'old')
  const stale = setup.deliver()
  await entered.wait
  await setup.writeWith(setup.sink, 'new')
  await setup.deliver()
  release.open()
  await stale
  expect(setup.read()).toMatchObject({ deliveryRevision: '2', syncStatus: 'synced', externalId: 'stable' })
  expect(remote).toEqual({ revision: '2', operation: 'upsert', values: { brand: 'new' } })
  expect(setup.service.recordMapping).toHaveBeenCalledTimes(1)
  expect(setup.service.reportOutcome).toHaveBeenCalledTimes(1)

  await withAtomicFlush(setup.em, [async () => {
    await setup.sink.onHostDeleted!(setup.context)
  }], { transaction: true })
  await setup.deliver()
  expect(remote).toEqual({ revision: '3', operation: 'delete', values: null })
  expect(setup.read()).toMatchObject({ deliveryRevision: '3', syncStatus: 'synced', values: null })
  const duplicate = { ...setup.read()!, syncStatus: 'pending' as const, nextAttemptAt: testNow }
  setup.replace(duplicate)
  await setup.deliver()
  expect(setup.read()?.syncStatus).toBe('synced')
  expect(remote).toEqual({ revision: '3', operation: 'delete', values: null })
})

it('backs off with safe error codes and retry preserves the exact operation and revision', async () => {
  const setup = fixture({ async deliver() { throw new Error('[internal] should never persist test-secret') } })
  await setup.writeWith(setup.sink, 'value')
  const initial = setup.read()!
  await setup.deliver()
  const pending = setup.read()!
  expect(pending).toMatchObject({ syncStatus: 'pending', syncAttempts: 1, lastErrorCode: 'delivery_unavailable' })
  expect(pending.nextAttemptAt!.getTime()).toBeGreaterThan(testNow.getTime())
  expect(setup.service.enqueue).toHaveBeenLastCalledWith(identity, expect.any(Number))
  await setup.deliver(setup.sink, pending.nextAttemptAt!)
  expect(setup.read()).toMatchObject({ syncStatus: 'failed', syncAttempts: 2 })
  expect(setup.service.reportOutcome).toHaveBeenLastCalledWith(expect.objectContaining({
    status: 'failed', actorId, code: 'delivery_unavailable',
  }))
  expect(JSON.stringify(setup.service.reportOutcome.mock.calls)).not.toContain('test-secret')
  await withAtomicFlush(setup.em, [async () => {
    await retryCrudFormSectionOutbox(setup.sink, setup.context)
  }], { transaction: true })
  expect(setup.read()).toMatchObject({
    syncStatus: 'pending', syncAttempts: 0, deliveryRevision: initial.deliveryRevision,
    idempotencyKey: initial.idempotencyKey, pendingOperation: initial.pendingOperation,
  })
})

it('marks unexpected remote-ahead revisions failed and holds them for reconciliation', async () => {
  const setup = fixture({ async deliver() { return { status: 'stale', currentRevision: '9' } } })
  await setup.writeWith(setup.sink, 'value')
  await setup.deliver()
  expect(setup.read()).toMatchObject({ syncStatus: 'failed', lastErrorCode: 'remote_revision_ahead', deliveryRevision: '1' })
  await expect(withAtomicFlush(setup.em, [async () => {
    await retryCrudFormSectionOutbox(setup.sink, setup.context)
  }], { transaction: true })).rejects.toMatchObject(conflict)
  expect(setup.service.recordMapping).not.toHaveBeenCalled()
})

it('rejects drift in read-only external validation and stops waiting after three seconds', async () => {
  type ValidateExternal = NonNullable<CrudFormSectionOutboxDelivery<{ brand: string }>['validateExternal']>
  const check = jest.fn<ReturnType<ValidateExternal>, Parameters<ValidateExternal>>(
    async () => undefined,
  )
  const setup = fixture({ validateExternal: check })
  const work = [{ runtime: setup.sink, values: { brand: 'value' } }]
  const validated = await prevalidateCrudFormSectionOutbox(work, scope, setup.context.container)
  expect(check).toHaveBeenCalledWith(expect.objectContaining({ scope, values: work[0].values }))
  expect(() => assertPrevalidatedCrudFormSectionOutbox(work, validated)).not.toThrow()
  expect(() => assertPrevalidatedCrudFormSectionOutbox([{ ...work[0], values: { brand: 'rewritten' } }], validated)).toThrow()
  expect(validCrudFormSectionExternalDelivery({
    ...setup.sink.fact, externalDelivery: { ...setup.sink.fact.externalDelivery!, fencing: 'none' as never },
  }, setup.sink.outbox)).toBe(false)
  const fieldErrors = { 'extensions.example.brand': 'example.brand.invalid' }
  check.mockResolvedValueOnce({ fieldErrors })
  await expect(prevalidateCrudFormSectionOutbox(work, scope, setup.context.container)).rejects.toMatchObject({
    status: 422, body: { error: 'validation_failed', code: 'validation_failed', fieldErrors },
  })

  jest.useFakeTimers()
  try {
    check.mockImplementationOnce(() => new Promise<void>(() => undefined))
    const validation = prevalidateCrudFormSectionOutbox(work, scope, setup.context.container)
    const rejection = expect(validation).rejects.toMatchObject({
      status: 503, body: { code: 'crud_form_section_external_unavailable' },
    })
    await jest.advanceTimersByTimeAsync(3000)
    await rejection
    expect(check.mock.lastCall?.[0].signal.aborted).toBe(true)
    expect(setup.read()).toBeNull()
  } finally {
    jest.useRealTimers()
  }
})

it('recovers only unfinished terminal effects without redelivering and pins their identity', async () => {
  const deliver = jest.fn(async () => ({ status: 'rejected' } as const))
  const setup = fixture({ deliver })
  setup.service.reportOutcome.mockImplementationOnce(async () => undefined)
    .mockImplementationOnce(async () => { throw new Error('[internal] temporary event transport failure') })
  await setup.writeWith(setup.sink, 'value')
  await setup.deliver()

  const failed = setup.read()!
  const report = failed.failureReports[0]!
  expect(failed).toMatchObject({ syncStatus: 'failed', deliveryRevision: '1', lastErrorCode: 'remote_rejected' })
  expect(report.effects).toEqual(['event'])
  expect(failed.nextFailureReportAt).toBeInstanceOf(Date)
  expect(setup.service.reportOutcome.mock.calls.map(([call]) => call.failure)).toEqual(
    ['log', 'event', 'notification'].map((effect) => ({ effect, reportId: report.id })),
  )

  await setup.deliver(setup.sink, failed.nextFailureReportAt!)
  expect(setup.service.reportOutcome).toHaveBeenCalledTimes(4)
  expect(setup.service.reportOutcome.mock.lastCall?.[0]).toMatchObject({
    identity, failure: { effect: 'event', reportId: report.id },
  })
  expect(deliver).toHaveBeenCalledTimes(1)
  expect(setup.read()).toMatchObject({ syncStatus: 'failed', failureReports: [], nextFailureReportAt: null })
})

it.each([
  [{ deliveryContractId: 'example.brand_mirror@v2' }, 'delivery_contract_mismatch'],
  [{ deliveryIntegrationId: 'example.other' }, 'delivery_contract_mismatch'],
  [{ idempotencyKey: 'invalid' }, 'delivery_intent_invalid'],
  [{ deliveryRevision: '0' }, 'delivery_intent_invalid'],
] as const)('quarantines the specific malformed or superseded intent %j without provider I/O', async (changed, errorCode) => {
  const deliver = jest.fn(async () => ({ status: 'identical' } as const))
  const setup = fixture({ deliver })
  await setup.writeWith(setup.sink, 'value')
  setup.replace({ ...setup.read()!, ...changed })
  await setup.deliver()
  expect(deliver).not.toHaveBeenCalled()
  expect(setup.service.credentials).not.toHaveBeenCalled()
  expect(setup.read()).toMatchObject({ ...changed, syncStatus: 'failed', lastErrorCode: errorCode, nextAttemptAt: null })
  await expect(withAtomicFlush(setup.em, [async () => {
    await retryCrudFormSectionOutbox(setup.sink, setup.context)
  }], { transaction: true })).rejects.toMatchObject(conflict)
})

it('retains an unfinished report when a later intent succeeds', async () => {
  type DeliveryResult = Awaited<ReturnType<CrudFormSectionOutboxDelivery<{ brand: string }>['deliver']>>
  const deliver = jest.fn<Promise<DeliveryResult>, []>(async () => ({ status: 'applied', externalId: 'stable' }))
    .mockResolvedValueOnce({ status: 'rejected' })
  const setup = fixture({ deliver })
  setup.service.reportOutcome.mockImplementationOnce(async () => undefined)
    .mockImplementationOnce(async () => { throw new Error('[internal] temporary event transport failure') })
  await setup.writeWith(setup.sink, 'first')
  await setup.deliver()
  const failed = setup.read()!
  await setup.writeWith(setup.sink, 'later')
  await setup.deliver()
  expect(setup.read()).toMatchObject({ deliveryRevision: '2', syncStatus: 'synced', failureReports: failed.failureReports })
  await setup.deliver(setup.sink, failed.nextFailureReportAt!)
  expect(setup.read()).toMatchObject({ deliveryRevision: '2', syncStatus: 'synced', failureReports: [] })
  expect(setup.service.reportOutcome.mock.lastCall?.[0]).toMatchObject({
    failure: { effect: 'event', reportId: failed.failureReports[0].id },
  })
  expect(deliver).toHaveBeenCalledTimes(2)
})
