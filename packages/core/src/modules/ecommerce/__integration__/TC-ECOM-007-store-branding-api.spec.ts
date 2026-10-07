import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import {
  ASSORTMENT_COUNT_PATH,
  CHANNEL_BINDINGS_PATH,
  STORES_PATH,
  STORE_BRANDING_PATH,
  STORE_PREVIEW_BRANDING_PATH,
  cleanupScopedActor,
  cleanupStorefrontFixture,
  createScopedActor,
  createStorefrontFixture,
  readStoreRecord,
  toEpochMs,
  uniqueStamp,
  type ScopedActor,
  type StorefrontFixture,
} from './helpers';

/**
 * TC-ECOM-007: store branding API, settings guards and assortment-scope validation.
 * Source: .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md §16 "API paths" —
 * branding write gated by `ecommerce.branding.manage`, branding replaced only through its own
 * route (other settings untouched, new `updatedAt` returned, optimistic lock honoured), the
 * general store PUT refusing a branding change and unknown settings keys, channel-binding
 * `assortment_scope` rejecting `allOf`, and the preview route rendering CSS without persisting.
 */

type FieldErrorBody = { error?: string; fieldErrors?: Record<string, string> };
type BrandingResponseBody = { id?: string; updatedAt?: string; branding?: Record<string, unknown> };
type PreviewResponseBody = { css?: string; styleBlock?: string; declarations?: Array<{ property: string; value: string }> };

const STORE_MANAGER_FEATURES = ['ecommerce.stores.view', 'ecommerce.stores.manage', 'ecommerce.channels.manage'];

const SEEDED_SETTINGS = {
  contact: { email: 'qa-ecom-branding@test.invalid', phone: '+48 600 000 000' },
  display: { priceDisplayModeDefault: 'net', enableSearch: false },
  seo: { siteName: 'QA ECOM Branding', defaultMetaDescription: 'Branding isolation check' },
} as const;

