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
 * TC-CRM-EMAIL-006: Email interaction visibility lifecycle
 *
 * Verifies the full visibility lifecycle routed through the PATCH endpoint:
 *   PATCH /api/customers/interactions/{id}/visibility
 *
 * Scenarios (personal mailbox privacy v1 — strict owner-only, NO admin bypass):
 *   1. Non-author (User B) cannot flip another user's private email → 404
 *   2. Author (User A) can flip to shared → 200 { ok: true, changed: true }
 *   3. No-op flip (same visibility) → 200 { ok: true, changed: false }
 *   4. Admin (with customers.email.view_private) is STILL denied flipping a
 *      non-authored email → 404; the email stays shared
 *   5. Author can flip their own back to private → 200 { changed: true }
 *
 * Two roles are created:
 *   - email-employee: interactions.view/manage + email.compose, NO view_private
 *   - email-admin: same as above PLUS customers.email.view_private — used here to
 *     PROVE the feature grants no write bypass in v1
 *
 * The interaction is created via admin token with authorUserId=userA.id so the
 * author ownership is established without requiring the compose route (which
 * needs a live channel fixture). The interactionCreateSchema accepts authorUserId
 * as an optional field.
 */
test.describe('TC-CRM-EMAIL-006: Email interaction visibility lifecycle', () => {
  test(
    'full visibility lifecycle: non-author blocked, author flips, no-op, admin ALSO blocked (v1), author restores',
    async ({ request }) => {
      test.slow();

      const stamp = Date.now();

      // -- Fixture state tracked for cleanup -----------------------------------
      let adminToken: string | null = null;
      let userAToken: string | null = null;
      let userBToken: string | null = null;
      let userAdminToken: string | null = null;
      let userAId: string | null = null;
      let userBId: string | null = null;
      let userAdminId: string | null = null;
      let employeeRoleId: string | null = null;
      let adminRoleId: string | null = null;
      let personId: string | null = null;
      let interactionId: string | null = null;

      try {
        // -- Setup: admin token and tenant scope --------------------------------
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        // -- Setup: employee role — interactions + email.compose, NO view_private
        const employeeRoleName = `qa_crm_email_006_emp_${stamp}`;
        employeeRoleId = await createRoleFixture(request, adminToken, {
          name: employeeRoleName,
          tenantId: scope.tenantId,
        });

        const employeeAclResp = await apiRequest(
          request,
          'PUT',
          '/api/auth/roles/acl',
          {
            token: adminToken,
            data: {
              roleId: employeeRoleId,
              features: [
                'customers.people.view',
                'customers.people.manage',
                'customers.interactions.view',
                'customers.interactions.manage',
                'customers.email.compose',
              ],
            },
          },
        );
        expect(
          employeeAclResp.ok(),
          `PUT /api/auth/roles/${employeeRoleId}/acl (employee) should succeed`,
        ).toBeTruthy();

        // -- Setup: admin role — same as employee PLUS customers.email.view_private
        const adminRoleName = `qa_crm_email_006_adm_${stamp}`;
        adminRoleId = await createRoleFixture(request, adminToken, {
          name: adminRoleName,
          tenantId: scope.tenantId,
        });

        const adminAclResp = await apiRequest(
          request,
          'PUT',
          '/api/auth/roles/acl',
          {
            token: adminToken,
            data: {
              roleId: adminRoleId,
              features: [
                'customers.people.view',
                'customers.people.manage',
                'customers.interactions.view',
                'customers.interactions.manage',
                'customers.email.compose',
                'customers.email.view_private',
              ],
            },
          },
        );
        expect(
          adminAclResp.ok(),
          `PUT /api/auth/roles/${adminRoleId}/acl (admin) should succeed`,
        ).toBeTruthy();

        // -- Setup: User A — employee role (author of the interaction) ----------
        const userAEmail = `qa-crm-email-006-a-${stamp}@acme.com`;
        const userAPassword = 'Valid1!Pass';
        userAId = await createUserFixture(request, adminToken, {
          email: userAEmail,
          password: userAPassword,
          organizationId: scope.organizationId,
          roles: [employeeRoleName],
          name: 'QA CRM Email 006 User A',
        });
        userAToken = await getAuthToken(request, userAEmail, userAPassword);

        // -- Setup: User B — employee role (different user, no view_private) ---
        const userBEmail = `qa-crm-email-006-b-${stamp}@acme.com`;
        const userBPassword = 'Valid1!Pass';
        userBId = await createUserFixture(request, adminToken, {
          email: userBEmail,
          password: userBPassword,
          organizationId: scope.organizationId,
          roles: [employeeRoleName],
          name: 'QA CRM Email 006 User B',
        });
        userBToken = await getAuthToken(request, userBEmail, userBPassword);

        // -- Setup: User Admin — admin role (has view_private bypass) -----------
        const userAdminEmail = `qa-crm-email-006-adm-${stamp}@acme.com`;
        const userAdminPassword = 'Valid1!Pass';
        userAdminId = await createUserFixture(request, adminToken, {
          email: userAdminEmail,
          password: userAdminPassword,
          organizationId: scope.organizationId,
          roles: [adminRoleName],
          name: 'QA CRM Email 006 User Admin',
        });
        userAdminToken = await getAuthToken(request, userAdminEmail, userAdminPassword);

        // -- Setup: derive User A's actual userId from their token --------------
        const userAScope = getTokenScope(userAToken);

        // -- Setup: create a Person entity as the interaction target ------------
        personId = await createPersonFixture(request, adminToken, {
          firstName: 'CrmEmail006',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail006 Person ${stamp}`,
        });

        // -- Setup: create a PRIVATE email interaction authored by User A ------
        //
        // The interactionCreateSchema accepts authorUserId as an optional field.
        // We POST as admin so the interaction is created without needing a live
        // channel, and we explicitly set authorUserId to userA.id so the author
        // ownership rule is established correctly.
        const interactionResp = await apiRequest(
          request,
          'POST',
          '/api/customers/interactions',
          {
            token: adminToken,
            data: {
              entityId: personId,
              interactionType: 'email',
              title: `TC-CRM-EMAIL-006 private email ${stamp}`,
              body: 'Private content',
              visibility: 'private',
              authorUserId: userAScope.userId,
              status: 'done',
            },
          },
        );
        expect(
          interactionResp.status(),
          'POST /api/customers/interactions should return 201',
        ).toBe(201);
        const interactionBody = await readJsonSafe<{ id?: string }>(interactionResp);
        interactionId = interactionBody?.id ?? null;
        expect(interactionId, 'interaction creation response must include id').toBeTruthy();

        const visibilityPath = `/api/customers/interactions/${interactionId}/visibility`;

        // ── Scenario 1: Non-author (User B) cannot flip another user's private email ──
        //
        // The PATCH handler returns 404 to avoid leaking row existence when the
        // caller is not the author and lacks the admin bypass feature.
        const userBFlipResp = await apiRequest(request, 'PATCH', visibilityPath, {
          token: userBToken,
          data: { visibility: 'shared' },
        });
        expect(
          userBFlipResp.status(),
          'Non-author PATCH visibility should return 404 (existence not leaked)',
        ).toBe(404);

        // Verify the interaction is still private (User A can still see it)
        const userAListAfterBAttempt = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userAToken },
        );
        expect(
          userAListAfterBAttempt.ok(),
          'User A GET interactions after B attempt should succeed',
        ).toBeTruthy();
        const userAItemsAfterBAttempt = await readJsonSafe<{
          items?: Array<{ id?: string; visibility?: string }>;
        }>(userAListAfterBAttempt);
        const targetAfterBAttempt = (userAItemsAfterBAttempt?.items ?? []).find(
          (item) => item.id === interactionId,
        );
        expect(
          targetAfterBAttempt,
          'Interaction must still exist and be visible to User A after non-author attempt',
        ).toBeTruthy();
        expect(
          targetAfterBAttempt?.visibility,
          'Interaction must still be private after non-author flip attempt',
        ).toBe('private');

        // ── Scenario 2: Author (User A) can flip to shared ───────────────────
        const userAFlipToSharedResp = await apiRequest(request, 'PATCH', visibilityPath, {
          token: userAToken,
          data: { visibility: 'shared' },
        });
        expect(
          userAFlipToSharedResp.status(),
          'Author PATCH visibility to shared should return 200',
        ).toBe(200);
        const userAFlipToSharedBody = await readJsonSafe<{
          ok?: boolean;
          changed?: boolean;
        }>(userAFlipToSharedResp);
        expect(
          userAFlipToSharedBody?.ok,
          'Author flip to shared should return { ok: true }',
        ).toBe(true);
        expect(
          userAFlipToSharedBody?.changed,
          'Author flip to shared should return { changed: true }',
        ).toBe(true);

        // User B should now see the interaction (it is shared)
        const userBListAfterShared = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userBToken },
        );
        expect(
          userBListAfterShared.ok(),
          'User B GET interactions after flip to shared should succeed',
        ).toBeTruthy();
        const userBItemsAfterShared = await readJsonSafe<{
          items?: Array<{ id?: string; visibility?: string }>;
        }>(userBListAfterShared);
        const sharedRow = (userBItemsAfterShared?.items ?? []).find(
          (item) => item.id === interactionId,
        );
        expect(
          sharedRow,
          'User B must see the interaction after it is flipped to shared',
        ).toBeTruthy();

        // ── Scenario 3: No-op flip (same visibility) returns changed: false ──
        const userANoOpResp = await apiRequest(request, 'PATCH', visibilityPath, {
          token: userAToken,
          data: { visibility: 'shared' },
        });
        expect(
          userANoOpResp.status(),
          'No-op flip should return 200',
        ).toBe(200);
        const userANoOpBody = await readJsonSafe<{ ok?: boolean; changed?: boolean }>(
          userANoOpResp,
        );
        expect(
          userANoOpBody?.ok,
          'No-op flip should return { ok: true }',
        ).toBe(true);
        expect(
          userANoOpBody?.changed,
          'No-op flip should return { changed: false }',
        ).toBe(false);

        // ── Scenario 4: Admin (non-author) is DENIED flipping another user's email (v1: no bypass) ──
        //
        // Personal mailbox privacy v1 — `customers.email.view_private` no longer
        // grants a write bypass; only the author may flip their own email's
        // visibility. The PATCH returns 404 (existence not leaked) and the email
        // stays shared.
        const adminFlipAttemptResp = await apiRequest(request, 'PATCH', visibilityPath, {
          token: userAdminToken,
          data: { visibility: 'private' },
        });
        expect(
          adminFlipAttemptResp.status(),
          'Admin PATCH on a non-authored email must return 404 (v1: no admin bypass)',
        ).toBe(404);

        // The email is unchanged (still shared) — User B still sees it.
        const userBListAfterAdminAttempt = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userBToken },
        );
        expect(
          userBListAfterAdminAttempt.ok(),
          'User B GET interactions after admin attempt should succeed',
        ).toBeTruthy();
        const userBItemsAfterAdminAttempt = await readJsonSafe<{
          items?: Array<{ id?: string }>;
        }>(userBListAfterAdminAttempt);
        expect(
          (userBItemsAfterAdminAttempt?.items ?? []).some((item) => item.id === interactionId),
          'Email remains shared after the denied admin attempt — User B still sees it',
        ).toBe(true);

        // ── Scenario 5: Author can flip their own email back to private ──────
        //
        // The email is currently shared (from Scenario 2; the admin attempt in
        // Scenario 4 was denied), so a flip to private must report changed: true.
        const userAFlipToPrivateResp = await apiRequest(request, 'PATCH', visibilityPath, {
          token: userAToken,
          data: { visibility: 'private' },
        });
        expect(
          userAFlipToPrivateResp.status(),
          'Author flip own email to private should return 200',
        ).toBe(200);
        const userAFlipToPrivateBody = await readJsonSafe<{ ok?: boolean; changed?: boolean }>(
          userAFlipToPrivateResp,
        );
        expect(
          userAFlipToPrivateBody?.ok,
          'Author flip own email to private should return { ok: true }',
        ).toBe(true);
        expect(
          userAFlipToPrivateBody?.changed,
          'Author flip own email to private should return { changed: true }',
        ).toBe(true);

        // User B no longer sees it (private, and B is not the author).
        const userBListAfterPrivate = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userBToken },
        );
        const userBItemsAfterPrivate = await readJsonSafe<{
          items?: Array<{ id?: string }>;
        }>(userBListAfterPrivate);
        expect(
          (userBItemsAfterPrivate?.items ?? []).some((item) => item.id === interactionId),
          'User B must NOT see the email after the author restored it to private',
        ).toBe(false);
      } finally {
        // Cleanup is best-effort and ordered: interaction → person → users → roles.
        if (adminToken) {
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/interactions',
            interactionId,
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
        await deleteUserIfExists(request, adminToken, userAdminId);
        await deleteRoleIfExists(request, adminToken, employeeRoleId);
        await deleteRoleIfExists(request, adminToken, adminRoleId);
      }
    },
  );
});
