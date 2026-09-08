import { expect, test } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { createUserDestinationFixture } from './helpers/userDestinationFixtures';

test.describe('TC-AUTH-058: descendant user destination scope', () => {
  test('allows a parent-scoped actor to move a user to a descendant and keep editing the user', async ({ request }) => {
    const fixture = await createUserDestinationFixture(request, 'AUTH-058');

    try {
      const targetUserId = await fixture.createUser({ emailPrefix: 'target' });
      const moveResponse = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: fixture.actorToken,
        data: { id: targetUserId, organizationId: fixture.childOrganizationId },
      });
      expect(moveResponse.status(), 'parent-scoped actor should move a user to a descendant').toBe(200);

      const editResponse = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: fixture.actorToken,
        data: { id: targetUserId, name: 'Edited after descendant move' },
      });
      expect(editResponse.status(), 'the moved descendant user should remain in canonical source scope').toBe(200);
    } finally {
      await fixture.cleanup();
    }
  });
});
