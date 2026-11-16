import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { expect, test } from '@playwright/test'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  PAYMENT_SESSION_REPLAY_WINDOW_MS,
  pruneCompletedPaymentSessionInitializations,
  pruneExpiredPaymentSessionInitializations,
} from '@open-mercato/core/modules/payment_gateways/lib/session-idempotency'
import { Migration20261018180000_payment_gateways as RetentionMigration } from '../migrations/Migration20261018180000_payment_gateways'

type ClaimFixture = {
  id: string
  operationKey: string
  tenantId: string
  organizationId: string
  updatedAt: Date
  createdAt?: Date
  gatewayTransactionId: string | null
  claimToken?: string | null
  claimedAt?: Date | null
}

function makeEntityManager(client: IntegrationDbClient): EntityManager {
  return {
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        let position = 0
        const pgSql = sql.replace(/\?/g, () => `$${++position}`)
        const result = await client.query(pgSql, params)
        return { affectedRows: result.rowCount ?? 0 }
      },
    }),
  } as unknown as EntityManager
}

async function insertClaim(client: IntegrationDbClient, fixture: ClaimFixture): Promise<void> {
  await client.query(
    `insert into gateway_session_initializations
      (id, operation_key, provider_key, claim_token, claimed_at, gateway_transaction_id,
       organization_id, tenant_id, created_at, updated_at)
     values ($1, $2, 'tc-pgwy-024', $3, $4, $5, $6, $7, $8, $9)`,
    [
      fixture.id,
      fixture.operationKey,
      fixture.claimToken ?? null,
      fixture.claimedAt ?? null,
      fixture.gatewayTransactionId,
      fixture.organizationId,
      fixture.tenantId,
      fixture.createdAt ?? fixture.updatedAt,
      fixture.updatedAt,
    ],
  )
}

function makeClaim(
  scope: { tenantId: string; organizationId: string },
  updatedAt: Date,
  overrides: Partial<ClaimFixture> = {},
): ClaimFixture {
  return {
    id: randomUUID(),
    operationKey: `retention-${randomUUID()}`,
    ...scope,
    updatedAt,
    gatewayTransactionId: null,
    ...overrides,
  }
}

async function withClaims(
  fixtures: ClaimFixture[],
  run: (client: IntegrationDbClient) => Promise<void>,
): Promise<void> {
  await withClient(async (client) => {
    try {
      for (const fixture of fixtures) await insertClaim(client, fixture)
      await run(client)
    } finally {
      await client.query('delete from gateway_session_initializations where id = any($1::uuid[])', [fixtures.map((fixture) => fixture.id)])
    }
  })
}

async function remainingIds(client: IntegrationDbClient, fixtures: ClaimFixture[]): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    'select id from gateway_session_initializations where id = any($1::uuid[]) order by id',
    [fixtures.map((fixture) => fixture.id)],
  )
  return result.rows.map((row) => row.id)
}

