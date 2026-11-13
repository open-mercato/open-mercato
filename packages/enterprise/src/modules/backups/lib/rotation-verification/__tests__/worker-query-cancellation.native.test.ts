import { EntitySchema } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Worker } from 'node:worker_threads'
import { EncryptionMap, CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { getEntityIds, registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { createPostgresRotationDataset } from '../postgres-dataset'
import { fingerprintRows } from '../row-fingerprints'
import { RowHmacWorker } from '../row-hmac-worker'

class WorkerCancellationRecord {
  id!: string
  tenantId!: string
  organizationId?: string | null
  secret!: string
}
const recordSchema = new EntitySchema({
  class: WorkerCancellationRecord,
  tableName: 'worker_cancellation_records',
  properties: {
    id: { type: 'uuid', primary: true },
    tenantId: { type: 'uuid', fieldName: 'tenant_id' },
    organizationId: { type: 'uuid', fieldName: 'organization_id', nullable: true },
    secret: { type: 'text' },
  },
})
const native = process.env.OM_ROTATION_TEST_DATABASE_URL ? describe : describe.skip
const tenantId = '11111111-1111-4111-8111-111111111111'

native('native PostgreSQL cancellation after an idle checksum worker fails', () => {
  test('terminates the composed dataset query, joins cleanup and releases a pool-one connection within fifteen seconds', async () => {
    const previousEntityIds = getEntityIds(false)
    const database = `rotation_worker_cancel_${randomUUID().replaceAll('-', '')}`
    const base = new URL(process.env.OM_ROTATION_TEST_DATABASE_URL!)
    const administrator = new Client({ connectionString: base.toString() })
    let orm: MikroORM | undefined
    let observer: Client | undefined
    let thread: Worker | undefined
    let termination: Promise<number> | undefined
    let sourceReturned = false, querySettled = false, closeSettled = false, output = 0
    let digestFinished = false, delayed = false
    let observedSignal: AbortSignal | undefined
    let resultReady!: () => void
    let queryReady!: () => void
    const firstResult = new Promise<void>(resolve => { resultReady = resolve })
    const blockedQuery = new Promise<void>(resolve => { queryReady = resolve })
    const key = randomBytes(32), sourceKey = randomBytes(32).toString('base64'), targetKey = randomBytes(32).toString('base64')
    await administrator.connect()
    try {
      await administrator.query(`CREATE DATABASE "${database}" CONNECTION LIMIT 0`)
      await administrator.query(`ALTER DATABASE "${database}" SET statement_timeout=900000`)
      await administrator.query(`ALTER DATABASE "${database}" SET lock_timeout=30000`)
      base.pathname = `/${database}`
      orm = await MikroORM.init({ clientUrl: base.toString(), entities: [recordSchema, EncryptionMap, CustomFieldDef], pool: { min: 0, max: 1 } })
      await orm.schema.create()
      const em = orm.em.fork()
      await em.execute('INSERT INTO worker_cancellation_records SELECT gen_random_uuid(),?::uuid,NULL,? FROM generate_series(1,1600)', [tenantId, encryptWithAesGcm('generated fixture only', sourceKey).value])
      em.persist(em.create(EncryptionMap, { id: randomUUID(), entityId: 'test:worker_cancellation', tenantId, fieldsJson: [{ field: 'secret' }], isActive: true, createdAt: new Date(), updatedAt: new Date() }))
      await em.flush()
      registerEntityIds({ fixture: { WorkerCancellationRecord: 'test:worker_cancellation' } })
      const providerController = new AbortController()
      const dataset = await createPostgresRotationDataset({
        context: { tenantId, organizationId: null, dryRun: false, entityManager: em, previousKey: 'fixture' },
        providers: {
          signal: providerController.signal,
          previousKms: { isHealthy: () => true, getTenantDek: async () => ({ tenantId, key: sourceKey, fetchedAt: 0 }), createTenantDek: async () => null },
          kms: { isHealthy: () => true, getTenantDek: async () => ({ tenantId, key: targetKey, fetchedAt: 0 }), createTenantDek: async () => null },
        },
        provider: 'native-worker-cancellation-fixture', backupDigest: 'a'.repeat(64),
      })
      const originalExecute = em.execute.bind(em)
      const tag = 'rotation_worker_cancel_fixture'
      let submitted = false
      jest.spyOn(em, 'execute').mockImplementation((async (...parameters: Parameters<typeof em.execute>) => {
        const [sql, values, options] = parameters
        if (typeof sql === 'string' && sql.startsWith('WITH frontier') && submitted && !delayed) {
          delayed = true
          observedSignal = (options as { signal?: AbortSignal } | undefined)?.signal
          expect(options).toMatchObject({ inflightQueryAbortStrategy: 'cancel query' })
          const sleeping = originalExecute(`SELECT pg_sleep(30) /* ${tag} */`, [], options)
          void sleeping.catch(() => undefined)
          observer = new Client({ connectionString: base.toString() })
          await observer.connect()
          const deadline = Date.now() + 5000
          for (;;) {
            const active = await observer.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND state=\'active\' AND wait_event=\'PgSleep\' AND query LIKE $2', [database, `%${tag}%`])
            if (active.rows[0].count === 1) break
            if (Date.now() >= deadline) throw new Error('Fixture did not enter a native PostgreSQL sleep')
            await new Promise(resolve => setTimeout(resolve, 10))
          }
          queryReady()
          try { await sleeping } finally { querySettled = true }
        }
        return originalExecute(sql, values, options)
      }) as typeof em.execute)
      const digestBatch = RowHmacWorker.prototype.digestBatch
      jest.spyOn(RowHmacWorker.prototype, 'digestBatch').mockImplementation(function (this: RowHmacWorker, frames) {
        submitted = true
        thread ??= (this as unknown as { worker: Worker }).worker
        return digestBatch.call(this, frames).then(digests => { digestFinished = true; resultReady(); return digests })
      })
      const close = RowHmacWorker.prototype.close
      jest.spyOn(RowHmacWorker.prototype, 'close').mockImplementation(function (this: RowHmacWorker) {
        return close.call(this).finally(() => { closeSettled = true })
      })
      const producer = (signal: AbortSignal) => (async function* () {
        try { yield* dataset.rows('before', signal) } finally { sourceReturned = true }
      })()
      const began = Date.now()
      const consume = (async () => { for await (const _row of fingerprintRows(producer, key)) output++ })()
      void consume.catch(() => undefined)
      let fixtureTimer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.all([firstResult, blockedQuery]),
          new Promise<never>((_resolve, reject) => { fixtureTimer = setTimeout(() => reject(new Error('Fixture did not reach the completed-digest/in-flight-query boundary')), 5000) }),
        ])
      } finally { if (fixtureTimer) clearTimeout(fixtureTimer) }
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(digestFinished).toBe(true)
      termination = thread!.terminate()
      await expect(consume).rejects.toThrow('ROTATION_VERIFICATION_INCOMPLETE')
      await termination
      expect(sourceReturned).toBe(true)
      expect(querySettled).toBe(true)
      expect(closeSettled).toBe(true)
      expect(output).toBeLessThan(1600)
      expect(observedSignal?.aborted).toBe(true)
      expect(providerController.signal.aborted).toBe(false)
      await expect(originalExecute('SELECT 1 AS ready')).resolves.toEqual([{ ready: 1 }])
      const remaining = await observer!.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND state=\'active\' AND query LIKE $2', [database, `%${tag}%`])
      expect(remaining.rows[0].count).toBe(0)
      expect(Date.now() - began).toBeLessThan(15000)
    } finally {
      jest.restoreAllMocks()
      key.fill(0)
      await (termination ?? thread?.terminate())?.catch(() => undefined)
      await observer?.end()
      await orm?.close(true)
      registerEntityIds(previousEntityIds)
      await administrator.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
      await administrator.end()
    }
  }, 20000)
})
