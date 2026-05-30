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
 * TC-CRM-EMAIL-007: No-channel UX — Person detail page
 *
 * Verifies that the Person detail page renders the "Connect your mailbox"
 * CTA (linking to /backend/profile/communication-channels) when the current
 * user has no connected channel, and that the standard "Send email" button is
 * NOT present (the no-channel swap is exclusive).
 *
 * The header actions component (PersonEmailActions) calls GET
 * /api/communication_channels/me/channels. When that returns { items: [] }
 * (no channel created for this user), it renders the "Connect your mailbox"
 * link instead of the "Send email" button.
 */
test.describe('TC-CRM-EMAIL-007: No-channel UX on Person detail page', () => {
  test(
    '"Connect your mailbox" CTA is shown and "Send email" button is absent when user has no channel',
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

        // -- Setup: role with people.view + people.manage + email.compose, but
        //    deliberately without communication_channels.manage so the user
        //    has no channel-creation privileges.
        const roleName = `qa_crm_email_007_${stamp}`;
        roleId = await createRoleFixture(request, adminToken, {
          name: roleName,
          tenantId: scope.tenantId,
        });

        const aclResp = await apiRequest(request, 'PUT', `/api/auth/roles/${roleId}/acl`, {
          token: adminToken,
          data: {
            features: [
              'customers.people.view',
              'customers.people.manage',
              'customers.email.compose',
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

        // -- Action: login as the new user and navigate to the Person detail page

        // Login using page.request so we can set tenant/org cookies, exactly
        // like TC-AUTH-022 does for custom-credential users.
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

        await page.goto(`/backend/customers/people-v2/${personId}`, {
          waitUntil: 'domcontentloaded',
        });

        // -- Assertion 1: the page renders without an application error ---------
        const errorHeading = page.getByRole('heading', {
          name: /Application error: a client-side exception has occurred/i,
        });
        await expect(errorHeading).not.toBeVisible();

        // -- Assertion 2: "Connect your mailbox" CTA is visible -----------------
        //
        // The widget loads channels asynchronously; while loading it renders
        // nothing. We wait up to 15 s for the CTA to appear. The element is a
        // <Button asChild> wrapping a Next.js <Link>, so it appears in the DOM
        // as an anchor element. We match either an anchor or a button to be
        // resilient to future markup changes.
        const connectCta = page.locator(
          'a:has-text("Connect your mailbox"), button:has-text("Connect your mailbox")',
        );
        await expect(connectCta.first()).toBeVisible({ timeout: 15_000 });

        // -- Assertion 3: the CTA href points to the communication-channels page
        const href = await connectCta.first().getAttribute('href');
        expect(href, '"Connect your mailbox" link href must be /backend/profile/communication-channels').toBe(
          '/backend/profile/communication-channels',
        );

        // -- Assertion 4: the "Send email" button is NOT present ----------------
        //
        // Regex is anchored to the exact label so it does not accidentally
        // match "Send an email" or other similar labels that may appear elsewhere
        // on the page.
        const sendEmailButton = page.getByRole('button', { name: /^send email$/i });
        await expect(sendEmailButton).not.toBeVisible();
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