test.describe('TC-PGWY-024: payment-session initialization retention', () => {
  test('prunes only completed scoped claims strictly beyond the replay window', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const now = new Date('2026-08-02T12:00:00.000Z')
    const cutoff = new Date(now.getTime() - PAYMENT_SESSION_REPLAY_WINDOW_MS)
    const otherOrganizationId = randomUUID()
    const fixtures: ClaimFixture[] = [
      {
        id: randomUUID(),
        operationKey: `expired-completed-${randomUUID()}`,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        updatedAt: new Date(cutoff.getTime() - 1),
        gatewayTransactionId: randomUUID(),
      },
      {
        id: randomUUID(),
        operationKey: `boundary-completed-${randomUUID()}`,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        updatedAt: cutoff,
        gatewayTransactionId: randomUUID(),
      },
      {
        id: randomUUID(),
        operationKey: `inside-completed-${randomUUID()}`,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        updatedAt: new Date(cutoff.getTime() + 1),
        gatewayTransactionId: randomUUID(),
      },
      {
        id: randomUUID(),
        operationKey: `old-active-${randomUUID()}`,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        updatedAt: new Date(cutoff.getTime() - 1),
        gatewayTransactionId: null,
        claimToken: randomUUID(),
        claimedAt: new Date(cutoff.getTime() - 1),
      },
      {
        id: randomUUID(),
        operationKey: `old-released-${randomUUID()}`,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        updatedAt: new Date(cutoff.getTime() - 1),
        gatewayTransactionId: null,
      },
      {
        id: randomUUID(),
        operationKey: `other-scope-${randomUUID()}`,
        tenantId: scope.tenantId,
        organizationId: otherOrganizationId,
        updatedAt: new Date(cutoff.getTime() - 1),
        gatewayTransactionId: randomUUID(),
      },
    ]

    await withClient(async (client) => {
      try {
        for (const fixture of fixtures) await insertClaim(client, fixture)

        const deleted = await pruneCompletedPaymentSessionInitializations(
          makeEntityManager(client),
          scope,
          { now, batchSize: 100 },
        )
        const remaining = await client.query<{ id: string }>(
          'select id from gateway_session_initializations where id = any($1::uuid[])',
          [fixtures.map((fixture) => fixture.id)],
        )
        const remainingIds = new Set(remaining.rows.map((row) => row.id))

        expect(deleted).toBe(1)
        expect(remainingIds.has(fixtures[0].id)).toBe(false)
        for (const fixture of fixtures.slice(1)) expect(remainingIds.has(fixture.id)).toBe(true)
      } finally {
        await client.query(
          'delete from gateway_session_initializations where id = any($1::uuid[])',
          [fixtures.map((fixture) => fixture.id)],
        )
      }
    })
  })

  test('expires completed, released and abandoned claims while preserving live, malformed and foreign claims', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const now = new Date('2026-08-02T12:00:00.000Z')
    const cutoff = new Date(now.getTime() - PAYMENT_SESSION_REPLAY_WINDOW_MS)
    const expired = new Date(cutoff.getTime() - 1)
    const eligible = [
      makeClaim(scope, expired, { gatewayTransactionId: randomUUID() }),
      makeClaim(scope, expired),
      makeClaim(scope, expired, { claimToken: randomUUID(), claimedAt: expired }),
    ]
    const protectedClaims = [
      makeClaim(scope, cutoff, { gatewayTransactionId: randomUUID() }),
      makeClaim(scope, cutoff),
      makeClaim(scope, cutoff, { claimToken: randomUUID(), claimedAt: expired }),
      makeClaim(scope, expired, { claimToken: randomUUID(), claimedAt: cutoff }),
      makeClaim(scope, expired, { claimToken: randomUUID(), claimedAt: now }),
      makeClaim(scope, now, { createdAt: expired, claimToken: randomUUID(), claimedAt: now }),
      makeClaim(scope, now, { createdAt: expired, gatewayTransactionId: randomUUID() }),
      makeClaim(scope, expired, { claimToken: randomUUID(), claimedAt: null }),
      makeClaim(scope, expired, { claimToken: null, claimedAt: expired }),
      makeClaim({ ...scope, organizationId: randomUUID() }, expired),
      makeClaim({ ...scope, tenantId: randomUUID() }, expired),
    ]

    await withClaims([...eligible, ...protectedClaims], async (client) => {
      expect(await pruneExpiredPaymentSessionInitializations(makeEntityManager(client), scope, { now })).toBe(3)
      expect(await remainingIds(client, [...eligible, ...protectedClaims])).toEqual(protectedClaims.map((fixture) => fixture.id).sort())
    })
  })

  test('drains mixed expired states in bounded oldest-first batches', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const now = new Date('2026-08-02T12:00:00.000Z')
    const cutoff = new Date(now.getTime() - PAYMENT_SESSION_REPLAY_WINDOW_MS)
    const fixtures = Array.from({ length: 7 }, (_, index) => {
      const expired = new Date(cutoff.getTime() - 10 + index)
      return makeClaim(scope, expired, index % 3 === 0
        ? { gatewayTransactionId: randomUUID() }
        : index % 3 === 1 ? {} : { claimToken: randomUUID(), claimedAt: expired })
    })

    await withClaims(fixtures, async (client) => {
      const counts: number[] = []
      for (let batch = 0; batch < 5; batch += 1) {
        counts.push(await pruneExpiredPaymentSessionInitializations(makeEntityManager(client), scope, { now, batchSize: 2 }))
        expect(await remainingIds(client, fixtures)).toEqual(fixtures.slice(Math.min((batch + 1) * 2, fixtures.length)).map((fixture) => fixture.id).sort())
      }
      expect(counts).toEqual([2, 2, 2, 1, 0])
    })
  })

  for (const mutation of ['heartbeat', 'reclaim', 'finalization'] as const) {
    test(`skips a transaction-held ${mutation} and preserves its committed claim`, async () => {
      const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
      const now = new Date('2026-08-02T12:00:00.000Z')
      const expired = new Date(now.getTime() - PAYMENT_SESSION_REPLAY_WINDOW_MS - 1)
      const locked = makeClaim(scope, expired, { claimToken: randomUUID(), claimedAt: expired })
      const unlocked = makeClaim(scope, expired)

      await withClaims([locked, unlocked], async (pruner) => {
        await pruner.query("set statement_timeout = '2s'")
        await withClient(async (writer) => {
          await writer.query('begin')
          try {
            const claimToken = mutation === 'reclaim' ? randomUUID() : mutation === 'finalization' ? null : locked.claimToken
            const transactionId = mutation === 'finalization' ? randomUUID() : null
            const changed = await writer.query(
              `update gateway_session_initializations
               set claim_token = $2, claimed_at = $3, gateway_transaction_id = $4, updated_at = $5
               where id = $1 and claim_token = $6 and gateway_transaction_id is null
                 and tenant_id = $7 and organization_id = $8`,
              [locked.id, claimToken, mutation === 'finalization' ? null : now, transactionId, now, locked.claimToken, scope.tenantId, scope.organizationId],
            )
            expect(changed.rowCount).toBe(1)
            expect(await pruneExpiredPaymentSessionInitializations(makeEntityManager(pruner), scope, { now, batchSize: 2 })).toBe(1)
            expect(await remainingIds(pruner, [locked, unlocked])).toEqual([locked.id])
            await writer.query('commit')
            expect(await pruneExpiredPaymentSessionInitializations(makeEntityManager(pruner), scope, { now })).toBe(0)
            const persisted = await pruner.query<{ claim_token: string | null; gateway_transaction_id: string | null; updated_at: Date }>(
              'select claim_token, gateway_transaction_id, updated_at from gateway_session_initializations where id = $1',
              [locked.id],
            )
            expect(persisted.rows).toEqual([{ claim_token: claimToken, gateway_transaction_id: transactionId, updated_at: now }])
          } finally {
            await writer.query('rollback')
          }
        })
      })
    })
  }

  test('prevents a pruned owner from finalizing and permits a fresh claim for the same operation', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const now = new Date('2026-08-02T12:00:00.000Z')
    const expired = new Date(now.getTime() - PAYMENT_SESSION_REPLAY_WINDOW_MS - 1)
    const stale = makeClaim(scope, expired, { claimToken: randomUUID(), claimedAt: expired })
    const retry = makeClaim(scope, now, { operationKey: stale.operationKey, claimToken: randomUUID(), claimedAt: now })

    await withClaims([stale], async (client) => {
      try {
        expect(await pruneExpiredPaymentSessionInitializations(makeEntityManager(client), scope, { now })).toBe(1)
        const finalized = await client.query(
          `update gateway_session_initializations
           set gateway_transaction_id = $2, claim_token = null, claimed_at = null, updated_at = $3
           where id = $1 and claim_token = $4 and gateway_transaction_id is null
             and tenant_id = $5 and organization_id = $6`,
          [stale.id, randomUUID(), now, stale.claimToken, scope.tenantId, scope.organizationId],
        )
        expect(finalized.rowCount).toBe(0)
        await insertClaim(client, retry)
        expect(await pruneExpiredPaymentSessionInitializations(makeEntityManager(client), scope, { now })).toBe(0)
        expect(await remainingIds(client, [stale, retry])).toEqual([retry.id])
      } finally {
        await client.query('delete from gateway_session_initializations where id = $1', [retry.id])
      }
    })
  })

  test('uses the scoped retention index and recovers an invalid concurrent index during migration retry', async () => {
    await withClient(async (client) => {
      const index = await client.query<{ indisvalid: boolean; definition: string }>(
        `select index.indisvalid, pg_get_indexdef(index.indexrelid) as definition
         from pg_index as index where index.indexrelid = to_regclass('gateway_session_initializations_retention_idx')`,
      )
      expect(index.rows).toHaveLength(1)
      expect(index.rows[0].indisvalid).toBe(true)
      expect(index.rows[0].definition).toContain('(tenant_id, organization_id, updated_at, id)')
      await client.query('begin')
      try {
        await client.query('set local enable_seqscan = off')
        const plan = await client.query<{ 'QUERY PLAN': unknown }>(
          `explain (format json) select id from gateway_session_initializations
           where tenant_id = $1 and organization_id = $2 and updated_at < $3
             and gateway_transaction_id is null and claim_token is null and claimed_at is null
           order by updated_at, id limit 10 for update skip locked`,
          [randomUUID(), randomUUID(), new Date('2026-08-01T12:00:00.000Z')],
        )
        expect(JSON.stringify(plan.rows)).toContain('gateway_session_initializations_retention_idx')
      } finally {
        await client.query('rollback')
      }

      const schema = `pgwy_retention_${randomUUID().replace(/-/g, '')}`
      const previousPath = await client.query<{ search_path: string }>('show search_path')
      const migration = new RetentionMigration(
        {} as ConstructorParameters<typeof RetentionMigration>[0],
        {} as ConstructorParameters<typeof RetentionMigration>[1],
      )
      const executeMigration = async (direction: 'up' | 'down') => {
        migration.reset()
        await migration[direction]()
        for (const sql of migration.getQueries()) {
          expect(typeof sql).toBe('string')
          await client.query(String(sql))
        }
      }
      const readIndex = () => client.query<{ indisvalid: boolean }>(
        `select index.indisvalid from pg_index as index
         where index.indexrelid = to_regclass('gateway_session_initializations_retention_idx')`,
      )

      try {
        await client.query(`create schema "${schema}"`)
        await client.query(`create table "${schema}".gateway_session_initializations (like gateway_session_initializations including all)`)
        await client.query("select set_config('search_path', $1, false)", [schema])
        const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
        const updatedAt = new Date('2026-08-01T12:00:00.000Z')
        await insertClaim(client, makeClaim(scope, updatedAt))
        await insertClaim(client, makeClaim(scope, updatedAt))
        await expect(client.query(
          'create unique index concurrently gateway_session_initializations_retention_idx on gateway_session_initializations(provider_key)',
        )).rejects.toMatchObject({ code: '23505' })
        expect((await readIndex()).rows).toEqual([{ indisvalid: false }])
        expect(migration.isTransactional()).toBe(false)
        await executeMigration('up')
        expect((await readIndex()).rows).toEqual([{ indisvalid: true }])
        await executeMigration('down')
        expect((await readIndex()).rows).toEqual([])
        await executeMigration('up')
        expect((await readIndex()).rows).toEqual([{ indisvalid: true }])
      } finally {
        await client.query("select set_config('search_path', $1, false)", [previousPath.rows[0].search_path])
        await client.query(`drop schema if exists "${schema}" cascade`)
      }
    })
  })
})
