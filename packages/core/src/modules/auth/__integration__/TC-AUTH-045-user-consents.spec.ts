import { expect, test } from '@playwright/test';
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
 * TC-AUTH-045 [P1]: User consent records — GDPR audit trail (#2464)
 *
 * GET /api/auth/users/consents?userId= (guarded by `auth.users.edit`) returns the consent
 * audit trail for a user. A freshly created user has none. The route returns
 * `{ ok: false, error: 'Unauthorized' }` (401) when unauthenticated, `{ ok: false,
 * error: 'Invalid userId' }` (400) for a malformed id, and the framework feature guard
 * returns 403 for an authenticated caller lacking `auth.users.edit`.
 */
const baseUrl = process.env.BASE_URL?.trim() || 'http://localhost:3000';

type ConsentItem = {
  id?: string;
  consentType?: string;
  isGranted?: boolean;
  grantedAt?: string | null;
  withdrawnAt?: string | null;
  integrityValid?: boolean;
  createdAt?: string;
};

test.describe('TC-AUTH-045: user consent records (#2464)', () => {
  test('returns an empty audit trail for a new user and enforces auth/feature gates', async ({ request, playwright }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { organizationId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const deniedEmail = `qa-tc-auth-045-denied-${stamp}@example.com`;
    const deniedPassword = 'StrongSecret123!';
    let userId: string | null = null;
    let deniedRoleId: string | null = null;
    let deniedUserId: string | null = null;

    try {
      userId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-auth-045-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
        name: 'QA TC-AUTH-045',
      });

      // Authorized read: a brand-new user has no recorded consents.
      const consentsRes = await apiRequest(
        request,
        'GET',
        `/api/auth/users/consents?userId=${encodeURIComponent(userId)}`,
        { token: superadminToken },
      );
      expect(consentsRes.status(), 'GET consents should return 200').toBe(200);
      const consentsBody = await readJsonSafe<{ ok?: boolean; items?: ConsentItem[] }>(consentsRes);
      expect(consentsBody?.ok, 'consents response should report ok=true').toBe(true);
      expect(Array.isArray(consentsBody?.items), 'consents items should be an array').toBe(true);
      expect(consentsBody?.items?.length, 'a new user should have no consent records').toBe(0);

      // Malformed userId → 400 Invalid userId.
      const invalidRes = await apiRequest(request, 'GET', '/api/auth/users/consents?userId=not-a-uuid', {
        token: superadminToken,
      });
      expect(invalidRes.status(), 'malformed userId should return 400').toBe(400);

      // Unauthenticated → 401. Use a fresh request context so the shared cookie jar
      // (which retains the session cookie set by the login call in getAuthToken) does
      // not accidentally authenticate this request.
      const anonContext = await playwright.request.newContext();
      try {
        const unauthRes = await anonContext.get(
          `${baseUrl}/api/auth/users/consents?userId=${encodeURIComponent(userId)}`,
        );
        expect(unauthRes.status(), 'unauthenticated request should return 401').toBe(401);
      } finally {
        await anonContext.dispose();
      }

      // Authenticated but lacking `auth.users.edit` → 403.
      deniedRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-auth-045-${stamp}` });
      deniedUserId = await createUserFixture(request, superadminToken, {
        email: deniedEmail,
        password: deniedPassword,
        organizationId,
        roles: [deniedRoleId],
        name: 'QA TC-AUTH-045 denied',
      });
      const deniedToken = await getAuthToken(request, deniedEmail, deniedPassword);
      const forbiddenRes = await apiRequest(
        request,
        'GET',
        `/api/auth/users/consents?userId=${encodeURIComponent(userId)}`,
        { token: deniedToken },
      );
      expect(forbiddenRes.status(), 'caller without auth.users.edit should be forbidden').toBe(403);
    } finally {
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteUserIfExists(request, superadminToken, deniedUserId);
      await deleteRoleIfExists(request, superadminToken, deniedRoleId);
    }
  });
});
