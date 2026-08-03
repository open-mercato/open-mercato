import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { expect, test } from '@playwright/test'
import type { Client } from 'pg'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import {
  PAYMENT_SESSION_REPLAY_WINDOW_MS,
  pruneCompletedPaymentSessionInitializations,
} from '@open-mercato/core/modules/payment_gateways/lib/session-idempotency'

type ClaimFixture = {
  id: string
  operationKey: string
  tenantId: string
  organizationId: string
  updatedAt: Date
  gatewayTransactionId: string | null
  claimToken?: string | null
  claimedAt?: Date | null
}

function makeEntityManager(client: Client): EntityManager {
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

async function insertClaim(client: Client, fixture: ClaimFixture): Promise<void> {
  await client.query(
    `insert into gateway_session_initializations
      (id, operation_key, provider_key, claim_token, claimed_at, gateway_transaction_id,
       organization_id, tenant_id, created_at, updated_at)
     values ($1, $2, 'tc-pgwy-024', $3, $4, $5, $6, $7, $8, $8)`,
    [
      fixture.id,
      fixture.operationKey,
      fixture.claimToken ?? null,
      fixture.claimedAt ?? null,
      fixture.gatewayTransactionId,
      fixture.organizationId,
      fixture.tenantId,
      fixture.updatedAt,
    ],
  )
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
})
