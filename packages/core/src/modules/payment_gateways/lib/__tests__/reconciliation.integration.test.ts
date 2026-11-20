import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { GatewayPaymentOperation, GatewayTransaction } from '../../data/entities'
import { listReconciliations, readReconciliation, reconciliationResponse, RECONCILIATION_KEY, resolveReconciliation } from '../reconciliation'
import { completePaymentOperation } from '../payment-operation-idempotency'
import { createPaymentGatewayService } from '../gateway-service'
import { GET } from '../../api/reconciliations/route'
import { POST } from '../../api/reconciliations/[id]/resolve/route'
import { resolveReconciliationCommand } from '../../commands/reconciliation'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const mockResolve = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({ resolve: mockResolve }) }))
jest.mock('../../api/guards', () => ({
  resolveUserFeatures: () => [],
  runPaymentGatewayMutationGuards: async () => ({ ok: true, afterSuccessCallbacks: [] }),
  runPaymentGatewayMutationGuardAfterSuccess: async () => undefined,
}))

const withDatabase = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

withDatabase('capture reconciliation against disposable PostgreSQL', () => {
  let orm: MikroORM
  let postgres: StartedTestContainer | undefined

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: 'reconciliation_test', POSTGRES_USER: 'fixture', POSTGRES_PASSWORD: 'fixture' })
      .withExposedPorts(5432).withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000).start()
    orm = await MikroORM.init({
      host: postgres.getHost(), port: postgres.getMappedPort(5432), dbName: 'reconciliation_test', user: 'fixture', password: 'fixture',
      entities: [GatewayTransaction, GatewayPaymentOperation], metadataProvider: ReflectMetadataProvider,
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try { await orm?.close(true) } finally { await postgres?.stop({ timeout: 10_000 }) }
  }, 30_000)

  async function fixture(currencyCode = 'USD') {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const em = orm.em.fork()
    const transaction = em.create(GatewayTransaction, {
      id: randomUUID(), ...scope, paymentId: randomUUID(), providerKey: 'synthetic', providerSessionId: randomUUID(),
      amount: '100.000000000000000001', capturedAmount: '100.000000000000000001', currencyCode, unifiedStatus: 'cancelled',
      deletedAt: new Date(),
    })
    const operation = em.create(GatewayPaymentOperation, {
      ...scope, transactionId: transaction.id, operationId: randomUUID(), operationType: 'capture', providerKey: 'synthetic',
      requestHash: randomUUID(), providerIdempotencyKey: randomUUID(), attemptToken: randomUUID(), status: 'succeeded',
      createdAt: new Date(Date.now() - 60_000),
      result: { status: 'captured', capturedAmount: 100, capturedAmountExact: '100.000000000000000001', __settledTransactionStatus: 'cancelled' },
    })
    await em.persist([transaction, operation]).flush()
    const evidence = { refundReference: randomUUID(), refundedAmountExact: '100.000000000000000001', currencyCode: 'USD', confirmedAt: new Date(Date.now() - 1000).toISOString(), confirmed: true as const }
    const input = { id: operation.id, scope, actorUserId: randomUUID(), evidence, container: createContainer() }
    return { scope, transaction, operation, input }
  }

  it('discovers legacy obligations even when the parent transaction is deleted', async () => {
    const { scope, operation } = await fixture()
    const result = await listReconciliations(orm.em.fork(), scope, { page: 1, pageSize: 20, status: 'required' })
    expect(result.items).toEqual([expect.objectContaining({ id: operation.id, parentDeleted: true, providerSessionId: expect.any(String), paymentId: expect.any(String), reconciliation: expect.objectContaining({ status: 'required' }) })])
    expect(result.total).toBe(1)
    expect((await listReconciliations(orm.em.fork(), { ...scope, tenantId: randomUUID() }, { page: 1, pageSize: 20, status: 'required' })).total).toBe(0)
  })

  it('lists and resolves fixtures through the real route and command boundaries', async () => {
    const { input, operation } = await fixture()
    let allowed = false
    mockResolve.mockImplementation((key: string) => {
      if (key === 'em') return orm.em.fork()
      if (key === 'rbacService') return { userHasAllFeatures: async () => allowed }
      if (key === 'commandBus') return { execute: async (_id: string, call: { input: Parameters<typeof resolveReconciliationCommand.execute>[0]; ctx: CommandRuntimeContext }) => ({
        result: await resolveReconciliationCommand.execute(call.input, call.ctx),
      }) }
      throw new Error('[internal] Unexpected service')
    })
    const auth = { sub: input.actorUserId, tenantId: input.scope.tenantId, orgId: input.scope.organizationId }
    const listed = await GET(new Request('http://localhost/api/payment_gateways/reconciliations'), { auth })
    expect(await listed.json()).toMatchObject({ items: [{ id: operation.id }], total: 1 })
    const request = () => new Request('http://localhost/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.evidence) })
    expect((await POST(request(), { auth, params: { id: operation.id } })).status).toBe(403)
    allowed = true
    const completed = await POST(request(), { auth, params: { id: operation.id } })
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({ id: operation.id, reconciliation: { status: 'resolved', resolution: { actorUserId: auth.sub } } })
  })

  it('records exact full-refund evidence, preserves financial history and replays without changing the original actor', async () => {
    const { scope, operation, transaction, input } = await fixture()
    const first = await resolveReconciliation(orm.em.fork(), input)
    const replay = await resolveReconciliation(orm.em.fork(), { ...input, actorUserId: randomUUID() })
    expect(replay).toEqual(first)
    const stored = await orm.em.fork().findOneOrFail(GatewayPaymentOperation, operation.id)
    expect(stored).toMatchObject({ status: 'succeeded', requestHash: operation.requestHash, providerIdempotencyKey: operation.providerIdempotencyKey })
    const { [RECONCILIATION_KEY]: reconciliation, ...original } = stored.result ?? {}
    expect(original).toEqual(operation.result)
    expect(reconciliation).toMatchObject({ status: 'resolved', resolution: { actorUserId: input.actorUserId } })
    expect(await orm.em.fork().findOneOrFail(GatewayTransaction, transaction.id)).toMatchObject({ unifiedStatus: 'cancelled', capturedAmount: '100.000000000000000001' })
    expect((await listReconciliations(orm.em.fork(), scope, { page: 1, pageSize: 20, status: 'required' })).total).toBe(0)
    expect((await listReconciliations(orm.em.fork(), scope, { page: 1, pageSize: 20, status: 'resolved' })).total).toBe(1)
  })

  it('refuses partial, wrong-currency, future and earlier-than-capture evidence', async () => {
    const { input } = await fixture()
    for (const evidence of [
      { ...input.evidence, refundedAmountExact: '100' }, { ...input.evidence, currencyCode: 'EUR' },
      { ...input.evidence, confirmedAt: new Date(Date.now() + 60_000).toISOString() },
      { ...input.evidence, confirmedAt: new Date(0).toISOString() },
    ]) await expect(resolveReconciliation(orm.em.fork(), { ...input, evidence })).rejects.toMatchObject({ status: 409 })
    await expect(resolveReconciliation(orm.em.fork(), { ...input, evidence: { ...input.evidence, confirmed: false } as unknown as typeof input.evidence })).rejects.toThrow()
    const stored = await orm.em.fork().findOneOrFail(GatewayPaymentOperation, input.id)
    expect(stored.result?.[RECONCILIATION_KEY]).toBeUndefined()
  })

  it.each(['tenantId', 'organizationId'] as const)('refuses foreign %s', async (field) => {
    const { input } = await fixture()
    await expect(resolveReconciliation(orm.em.fork(), { ...input, scope: { ...input.scope, [field]: randomUUID() } })).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a stale open-case version and conflicting evidence after resolution', async () => {
    const { input } = await fixture()
    const request = new Request('http://localhost/resolve', { headers: { 'x-om-ext-optimistic-lock-expected-updated-at': new Date(0).toISOString() } })
    await expect(resolveReconciliation(orm.em.fork(), { ...input, request })).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
    await resolveReconciliation(orm.em.fork(), input)
    await expect(resolveReconciliation(orm.em.fork(), { ...input, evidence: { ...input.evidence, refundReference: randomUUID() } })).rejects.toMatchObject({ status: 409 })
  })

  it('awaits the optional record-lock guard and preserves its refusal', async () => {
    const { input } = await fixture()
    const enforce = jest.fn(async () => { throw new CrudHttpError(409, { code: 'record_lock_conflict', error: 'fixture conflict' }) })
    input.container.register({ commandOptimisticLockGuardService: asValue({ enforce }) })
    await expect(resolveReconciliation(orm.em.fork(), input)).rejects.toMatchObject({ status: 409, body: { code: 'record_lock_conflict' } })
    expect(enforce).toHaveBeenCalledTimes(1)
    expect((await orm.em.fork().findOneOrFail(GatewayPaymentOperation, input.id)).result?.[RECONCILIATION_KEY]).toBeUndefined()
  })

  it('discovers and resolves accepted lowercase legacy currency without rewriting transaction history', async () => {
    const { input, scope, transaction } = await fixture('usd')
    const listed = await listReconciliations(orm.em.fork(), scope, { page: 1, pageSize: 20, status: 'required' })
    expect(listed.items[0].reconciliation.currencyCode).toBe('USD')
    expect((await resolveReconciliation(orm.em.fork(), { ...input, evidence: { ...input.evidence, currencyCode: 'usd' } })).reconciliation.status).toBe('resolved')
    expect((await orm.em.fork().findOneOrFail(GatewayTransaction, transaction.id)).currencyCode).toBe('usd')
  })

  it('serializes concurrent receipt use across operations on independent connections', async () => {
    const { input, operation } = await fixture()
    const em = orm.em.fork()
    const second = em.create(GatewayPaymentOperation, {
      transactionId: operation.transactionId, ...input.scope, operationId: randomUUID(), operationType: 'capture', providerKey: 'synthetic',
      requestHash: randomUUID(), providerIdempotencyKey: randomUUID(), attemptToken: randomUUID(), status: 'succeeded',
      result: operation.result, createdAt: operation.createdAt,
    })
    await em.persist(second).flush()
    const results = await Promise.allSettled([
      resolveReconciliation(orm.em.fork(), input), resolveReconciliation(orm.em.fork(), { ...input, id: second.id }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
  })

  it('does not turn compatible progress or a reservation into a reconciliation obligation', async () => {
    const { operation } = await fixture()
    expect(readReconciliation({ ...operation, result: { ...operation.result, __settledTransactionStatus: 'partially_refunded' } }, 'USD')).toBeNull()
    expect(readReconciliation({ ...operation, status: 'in_progress' }, 'USD')).toBeNull()
  })

  it.each(['captured', 'partially_captured'] as const)('atomically stores %s completion facts and preserves replay after resolution', async (status) => {
    const { input, operation, transaction } = await fixture('usd')
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
    const em = orm.em.fork()
    await em.nativeUpdate(GatewayTransaction, transaction.id, { deletedAt: null })
    await em.nativeUpdate(GatewayPaymentOperation, operation.id, {
      status: 'in_progress', result: null,
      requestHash: digest({ transactionId: transaction.id, providerKey: operation.providerKey, action: 'capture', payload: { amount: null } }),
      providerIdempotencyKey: `om-pg-${digest({ tenantId: input.scope.tenantId, organizationId: input.scope.organizationId, transactionId: transaction.id, action: 'capture', operationId: operation.operationId })}`,
    })
    const record = await em.findOneOrFail(GatewayPaymentOperation, operation.id)
    const capturedAmountExact = status === 'captured' ? '100.000000000000000001' : '60.000000000000000001'
    const providerResult = { status, capturedAmount: status === 'captured' ? 100 : 60, capturedAmountExact }
    const completionResult = { ...providerResult, reconciliation: reconciliationResponse(record.id) }
    await completePaymentOperation(em, { record, attemptToken: record.attemptToken, providerIdempotencyKey: record.providerIdempotencyKey }, providerResult, async (completionEm) => {
      const current = await completionEm.findOneOrFail(GatewayTransaction, transaction.id)
      const reconciliation = readReconciliation({ operationType: 'capture', status: 'succeeded', updatedAt: new Date(), result: {
        ...providerResult, __settledTransactionStatus: current.unifiedStatus,
      } }, current.currencyCode)
      expect(reconciliation).toMatchObject({ status: 'required', currencyCode: 'USD' })
      return { statusChanged: false, settledStatus: current.unifiedStatus, storedResult: { ...completionResult, [RECONCILIATION_KEY]: reconciliation } }
    })
    const stored = await orm.em.fork().findOneOrFail(GatewayPaymentOperation, operation.id)
    expect(stored.result).toMatchObject({ ...completionResult, [RECONCILIATION_KEY]: { status: 'required', capturedAmountExact, currencyCode: 'USD' } })
    const credentials = { resolve: jest.fn() }
    const replay = () => createPaymentGatewayService({ em: orm.em.fork(), integrationCredentialsService: credentials as never })
      .capturePayment(transaction.id, undefined, input.scope, operation.operationId)
    await expect(replay()).resolves.toEqual(completionResult)
    await resolveReconciliation(orm.em.fork(), { ...input, evidence: { ...input.evidence, refundedAmountExact: capturedAmountExact } })
    await expect(replay()).resolves.toEqual(completionResult)
    expect(credentials.resolve).not.toHaveBeenCalled()
  })

  it('rolls back newly attached obligation metadata with the completion transaction', async () => {
    const { operation } = await fixture()
    const em = orm.em.fork()
    await em.nativeUpdate(GatewayPaymentOperation, operation.id, { status: 'in_progress', result: null })
    const record = await em.findOneOrFail(GatewayPaymentOperation, operation.id)
    const original = em.transactional.bind(em)
    em.transactional = (async (...args: Parameters<EntityManager['transactional']>) => original(async (transactionEm) => {
      await args[0](transactionEm)
      throw new Error('[internal] fixture commit refused')
    }, args[1])) as EntityManager['transactional']
    await expect(completePaymentOperation(em, { record, attemptToken: record.attemptToken, providerIdempotencyKey: record.providerIdempotencyKey }, { status: 'captured' }, async () => ({
      statusChanged: false, settledStatus: 'cancelled', storedResult: { status: 'captured', [RECONCILIATION_KEY]: { status: 'required' } },
    }))).rejects.toThrow('fixture commit refused')
    expect(await orm.em.fork().findOneOrFail(GatewayPaymentOperation, operation.id)).toMatchObject({ status: 'in_progress', result: null, providerIdempotencyKey: record.providerIdempotencyKey })
    expect(record.result).toBeNull()
  })
})
