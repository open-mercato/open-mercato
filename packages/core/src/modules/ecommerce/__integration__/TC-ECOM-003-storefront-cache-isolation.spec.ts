import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerCompanyFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerUserFixture,
  portalLogin,
  type CustomerUserFixture,
  type PortalSession,
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
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createStorefrontFixture,
  deletePriceKindIfExists,
  getStorefrontContext,
  uniqueStamp,
  type PriceKindDisplayMode,
  type StorefrontFixture,
} from './helpers';

/**
 * TC-ECOM-003: storefront cache isolation (SPEC-029 Phase 1 gate).
 * Source: .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md §16 "Cache isolation".
 *
 * The buyer layer is cached per (store, customerUserId | anonymous). These cases interleave
 * anonymous and authenticated requests for the same URL and assert no response ever carries
 * another caller's projection, and that the HTTP cache directives keep authenticated bodies out
 * of shared caches.
 */

type Buyer = {
  companyId: string;
  user: CustomerUserFixture;
  groupId: string;
  membershipId: string;
  session: PortalSession | null;
};

type BuyerTracker = {
  companyIds: string[];
  userIds: string[];
  groupIds: string[];
  membershipIds: string[];
};

async function createGroupBuyer(
  request: APIRequestContext,
  token: string,
  tracker: BuyerTracker,
  input: { stamp: string; label: string; priceKindId: string; allowPurchaseOnAccount: boolean },
): Promise<Buyer> {
  const companyId = await createCustomerCompanyFixture(request, token, `QA ECOM ${input.label} Co ${input.stamp}`);
  tracker.companyIds.push(companyId);
  const user = await createCustomerUserFixture(request, token, {
    customerEntityId: companyId,
    displayName: `QA ECOM ${input.label} Buyer ${input.stamp}`,
  });
  tracker.userIds.push(user.id);
  const groupId = await createCustomerGroupFixture(request, token, {
    code: `qa-ecom-003-${input.label}-${input.stamp}`,
    name: `QA ECOM 003 ${input.label} ${input.stamp}`,
    kind: 'b2b',
  });
  tracker.groupIds.push(groupId);
  await createCustomerGroupTermsFixture(request, token, {
    groupId,
    priceKindId: input.priceKindId,
    allowPurchaseOnAccount: input.allowPurchaseOnAccount,
  });
  const membershipId = await createCustomerGroupMembershipFixture(request, token, { groupId, customerId: companyId });
  tracker.membershipIds.push(membershipId);
  return { companyId, user, groupId, membershipId, session: null };
}

async function cleanupBuyers(request: APIRequestContext, token: string, tracker: BuyerTracker): Promise<void> {
  for (const id of tracker.membershipIds) await deleteCustomerGroupMembershipIfExists(request, token, id);
  for (const id of tracker.groupIds) await deleteCustomerGroupIfExists(request, token, id);
  for (const id of tracker.userIds) await deleteCustomerUserFixture(request, token, id);
  for (const id of tracker.companyIds) await deleteCustomerCompanyFixture(request, token, id);
}

async function createPriceKinds(
  request: APIRequestContext,
  token: string,
  stamp: string,
  modes: Array<{ suffix: string; displayMode: PriceKindDisplayMode }>,
  created: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const mode of modes) {
    const id = await createPriceKindFixture(request, token, { stamp, ...mode });
    created.push(id);
    ids.push(id);
  }
  return ids;
}

