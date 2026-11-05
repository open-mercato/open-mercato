import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
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
 * TC-CRM-EMAIL-007: No-channel UX lives in the Person Emails TAB.
 *
 * The header `PersonEmailActions` component was removed; the Connect-mailbox CTA
 * + compose now live ONLY in the Emails tab (`PersonEmailThreadsTab` →
 * `EmailThreadsPanel`). When the current user has no connected channel:
 *   - the Emails tab renders the "Connect your mailbox" CTA (`composeDisabledHint`)
 *     linking to /backend/profile/communication-channels, and
 *   - the "New email" trigger is gated off (`canCompose = channels.length > 0`).
 *
 * The Emails tab is reached via the `?tab=emails` query param
 * (`resolveLegacyTab`), which renders `PersonEmailThreadsTab` directly.
 */
test.describe('TC-CRM-EMAIL-007: No-channel UX on the Person Emails tab', () => {
  test(
    '"Connect your mailbox" CTA shows in the Emails tab and "New email" is gated when no channel is connected',
    async ({ page, request }) => {
      test.slow();

      const stamp = Date.now();
      let adminToken: string | null = null;
      let userId: string | null = null;
      let roleId: string | null = null;
      let personId: string | null = null;

      try {
        // -- Setup: admin token and tenant scope --------------------------------
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        // -- Setup: role that can view people + compose email + connect a
        //    mailbox, but with NO channel actually connected for this user, so
        //    GET /api/communication_channels/me/channels returns { items: [] }
        //    and the tab shows the Connect CTA instead of "New email".
        const roleName = `qa_crm_email_007_${stamp}`;
        roleId = await createRoleFixture(request, adminToken, {
          name: roleName,
          tenantId: scope.tenantId,
        });

        const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: {
            roleId,
            features: [
              'customers.people.view',
              'customers.people.manage',
              'customers.email.compose',
              'communication_channels.connect_user_channel',
            ],
          },
        });
        expect(aclResp.ok(), `PUT /api/auth/roles/${roleId}/acl should succeed`).toBeTruthy();

        // -- Setup: create a user in that role ----------------------------------
        const userEmail = `qa-crm-email-007-${stamp}@acme.com`;
        const userPassword = 'Valid1!Pass';
        userId = await createUserFixture(request, adminToken, {
          email: userEmail,
          password: userPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Email 007 User',
        });

        // -- Setup: create a Person entity (admin token — no channel required)
        personId = await createPersonFixture(request, adminToken, {
          firstName: 'CrmEmail007',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail007 Person ${stamp}`,
        });

        // -- Action: login as the new user (set tenant/org cookies like TC-AUTH-022)
        const loginForm = new URLSearchParams();
        loginForm.set('email', userEmail);
        loginForm.set('password', userPassword);
        const loginResp = await page.request.post('/api/auth/login', {
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          data: loginForm.toString(),
        });
        expect(loginResp.ok(), 'Login as test user should succeed').toBeTruthy();

        const loginBody = (await loginResp.json().catch(() => null)) as { token?: string } | null;
        const tokenParts = typeof loginBody?.token === 'string' ? loginBody.token.split('.') : [];
        if (tokenParts.length >= 2) {
          const normalized = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
          const claims = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
            tenantId?: string;
            orgId?: string | null;
          };
          const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
          const cookies = [];
          if (claims.tenantId) {
            cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: baseUrl, sameSite: 'Lax' as const });
          }
          if (claims.orgId) {
            cookies.push({ name: 'om_selected_org', value: claims.orgId, url: baseUrl, sameSite: 'Lax' as const });
          }
          if (cookies.length > 0) {
            await page.context().addCookies(cookies);
          }
        }

        // Land directly on the Emails tab via the legacy `?tab=` param.
        await page.goto(`/backend/customers/people-v2/${personId}?tab=emails`, {
          waitUntil: 'domcontentloaded',
        });

        // -- Assertion 1: the page renders without an application error ---------
        const errorHeading = page.getByRole('heading', {
          name: /Application error: a client-side exception has occurred/i,
        });
        await expect(errorHeading).not.toBeVisible();

        // -- Assertion 2: the "Connect your mailbox" CTA is visible in the tab --
        //
        // The tab loads channels asynchronously; while loading the panel renders
        // the count row, then resolves to the no-channel hint. The CTA is a
        // <Button asChild> wrapping a Next.js <Link>, so it appears as an anchor.
        const connectCta = page.locator(
          'a:has-text("Connect your mailbox"), button:has-text("Connect your mailbox")',
        );
        await expect(connectCta.first()).toBeVisible({ timeout: 15_000 });

        // -- Assertion 3: the CTA href points to the communication-channels page
        const href = await connectCta.first().getAttribute('href');
        expect(
          href,
          '"Connect your mailbox" link href must be /backend/profile/communication-channels',
        ).toBe('/backend/profile/communication-channels');

        // -- Assertion 4: the "New email" trigger is NOT present (compose gated)
        //
        // `EmailThreadsPanel` only renders the "New email" button when
        // `canCompose` (channels.length > 0). With no connected channel it must
        // be absent. Anchored regex so it doesn't match "New email thread" etc.
        const newEmailButton = page.getByRole('button', { name: /^New email$/i });
        await expect(newEmailButton).not.toBeVisible();
      } finally {
        // Cleanup is best-effort and ordered: person → user → role.
        if (adminToken) {
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
        }
        await deleteUserIfExists(request, adminToken, userId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );
});
