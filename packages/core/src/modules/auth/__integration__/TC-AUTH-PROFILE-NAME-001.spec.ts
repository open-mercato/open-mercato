import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-PROFILE-NAME-001: `GET /api/auth/profile` returns the signed-in user's display name.
 * Source spec: .ai/specs/2026-05-09-auth-user-display-name-exposure.md ("Profile Self-Read").
 *
 * The unit coverage for this endpoint mocks the container, the ORM and the decryption helper, so it
 * proves the handler's shaping logic but never that a name written through the admin user API comes
 * back out of the self-read endpoint. This closes that loop: a user is created with a display name via
 * `POST /api/auth/users`, then authenticates as that user and reads their own profile.
 *
 * Verified-against-source contract (`modules/auth/api/profile/route.ts`):
 * - `GET` requires authentication; without a token it is `401`
 * - the response carries `email`, `name` and `roles`
 * - `name` is `null` when unset, and blank or whitespace-only values normalise to `null` rather than
 *   surfacing as an empty label
 */

const PROFILE_PATH = '/api/auth/profile';
const PASSWORD = 'Integration-Passw0rd!';

type ProfileResponse = {
  email?: string;
  name?: string | null;
  roles?: string[];
};

async function readOwnProfile(
  request: Parameters<typeof apiRequest>[0],
  token: string,
): Promise<ProfileResponse> {
  const response = await apiRequest(request, 'GET', PROFILE_PATH, { token });
  expect(response.status(), `GET ${PROFILE_PATH} should return 200`).toBe(200);
  return (await readJsonSafe<ProfileResponse>(response)) ?? {};
}

test.describe('profile self-read display name', () => {
  test('returns a display name set through the admin user API', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenScope(adminToken);
    const email = `tc-auth-profile-name-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      userId = await createUserFixture(request, adminToken, {
        email,
        password: PASSWORD,
        organizationId,
        roles: [],
        name: 'Ada Lovelace',
      });

      const userToken = await getAuthToken(request, email, PASSWORD);
      const profile = await readOwnProfile(request, userToken);

      expect(profile.email, 'the profile should describe the authenticated user').toBe(email);
      expect(
        profile.name,
        'a display name written through the admin API must be readable by the user themselves',
      ).toBe('Ada Lovelace');
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
    }
  });

  test('returns null for a user with no display name', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenScope(adminToken);
    const email = `tc-auth-profile-noname-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      userId = await createUserFixture(request, adminToken, {
        email,
        password: PASSWORD,
        organizationId,
        roles: [],
      });

      const userToken = await getAuthToken(request, email, PASSWORD);
      const profile = await readOwnProfile(request, userToken);

      expect(profile.email).toBe(email);
      expect(profile.name ?? null, 'an unset display name should read as null, not undefined-as-empty').toBeNull();
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
    }
  });

  test('normalises a whitespace-only display name to null', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenScope(adminToken);
    const email = `tc-auth-profile-blank-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      userId = await createUserFixture(request, adminToken, {
        email,
        password: PASSWORD,
        organizationId,
        roles: [],
        name: '   ',
      });

      const userToken = await getAuthToken(request, email, PASSWORD);
      const profile = await readOwnProfile(request, userToken);

      expect(
        profile.name ?? null,
        'a blank name must not surface as an empty label in the chrome',
      ).toBeNull();
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
    }
  });

  test('still requires authentication', async ({ request }) => {
    const response = await request.get(PROFILE_PATH);

    expect(response.status(), 'an unauthenticated profile read should be rejected').toBe(401);
  });
});
