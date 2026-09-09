import { expect, test } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { createUserDestinationFixture } from './helpers/userDestinationFixtures';

test.describe('TC-AUTH-059: out-of-scope user destination', () => {
  test('denies a same-tenant move outside the actor organization scope', async ({ request }) => {
    const fixture = await createUserDestinationFixture(request, 'AUTH-059');

    try {
      const targetUserId = await fixture.createUser({ emailPrefix: 'target' });
      const response = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: fixture.actorToken,
        data: { id: targetUserId, organizationId: fixture.siblingOrganizationId },
      });

      expect(response.status(), 'same-tenant destination outside canonical actor scope should be denied').toBe(403);
    } finally {
      await fixture.cleanup();
    }
  });
});