test.describe('TC-ECOM-003: storefront cache isolation', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an anonymous request after an authenticated one never receives the authenticated body', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const priceKindIds: string[] = [];
    const tracker: BuyerTracker = { companyIds: [], userIds: [], groupIds: [], membershipIds: [] };
    let fixture: StorefrontFixture | null = null;
    try {
      const [channelKindId, groupKindId] = await createPriceKinds(
        request,
        token,
        stamp,
        [
          { suffix: 'channel', displayMode: 'excluding-tax' },
          { suffix: 'group', displayMode: 'including-tax' },
        ],
        priceKindIds,
      );
      fixture = await createStorefrontFixture(request, token, { stamp, channelPriceKindId: channelKindId });
      const buyer = await createGroupBuyer(request, token, tracker, {
        stamp,
        label: 'auth',
        priceKindId: groupKindId,
        allowPurchaseOnAccount: true,
      });
      const session = await portalLogin(request, {
        email: buyer.user.email,
        password: buyer.user.password,
        tenantId: fixture.tenantId,
      });
      const query = { locale: 'en', path: '/' };

      const authenticated = await getStorefrontContext(fixture.hostname, { query, cookie: session.cookieHeader });
      expect(authenticated.status, authenticated.text).toBe(200);
      expect(authenticated.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      const authenticatedBody = asContextBody(authenticated.body);
      expect(authenticatedBody.buyer.isAuthenticated).toBe(true);
      expect(authenticatedBody.buyer.displayName).toBe(buyer.user.displayName);
      expect(authenticatedBody.buyer.taxMode).toBe('gross');

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const anonymous = await getStorefrontContext(fixture.hostname, { query });
        expect(anonymous.status, anonymous.text).toBe(200);
        expect(anonymous.headers['cache-control']).toBe(ANONYMOUS_CACHE_CONTROL);
        const anonymousBody = asContextBody(anonymous.body);
        expect(anonymousBody.buyer).toEqual({
          isAuthenticated: false,
          taxMode: 'net',
          displayName: null,
          companyName: null,
          allowPurchaseOnAccount: false,
        });
        expect(anonymous.text).not.toContain(buyer.user.displayName);
      }

      const authenticatedAgain = await getStorefrontContext(fixture.hostname, { query, cookie: session.cookieHeader });
      expect(authenticatedAgain.status, authenticatedAgain.text).toBe(200);
      expect(authenticatedAgain.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(asContextBody(authenticatedAgain.body).buyer).toEqual(authenticatedBody.buyer);
    } finally {
      await cleanupBuyers(request, token, tracker);
      await cleanupStorefrontFixture(request, token, fixture);
      for (const id of priceKindIds) await deletePriceKindIfExists(request, token, id);
    }
  });

  test('two buyers in different groups never share a buyer projection', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const priceKindIds: string[] = [];
    const tracker: BuyerTracker = { companyIds: [], userIds: [], groupIds: [], membershipIds: [] };
    let fixture: StorefrontFixture | null = null;
    try {
      const [channelKindId, grossKindId, netKindId] = await createPriceKinds(
        request,
        token,
        stamp,
        [
          { suffix: 'channel', displayMode: 'including-tax' },
          { suffix: 'gross', displayMode: 'including-tax' },
          { suffix: 'net', displayMode: 'excluding-tax' },
        ],
        priceKindIds,
      );
      fixture = await createStorefrontFixture(request, token, { stamp, channelPriceKindId: channelKindId });
      const grossBuyer = await createGroupBuyer(request, token, tracker, {
        stamp,
        label: 'gross',
        priceKindId: grossKindId,
        allowPurchaseOnAccount: false,
      });
      const netBuyer = await createGroupBuyer(request, token, tracker, {
        stamp,
        label: 'net',
        priceKindId: netKindId,
        allowPurchaseOnAccount: true,
      });
      grossBuyer.session = await portalLogin(request, {
        email: grossBuyer.user.email,
        password: grossBuyer.user.password,
        tenantId: fixture.tenantId,
      });
      netBuyer.session = await portalLogin(request, {
        email: netBuyer.user.email,
        password: netBuyer.user.password,
        tenantId: fixture.tenantId,
      });

      const expected = new Map<Buyer, { taxMode: 'gross' | 'net'; allowPurchaseOnAccount: boolean }>([
        [grossBuyer, { taxMode: 'gross', allowPurchaseOnAccount: false }],
        [netBuyer, { taxMode: 'net', allowPurchaseOnAccount: true }],
      ]);

      for (const buyer of [grossBuyer, netBuyer, grossBuyer, netBuyer]) {
        const response = await getStorefrontContext(fixture.hostname, { cookie: buyer.session!.cookieHeader });
        expect(response.status, response.text).toBe(200);
        expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
        const body = asContextBody(response.body);
        expect(body.buyer.isAuthenticated).toBe(true);
        expect(body.buyer.displayName).toBe(buyer.user.displayName);
        expect(body.buyer.taxMode).toBe(expected.get(buyer)!.taxMode);
        expect(body.buyer.allowPurchaseOnAccount).toBe(expected.get(buyer)!.allowPurchaseOnAccount);
      }
    } finally {
      await cleanupBuyers(request, token, tracker);
      await cleanupStorefrontFixture(request, token, fixture);
      for (const id of priceKindIds) await deletePriceKindIfExists(request, token, id);
    }
  });
});
