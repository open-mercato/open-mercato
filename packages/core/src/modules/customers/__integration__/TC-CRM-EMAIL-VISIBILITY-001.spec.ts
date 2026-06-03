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
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-EMAIL-VISIBILITY-001: Email interaction visibility filter
 *
 * Verifies the Layer 1 email visibility filter wired into EVERY read path that
 * returns customer_interactions — not only `customers/api/interactions/route.ts`
 * (applyEmailVisibilityFilter) but also the person-detail include surface
 * (`/api/customers/people/[id]?include=interactions`) and the per-type counts
 * (`/api/customers/interactions/counts`), which read the same table.
 *
 * Rules under test:
 *  - A 'private' email interaction is visible to its author but not to other
 *    users who lack `customers.email.view_private`.
 *  - A 'shared' email interaction is visible to all users who have
 *    `customers.interactions.view`.
 *  - Neither the person-detail include surface nor the counts surface leaks the
 *    private email body / count to a non-author teammate.
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
      let companyId: string | null = null;
      let privateInteractionId: string | null = null;
      let sharedInteractionId: string | null = null;
      let companyPrivateInteractionId: string | null = null;

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
        const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: {
            roleId,
            features: [
              'customers.people.view',
              'customers.companies.view',
              'customers.interactions.view',
              'customers.interactions.manage',
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

        // -- Step 3b: the SAME private email must not leak through the other
        //    read paths that return customer_interactions (Layer 1 must cover
        //    every path, not only /interactions). ----------------------------
        const userBPersonResp = await apiRequest(
          request,
          'GET',
          `/api/customers/people/${encodeURIComponent(personId)}?include=interactions`,
          { token: userBToken },
        );
        expect(
          userBPersonResp.ok(),
          'User B GET /api/customers/people/[id]?include=interactions should succeed',
        ).toBeTruthy();
        const userBPersonBody = await readJsonSafe<{ interactions?: Array<{ id?: string }> }>(userBPersonResp);
        const userBPersonInteractions = Array.isArray(userBPersonBody?.interactions)
          ? userBPersonBody.interactions
          : [];
        expect(
          userBPersonInteractions.some((item) => item.id === privateInteractionId),
          'User B must NOT see the private email via /people/[id]?include=interactions',
        ).toBe(false);

        const userBCountsBeforeShared = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions/counts?entityId=${encodeURIComponent(personId)}`,
          { token: userBToken },
        );
        expect(
          userBCountsBeforeShared.ok(),
          'User B GET /api/customers/interactions/counts should succeed',
        ).toBeTruthy();
        const userBCountsBeforeSharedBody = await readJsonSafe<{ result?: { email?: number } }>(userBCountsBeforeShared);
        expect(
          userBCountsBeforeSharedBody?.result?.email ?? 0,
          'User B email count must exclude the private email (0 before a shared one exists)',
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

        // -- Step 5b: the person-detail include surface and counts must reflect
        //    exactly the shared email for User B (private one stays hidden). --
        const userBPersonAfterResp = await apiRequest(
          request,
          'GET',
          `/api/customers/people/${encodeURIComponent(personId)}?include=interactions`,
          { token: userBToken },
        );
        expect(
          userBPersonAfterResp.ok(),
          'User B GET /api/customers/people/[id]?include=interactions (after shared) should succeed',
        ).toBeTruthy();
        const userBPersonAfterBody = await readJsonSafe<{ interactions?: Array<{ id?: string }> }>(userBPersonAfterResp);
        const userBPersonAfterInteractions = Array.isArray(userBPersonAfterBody?.interactions)
          ? userBPersonAfterBody.interactions
          : [];
        expect(
          userBPersonAfterInteractions.some((item) => item.id === sharedInteractionId),
          'User B must see the shared email via /people/[id]?include=interactions',
        ).toBe(true);
        expect(
          userBPersonAfterInteractions.some((item) => item.id === privateInteractionId),
          'User B must still NOT see the private email via /people/[id]?include=interactions',
        ).toBe(false);

        const userBCountsAfterShared = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions/counts?entityId=${encodeURIComponent(personId)}`,
          { token: userBToken },
        );
        expect(
          userBCountsAfterShared.ok(),
          'User B GET /api/customers/interactions/counts (after shared) should succeed',
        ).toBeTruthy();
        const userBCountsAfterSharedBody = await readJsonSafe<{ result?: { email?: number } }>(userBCountsAfterShared);
        expect(
          userBCountsAfterSharedBody?.result?.email ?? 0,
          'User B email count must be exactly 1 (the shared email; private one stays hidden)',
        ).toBe(1);

        // -- Step 6: the GENERIC interaction-update path must not let a
        //    non-author (holding interactions.manage but not view_private) flip
        //    a private email's visibility. The dedicated PATCH .../visibility
        //    route is the only authorized path; the update command enforces the
        //    same author/admin gate so the generic PUT cannot bypass it. ------
        const userBVisibilityBypassResp = await apiRequest(
          request,
          'PUT',
          '/api/customers/interactions',
          {
            token: userBToken,
            data: { id: privateInteractionId, visibility: 'shared' },
          },
        );
        expect(
          userBVisibilityBypassResp.status(),
          'User B must NOT change a private email visibility via the generic update (404, existence-masked)',
        ).toBe(404);

        // The private email's visibility must remain unchanged for the author.
        const userAAfterBypassResp = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userAToken },
        );
        expect(userAAfterBypassResp.ok(), 'User A list after bypass attempt should succeed').toBeTruthy();
        const userAAfterBypassBody = await readJsonSafe<{
          items?: Array<{ id?: string; visibility?: string }>;
        }>(userAAfterBypassResp);
        const stillPrivate = (Array.isArray(userAAfterBypassBody?.items) ? userAAfterBypassBody.items : []).find(
          (item) => item.id === privateInteractionId,
        );
        expect(
          stillPrivate?.visibility,
          'Private email visibility must remain "private" after the blocked bypass attempt',
        ).toBe('private');

        // -- Step 7: the COMPANY detail read path must apply the same visibility
        //    filter as the person detail path. A private email anchored to a
        //    company must be hidden from a non-author teammate. ---------------
        companyId = await createCompanyFixture(request, adminToken, `EmailVis Co ${stamp}`);
        const companyPrivateResp = await apiRequest(
          request,
          'POST',
          '/api/customers/interactions',
          {
            token: adminToken,
            data: {
              entityId: companyId,
              interactionType: 'email',
              title: `Company private email ${stamp}`,
              body: 'Company private body',
              visibility: 'private',
              authorUserId: userAScope.userId,
              status: 'planned',
            },
          },
        );
        expect(
          companyPrivateResp.status(),
          'POST company-anchored private email should return 201',
        ).toBe(201);
        const companyPrivateBody = await readJsonSafe<{ id?: string }>(companyPrivateResp);
        companyPrivateInteractionId = companyPrivateBody?.id ?? null;
        expect(companyPrivateInteractionId, 'Company private interaction must include id').toBeTruthy();

        const userBCompanyResp = await apiRequest(
          request,
          'GET',
          `/api/customers/companies/${encodeURIComponent(companyId)}?include=interactions`,
          { token: userBToken },
        );
        expect(userBCompanyResp.ok(), 'User B GET company?include=interactions should succeed').toBeTruthy();
        const userBCompanyBody = await readJsonSafe<{ interactions?: Array<{ id?: string }> }>(userBCompanyResp);
        const userBCompanyInteractions = Array.isArray(userBCompanyBody?.interactions)
          ? userBCompanyBody.interactions
          : [];
        expect(
          userBCompanyInteractions.some((item) => item.id === companyPrivateInteractionId),
          'User B must NOT see the company-anchored private email via /companies/[id]?include=interactions',
        ).toBe(false);

        const userACompanyResp = await apiRequest(
          request,
          'GET',
          `/api/customers/companies/${encodeURIComponent(companyId)}?include=interactions`,
          { token: userAToken },
        );
        expect(userACompanyResp.ok(), 'User A GET company?include=interactions should succeed').toBeTruthy();
        const userACompanyBody = await readJsonSafe<{ interactions?: Array<{ id?: string }> }>(userACompanyResp);
        const userACompanyInteractions = Array.isArray(userACompanyBody?.interactions)
          ? userACompanyBody.interactions
          : [];
        expect(
          userACompanyInteractions.some((item) => item.id === companyPrivateInteractionId),
          'User A (author) must see the company-anchored private email via company detail',
        ).toBe(true);
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
            '/api/customers/interactions',
            companyPrivateInteractionId,
          );
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/people',
            personId,
          );
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/companies',
            companyId,
          );
        }
        await deleteUserIfExists(request, adminToken, userAId);
        await deleteUserIfExists(request, adminToken, userBId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );
});
