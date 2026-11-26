import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';
import injectionTable from '@open-mercato/core/modules/customer_accounts/widgets/injection-table';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AI-INJECT-010: Portal AiChat injection example (Phase 2 WS-C, Step 4.10-4.11).
 *
 * Phase 2 smoke: asserts that the injection table at
 * `packages/core/src/modules/customer_accounts/widgets/injection-table.ts`
 * actually maps the `customer_accounts.injection.portal-ai-assistant-trigger`
 * widget into the frozen `portal:profile:after` spot. The host portal
 * profile page is intentionally NOT edited; the widget registry does the
 * wiring.
 *
 * The UI case logs real portal customers in and checks the trigger renders
 * on `/{orgSlug}/portal/profile` only when the customer holds
 * `portal.account.manage` — the portal-side ACL path of the injection
 * feature gating (#9743).
 *
 * The RTL unit test at
 * `packages/core/src/modules/customer_accounts/widgets/injection/
 * portal-ai-assistant-trigger/__tests__/widget.client.test.tsx` covers
 * the React component wiring.
 */
test.describe('TC-AI-INJECT-010: portal AiChat injection', () => {
  test('portal-ai-assistant-trigger is mapped to portal:profile:after', () => {
    // Frozen spot id per `packages/ui/AGENTS.md` -> Portal Widget Injection Spots.
    // `ModuleInjectionSlot` is a union — accept the array form used by this module.
    const rawSlot = (injectionTable as Record<string, unknown>)['portal:profile:after'];
    expect(Array.isArray(rawSlot)).toBe(true);
    const entries = Array.isArray(rawSlot) ? rawSlot : [];
    expect(entries.length).toBeGreaterThan(0);

    const widgetIds = entries
      .map((entry: unknown) =>
        entry && typeof entry === 'object' && 'widgetId' in entry
          ? String((entry as { widgetId?: unknown }).widgetId ?? '')
          : '',
      )
      .filter((id) => id.length > 0);
    expect(widgetIds).toContain('customer_accounts.injection.portal-ai-assistant-trigger');
  });

  test('profile Ask AI trigger renders for a portal.account.manage customer and stays hidden without it (#9743)', async ({ browser, request }, testInfo) => {
    test.setTimeout(120_000);
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId } = getTokenContext(adminToken);
    const baseURL = testInfo.project.use.baseURL!;
    const roleIds: string[] = [];
    const userIds: string[] = [];

    try {
      const organization = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${organizationId}&tenantId=${tenantId}`,
        { token: adminToken },
      );
      expect(organization.status()).toBe(200);
      const orgSlug = (await readJsonSafe<{ items?: Array<{ slug?: string }> }>(organization))?.items?.[0]?.slug ?? null;
      expect(orgSlug, 'org slug should resolve for portal navigation').toBeTruthy();

      const grantedRoleId = (await createCustomerRoleFixture(request, adminToken, { features: ['portal.account.manage'] })).id;
      roleIds.push(grantedRoleId);
      const ungrantedRoleId = (await createCustomerRoleFixture(request, adminToken, { features: ['portal.orders.view'] })).id;
      roleIds.push(ungrantedRoleId);

      const openProfile = async (roleId: string) => {
        const customerUser = await createCustomerUserFixture(request, adminToken, { roleIds: [roleId] });
        userIds.push(customerUser.id);
        return openPortalProfile(browser, request, baseURL, orgSlug!, tenantId, customerUser);
      };

      const granted = await openProfile(grantedRoleId);
      try {
        await expect(granted.page.locator('[data-ai-portal-inject-trigger]')).toBeVisible({ timeout: 30_000 });
        await granted.page.screenshot({ path: testInfo.outputPath('portal-profile-ask-ai-visible.png'), fullPage: true });
      } finally {
        await granted.context.close();
      }

      const ungranted = await openProfile(ungrantedRoleId);
      try {
        await expect(ungranted.page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
        await expect(ungranted.page.locator('[data-ai-portal-inject-trigger]')).toHaveCount(0);
      } finally {
        await ungranted.context.close();
      }
    } finally {
      for (const userId of userIds) await deleteCustomerUserFixture(request, adminToken, userId).catch(() => undefined);
      for (const roleId of roleIds) await deleteCustomerRoleFixture(request, adminToken, roleId).catch(() => undefined);
    }
  });
});

async function openPortalProfile(
  browser: Browser,
  request: APIRequestContext,
  baseURL: string,
  orgSlug: string,
  tenantId: string,
  customerUser: { email: string; password: string },
) {
  const session = await portalLogin(request, { email: customerUser.email, password: customerUser.password, tenantId });
  const context = await browser.newContext({ baseURL, locale: 'en-US' });
  await context.addCookies([
    { name: 'customer_auth_token', value: session.authToken, url: baseURL, sameSite: 'Lax' },
    { name: 'customer_session_token', value: session.sessionToken, url: baseURL, sameSite: 'Lax' },
    { name: 'locale', value: 'en', url: baseURL, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  await page.goto(`/${orgSlug}/portal/profile`, { waitUntil: 'domcontentloaded' });
  return { context, page };
}
