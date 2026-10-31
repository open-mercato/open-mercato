/**
 * Real-PostgreSQL race harness for the payment gateway status writers: the status poller
 * worker, the inbound webhook job and manual capture / cancel completion, each on its own
 * forked entity manager, racing on one `gateway_transactions` row. Deterministic cases gate the
 * provider call to force an interleaving; the jittered cases repeat each pairing and fail on any
 * lost update (status, metadata) or duplicate / stale status event.
 *
 * Gated on OM_PAYMENT_GATEWAYS_RACE_DATABASE_URL — a throwaway database, since the suite drops
 * and recreates the payment gateway tables. Run it with, for example:
 *
 *   docker run -d --rm --name om-pgw-race -e POSTGRES_PASSWORD=race -e POSTGRES_USER=race \
 *     -e POSTGRES_DB=race -p 55473:5432 postgres:16-alpine
 *   OM_PAYMENT_GATEWAYS_RACE_DATABASE_URL=postgres://race:race@127.0.0.1:55473/race \
 *     OM_PAYMENT_GATEWAYS_RACE_ROUNDS=200 OM_PAYMENT_GATEWAYS_RACE_PARALLEL=20 \
 *     yarn workspace @open-mercato/core jest gateway-service.status-race.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { markQueueJobOrigin } from '@open-mercato/shared/lib/queue/dispatchOrigin'
import {
  registerGatewayAdapter,
  type GatewayAdapter,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import {
  GatewayPaymentOperation,
  GatewaySessionInitialization,
  GatewayTransaction,
  WebhookProcessedEvent,
} from '../../data/entities'
import { createPaymentGatewayService } from '../gateway-service'
import { processPaymentGatewayWebhookJob } from '../webhook-processor'
import handleStatusPoll from '../../workers/status-poller'

const DATABASE_URL = process.env.OM_PAYMENT_GATEWAYS_RACE_DATABASE_URL ?? ''
const ROUNDS = Number(process.env.OM_PAYMENT_GATEWAYS_RACE_ROUNDS ?? '50')
const PARALLEL = Number(process.env.OM_PAYMENT_GATEWAYS_RACE_PARALLEL ?? '10')
const POOL_MAX = Number(process.env.OM_PAYMENT_GATEWAYS_RACE_POOL_MAX ?? '10')
const PROVIDER_KEY = 'race-provider'
const TENANT_ID = '00000000-0000-4000-8000-0000000000aa'

const describeWithDatabase = DATABASE_URL ? describe : describe.skip

type ProviderSession = {
  pollStatus: UnifiedPaymentStatus
  pollGate: Promise<void> | null
  onPollStarted: (() => void) | null
  maxDelayMs: number
  captureAmount: number | null
  captureGate: Promise<void> | null
  onCaptureStarted: (() => void) | null
  onCaptureReturned: (() => void) | null
  captureKeys: string[]
}

type EmittedEvent = { id: string; transactionId: string }

const sessions = new Map<string, ProviderSession>()
const emitted: EmittedEvent[] = []

function delay(maxMs: number): Promise<void> {
  if (maxMs <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * maxMs)))
}

function readSession(sessionId: string): ProviderSession {
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`[internal] unknown race session ${sessionId}`)
  return session
}

const raceAdapter: GatewayAdapter = {
  providerKey: PROVIDER_KEY,
  async createSession() {
    throw new Error('[internal] not used')
  },
  async capture(input) {
    const session = readSession(input.sessionId)
    session.captureKeys.push(input.idempotencyKey ?? '')
    session.onCaptureStarted?.()
    if (session.captureGate) await session.captureGate
    await delay(session.maxDelayMs)
    session.onCaptureReturned?.()
    return {
      status: 'captured',
      capturedAmount: session.captureAmount ?? input.amount,
      providerData: { captureMarker: input.sessionId },
    }
  },
  async refund(input) {
    await delay(readSession(input.sessionId).maxDelayMs)
    return { status: 'refunded', refundId: `re_${input.sessionId}`, refundedAmount: input.amount ?? 0 }
  },
  async cancel(input) {
    await delay(readSession(input.sessionId).maxDelayMs)
    return { status: 'cancelled' }
  },
  async getStatus(input) {
    const session = readSession(input.sessionId)
    session.onPollStarted?.()
    if (session.pollGate) await session.pollGate
    await delay(session.maxDelayMs)
    return {
      status: session.pollStatus,
      amount: 100,
      amountReceived: 0,
      currencyCode: 'USD',
      providerData: { pollMarker: true },
    }
  },
  async verifyWebhook() {
    throw new Error('[internal] not used')
  },
  mapStatus(providerStatus) {
    return providerStatus as UnifiedPaymentStatus
  },
}

const integrationCredentialsService = { resolve: async () => ({}) }
const integrationLogService = {
  write: async () => undefined,
  scoped: () => ({ info: async () => undefined, warn: async () => undefined, error: async () => undefined }),
}

let orm: MikroORM

function buildService(em: EntityManager) {
  return createPaymentGatewayService({
    em,
    integrationCredentialsService: integrationCredentialsService as never,
    integrationLogService: integrationLogService as never,
  })
}

async function runPoller(organizationId: string): Promise<void> {
  const em = orm.em.fork() as unknown as EntityManager
  const service = buildService(em)
  await handleStatusPoll(
    { id: randomUUID(), payload: { scope: { organizationId, tenantId: TENANT_ID, providerKey: PROVIDER_KEY } } } as never,
    {
      resolve: <T,>(name: string): T => {
        if (name === 'paymentGatewayService') return service as T
        if (name === 'integrationLogService') return integrationLogService as T
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    } as never,
  )
}

async function deliverWebhook(
  transaction: { id: string; organizationId: string },
  status: UnifiedPaymentStatus,
  marker: string,
): Promise<void> {
  const em = orm.em.fork() as unknown as EntityManager
  const service = buildService(em)
  await processPaymentGatewayWebhookJob(
    { em, paymentGatewayService: service, integrationLogService: integrationLogService as never },
    markQueueJobOrigin({
      providerKey: PROVIDER_KEY,
      transactionId: transaction.id,
      scope: { organizationId: transaction.organizationId, tenantId: TENANT_ID },
      event: {
        eventType: `race.${status}`,
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        timestamp: new Date(),
        data: { status, [marker]: true },
      },
    }, 'inbound-webhook'),
  )
}

async function manualCapture(transaction: { id: string; organizationId: string }): Promise<void> {
  const service = buildService(orm.em.fork() as unknown as EntityManager)
  await service.capturePayment(transaction.id, undefined, { organizationId: transaction.organizationId, tenantId: TENANT_ID })
}

async function captureWithOperation(
  transaction: { id: string; organizationId: string },
  operationId: string,
  em: EntityManager = orm.em.fork() as unknown as EntityManager,
) {
  const service = buildService(em)
  return service.capturePayment(transaction.id, undefined, { organizationId: transaction.organizationId, tenantId: TENANT_ID }, operationId)
}

function failNextCompletion(em: EntityManager, session: ProviderSession): void {
  const original = em.transactional.bind(em)
  let providerReturned = false
  let failed = false
  session.onCaptureReturned = () => { providerReturned = true }
  em.transactional = (async (...args: Parameters<EntityManager['transactional']>) => {
    if (providerReturned && !failed) {
      failed = true
      throw new Error('[internal] simulated completion outage')
    }
    return original(...args)
  }) as EntityManager['transactional']
}

async function readOperations(transactionId: string): Promise<GatewayPaymentOperation[]> {
  return orm.em.fork().find(GatewayPaymentOperation, { transactionId })
}

async function manualCancel(transaction: { id: string; organizationId: string }): Promise<void> {
  const service = buildService(orm.em.fork() as unknown as EntityManager)
  await service.cancelPayment(transaction.id, undefined, { organizationId: transaction.organizationId, tenantId: TENANT_ID })
}

async function seedTransaction(status: UnifiedPaymentStatus, session: Partial<ProviderSession>) {
  const em = orm.em.fork()
  const organizationId = randomUUID()
  const providerSessionId = `sess_${randomUUID()}`
  sessions.set(providerSessionId, {
    pollStatus: 'captured',
    pollGate: null,
    onPollStarted: null,
    maxDelayMs: 0,
    captureAmount: null,
    captureGate: null,
    onCaptureStarted: null,
    onCaptureReturned: null,
    captureKeys: [],
    ...session,
  })
  const transaction = em.create(GatewayTransaction, {
    paymentId: randomUUID(),
    providerKey: PROVIDER_KEY,
    providerSessionId,
    unifiedStatus: status,
    amount: '100',
    capturedAmount: status === 'captured' ? '100' : '0',
    currencyCode: 'USD',
    gatewayMetadata: {},
    organizationId,
    tenantId: TENANT_ID,
    deletedAt: null,
  })
  await em.persist(transaction).flush()
  return { id: transaction.id, organizationId, providerSessionId }
}

async function readTransaction(id: string): Promise<GatewayTransaction> {
  const em = orm.em.fork()
  const row = await em.findOneOrFail(GatewayTransaction, { id })
  return row
}

function eventsFor(transactionId: string): string[] {
  return emitted.filter((event) => event.transactionId === transactionId).map((event) => event.id.replace('payment_gateways.payment.', ''))
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describeWithDatabase('payment gateway status poll vs concurrent writers (real Postgres)', () => {
  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: DATABASE_URL,
      entities: [GatewayTransaction, GatewayPaymentOperation, GatewaySessionInitialization, WebhookProcessedEvent],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: POOL_MAX },
    })
    await orm.schema.refresh()
    registerGatewayAdapter(raceAdapter)
    setGlobalEventBus({
      emit: async (id: string, payload: unknown) => {
        const transactionId = (payload as { transactionId?: string } | null)?.transactionId
        if (transactionId) emitted.push({ id, transactionId })
      },
    })
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  describe('deterministic interleavings', () => {
    it('poll that read authorized does not overwrite a partial refund committed by webhooks', async () => {
      const gate = deferred()
      const started = deferred()
      const txn = await seedTransaction('authorized', { pollStatus: 'captured', pollGate: gate.promise, onPollStarted: started.resolve })
      const poll = runPoller(txn.organizationId)
      await started.promise
      await deliverWebhook(txn, 'captured', 'captureWebhookMarker')
      await deliverWebhook(txn, 'partially_refunded', 'refundWebhookMarker')
      gate.resolve()
      await poll
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('partially_refunded')
      expect(row.gatewayMetadata).toEqual(expect.objectContaining({ refundWebhookMarker: true }))
      expect(eventsFor(txn.id)).toEqual(['captured'])
    })

    it('poll that read authorized does not overwrite a full refund committed by webhooks', async () => {
      const gate = deferred()
      const started = deferred()
      const txn = await seedTransaction('authorized', { pollStatus: 'captured', pollGate: gate.promise, onPollStarted: started.resolve })
      const poll = runPoller(txn.organizationId)
      await started.promise
      await deliverWebhook(txn, 'captured', 'captureWebhookMarker')
      await deliverWebhook(txn, 'refunded', 'refundWebhookMarker')
      gate.resolve()
      await poll
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('refunded')
      expect(eventsFor(txn.id)).toEqual(['captured', 'refunded'])
    })

    it('poll and a manual capture of the same authorization emit captured once', async () => {
      const gate = deferred()
      const started = deferred()
      const txn = await seedTransaction('authorized', { pollStatus: 'captured', pollGate: gate.promise, onPollStarted: started.resolve })
      const poll = runPoller(txn.organizationId)
      await started.promise
      await manualCapture(txn)
      gate.resolve()
      await poll
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('captured')
      expect(row.capturedAmount).toBe('100.0000')
      expect(eventsFor(txn.id)).toEqual(['captured'])
    })

    it('two polls of the same authorization emit captured once', async () => {
      const gate = deferred()
      let startedCount = 0
      const bothStarted = deferred()
      const txn = await seedTransaction('authorized', {
        pollStatus: 'captured',
        pollGate: gate.promise,
        onPollStarted: () => {
          startedCount += 1
          if (startedCount === 2) bothStarted.resolve()
        },
      })
      const polls = Promise.all([runPoller(txn.organizationId), runPoller(txn.organizationId)])
      await bothStarted.promise
      gate.resolve()
      await polls
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('captured')
      expect(eventsFor(txn.id)).toEqual(['captured'])
    })

    it('poll that read authorized does not re-announce a cancellation already committed', async () => {
      const gate = deferred()
      const started = deferred()
      const txn = await seedTransaction('authorized', { pollStatus: 'cancelled', pollGate: gate.promise, onPollStarted: started.resolve })
      const poll = runPoller(txn.organizationId)
      await started.promise
      await manualCancel(txn)
      gate.resolve()
      await poll
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('cancelled')
      expect(eventsFor(txn.id)).toEqual(['cancelled'])
    })

    it('manual capture settles the ledger to what the provider actually captured', async () => {
      const txn = await seedTransaction('authorized', { captureAmount: 90 })
      await manualCapture(txn)
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('captured')
      expect(row.capturedAmount).toBe('90.0000')
      expect(eventsFor(txn.id)).toEqual(['captured'])
    })

    it('manual capture completes without overriding a cancellation committed while the provider captured', async () => {
      const gate = deferred()
      const started = deferred()
      const txn = await seedTransaction('authorized', { captureGate: gate.promise, onCaptureStarted: started.resolve })
      const capture = manualCapture(txn)
      await started.promise
      await deliverWebhook(txn, 'cancelled', 'cancelWebhookMarker')
      gate.resolve()
      await capture
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('cancelled')
      expect(row.capturedAmount).toBe('100.0000')
      expect(row.gatewayMetadata).toEqual(expect.objectContaining({ cancelWebhookMarker: true }))
      expect(eventsFor(txn.id)).toEqual(['cancelled'])
      const operations = await orm.em.fork().find(GatewayPaymentOperation, { transactionId: txn.id })
      expect(operations.map((operation) => operation.status)).toEqual(['succeeded'])
    })

    it('replays a capture completed across a concurrent cancellation from a fresh entity manager', async () => {
      const gate = deferred()
      const started = deferred()
      const txn = await seedTransaction('authorized', {
        captureAmount: 100,
        captureGate: gate.promise,
        onCaptureStarted: started.resolve,
      })
      const capture = captureWithOperation(txn, 'capture-across-cancel')
      await started.promise
      await deliverWebhook(txn, 'cancelled', 'cancelWebhookMarker')
      gate.resolve()
      const first = await capture
      const replay = await captureWithOperation(txn, 'capture-across-cancel')
      expect(first).toMatchObject({ status: 'captured', capturedAmount: 100 })
      expect(replay).toEqual(first)
      expect(readSession(txn.providerSessionId).captureKeys).toHaveLength(1)
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('cancelled')
      expect(row.capturedAmount).toBe('100.0000')
      expect(eventsFor(txn.id)).toEqual(['cancelled'])
      const operations = await readOperations(txn.id)
      expect(operations.map((operation) => [operation.operationId, operation.status, operation.attemptCount]))
        .toEqual([['capture-across-cancel', 'succeeded', 1]])
    })

    it('retries a capture whose completion failed with one provider effect and a consistent ledger', async () => {
      const txn = await seedTransaction('authorized', {})
      const session = readSession(txn.providerSessionId)
      const failingEm = orm.em.fork() as unknown as EntityManager
      failNextCompletion(failingEm, session)
      await expect(captureWithOperation(txn, 'capture-completion-retry', failingEm))
        .rejects.toThrow('simulated completion outage')
      const afterFailure = await readTransaction(txn.id)
      expect(afterFailure.unifiedStatus).toBe('authorized')
      expect(afterFailure.capturedAmount).toBe('100.0000')
      expect((await readOperations(txn.id)).map((operation) => [operation.status, operation.reservedAmount]))
        .toEqual([['failed', '100.0000']])

      const retried = await captureWithOperation(txn, 'capture-completion-retry')
      const replay = await captureWithOperation(txn, 'capture-completion-retry')
      expect(retried).toMatchObject({ status: 'captured', capturedAmount: 100 })
      expect(replay).toEqual(retried)
      expect(session.captureKeys).toHaveLength(2)
      expect(new Set(session.captureKeys).size).toBe(1)
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('captured')
      expect(row.capturedAmount).toBe('100.0000')
      expect(eventsFor(txn.id)).toEqual(['captured'])
      expect((await readOperations(txn.id)).map((operation) => [operation.status, operation.attemptCount]))
        .toEqual([['succeeded', 2]])
    })

    it('settles a retried capture after a cancellation committed between the failed completion and the retry', async () => {
      const txn = await seedTransaction('authorized', {})
      const session = readSession(txn.providerSessionId)
      const failingEm = orm.em.fork() as unknown as EntityManager
      failNextCompletion(failingEm, session)
      await expect(captureWithOperation(txn, 'capture-retry-after-cancel', failingEm))
        .rejects.toThrow('simulated completion outage')
      await deliverWebhook(txn, 'cancelled', 'cancelWebhookMarker')

      const retried = await captureWithOperation(txn, 'capture-retry-after-cancel')
      const replay = await captureWithOperation(txn, 'capture-retry-after-cancel')
      expect(retried).toMatchObject({ status: 'captured', capturedAmount: 100 })
      expect(replay).toEqual(retried)
      expect(new Set(session.captureKeys).size).toBe(1)
      const row = await readTransaction(txn.id)
      expect(row.unifiedStatus).toBe('cancelled')
      expect(row.capturedAmount).toBe('100.0000')
      expect(row.gatewayMetadata).toEqual(expect.objectContaining({ cancelWebhookMarker: true }))
      expect(eventsFor(txn.id)).toEqual(['cancelled'])
      expect((await readOperations(txn.id)).map((operation) => [operation.status, operation.attemptCount]))
        .toEqual([['succeeded', 2]])
    })
  })

  describe('jittered races', () => {
    type Category = {
      name: string
      initial: UnifiedPaymentStatus
      pollStatus: UnifiedPaymentStatus
      writers: (txn: { id: string; organizationId: string }) => Array<() => Promise<void>>
      expectedStatus: UnifiedPaymentStatus
      expectedEvents: string[]
      requiredMetadata?: string
    }

    const sequential = (...steps: Array<() => Promise<void>>) => async () => {
      for (const step of steps) {
        await delay(5)
        await step()
      }
    }

    const categories: Category[] = [
      {
        name: 'poll vs partial refund',
        initial: 'authorized',
        pollStatus: 'captured',
        writers: (txn) => [sequential(
          () => deliverWebhook(txn, 'captured', 'captureWebhookMarker'),
          () => deliverWebhook(txn, 'partially_refunded', 'refundWebhookMarker'),
        )],
        expectedStatus: 'partially_refunded',
        expectedEvents: ['captured'],
        requiredMetadata: 'refundWebhookMarker',
      },
      {
        name: 'poll vs full refund',
        initial: 'authorized',
        pollStatus: 'captured',
        writers: (txn) => [sequential(
          () => deliverWebhook(txn, 'captured', 'captureWebhookMarker'),
          () => deliverWebhook(txn, 'refunded', 'refundWebhookMarker'),
        )],
        expectedStatus: 'refunded',
        expectedEvents: ['captured', 'refunded'],
        requiredMetadata: 'refundWebhookMarker',
      },
      {
        name: 'poll vs capture',
        initial: 'authorized',
        pollStatus: 'captured',
        writers: (txn) => [() => manualCapture(txn)],
        expectedStatus: 'captured',
        expectedEvents: ['captured'],
      },
      {
        name: 'poll vs poll',
        initial: 'authorized',
        pollStatus: 'captured',
        writers: (txn) => [() => runPoller(txn.organizationId)],
        expectedStatus: 'captured',
        expectedEvents: ['captured'],
      },
      {
        name: 'poll vs cancel',
        initial: 'authorized',
        pollStatus: 'cancelled',
        writers: (txn) => [() => manualCancel(txn)],
        expectedStatus: 'cancelled',
        expectedEvents: ['cancelled'],
      },
    ]

    type RoundOutcome = { problems: string[]; kinds: string[] }

    async function runRound(category: Category): Promise<RoundOutcome> {
      const txn = await seedTransaction(category.initial, { pollStatus: category.pollStatus, maxDelayMs: 12 })
      const actors = [() => runPoller(txn.organizationId), ...category.writers(txn)]
      const results = await Promise.allSettled(actors.map(async (actor) => {
        await delay(10)
        await actor()
      }))
      const row = await readTransaction(txn.id)
      const events = eventsFor(txn.id)
      const problems: string[] = []
      const kinds: string[] = []
      for (const result of results) {
        if (result.status === 'rejected') {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
          if (!/Cannot (capture|cancel) a payment in status|not a valid transition|already fully captured|changed while the capture amount/.test(message)) {
            problems.push(`error: ${message}`)
            kinds.push('unexpected error')
          }
        }
      }
      if (row.unifiedStatus !== category.expectedStatus) {
        problems.push(`status ${row.unifiedStatus}`)
        kinds.push('status lost update')
      }
      if (JSON.stringify(events) !== JSON.stringify(category.expectedEvents)) {
        problems.push(`events ${events.join(',')}`)
        kinds.push('duplicate or stale event')
      }
      if (category.requiredMetadata && row.gatewayMetadata?.[category.requiredMetadata] !== true) {
        problems.push(`metadata lost ${category.requiredMetadata}`)
        kinds.push('metadata lost update')
      }
      if (['captured', 'refunded', 'partially_refunded'].includes(row.unifiedStatus) && row.capturedAmount !== '100.0000') {
        problems.push(`capturedAmount ${row.capturedAmount}`)
        kinds.push('captured amount drift')
      }
      return { problems, kinds }
    }

    type Summary = { category: string; rounds: number; violations: number; kinds: Record<string, number>; examples: string[] }
    const summary: Summary[] = []

    function record(name: string, outcomes: RoundOutcome[]): string[] {
      const violations: string[] = []
      const kinds: Record<string, number> = {}
      outcomes.forEach((outcome, round) => {
        if (outcome.problems.length === 0) return
        violations.push(`round ${round}: ${outcome.problems.join('; ')}`)
        for (const kind of new Set(outcome.kinds)) kinds[kind] = (kinds[kind] ?? 0) + 1
      })
      summary.push({ category: name, rounds: outcomes.length, violations: violations.length, kinds, examples: violations.slice(0, 3) })
      return violations
    }

    afterAll(() => {
      process.stdout.write(`RACE_SUMMARY ${JSON.stringify(summary)}\n`)
    })

    for (const category of categories) {
      it(`${category.name}: ${ROUNDS} rounds without a lost update or duplicate event`, async () => {
        const outcomes: RoundOutcome[] = []
        for (let round = 0; round < ROUNDS; round += 1) outcomes.push(await runRound(category))
        expect(record(category.name, outcomes)).toEqual([])
      }, 600_000)
    }

    it(`all categories on distinct transactions, ${PARALLEL} rounds at a time (pool ${POOL_MAX})`, async () => {
      const outcomes: RoundOutcome[] = []
      const total = ROUNDS
      for (let offset = 0; offset < total; offset += PARALLEL) {
        const batch = Array.from({ length: Math.min(PARALLEL, total - offset) }, (_, index) => categories[(offset + index) % categories.length])
        outcomes.push(...await Promise.all(batch.map((category) => runRound(category))))
      }
      expect(record('parallel distinct transactions', outcomes)).toEqual([])
    }, 600_000)
  })
})
