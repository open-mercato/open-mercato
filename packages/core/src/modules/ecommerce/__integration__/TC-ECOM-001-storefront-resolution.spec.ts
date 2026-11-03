import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  ANONYMOUS_CACHE_CONTROL,
  asContextBody,
  cleanupStorefrontFixture,
  createStorefrontFixture,
  getStorefrontContext,
  storefrontHostname,
  uniqueStamp,
  type StorefrontFixture,
} from './helpers';

/**
 * TC-ECOM-001: storefront store resolution by host.
 * Source: .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md §16 "Resolution".
 *
 * `GET /api/ecommerce/storefront/context` resolves Host → active `DomainMapping` → store domain
 * binding → store + default channel binding. Every failure mode answers a bare `{ error }` body so
 * nothing about a hidden store leaks; an unknown host and a draft store must be indistinguishable.
 */
test.describe('TC-ECOM-001: storefront resolution by host', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an active mapping with a binding resolves the store with a public cacheable projection', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { defaultCurrencyCode: 'EUR' });
      const response = await getStorefrontContext(fixture.hostname);
      expect(response.status, `context should resolve (${response.text})`).toBe(200);
      expect(response.headers['cache-control']).toBe(ANONYMOUS_CACHE_CONTROL);
      expect(response.headers.vary ?? '').toContain('Cookie');
      expect(response.headers.vary ?? '').toContain('Authorization');
      const body = asContextBody(response.body);
      expect(body.store.id).toBe(fixture.storeId);
      expect(body.store.slug).toBe(`qa-ecom-${fixture.stamp}`);
      expect(body.store.status).toBe('active');
      expect(body.currencyCode).toBe('EUR');
      expect(body.buyer.isAuthenticated).toBe(false);
      expect(body.buyer.displayName).toBeNull();
      expect(body.buyer.companyName).toBeNull();
      expect(body).not.toHaveProperty('tenantId');
      expect(body).not.toHaveProperty('organizationId');
      expect(body).not.toHaveProperty('channel');
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('locale negotiation falls back to the default locale and reports the requested one', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { defaultLocale: 'en', supportedLocales: ['en', 'de'] });

      const unsupported = await getStorefrontContext(fixture.hostname, { query: { locale: 'fr' } });
      expect(unsupported.status, unsupported.text).toBe(200);
      const unsupportedBody = asContextBody(unsupported.body);
      expect(unsupportedBody.requestedLocale).toBe('fr');
      expect(unsupportedBody.effectiveLocale).toBe('en');
      expect(unsupportedBody.supportedLocales).toEqual(['en', 'de']);

      const regional = await getStorefrontContext(fixture.hostname, { query: { locale: 'de-AT' } });
      expect(regional.status, regional.text).toBe(200);
      const regionalBody = asContextBody(regional.body);
      expect(regionalBody.requestedLocale).toBe('de-AT');
      expect(regionalBody.effectiveLocale).toBe('de');

      const headerOnly = await getStorefrontContext(fixture.hostname, { headers: { 'Accept-Language': 'de;q=0.9, fr' } });
      expect(headerOnly.status, headerOnly.text).toBe(200);
      const headerBody = asContextBody(headerOnly.body);
      expect(headerBody.requestedLocale).toBeNull();
      expect(headerBody.effectiveLocale).toBe('de');
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('an unknown host, a draft store and a verified-but-not-active mapping all answer the same 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let draft: StorefrontFixture | null = null;
    let verifiedOnly: StorefrontFixture | null = null;
    try {
      draft = await createStorefrontFixture(request, token, { status: 'draft' });
      verifiedOnly = await createStorefrontFixture(request, token, { domainMappingStatus: 'verified' });

      const unknown = await getStorefrontContext(storefrontHostname(uniqueStamp(), 'unknown'));
      const draftResponse = await getStorefrontContext(draft.hostname);
      const verifiedResponse = await getStorefrontContext(verifiedOnly.hostname);

      for (const response of [unknown, draftResponse, verifiedResponse]) {
        expect(response.status, response.text).toBe(404);
        expect(response.body).toEqual({ error: 'store_not_found' });
        expect(response.headers['cache-control']).toBe('no-store');
      }
      expect(draftResponse.text).toBe(unknown.text);
      expect(verifiedResponse.text).toBe(unknown.text);
    } finally {
      await cleanupStorefrontFixture(request, token, draft);
      await cleanupStorefrontFixture(request, token, verifiedOnly);
    }
  });

  test('an archived store answers 410', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { status: 'archived' });
      const response = await getStorefrontContext(fixture.hostname);
      expect(response.status, response.text).toBe(410);
      expect(response.body).toEqual({ error: 'store_archived' });
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('a store without a default channel binding answers 503', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { withChannelBinding: false });
      const first = await getStorefrontContext(fixture.hostname);
      expect(first.status, first.text).toBe(503);
      expect(first.body).toEqual({ error: 'store_misconfigured' });
      const second = await getStorefrontContext(fixture.hostname);
      expect(second.status, second.text).toBe(503);
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('storeSlug is rejected with 400 while the development flag is off', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token);
      const response = await getStorefrontContext(fixture.hostname, { query: { storeSlug: `qa-ecom-${fixture.stamp}` } });
      expect(response.status, response.text).toBe(400);
      expect(response.body).toEqual({ error: 'store_slug_not_allowed' });
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });
});
