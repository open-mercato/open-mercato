import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_CURRENT_PATH,
  cartStorefrontRequest,
  cleanupCartStorefrontFixture,
  cleanupSecondTenantCartActor,
  createCartStorefrontFixture,
  createSecondTenantCartActor,
  createStorefrontCart,
  uniqueStamp,
  type CartStorefrontFixture,
  type SecondTenantCartActor,
} from './helpers';

/**
 * TC-CART-R1-12 — cross-tenant cart-token isolation (§8.3/§10: a cart is addressed purely
 * by an opaque bearer `X-Cart-Token`, never a path segment or query string). Review finding
 * (PR #15): every other `TC-CART-R1-*` spec proves per-line assortment visibility and
 * request-body hardening, but none of them proved a token minted under one tenant's store
 * cannot resolve any data when presented at a DIFFERENT tenant's storefront host — the
 * natural wrong-scope-read boundary for a token-only addressing model.
 * Fixtures are created inline in the test body, not `beforeAll` — same convention as
 * `promotions/__integration__/TC-PROM-004-tenant-isolation.spec.ts`'s own second-tenant-actor
 * test: `beforeAll`/`afterAll` hooks keep this suite's project-level 20s timeout regardless of
 * `test.describe.configure({ timeout })`, which only extends the test body itself — and
 * provisioning a whole second tenant (org, role, ACL grant, user, token, storefront chain) on
 * a cold dev server can exceed that.
 * Source: .ai/specs/2026-08-14-cart-module.md §8.3, §10, §6a.1c.
 */
test.describe('TC-CART-R1-12: a cart token minted under one tenant cannot resolve data at another tenant\'s storefront host', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a tenant-A cart token 404s at tenant B\'s host, and keeps resolving at tenant A\'s own host', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();

    let storeA: CartStorefrontFixture | null = null;
    let tenantB: SecondTenantCartActor | null = null;
    let storeB: CartStorefrontFixture | null = null;

    try {
      storeA = await createCartStorefrontFixture(request, adminToken, {});
      tenantB = await createSecondTenantCartActor(request, superadminToken, stamp);
      storeB = await createCartStorefrontFixture(request, tenantB.token, {});

      const { token } = await createStorefrontCart(storeA.hostname);

      // Sanity: the token still resolves at its own tenant's host.
      const sameTenant = await cartStorefrontRequest(storeA.hostname, CART_CURRENT_PATH, {
        method: 'GET',
        cartToken: token,
      });
      expect(sameTenant.status, sameTenant.text).toBe(200);

      // The cross-tenant attempt: tenant A's token, presented at tenant B's host.
      const crossTenant = await cartStorefrontRequest(storeB.hostname, CART_CURRENT_PATH, {
        method: 'GET',
        cartToken: token,
      });
      expect(crossTenant.status, `a tenant-A token must not resolve any cart at tenant B's host (${crossTenant.text})`).toBe(404);
    } finally {
      await cleanupCartStorefrontFixture(request, tenantB?.token ?? null, storeB);
      await cleanupSecondTenantCartActor(request, superadminToken, tenantB);
      await cleanupCartStorefrontFixture(request, adminToken, storeA);
    }
  });
});
