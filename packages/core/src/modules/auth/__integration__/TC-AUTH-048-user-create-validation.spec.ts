import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe, expectId } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-048 [P1]: User creation validation — password or invite required (#2464)
 *
 * POST /api/auth/users requires `password || sendInviteEmail`. Validation is enforced by the
 * `auth.users.create` command schema; the CRUD factory surfaces a ZodError as HTTP 400 with
 * `{ error: 'Invalid input', details: ZodIssue[] }` (NOT 422/fieldErrors as the issue guessed).
 * Successful creates return 201 with `{ id }`.
 */
type CreateError = { error?: string; details?: Array<{ path?: unknown[]; message?: string }> };

const hasIssueForPath = (body: CreateError | null, field: string): boolean =>
  (body?.details ?? []).some((issue) => Array.isArray(issue.path) && issue.path.includes(field));

test.describe('TC-AUTH-048: user creation validation (#2464)', () => {
  test('enforces password-or-invite and email format, and accepts valid payloads', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { organizationId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const createdUserIds: string[] = [];

    const createUser = async (data: Record<string, unknown>) =>
      apiRequest(request, 'POST', '/api/auth/users', { token: superadminToken, data });

    try {
      // Neither password nor sendInviteEmail → 400 Invalid input with a `password`-path issue.
      const missingBoth = await createUser({
        email: `qa-tc-auth-048-missing-${stamp}@example.com`,
        organizationId,
        roles: [],
      });
      expect(missingBoth.status(), 'missing password and sendInviteEmail should return 400').toBe(400);
      const missingBody = await readJsonSafe<CreateError>(missingBoth);
      expect(missingBody?.error, 'error should be Invalid input').toBe('Invalid input');
      expect(hasIssueForPath(missingBody, 'password'), 'details should flag the password field').toBe(true);

      // Invalid email format → 400 Invalid input with an `email`-path issue.
      const badEmail = await createUser({
        email: 'not-an-email',
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      });
      expect(badEmail.status(), 'invalid email should return 400').toBe(400);
      const badEmailBody = await readJsonSafe<CreateError>(badEmail);
      expect(hasIssueForPath(badEmailBody, 'email'), 'details should flag the email field').toBe(true);

      // Password only → 201.
      const passwordOnly = await createUser({
        email: `qa-tc-auth-048-pw-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      });
      expect(passwordOnly.status(), 'password-only create should return 201').toBe(201);
      createdUserIds.push(expectId((await readJsonSafe<{ id?: string }>(passwordOnly))?.id, 'create should return id'));

      // sendInviteEmail only (no password) → 201.
      const inviteOnly = await createUser({
        email: `qa-tc-auth-048-invite-${stamp}@example.com`,
        organizationId,
        roles: [],
        sendInviteEmail: true,
      });
      expect(inviteOnly.status(), 'invite-only create should return 201').toBe(201);
      createdUserIds.push(expectId((await readJsonSafe<{ id?: string }>(inviteOnly))?.id, 'create should return id'));

      // Both password and sendInviteEmail → 201.
      const both = await createUser({
        email: `qa-tc-auth-048-both-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
        sendInviteEmail: true,
      });
      expect(both.status(), 'password+invite create should return 201').toBe(201);
      createdUserIds.push(expectId((await readJsonSafe<{ id?: string }>(both))?.id, 'create should return id'));
    } finally {
      for (const id of createdUserIds) {
        await deleteUserIfExists(request, superadminToken, id);
      }
    }
  });
});
