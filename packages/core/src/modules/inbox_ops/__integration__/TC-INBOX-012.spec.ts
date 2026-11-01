import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-INBOX-012: Completing an action externally claims it exactly once.
 *
 * PATCH /api/inbox_ops/proposals/{id}/actions/{actionId}/complete must move an
 * action out of pending/failed with a conditional write: when several
 * completions race on the same pending action, exactly one wins (200) and every
 * other request gets 409 "Action already processed" without overwriting the
 * winner's created entity link. Fixtures are seeded directly, so no extraction
 * provider is needed.
 */

const CONCURRENT_COMPLETIONS = 8
const ROUNDS = 3

type Scope = { tenantId: string; organizationId: string }

type Fixture = { emailId: string; proposalId: string; actionId: string }

async function seedPendingAction(scope: Scope, status: 'pending' | 'failed' = 'pending'): Promise<Fixture> {
  const fixture: Fixture = { emailId: randomUUID(), proposalId: randomUUID(), actionId: randomUUID() }
  await withClient(async (client) => {
    await client.query(
      `insert into inbox_emails
         (id, forwarded_by_address, to_address, subject, received_at, status, is_active, organization_id, tenant_id, created_at, updated_at)
       values ($1, 'sender@example.test', 'inbox@example.test', 'TC-INBOX-012 fixture', now(), 'processed', true, $2, $3, now(), now())`,
      [fixture.emailId, scope.organizationId, scope.tenantId],
    )
    await client.query(
      `insert into inbox_proposals
         (id, inbox_email_id, summary, participants, confidence, status, possibly_incomplete, is_active, organization_id, tenant_id, created_at, updated_at)
       values ($1, $2, 'TC-INBOX-012 proposal', '[]'::jsonb, 0.95, 'pending', false, true, $3, $4, now(), now())`,
      [fixture.proposalId, fixture.emailId, scope.organizationId, scope.tenantId],
    )
    await client.query(
      `insert into inbox_proposal_actions
         (id, proposal_id, sort_order, action_type, description, payload, status, confidence, is_active, organization_id, tenant_id, created_at, updated_at)
       values ($1, $2, 0, 'create_order', 'TC-INBOX-012 action', '{}'::jsonb, $3, 0.90, true, $4, $5, now() - interval '1 hour', now() - interval '1 hour')`,
      [fixture.actionId, fixture.proposalId, status, scope.organizationId, scope.tenantId],
    )
  })
  return fixture
}

async function deleteFixtures(fixtures: Fixture[]): Promise<void> {
  if (fixtures.length === 0) return
  await withClient(async (client) => {
    await client.query('delete from inbox_proposal_actions where id = any($1::uuid[])', [fixtures.map((item) => item.actionId)])
    await client.query('delete from inbox_proposals where id = any($1::uuid[])', [fixtures.map((item) => item.proposalId)])
    await client.query('delete from inbox_emails where id = any($1::uuid[])', [fixtures.map((item) => item.emailId)])
  })
}

type StoredAction = {
  status: string
  created_entity_id: string | null
  executed_by_user_id: string | null
  updated_at: Date
}

async function readAction(actionId: string): Promise<StoredAction> {
  return withClient(async (client) => {
    const result = await client.query<StoredAction>(
      'select status, created_entity_id, executed_by_user_id, updated_at from inbox_proposal_actions where id = $1',
      [actionId],
    )
    return result.rows[0]
  })
}

function completePath(fixture: Fixture): string {
  return `/api/inbox_ops/proposals/${fixture.proposalId}/actions/${fixture.actionId}/complete`
}

test.describe('TC-INBOX-012: complete action claims the transition exactly once', () => {
  test('a failed action can be completed externally', async ({ request }) => {
    const token = await getAuthToken(request)
    const scope = getTokenScope(token)
    const fixtures: Fixture[] = []
    try {
      const fixture = await seedPendingAction(scope, 'failed')
      fixtures.push(fixture)
      const createdEntityId = randomUUID()

      const response = await apiRequest(request, 'PATCH', completePath(fixture), {
        token,
        data: { createdEntityId, createdEntityType: 'sales_order' },
      })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ action?: { status?: string; createdEntityId?: string } }>(response)
      expect(body?.action?.status).toBe('executed')
      expect(body?.action?.createdEntityId).toBe(createdEntityId)

      const stored = await readAction(fixture.actionId)
      expect(stored.status).toBe('executed')
      expect(stored.created_entity_id).toBe(createdEntityId)
      expect(Date.now() - new Date(stored.updated_at).getTime()).toBeLessThan(10 * 60 * 1000)

      const repeat = await apiRequest(request, 'PATCH', completePath(fixture), {
        token,
        data: { createdEntityId: randomUUID(), createdEntityType: 'sales_order' },
      })
      expect(repeat.status()).toBe(409)
      expect((await readAction(fixture.actionId)).created_entity_id).toBe(createdEntityId)
    } finally {
      await deleteFixtures(fixtures)
    }
  })

  test('concurrent completions of one pending action produce one winner and 409s', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request)
    const scope = getTokenScope(token)
    const fixtures: Fixture[] = []
    try {
      for (let round = 0; round < ROUNDS; round += 1) {
        const fixture = await seedPendingAction(scope)
        fixtures.push(fixture)
        const candidateIds = Array.from({ length: CONCURRENT_COMPLETIONS }, () => randomUUID())

        const responses = await Promise.all(
          candidateIds.map((createdEntityId) =>
            apiRequest(request, 'PATCH', completePath(fixture), {
              token,
              data: { createdEntityId, createdEntityType: 'sales_order' },
              retryTransport: false,
            }),
          ),
        )

        const statuses = responses.map((response) => response.status())
        const winners = statuses.flatMap((status, index) => (status === 200 ? [candidateIds[index]] : []))
        expect(winners, `round ${round} statuses: ${statuses.join(',')}`).toHaveLength(1)
        expect(statuses.filter((status) => status === 409)).toHaveLength(CONCURRENT_COMPLETIONS - 1)
        for (const [index, response] of responses.entries()) {
          if (statuses[index] !== 409) continue
          const body = await readJsonSafe<{ error?: string }>(response)
          expect(body?.error).toBe('Action already processed')
        }

        const stored = await readAction(fixture.actionId)
        expect(stored.status).toBe('executed')
        expect(stored.created_entity_id).toBe(winners[0])
        expect(stored.executed_by_user_id).toBeTruthy()
        expect(stored.executed_by_user_id).toBe(scope.userId)
      }
    } finally {
      await deleteFixtures(fixtures)
    }
  })
})
