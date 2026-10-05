import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  OMNIBUS_CONFIG_PATH,
  PRICES_PATH,
  PRICE_KINDS_PATH,
  cleanupOmnibusTenantActor,
  cleanupRestrictedUser,
  createOmnibusProductFixture,
  createOmnibusTenantActor,
  createPriceFixture,
  createPriceKindFixture,
  createRestrictedUser,
  deleteEntityIfExists,
  fetchOmnibusPreview,
  fetchPriceHistory,
  getOmnibusConfig,
  patchOmnibusConfig,
  uniqueStamp,
  type OmnibusTenantActor,
} from './omnibusHelpers';

/**
 * TC-CAT-OMNI-003: Omnibus config validation, ACL and tenant isolation.
 * Source: `.ai/specs/2026-06-30-omnibus-price-tracking.md` — `GET | PATCH /api/catalog/config/omnibus`
 * (zod validation, `'EU'` rejected, presented price kind required when enabling, read-only
 * `backfillCoverage`, `{}` for an unset config), ACL (`catalog.price_history.view`,
 * `catalog.settings.view`, `catalog.settings.manage`) and Tenant / Security (compliance case C15).
 *
 * Config writes run in a fresh tenant so the shared demo tenant's Omnibus config is never touched.
 */
const ACTOR_FEATURES = ['catalog.*', 'sales.*'];

type InvalidConfigBody = { error?: string; details?: { fieldErrors?: Record<string, string[]> } };

