import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-EMAIL-VISIBILITY-001: Email interaction visibility filter
 *
 * Verifies the Layer 1 email visibility filter wired into
 * `customers/api/interactions/route.ts` (applyEmailVisibilityFilter).
 *
 * Rules under test:
 *  - A 'private' email interaction is visible to its author but not to other
 *    users who lack `customers.email.view_private`.
 *  - A 'shared' email interaction is visible to all users who have
 *    `customers.interactions.view`.
 */
test.describe('TC-CRM-EMAIL-VISIBILITY-001: Email interaction visibility filter', () => {
  test(
    'private email interactions are hidden from other employees; shared interactions remain visible',
    async ({ request }) => {
      test.slow();

      // -- Fixture state tracked for cleanup ---------------------------------
      const stamp = Date.now();
      let adminToken: string | null = null;
      let userAToken: string | null = null;
      let userBToken: string | null = null;
      let userAId: string | null = null;
      let userBId: string | null = null;
      let roleId: string | null = null;
      let personId: string | null = null;
      let privateInteractionId: string | null = null;
      let sharedInteractionId: string | null = null;

      try {
        // -- Setup: obtain admin token and tenant scope ----------------------
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        // -- Setup: create a role that grants interactions.view but NOT
        //    customers.email.view_private.  The 'employee' seeded role has
        //    `customers.email.compose` but does NOT have `view_private`, so we
        //    can create a fresh role to be explicit about the grant set.
        const roleName = `qa_email_vis_${stamp}`;
        roleId = await createRoleFixture(request, adminToken, {
          name: roleName,
          tenantId: scope.tenantId,
        });

        // Grant the role the minimum features needed to list interactions.
        // Deliberately do NOT grant `customers.email.view_private`.
        const aclResponse = await apiRequest(request, 'PUT', `/api/auth/roles/${roleId}/acl`, {
          token: adminToken,
          data: {
            features: [
              'customers.interactions.view',
              'customers.email.compose',
            ],
          },
        });
        expect(aclResponse.ok(), `PUT /api/auth/roles/${roleId}/acl should succeed`).toBeTruthy();

        // -- Setup: create User A (author — has compose, will own interactions)
        const userAEmail = `qa-email-vis-a-${stamp}@acme.com`;
        const userAPassword = 'Valid1!Pass';
        userAId = await createUserFixture(request, adminToken, {
          email: userAEmail,
          password: userAPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA Email Vis User A',
        });
        userAToken = await getAuthToken(request, userAEmail, userAPassword);

        // -- Setup: create User B (other employee — same role, no view_private)
        const userBEmail = `qa-email-vis-b-${stamp}@acme.com`;
        const userBPassword = 'Valid1!Pass';
        userBId = await createUserFixture(request, adminToken, {
          email: userBEmail,
          password: userBPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA Email Vis User B',
        });
        userBToken = await getAuthToken(request, userBEmail, userBPassword);

        // -- Setup: derive User A's actual user ID from their token ----------
        const userAScope = getTokenScope(userAToken);

        // -- Setup: create a Person entity as the interaction target ---------
        personId = await createPersonFixture(request, adminToken, {
          firstName: 'EmailVis',
          lastName: `Test${stamp}`,
          displayName: `EmailVis Test ${stamp}`,
        });

        // -- Step 1: create a PRIVATE email interaction authored by User A ---
        const privateInteractionResp = await apiRequest(
          request,
          'POST',
          '/api/customers/interactions',
          {
            token: adminToken,
            data: {
              entityId: personId,
              interactionType: 'email',
              title: `Private email subject ${stamp}`,
              body: 'Private body',
              visibility: 'private',
              authorUserId: userAScope.userId,
              status: 'planned',
            },
          },
        );
        expect(
          privateInteractionResp.status(),
          'POST /api/customers/interactions (private) should return 201',
        ).toBe(201);
        const privateInteractionBody = await readJsonSafe<{ id?: string }>(
          privateInteractionResp,
        );
        privateInteractionId = privateInteractionBody?.id ?? null;
        expect(privateInteractionId, 'Private interaction response must include id').toBeTruthy();

        // -- Step 2: User A can see the private interaction ------------------
        const userAListResp = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userAToken },
        );
        expect(userAListResp.ok(), 'User A GET /api/customers/interactions should succeed').toBeTruthy();
        const userAListBody = await readJsonSafe<{ items?: Array<{ id?: string; visibility?: string }> }>(
          userAListResp,
        );
        const userAItems = Array.isArray(userAListBody?.items) ? userAListBody.items : [];
        expect(
          userAItems.some((item) => item.id === privateInteractionId),
          'User A (author) must see the private email interaction they authored',
        ).toBe(true);

        // -- Step 3: User B cannot see the private interaction ---------------
        const userBListPrivateResp = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userBToken },
        );
        expect(
          userBListPrivateResp.ok(),
          'User B GET /api/customers/interactions should succeed (200 with empty list)',
        ).toBeTruthy();
        const userBListPrivateBody = await readJsonSafe<{
          items?: Array<{ id?: string; visibility?: string }>;
        }>(userBListPrivateResp);
        const userBItemsBeforeShared = Array.isArray(userBListPrivateBody?.items)
          ? userBListPrivateBody.items
          : [];
        expect(
          userBItemsBeforeShared.some((item) => item.id === privateInteractionId),
          'User B (not author, no view_private) must NOT see the private email interaction',
        ).toBe(false);
        expect(
          userBItemsBeforeShared.length,
          'User B list must contain 0 email interactions at this point',
        ).toBe(0);

        // -- Step 4: create a SHARED email interaction authored by User A ----
        const sharedInteractionResp = await apiRequest(
          request,
          'POST',
          '/api/customers/interactions',
          {
            token: adminToken,
            data: {
              entityId: personId,
              interactionType: 'email',
              title: `Shared email subject ${stamp}`,
              body: 'Shared body',
              visibility: 'shared',
              authorUserId: userAScope.userId,
              status: 'planned',
            },
          },
        );
        expect(
          sharedInteractionResp.status(),
          'POST /api/customers/interactions (shared) should return 201',
        ).toBe(201);
        const sharedInteractionBody = await readJsonSafe<{ id?: string }>(sharedInteractionResp);
        sharedInteractionId = sharedInteractionBody?.id ?? null;
        expect(sharedInteractionId, 'Shared interaction response must include id').toBeTruthy();

        // -- Step 5: User B now sees exactly the shared interaction ----------
        const userBListSharedResp = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userBToken },
        );
        expect(
          userBListSharedResp.ok(),
          'User B GET /api/customers/interactions (after shared creation) should succeed',
        ).toBeTruthy();
        const userBListSharedBody = await readJsonSafe<{
          items?: Array<{ id?: string; visibility?: string }>;
        }>(userBListSharedResp);
        const userBItemsAfterShared = Array.isArray(userBListSharedBody?.items)
          ? userBListSharedBody.items
          : [];
        expect(
          userBItemsAfterShared.some((item) => item.id === sharedInteractionId),
          'User B must see the shared email interaction',
        ).toBe(true);
        expect(
          userBItemsAfterShared.some((item) => item.id === privateInteractionId),
          'User B must still NOT see the private email interaction after shared one is added',
        ).toBe(false);
        expect(
          userBItemsAfterShared.length,
          'User B list must contain exactly 1 email interaction (the shared one)',
        ).toBe(1);
      } finally {
        // Cleanup is best-effort and ordered: interactions before person,
        // users before role (role deletion is last because user references it).
        if (adminToken) {
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/interactions',
            privateInteractionId,
          );
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/interactions',
            sharedInteractionId,
          );
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/people',
            personId,
          );
        }
        await deleteUserIfExists(request, adminToken, userAId);
        await deleteUserIfExists(request, adminToken, userBId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );
});