test.describe('TC-ECOM-007: store branding API and settings guards', () => {
  test.describe.configure({ timeout: 120_000 });

  test('branding writes need ecommerce.branding.manage', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    const { tenantId, organizationId } = getTokenContext(token);
    let fixture: StorefrontFixture | null = null;
    let manager: ScopedActor | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      manager = await createScopedActor(request, superadminToken, {
        stamp,
        tenantId,
        organizationId,
        features: STORE_MANAGER_FEATURES,
        label: 'store-manager',
      });
      const before = await readStoreRecord(request, token, fixture.storeId);

      const denied = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token: manager.token,
        data: { primaryColor: '#112233' },
      });
      expect(denied.status(), `branding PUT without the feature must be 403 (${await denied.text()})`).toBe(403);

      const deniedPreview = await apiRequest(
        request,
        'GET',
        `${STORE_PREVIEW_BRANDING_PATH(fixture.storeId)}?primaryColor=${encodeURIComponent('#112233')}`,
        { token: manager.token },
      );
      expect(deniedPreview.status(), 'branding preview without the feature must be 403').toBe(403);

      const deniedCreate = await apiRequest(request, 'POST', STORES_PATH, {
        token: manager.token,
        data: {
          code: `qa_ecom_denied_${stamp}`.replace(/-/g, '_'),
          name: `QA ECOM Denied ${stamp}`,
          slug: `qa-ecom-denied-${stamp}`,
          defaultLocale: 'en',
          supportedLocales: ['en'],
          defaultCurrencyCode: 'EUR',
          settings: { branding: { primaryColor: '#112233' } },
        },
      });
      expect(deniedCreate.status(), `store create carrying branding must be 403 (${await deniedCreate.text()})`).toBe(403);
      expect((await readJsonSafe<FieldErrorBody>(deniedCreate))?.fieldErrors ?? {}).toHaveProperty(['settings.branding']);

      const managerRename = await apiRequest(request, 'PUT', STORES_PATH, {
        token: manager.token,
        data: { id: fixture.storeId, name: `QA ECOM Renamed ${stamp}` },
      });
      expect(managerRename.status(), 'a store manager still edits the store itself').toBe(200);

      const after = await readStoreRecord(request, token, fixture.storeId);
      expect(after.settings?.branding ?? {}).toEqual(before.settings?.branding ?? {});
    } finally {
      await cleanupScopedActor(request, superadminToken, manager);
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('the branding route replaces only settings.branding, returns the new updatedAt and honours the lock', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      const seeded = await apiRequest(request, 'PUT', STORES_PATH, {
        token,
        data: { id: fixture.storeId, settings: SEEDED_SETTINGS },
      });
      expect(seeded.status(), `settings seed should be 200 (${await seeded.text()})`).toBe(200);
      const before = await readStoreRecord(request, token, fixture.storeId);

      const saved = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token,
        data: { primaryColor: '#112233', borderRadius: '0.5rem', fontFamilyBase: 'system-serif' },
      });
      expect(saved.status(), `branding PUT should be 200 (${await saved.text()})`).toBe(200);
      const savedBody = await readJsonSafe<BrandingResponseBody>(saved);
      expect(savedBody?.id).toBe(fixture.storeId);
      expect(savedBody?.branding).toEqual({ primaryColor: '#112233', borderRadius: '0.5rem', fontFamilyBase: 'system-serif' });
      expect(typeof savedBody?.updatedAt, 'branding PUT returns the new updatedAt').toBe('string');

      const after = await readStoreRecord(request, token, fixture.storeId);
      expect(toEpochMs(after.updatedAt)).toBe(toEpochMs(savedBody?.updatedAt ?? ''));
      expect(toEpochMs(after.updatedAt)).toBeGreaterThan(toEpochMs(before.updatedAt));
      expect(after.settings?.branding).toEqual({ primaryColor: '#112233', borderRadius: '0.5rem', fontFamilyBase: 'system-serif' });
      expect(after.settings?.contact).toEqual(before.settings?.contact);
      expect(after.settings?.display).toEqual(before.settings?.display);
      expect(after.settings?.seo).toEqual(before.settings?.seo);
      expect(after.name).toBe(before.name);

      const stale = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: new Date(toEpochMs(before.updatedAt)).toISOString() },
        data: { primaryColor: '#445566' },
      });
      expect(stale.status(), `a stale branding PUT must 409 (${await stale.text()})`).toBe(409);
      expect((await readJsonSafe<{ code?: string }>(stale))?.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE);

      const fresh = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: new Date(toEpochMs(after.updatedAt)).toISOString() },
        data: { primaryColor: '#445566' },
      });
      expect(fresh.status(), `a fresh branding PUT should be 200 (${await fresh.text()})`).toBe(200);
      const replaced = await readStoreRecord(request, token, fixture.storeId);
      expect(replaced.settings?.branding, 'branding uses replace semantics').toEqual({ primaryColor: '#445566' });
      expect(replaced.settings?.seo).toEqual(before.settings?.seo);

      const badColour = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token,
        data: { primaryColor: 'red; } body { color: red' },
      });
      expect(badColour.status(), 'an invalid colour must be 400').toBe(400);
      expect((await readJsonSafe<FieldErrorBody>(badColour))?.fieldErrors ?? {}).toHaveProperty('primaryColor');

      const unknownKey = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token,
        data: { primaryColor: '#445566', backgroundImage: 'https://example.com/a.png' },
      });
      expect(unknownKey.status(), 'an unknown branding key must be 400').toBe(400);
      expect((await readJsonSafe<FieldErrorBody>(unknownKey))?.fieldErrors ?? {}).toHaveProperty('backgroundImage');

      const unchanged = await readStoreRecord(request, token, fixture.storeId);
      expect(unchanged.settings?.branding).toEqual({ primaryColor: '#445566' });
      expect(toEpochMs(unchanged.updatedAt)).toBe(toEpochMs(replaced.updatedAt));
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('the general store PUT refuses branding changes and unknown settings keys', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      const branded = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token,
        data: { primaryColor: '#112233' },
      });
      expect(branded.status()).toBe(200);
      const before = await readStoreRecord(request, token, fixture.storeId);

      const brandingViaGeneral = await apiRequest(request, 'PUT', STORES_PATH, {
        token,
        data: { id: fixture.storeId, settings: { branding: { primaryColor: '#ffffff' } } },
      });
      expect(brandingViaGeneral.status(), `branding change via the general PUT must be 400`).toBe(400);
      expect((await readJsonSafe<FieldErrorBody>(brandingViaGeneral))?.fieldErrors ?? {}).toHaveProperty([
        'settings.branding',
      ]);

      const sameBranding = await apiRequest(request, 'PUT', STORES_PATH, {
        token,
        data: {
          id: fixture.storeId,
          settings: { branding: { primaryColor: '#112233' }, seo: { siteName: `QA ECOM SEO ${stamp}` } },
        },
      });
      expect(sameBranding.status(), `re-sending the unchanged branding is accepted (${await sameBranding.text()})`).toBe(
        200,
      );

      const unknownSettingsKey = await apiRequest(request, 'PUT', STORES_PATH, {
        token,
        data: { id: fixture.storeId, settings: { checkout: { guest: true } } },
      });
      expect(unknownSettingsKey.status(), 'an unknown settings key must be 400').toBe(400);

      const unknownNestedKey = await apiRequest(request, 'PUT', STORES_PATH, {
        token,
        data: { id: fixture.storeId, settings: { seo: { keywords: 'shop' } } },
      });
      expect(unknownNestedKey.status(), 'an unknown nested settings key must be 400').toBe(400);

      const after = await readStoreRecord(request, token, fixture.storeId);
      expect(after.settings?.branding).toEqual(before.settings?.branding);
      expect(after.settings?.seo).toEqual({ siteName: `QA ECOM SEO ${stamp}` });
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('channel-binding assortment_scope rejects allOf on write and on the live count', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      const bindingId = fixture.channelBindingId ?? '';
      const allOfScope = { allOf: [{ categoryIds: [fixture.storeId] }] };

      const update = await apiRequest(request, 'PUT', CHANNEL_BINDINGS_PATH, {
        token,
        data: { id: bindingId, assortmentScope: allOfScope },
      });
      expect(update.status(), `assortmentScope with allOf must be 400 on update (${await update.text()})`).toBe(400);

      const createBinding = await apiRequest(request, 'POST', CHANNEL_BINDINGS_PATH, {
        token,
        data: {
          storeId: fixture.storeId,
          salesChannelId: fixture.salesChannelId,
          isDefault: false,
          assortmentScope: allOfScope,
        },
      });
      expect(createBinding.status(), 'assortmentScope with allOf must be 400 on create').toBe(400);

      const draftCount = await apiRequest(
        request,
        'GET',
        `${ASSORTMENT_COUNT_PATH(bindingId)}?draftScope=${encodeURIComponent(JSON.stringify(allOfScope))}`,
        { token },
      );
      expect(draftCount.status(), 'a draft scope with allOf must be 400 on the live count').toBe(400);

      const savedCount = await apiRequest(request, 'GET', ASSORTMENT_COUNT_PATH(bindingId), { token });
      expect(savedCount.status(), 'the saved scope still counts').toBe(200);
      expect((await readJsonSafe<{ scopeSource?: string }>(savedCount))?.scopeSource).toBe('saved');
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('preview-branding renders CSS for valid values, 400 for invalid ones, and writes nothing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      const before = await readStoreRecord(request, token, fixture.storeId);

      const query = new URLSearchParams({ primaryColor: '#AABBCC', borderRadius: '0.75rem' }).toString();
      const preview = await apiRequest(request, 'GET', `${STORE_PREVIEW_BRANDING_PATH(fixture.storeId)}?${query}`, {
        token,
      });
      expect(preview.status(), `preview should be 200 (${await preview.text()})`).toBe(200);
      expect(preview.headers()['cache-control']).toBe('no-store');
      const body = await readJsonSafe<PreviewResponseBody>(preview);
      expect(body?.css ?? '').toMatch(/^:root\{/);
      expect(body?.css ?? '').toContain('--primary:#aabbcc');
      expect(body?.css ?? '').toContain('--radius:0.75rem');
      expect(body?.styleBlock ?? '').toContain(body?.css ?? '');
      expect(body?.declarations ?? []).toContainEqual({ property: '--primary', value: '#aabbcc' });

      const invalidColour = await apiRequest(
        request,
        'GET',
        `${STORE_PREVIEW_BRANDING_PATH(fixture.storeId)}?${new URLSearchParams({ primaryColor: 'url(javascript:1)' }).toString()}`,
        { token },
      );
      expect(invalidColour.status(), 'an invalid preview colour must be 400').toBe(400);
      expect((await readJsonSafe<FieldErrorBody>(invalidColour))?.fieldErrors ?? {}).toHaveProperty('primaryColor');

      const unknownParam = await apiRequest(
        request,
        'GET',
        `${STORE_PREVIEW_BRANDING_PATH(fixture.storeId)}?${new URLSearchParams({ customCss: 'body{}' }).toString()}`,
        { token },
      );
      expect(unknownParam.status(), 'an unknown preview parameter must be 400').toBe(400);

      const after = await readStoreRecord(request, token, fixture.storeId);
      expect(after.settings?.branding ?? {}).toEqual(before.settings?.branding ?? {});
      expect(toEpochMs(after.updatedAt), 'previewing never writes the store').toBe(toEpochMs(before.updatedAt));
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });
});
