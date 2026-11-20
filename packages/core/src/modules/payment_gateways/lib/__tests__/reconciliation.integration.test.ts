import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { GatewayPaymentOperation, GatewayTransaction } from '../../data/entities'
import { listReconciliations, readReconciliation, RECONCILIATION_KEY, resolveReconciliation } from '../reconciliation'
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

  async function fixture() {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const em = orm.em.fork()
    const transaction = em.create(GatewayTransaction, {
      id: randomUUID(), ...scope, paymentId: randomUUID(), providerKey: 'synthetic', providerSessionId: randomUUID(),
      amount: '100.000000000000000001', capturedAmount: '100.000000000000000001', currencyCode: 'USD', unifiedStatus: 'cancelled',
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
    const input = { id: operation.id, scope, actorUserId: randomUUID(), evidence }
    return { scope, transaction, operation, input }
  }

  it('discovers legacy obligations even when the parent transaction is deleted', async () => {
    const { scope, operation } = await fixture()
    const result = await listReconciliations(orm.em.fork(), scope, { page: 1, pageSize: 20, status: 'required' })
    expect(result.items).toEqual([expect.objectContaining({ id: operation.id, reconciliation: expect.objectContaining({ status: 'required' }) })])
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
})
