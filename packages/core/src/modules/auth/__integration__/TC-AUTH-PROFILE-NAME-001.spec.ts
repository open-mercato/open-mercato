import { expect, test, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth';
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
 *
 * The profile page (`/backend/auth/profile`) and the change password page users reach from the user
 * menu (`/backend/profile/change-password`) save through a bar at the bottom of the screen that is
 * shown only while there is something to report. The last block covers that flow on both pages: no Save control on a
 * clean form, Save and Reset after an edit, Reset restoring the saved value, and Save persisting it.
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

const PROFILE_PAGE_PATH = '/backend/auth/profile';

const CHANGE_PASSWORD_PAGE_PATH = '/backend/profile/change-password';
const SAVE_BAR_PAGES = [
  { label: 'profile page', slug: 'profile', path: PROFILE_PAGE_PATH },
  { label: 'change password page', slug: 'change-password', path: CHANGE_PASSWORD_PAGE_PATH },
];

async function openProfilePageAs(page: Page, email: string, path: string): Promise<void> {
  await acknowledgeGlobalNotices(page);
  const loginResponse = await page.request.post('/api/auth/login', { form: { email, password: PASSWORD } });
  expect(loginResponse.ok(), 'the fixture user should be able to sign in').toBe(true);
  await page.goto(path);
}

function profileSaveBar(page: Page) {
  return page.locator('[data-slot="form-save-bar"]');
}

function profileEmailInput(page: Page) {
  return page.locator('[data-crud-field-id="email"] input').first();
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
      expect(
        profile,
        'an unset display name should be present as null, not omitted from the current response',
      ).toHaveProperty('name', null);
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

      expect(profile, 'a blank name must not surface as an empty label in the chrome').toHaveProperty(
        'name',
        null,
      );
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
    }
  });

  test('still requires authentication', async ({ request }) => {
    const response = await request.get(PROFILE_PATH);

    expect(response.status(), 'an unauthenticated profile read should be rejected').toBe(401);
  });
});

for (const saveBarPage of SAVE_BAR_PAGES) {
  test.describe(`${saveBarPage.label} save bar`, () => {
    test('offers Save only after an edit and restores the saved value on Reset', async ({ page, request }) => {
      const adminToken = await getAuthToken(request, 'admin');
      const { organizationId } = getTokenScope(adminToken);
      const stamp = Date.now();
      const email = `tc-auth-${saveBarPage.slug}-reset-${stamp}@example.com`;
      const editedEmail = `tc-auth-${saveBarPage.slug}-reset-edited-${stamp}@example.com`;
      let userId: string | null = null;

      try {
        userId = await createUserFixture(request, adminToken, {
          email,
          password: PASSWORD,
          organizationId,
          roles: ['employee'],
        });

        await openProfilePageAs(page, email, saveBarPage.path);
        const emailInput = profileEmailInput(page);
        await expect(emailInput).toHaveValue(email);
        await expect(profileSaveBar(page), 'a clean form should show no save bar').toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);

        await emailInput.fill(editedEmail);
        await expect(emailInput).toHaveValue(editedEmail);
        await expect(profileSaveBar(page)).toBeVisible();
        await expect(profileSaveBar(page)).toHaveAttribute('data-state', 'dirty');
        await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(1);

        await profileSaveBar(page).getByRole('button', { name: 'Reset' }).click();
        await expect(profileSaveBar(page), 'Reset should hide the bar again').toHaveCount(0);
        await expect(profileEmailInput(page)).toHaveValue(email);

        const userToken = await getAuthToken(request, email, PASSWORD);
        const profile = await readOwnProfile(request, userToken);
        expect(profile.email, 'Reset must not save anything').toBe(email);
      } finally {
        await deleteUserIfExists(request, adminToken, userId);
      }
    });

    test('saves an edited email from the bar and hides the bar afterwards', async ({ page, request }) => {
      const adminToken = await getAuthToken(request, 'admin');
      const { organizationId } = getTokenScope(adminToken);
      const stamp = Date.now();
      const email = `tc-auth-${saveBarPage.slug}-save-${stamp}@example.com`;
      const editedEmail = `tc-auth-${saveBarPage.slug}-save-edited-${stamp}@example.com`;
      let userId: string | null = null;

      try {
        userId = await createUserFixture(request, adminToken, {
          email,
          password: PASSWORD,
          organizationId,
          roles: ['employee'],
        });

        await openProfilePageAs(page, email, saveBarPage.path);
        const emailInput = profileEmailInput(page);
        await expect(emailInput).toHaveValue(email);

        await emailInput.fill(editedEmail);
        await expect(emailInput).toHaveValue(editedEmail);
        await profileSaveBar(page).getByRole('button', { name: 'Save changes' }).click();

        await expect(page.getByText('Profile updated.').first()).toBeVisible();
        await expect(profileSaveBar(page), 'the bar should hide once the save is done').toHaveCount(0);
        await expect(profileEmailInput(page)).toHaveValue(editedEmail);

        const userToken = await getAuthToken(request, editedEmail, PASSWORD);
        const profile = await readOwnProfile(request, userToken);
        expect(profile.email, 'the edited email should be stored').toBe(editedEmail);
      } finally {
        await deleteUserIfExists(request, adminToken, userId);
      }
    });
  });
}
