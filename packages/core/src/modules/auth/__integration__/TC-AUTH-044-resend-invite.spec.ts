import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe, expectId } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-044 [P1]: Resend the onboarding invitation email (#2464)
 *
 * POST /api/auth/users/resend-invite (guarded by `auth.users.create`) regenerates the setup
 * token for a user who has NOT yet set a password. Request body is `{ id }` (the issue's
 * `userId` is wrong). A user who already has a password is ineligible (409).
 *
 * Rate-limit note: the endpoint is rate limited (3/300s per IP) in production, but the
 * integration runner sets OM_INTEGRATION_TEST=true which disables rate limiting globally
 * (packages/shared/src/lib/ratelimit/config.ts). The 429 boundary therefore cannot fire in
 * this environment, and asserting an IP-global, 300s-block limiter would break the suite's
 * retry-idempotency — so the 429 path is intentionally not asserted here.
 */
test.describe('TC-AUTH-044: resend user invitation (#2464)', () => {
  test('resends invites for invited users and rejects ineligible targets', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { organizationId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    let invitedUserId: string | null = null;
    let passwordUserId: string | null = null;

    try {
      // Invited (passwordless) user — created via sendInviteEmail, eligible for (re)sending the invite.
      const createInvited = await apiRequest(request, 'POST', '/api/auth/users', {
        token: superadminToken,
        data: {
          email: `qa-tc-auth-044-invited-${stamp}@example.com`,
          organizationId,
          roles: [],
          sendInviteEmail: true,
        },
      });
      expect(createInvited.status(), 'creating an invited user should return 201').toBe(201);
      invitedUserId = expectId(
        (await readJsonSafe<{ id?: string }>(createInvited))?.id,
        'invited user response should include id',
      );

      // Resend succeeds, and remains successful when called again (rate limiting disabled in CI).
      for (const attempt of [1, 2]) {
        const resend = await apiRequest(request, 'POST', '/api/auth/users/resend-invite', {
          token: superadminToken,
          data: { id: invitedUserId },
        });
        expect(resend.status(), `resend attempt ${attempt} should return 200`).toBe(200);
        const body = await readJsonSafe<{ ok?: boolean }>(resend);
        expect(body?.ok, `resend attempt ${attempt} should report ok=true`).toBe(true);
      }

      // A user who already has a password is not invite-eligible → 409.
      passwordUserId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-auth-044-pw-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
        name: 'QA TC-AUTH-044',
      });
      const resendPw = await apiRequest(request, 'POST', '/api/auth/users/resend-invite', {
        token: superadminToken,
        data: { id: passwordUserId },
      });
      expect(resendPw.status(), 'resend for a user with a password should return 409').toBe(409);

      // Unknown (but well-formed) user id → 404.
      const resendMissing = await apiRequest(request, 'POST', '/api/auth/users/resend-invite', {
        token: superadminToken,
        data: { id: randomUUID() },
      });
      expect(resendMissing.status(), 'resend for an unknown id should return 404').toBe(404);

      // Malformed id → 422 validation error.
      const resendInvalid = await apiRequest(request, 'POST', '/api/auth/users/resend-invite', {
        token: superadminToken,
        data: { id: 'not-a-uuid' },
      });
      expect(resendInvalid.status(), 'resend with a non-uuid id should return 422').toBe(422);
    } finally {
      await deleteUserIfExists(request, superadminToken, invitedUserId);
      await deleteUserIfExists(request, superadminToken, passwordUserId);
    }
  });
});
