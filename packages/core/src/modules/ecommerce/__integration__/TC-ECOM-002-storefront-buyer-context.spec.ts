import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerCompanyFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerUserFixture,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures';
import {
  createCustomerGroupFixture,
  createCustomerGroupMembershipFixture,
  createCustomerGroupTermsFixture,
  deleteCustomerGroupIfExists,
  deleteCustomerGroupMembershipIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import {
  ANONYMOUS_CACHE_CONTROL,
  PRIVATE_CACHE_CONTROL,
  asContextBody,
  cleanupSecondTenantActor,
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createSecondTenantActor,
  createStorefrontFixture,
  deletePriceKindIfExists,
  getStorefrontContext,
  uniqueStamp,
  type SecondTenantActor,
  type StorefrontFixture,
} from './helpers';

/**
 * TC-ECOM-002: storefront buyer context.
 * Source: .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md §16 "Buyer context" and
 * "Identity and tenant binding" (D3/D4).
 *
 * The channel binding carries an `excluding-tax` price kind while the store's display default is
 * `gross`, so an anonymous `net` proves `taxMode` is derived from the channel price kind and not
 * from the store fallback. The buyer's company sits in a group whose terms select an
 * `including-tax` price kind, so an authenticated `gross` proves the group kind overrides the
 * channel kind.
 */
test.describe('TC-ECOM-002: storefront buyer context', () => {
  test.describe.configure({ timeout: 120_000 });

  test('anonymous and authenticated buyers resolve taxMode from the effective price kind', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let channelPriceKindId: string | null = null;
    let groupPriceKindId: string | null = null;
    let fixture: StorefrontFixture | null = null;
    let companyId: string | null = null;
    let customerUserId: string | null = null;
    let groupId: string | null = null;
    let membershipId: string | null = null;
    try {
      channelPriceKindId = await createPriceKindFixture(request, token, {
        stamp,
        suffix: 'channel',
        displayMode: 'excluding-tax',
      });
      groupPriceKindId = await createPriceKindFixture(request, token, {
        stamp,
        suffix: 'group',
        displayMode: 'including-tax',
      });
      fixture = await createStorefrontFixture(request, token, {
        stamp,
        channelPriceKindId,
        priceDisplayModeDefault: 'gross',
      });

      const companyName = `QA ECOM Company ${stamp}`;
      companyId = await createCustomerCompanyFixture(request, token, companyName);
      const customerUser = await createCustomerUserFixture(request, token, {
        customerEntityId: companyId,
        displayName: `QA ECOM Buyer ${stamp}`,
      });
      customerUserId = customerUser.id;
      groupId = await createCustomerGroupFixture(request, token, {
        code: `qa-ecom-002-${stamp}`,
        name: `QA ECOM 002 Group ${stamp}`,
        kind: 'b2b',
      });
      await createCustomerGroupTermsFixture(request, token, {
        groupId,
        priceKindId: groupPriceKindId,
        allowPurchaseOnAccount: true,
      });
      membershipId = await createCustomerGroupMembershipFixture(request, token, { groupId, customerId: companyId });

      const anonymous = await getStorefrontContext(fixture.hostname);
      expect(anonymous.status, anonymous.text).toBe(200);
      expect(anonymous.headers['cache-control']).toBe(ANONYMOUS_CACHE_CONTROL);
      const anonymousBody = asContextBody(anonymous.body);
      expect(anonymousBody.buyer.isAuthenticated).toBe(false);
      expect(anonymousBody.buyer.taxMode).toBe('net');
      expect(anonymousBody.buyer.allowPurchaseOnAccount).toBe(false);

      const session = await portalLogin(request, {
        email: customerUser.email,
        password: customerUser.password,
        tenantId: fixture.tenantId,
      });

      const byCookie = await getStorefrontContext(fixture.hostname, { cookie: session.cookieHeader });
      expect(byCookie.status, byCookie.text).toBe(200);
      expect(byCookie.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      const cookieBody = asContextBody(byCookie.body);
      expect(cookieBody.buyer.isAuthenticated).toBe(true);
      expect(cookieBody.buyer.taxMode).toBe('gross');
      expect(cookieBody.buyer.allowPurchaseOnAccount).toBe(true);
      expect(cookieBody.buyer.displayName).toBe(customerUser.displayName);
      expect(cookieBody.buyer.companyName).toBe(companyName);

      const byBearer = await getStorefrontContext(fixture.hostname, { bearer: session.authToken });
      expect(byBearer.status, byBearer.text).toBe(200);
      expect(byBearer.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(asContextBody(byBearer.body).buyer).toEqual(cookieBody.buyer);
    } finally {
      await deleteCustomerGroupMembershipIfExists(request, token, membershipId);
      await deleteCustomerGroupIfExists(request, token, groupId);
      await deleteCustomerUserFixture(request, token, customerUserId);
      await deleteCustomerCompanyFixture(request, token, companyId);
      await cleanupStorefrontFixture(request, token, fixture);
      await deletePriceKindIfExists(request, token, groupPriceKindId);
      await deletePriceKindIfExists(request, token, channelPriceKindId);
    }
  });

  test('a portal session issued by a second tenant is rejected with 401', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    let actor: SecondTenantActor | null = null;
    let foreignCustomerUserId: string | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      actor = await createSecondTenantActor(request, superadminToken, stamp, ['customer_accounts.*', 'customers.*']);
      const foreignUser = await createCustomerUserFixture(request, actor.token, {
        displayName: `QA ECOM Foreign Buyer ${stamp}`,
      });
      foreignCustomerUserId = foreignUser.id;
      const foreignSession = await portalLogin(request, {
        email: foreignUser.email,
        password: foreignUser.password,
        tenantId: actor.tenantId,
      });

      const byBearer = await getStorefrontContext(fixture.hostname, { bearer: foreignSession.authToken });
      expect(byBearer.status, byBearer.text).toBe(401);
      expect(byBearer.body).toEqual({ error: 'portal_session_scope_mismatch' });
      expect(byBearer.headers['cache-control']).toBe('no-store');

      const byCookie = await getStorefrontContext(fixture.hostname, { cookie: foreignSession.cookieHeader });
      expect(byCookie.status, byCookie.text).toBe(401);
      expect(byCookie.text).not.toContain(fixture.storeId);

      const anonymousAfter = await getStorefrontContext(fixture.hostname);
      expect(anonymousAfter.status, anonymousAfter.text).toBe(200);
      expect(asContextBody(anonymousAfter.body).buyer.isAuthenticated).toBe(false);
    } finally {
      if (actor) await deleteCustomerUserFixture(request, actor.token, foreignCustomerUserId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });
});
