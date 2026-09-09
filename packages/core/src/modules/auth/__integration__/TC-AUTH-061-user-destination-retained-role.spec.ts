import { expect, test } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { createUserDestinationFixture } from './helpers/userDestinationFixtures';

test.describe('TC-AUTH-061: retained user role grant boundary', () => {
  test('denies a move when an omitted retained role is not grantable by the actor', async ({ request }) => {
    const fixture = await createUserDestinationFixture(request, 'AUTH-061');

    try {
      const privilegedRoleId = await fixture.createRole({
        namePrefix: 'privileged',
        features: ['api_keys.create'],
      });
      const targetUserId = await fixture.createUser({
        emailPrefix: 'target',
        roles: [privilegedRoleId],
      });
      const response = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: fixture.actorToken,
        data: { id: targetUserId, organizationId: fixture.childOrganizationId },
      });

      expect(response.status(), 'ungrantable retained role should block the destination move').toBe(403);
    } finally {
      await fixture.cleanup();
    }
  });
});
