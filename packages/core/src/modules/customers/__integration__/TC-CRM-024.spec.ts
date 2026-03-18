import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-024: Person Profile-Only Update Timestamps (fix for issue #795)
 *
 * Verifies that:
 * 1. `profile.updatedAt` is exposed in GET /api/customers/people/[id] response.
 * 2. `person.updatedAt` advances when profile-only fields (e.g. linkedInUrl) are changed.
 * 3. `profile.updatedAt` advances when profile-only fields are changed.
 */
test.describe('TC-CRM-024: Person Profile-Only Update Timestamps', () => {
  test('should update person.updatedAt and expose profile.updatedAt on profile-only field change', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM024${ts}`,
        displayName: `QA TC-CRM-024 ${ts}`,
      });

      // Fetch initial state
      const getInitial = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(getInitial.ok(), `Initial GET failed: ${getInitial.status()}`).toBeTruthy();
      const initial = await readJsonSafe<Record<string, unknown>>(getInitial);
      expect(initial).not.toBeNull();

      const personBefore = initial!.person as Record<string, unknown>;
      const profileBefore = initial!.profile as Record<string, unknown> | null;

      expect(profileBefore, 'profile must be present in GET response').not.toBeNull();
      expect(typeof profileBefore!.updatedAt, 'profile.updatedAt must be a string').toBe('string');
      expect(typeof personBefore.updatedAt, 'person.updatedAt must be a string').toBe('string');

      const personUpdatedAtBefore = new Date(personBefore.updatedAt as string).getTime();
      const profileUpdatedAtBefore = new Date(profileBefore!.updatedAt as string).getTime();

      // Wait 1 second so timestamp comparison is unambiguous
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Update a profile-only field — no entity-level fields included
      const putResponse = await apiRequest(request, 'PUT', '/api/customers/people', {
        token,
        data: {
          id: personId,
          linkedInUrl: 'https://linkedin.com/in/qa-crm-024',
        },
      });
      expect(putResponse.ok(), `PUT failed: ${putResponse.status()}`).toBeTruthy();

      // Fetch updated state
      const getUpdated = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(getUpdated.ok(), `Updated GET failed: ${getUpdated.status()}`).toBeTruthy();
      const updated = await readJsonSafe<Record<string, unknown>>(getUpdated);
      expect(updated).not.toBeNull();

      const personAfter = updated!.person as Record<string, unknown>;
      const profileAfter = updated!.profile as Record<string, unknown> | null;

      expect(profileAfter, 'profile must be present after update').not.toBeNull();
      expect(typeof profileAfter!.updatedAt).toBe('string');

      const personUpdatedAtAfter = new Date(personAfter.updatedAt as string).getTime();
      const profileUpdatedAtAfter = new Date(profileAfter!.updatedAt as string).getTime();

      // person.updatedAt must have advanced (issue #795 fix)
      expect(
        personUpdatedAtAfter,
        `person.updatedAt (${personAfter.updatedAt}) should be later than initial (${personBefore.updatedAt})`,
      ).toBeGreaterThan(personUpdatedAtBefore);

      // profile.updatedAt must have advanced
      expect(
        profileUpdatedAtAfter,
        `profile.updatedAt (${profileAfter!.updatedAt}) should be later than initial (${profileBefore!.updatedAt})`,
      ).toBeGreaterThan(profileUpdatedAtBefore);

      // The profile field change must be visible
      expect(profileAfter!.linkedInUrl).toBe('https://linkedin.com/in/qa-crm-024');
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