test.describe('TC-CAT-OMNI-003: Omnibus config validation, ACL and tenant isolation', () => {
  test.describe.configure({ timeout: 180_000 });

  test('PATCH validates the config and persists only valid changes', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let actor: OmnibusTenantActor | null = null;
    try {
      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ACTOR_FEATURES);
      const token = actor.token;

      const initial = await getOmnibusConfig(request, token);
      expect(initial.status).toBe(200);
      expect(initial.body, 'an unset config reads as {}').toEqual({});

      const euRejected = await patchOmnibusConfig(request, token, { enabledCountryCodes: ['PL', 'EU'] });
      expect(euRejected.status).toBe(400);
      const euBody = euRejected.body as InvalidConfigBody | null;
      expect(euBody?.error).toBe('Invalid config');
      expect(euBody?.details?.fieldErrors?.['enabledCountryCodes.1']).toContain('omnibus_country_code_eu_not_allowed');

      const missingPresentedKind = await patchOmnibusConfig(request, token, {
        enabled: true,
        enabledCountryCodes: ['PL'],
      });
      expect(missingPresentedKind.status).toBe(400);
      expect((missingPresentedKind.body as InvalidConfigBody | null)?.details?.fieldErrors?.defaultPresentedPriceKindId).toEqual([
        'omnibus_presented_price_kind_required',
      ]);

      const channelWithoutKind = await patchOmnibusConfig(request, token, {
        enabled: true,
        enabledCountryCodes: ['PL'],
        channels: { [randomUUID()]: { countryCode: 'PL' } },
      });
      expect(channelWithoutKind.status, 'a channel override without a presented price kind is rejected').toBe(400);

      for (const invalid of [
        { lookbackDays: 0 },
        { lookbackDays: 366 },
        { minimizationAxis: 'both' },
        { enabledCountryCodes: ['pl'] },
        { backfillCoverage: { '': { completedAt: new Date().toISOString(), lookbackDays: 30 } } },
        { unknownField: true },
      ]) {
        const response = await patchOmnibusConfig(request, token, invalid);
        expect(response.status, `PATCH ${JSON.stringify(invalid)} should be rejected`).toBe(400);
      }

      const invalidJson = await apiRequest(request, 'PATCH', OMNIBUS_CONFIG_PATH, {
        token,
        data: Buffer.from('{not json'),
      });
      expect(invalidJson.status()).toBe(400);
      expect((await readJsonSafe<{ error?: string }>(invalidJson))?.error).toBe('Invalid JSON body');

      const unchanged = await getOmnibusConfig(request, token);
      expect(unchanged.body, 'rejected PATCHes persist nothing').toEqual({});

      const valid = await patchOmnibusConfig(request, token, {
        enabled: false,
        enabledCountryCodes: ['PL', 'DE'],
        lookbackDays: 45,
        minimizationAxis: 'net',
      });
      expect(valid.status, JSON.stringify(valid.body)).toBe(200);
      const stored = await getOmnibusConfig(request, token);
      expect(stored.body).toMatchObject({
        enabled: false,
        enabledCountryCodes: ['PL', 'DE'],
        lookbackDays: 45,
        minimizationAxis: 'net',
        noChannelMode: 'best_effort',
      });
    } finally {
      await cleanupOmnibusTenantActor(request, superadminToken, actor);
    }
  });

  test('features gate the history, preview and config routes', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let actor: OmnibusTenantActor | null = null;
    let settingsViewer: { roleId: string; userId: string; token: string } | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let priceId: string | null = null;
    try {
      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ACTOR_FEATURES);
      productId = await createOmnibusProductFixture(request, actor.token, stamp);
      priceKindId = await createPriceKindFixture(request, actor.token, { stamp, suffix: 'acl' });
      priceId = await createPriceFixture(request, actor.token, {
        productId,
        priceKindId,
        unitPriceNet: 10,
        unitPriceGross: 12.3,
      });
      settingsViewer = await createRestrictedUser(request, superadminToken, actor, stamp, [
        'catalog.products.view',
        'catalog.settings.view',
      ]);

      const ownHistory = await fetchPriceHistory(request, actor.token, { productId });
      expect(ownHistory.status).toBe(200);
      expect(ownHistory.body?.items).toHaveLength(1);

      const history = await fetchPriceHistory(request, settingsViewer.token, { productId });
      expect(history.status, 'history requires catalog.price_history.view').toBe(403);

      const preview = await fetchOmnibusPreview(request, settingsViewer.token, {
        productId,
        priceKindId,
        currencyCode: 'EUR',
      });
      expect(preview.status, 'preview requires catalog.price_history.view').toBe(403);

      const config = await getOmnibusConfig(request, settingsViewer.token);
      expect(config.status, 'config GET requires catalog.settings.view').toBe(200);

      const patch = await patchOmnibusConfig(request, settingsViewer.token, { lookbackDays: 40 });
      expect(patch.status, 'config PATCH requires catalog.settings.manage').toBe(403);
      const afterPatch = await getOmnibusConfig(request, actor.token);
      expect(afterPatch.body).toEqual({});
    } finally {
      if (actor) {
        await deleteEntityIfExists(request, actor.token, PRICES_PATH, priceId);
        await deleteCatalogProductIfExists(request, actor.token, productId);
        await deleteEntityIfExists(request, actor.token, PRICE_KINDS_PATH, priceKindId);
      }
      await cleanupRestrictedUser(request, superadminToken, settingsViewer);
      await cleanupOmnibusTenantActor(request, superadminToken, actor);
    }
  });

  test('another tenant cannot read this tenant price history or preview its products', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let actor: OmnibusTenantActor | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let priceId: string | null = null;
    try {
      productId = await createOmnibusProductFixture(request, token, stamp);
      priceKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'iso' });
      priceId = await createPriceFixture(request, token, {
        productId,
        priceKindId,
        unitPriceNet: 20,
        unitPriceGross: 24.6,
      });
      const ownHistory = await fetchPriceHistory(request, token, { productId });
      expect(ownHistory.status).toBe(200);
      const ownEntryIds = (ownHistory.body?.items ?? []).map((item) => item.id);
      expect(ownEntryIds).toHaveLength(1);

      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ACTOR_FEATURES);

      const foreignByProduct = await fetchPriceHistory(request, actor.token, { productId, includeTotal: 'true' });
      expect(foreignByProduct.status).toBe(200);
      expect(foreignByProduct.body?.items).toEqual([]);
      expect(foreignByProduct.body?.total).toBe(0);

      const foreignUnfiltered = await fetchPriceHistory(request, actor.token, { pageSize: '100' });
      expect(foreignUnfiltered.status).toBe(200);
      const foreignIds = (foreignUnfiltered.body?.items ?? []).map((item) => item.id);
      expect(foreignIds.some((id) => ownEntryIds.includes(id))).toBe(false);

      const foreignPreview = await fetchOmnibusPreview(request, actor.token, {
        productId,
        priceKindId,
        currencyCode: 'EUR',
      });
      expect(foreignPreview.status, 'a foreign product is not found in the caller scope').toBe(404);
    } finally {
      await cleanupOmnibusTenantActor(request, superadminToken, actor);
      await deleteEntityIfExists(request, token, PRICES_PATH, priceId);
      await deleteCatalogProductIfExists(request, token, productId);
      await deleteEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
    }
  });
});
