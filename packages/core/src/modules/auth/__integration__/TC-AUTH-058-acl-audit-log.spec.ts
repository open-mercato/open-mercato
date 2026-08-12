import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-058 [P0]: ACL changes are recorded in the action log
 *
 * PUT /api/auth/roles/acl and PUT /api/auth/users/acl used to write permissions
 * straight to the ORM without reaching the command bus, so a permission change
 * left no audit trail at all. Both now dispatch a log-only command. This covers
 * both halves — role grants and per-user overrides, including the clear path —
 * and pins that the entries carry no undo token, since undo is gated on
 * `audit_logs.undo_*` rather than on `auth.acl.manage`.
 */
const GRANTED_FEATURE = 'audit_logs.view_self';

type AuditEntry = {
  commandId: string;
  actionLabel: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  undoToken: string | null;
  snapshotBefore: { isSuperAdmin?: boolean; features?: string[]; organizations?: string[] | null } | null;
  snapshotAfter: { isSuperAdmin?: boolean; features?: string[]; organizations?: string[] | null } | null;
  changes: Record<string, unknown> | null;
  context: {
    effect?: string;
    target?: { kind?: string; id?: string; email?: string | null; name?: string | null };
  } | null;
};

async function findAuditEntries(
  request: APIRequestContext,
  token: string,
  params: { resourceKind: string; resourceId: string },
  // Poll for the entry the caller is actually waiting for. Defaulting to "any
  // entry" would return the *previous* action's row immediately on a second
  // lookup, so a follow-up assertion would silently inspect the wrong entry.
  isReady: (items: AuditEntry[]) => boolean = (items) => items.length > 0,
): Promise<AuditEntry[]> {
  const query = new URLSearchParams({
    resourceKind: params.resourceKind,
    resourceId: params.resourceId,
    pageSize: '20',
    sortField: 'createdAt',
    sortDir: 'desc',
  });
  // The log row is persisted inside commandBus.execute, but poll briefly so the
  // assertion does not race the read replica / request container teardown.
  let items: AuditEntry[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query.toString()}`, {
      token,
    });
    const body = await readJsonSafe<{ items?: AuditEntry[] }>(response);
    items = body?.items ?? [];
    if (isReady(items)) return items;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return items;
}

test.describe('TC-AUTH-058: ACL changes are audited', () => {
  test('role ACL update writes an action-log entry with before/after and no undo token', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    let roleId: string | null = null;

    try {
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-auth-058-${stamp}` });

      const update = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: superadminToken,
        data: { roleId, features: [GRANTED_FEATURE], tenantId },
      });
      expect(update.status(), 'role ACL update should succeed').toBe(200);

      const entries = await findAuditEntries(request, superadminToken, {
        resourceKind: 'auth.role_acl',
        resourceId: roleId,
      });
      expect(entries.length, 'role ACL change should produce an action-log entry').toBeGreaterThan(0);

      const entry = entries[0];
      expect(entry.commandId, 'entry should come from the role ACL command').toBe('auth.role-acl.update');
      expect(entry.actionLabel, 'entry should carry a human-readable label').toBe('Change role permissions');
      expect(entry.resourceId).toBe(roleId);
      expect(entry.snapshotBefore?.features ?? [], 'a fresh role starts with no grants').not.toContain(GRANTED_FEATURE);
      expect(entry.snapshotAfter?.features ?? [], 'after-snapshot should hold the granted feature').toContain(
        GRANTED_FEATURE,
      );
      expect(entry.undoToken, 'ACL commands are log-only, so no undo token is minted').toBeNull();
      // `resource_id` is a bare uuid and `action_logs` has no label column, so
      // the entry would stop being readable once the role is deleted.
      expect(entry.context?.target?.name, 'entry should name the role it is about').toBe(
        `qa-tc-auth-058-${stamp}`,
      );
      expect(entry.context?.effect, 'a first grant reads as granted').toBe('granted');
    } finally {
      await deleteRoleIfExists(request, superadminToken, roleId);
    }
  });

  test('user ACL grant and clear are both audited', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { organizationId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const targetEmail = `qa-tc-auth-058-target-${stamp}@example.com`;
    let targetUserId: string | null = null;

    try {
      targetUserId = await createUserFixture(request, superadminToken, {
        email: targetEmail,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
        name: 'QA TC-AUTH-058 Target',
      });

      const grant = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: superadminToken,
        data: { userId: targetUserId, features: [GRANTED_FEATURE] },
      });
      expect(grant.status(), 'user ACL grant should succeed').toBe(200);

      const afterGrant = await findAuditEntries(request, superadminToken, {
        resourceKind: 'auth.user_acl',
        resourceId: targetUserId,
      });
      expect(afterGrant.length, 'user ACL grant should produce an action-log entry').toBeGreaterThan(0);
      expect(afterGrant[0].commandId).toBe('auth.user-acl.update');
      expect(afterGrant[0].actionLabel).toBe('Change user permissions');
      expect(afterGrant[0].snapshotAfter?.features ?? [], 'grant should appear in the after-snapshot').toContain(
        GRANTED_FEATURE,
      );
      expect(afterGrant[0].undoToken, 'ACL commands are log-only').toBeNull();

      // Clearing every grant removes the override row entirely — the audit entry
      // must still record it, with the emptied state as the after-snapshot.
      const clear = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: superadminToken,
        data: { userId: targetUserId, features: [] },
      });
      expect(clear.status(), 'clearing the user ACL should succeed').toBe(200);

      const afterClear = await findAuditEntries(
        request,
        superadminToken,
        { resourceKind: 'auth.user_acl', resourceId: targetUserId },
        (items) => items.length > afterGrant.length,
      );
      expect(afterClear.length, 'clearing should add a second entry').toBeGreaterThan(afterGrant.length);

      const clearEntry = afterClear[0];
      expect(clearEntry.snapshotBefore?.features ?? [], 'before-snapshot should still hold the grant').toContain(
        GRANTED_FEATURE,
      );
      expect(clearEntry.snapshotAfter?.features ?? [], 'after-snapshot should be empty once cleared').toEqual([]);
      expect(clearEntry.undoToken, 'ACL commands are log-only').toBeNull();
      expect(clearEntry.context?.target?.email, 'entry should name the account it is about').toBe(targetEmail);
      expect(clearEntry.context?.effect, 'dropping the last grant reads as revoked').toBe('revoked');

      // The user-edit page PUTs the ACL on every save, so an unchanged ACL is
      // the most common request by far — recording it would bury the two
      // entries above under identical empty ones.
      const repeat = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: superadminToken,
        data: { userId: targetUserId, features: [] },
      });
      expect(repeat.status(), 're-saving an unchanged ACL should still succeed').toBe(200);

      // "Nothing was written" can only be established by waiting, so exhaust
      // the poll window deliberately and assert the count never moved.
      const afterNoOp = await findAuditEntries(
        request,
        superadminToken,
        { resourceKind: 'auth.user_acl', resourceId: targetUserId },
        () => false,
      );
      expect(afterNoOp.length, 'an unchanged ACL should add no entry').toBe(afterClear.length);
    } finally {
      await deleteUserIfExists(request, superadminToken, targetUserId);
    }
  });
});
