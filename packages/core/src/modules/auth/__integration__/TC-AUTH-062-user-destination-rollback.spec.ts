import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { createUserDestinationFixture } from './helpers/userDestinationFixtures';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('TC-AUTH-062: atomic user destination reconciliation', () => {
  test('rolls back the destination when role synchronization fails', async ({ request }) => {
    const fixture = await createUserDestinationFixture(request, 'AUTH-062');
    const suffix = `${Date.now()}_${randomInt(1_000_000)}`;
    const functionName = `om_test_fail_user_role_${suffix}`;
    const triggerName = `om_test_fail_user_role_trigger_${suffix}`;

    try {
      const targetUserId = await fixture.createUser({ emailPrefix: 'target' });
      const assignableRoleId = await fixture.createRole({ namePrefix: 'assignable' });
      if (!UUID_RE.test(targetUserId)) throw new Error('[internal] Target user fixture id is not a UUID');

      await withClient(async (client) => {
        await client.query(
          `create function "${functionName}"() returns trigger language plpgsql as $$
           begin
             raise exception 'injected user role synchronization failure';
           end
           $$`,
        );
        await client.query(
          `create trigger "${triggerName}"
           before insert on user_roles
           for each row when (new.user_id = '${targetUserId}'::uuid)
           execute function "${functionName}"()`,
        );
      });

      const response = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: fixture.actorToken,
        data: {
          id: targetUserId,
          organizationId: fixture.childOrganizationId,
          roles: [assignableRoleId],
        },
      });
      expect(response.status(), 'injected role synchronization failure should reject the update').toBeGreaterThanOrEqual(500);

      const persisted = await withClient(async (client) => {
        const userResult = await client.query<{ organization_id: string | null }>(
          'select organization_id from users where id = $1',
          [targetUserId],
        );
        const roleResult = await client.query<{ count: string }>(
          'select count(*)::text as count from user_roles where user_id = $1 and deleted_at is null',
          [targetUserId],
        );
        return {
          organizationId: userResult.rows[0]?.organization_id ?? null,
          roleCount: Number(roleResult.rows[0]?.count ?? '0'),
        };
      });
      expect(persisted.organizationId, 'failed role synchronization must roll back the organization move').toBe(
        fixture.parentOrganizationId,
      );
      expect(persisted.roleCount, 'failed role synchronization must not retain a partial role link').toBe(0);
    } finally {
      await withClient(async (client) => {
        await client.query(`drop trigger if exists "${triggerName}" on user_roles`);
        await client.query(`drop function if exists "${functionName}"()`);
      }).catch(() => undefined);
      await fixture.cleanup();
    }
  });
});
