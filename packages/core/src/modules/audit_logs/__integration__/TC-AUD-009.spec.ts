import { expect, test } from '@playwright/test'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

type StoredActionLog = {
  changes_json: unknown
  command_payload: unknown
  context_json: unknown
  snapshot_after: unknown
  snapshot_before: unknown
  undo_token: string | null
}

/**
 * TC-AUD-009: Credential-bearing commands never persist raw secrets
 * Source: .ai/specs/2026-08-20-command-audit-sensitive-data-redaction.md
 *
 * The user-create API executes `auth.users.create` through the real command bus.
 * The assertion reads the resulting row directly from Postgres so response
 * shaping and audit-log decryption cannot hide a plaintext persistence bug.
 */
test.describe('TC-AUD-009: credential-safe command persistence', () => {
  test('stores no raw password and disables replay for user creation', async ({ request }) => {
    const stamp = Date.now()
    const password = `Aud009!${stamp}Secret`
    const email = `qa-aud-009-${stamp}@example.com`
    let adminToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenScope(adminToken)
      roleId = await createRoleFixture(request, adminToken, {
        name: `QA TC-AUD-009 ${stamp}`,
        tenantId: scope.tenantId,
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        name: 'QA TC-AUD-009 User',
        organizationId: scope.organizationId,
        password,
        roles: [roleId],
      })

      const stored = await withClient(async (client) => {
        const result = await client.query<StoredActionLog>(
          `select undo_token, command_payload, snapshot_before, snapshot_after, changes_json, context_json
             from action_logs
            where resource_id = $1
              and deleted_at is null
            order by created_at desc
            limit 1`,
          [userId],
        )
        return result.rows[0] ?? null
      })

      expect(stored, 'the user-create action log should exist').not.toBeNull()
      expect(stored!.undo_token, 'credential-bearing history must not expose undo').toBeNull()
      const persisted = JSON.stringify(stored)
      expect(persisted, 'the exact submitted password must not reach Postgres').not.toContain(password)
      expect(persisted, 'the password field name must not retain a replayable value').not.toContain(`"password":"${password}"`)
      if (stored!.command_payload && typeof stored!.command_payload === 'object') {
        expect(stored!.command_payload).toEqual(expect.objectContaining({
          __redoUnavailable: 'sensitive-data-redacted',
        }))
        expect(stored!.command_payload).not.toHaveProperty('__redoInput')
      }
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      if (userId) {
        await withClient(async (client) => {
          await client.query('delete from action_logs where resource_id = $1', [userId])
        }).catch(() => undefined)
      }
    }
  })
})
