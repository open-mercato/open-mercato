import { expect, test, type Page } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  OMNIBUS_ACTOR_PASSWORD,
  OMNIBUS_CONFIG_PATH,
  cleanupOmnibusTenantActor,
  createOmnibusTenantActor,
  getOmnibusConfig,
  uniqueStamp,
  type OmnibusTenantActor,
} from './omnibusHelpers';

/**
 * TC-CAT-OMNI-004: the Omnibus settings panel on the catalog configuration page.
 * Source: `.ai/specs/2026-06-30-omnibus-price-tracking.md` — Phase 3 admin UI (`OmnibusSettings`
 * on `/backend/config/catalog`) backed by `GET | PATCH /api/catalog/config/omnibus`.
 *
 * Runs as the admin of a fresh tenant so saving the tenant-wide Omnibus config never touches the
 * shared demo tenant. Covers: the panel loads the (unset) config with defaults, a server-side
 * validation error (enabling without a presented price kind) is surfaced on the field, and saving a
 * valid config succeeds and persists.
 */
const ACTOR_FEATURES = ['catalog.*', 'sales.*'];

async function loginAsActor(page: Page, actor: OmnibusTenantActor): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const form = new URLSearchParams();
  form.set('email', actor.email);
  form.set('password', OMNIBUS_ACTOR_PASSWORD);
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(response.ok(), `actor login should succeed (${response.status()})`).toBe(true);
  await page.context().addCookies([
    { name: 'om_selected_tenant', value: actor.tenantId, url: baseUrl, sameSite: 'Lax' },
    { name: 'om_selected_org', value: actor.organizationId, url: baseUrl, sameSite: 'Lax' },
    { name: 'locale', value: 'en', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
  ]);
}

test.describe('TC-CAT-OMNI-004: Omnibus settings panel', () => {
  test('loads the config, surfaces a validation error and saves a valid config', async ({ page, request }) => {
    test.setTimeout(180_000);
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let actor: OmnibusTenantActor | null = null;
    try {
      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ACTOR_FEATURES);
      await loginAsActor(page, actor);

      await page.goto('/backend/config/catalog', { waitUntil: 'domcontentloaded' });
      const panel = page.getByTestId('catalog-omnibus-settings');
      await expect(panel).toBeVisible({ timeout: 60_000 });
      await expect(panel.getByRole('heading', { name: 'Omnibus price tracking' })).toBeVisible();
      const lookback = panel.getByTestId('catalog-omnibus-lookback');
      await expect(lookback).toHaveValue('30', { timeout: 30_000 });
      const enabledSwitch = panel.getByRole('switch', { name: 'Enable Omnibus reference prices' });
      await expect(enabledSwitch).not.toBeChecked();

      await enabledSwitch.click();
      await expect(enabledSwitch).toBeChecked();
      const rejectedSave = page.waitForResponse(
        (response) => response.url().includes(OMNIBUS_CONFIG_PATH) && response.request().method() === 'PATCH',
      );
      await panel.getByTestId('catalog-omnibus-save').click();
      expect((await rejectedSave).status()).toBe(400);
      await expect(
        panel.getByRole('alert').filter({ hasText: 'Select a default presented price kind' }),
      ).toBeVisible();

      await enabledSwitch.click();
      await expect(enabledSwitch).not.toBeChecked();
      await lookback.fill('45');
      const acceptedSave = page.waitForResponse(
        (response) => response.url().includes(OMNIBUS_CONFIG_PATH) && response.request().method() === 'PATCH',
      );
      await panel.getByTestId('catalog-omnibus-save').click();
      expect((await acceptedSave).status()).toBe(200);
      await expect(page.getByText('Omnibus settings saved.').first()).toBeVisible();

      const stored = await getOmnibusConfig(request, actor.token);
      expect(stored.status).toBe(200);
      expect(stored.body).toMatchObject({ enabled: false, lookbackDays: 45, minimizationAxis: 'gross' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('catalog-omnibus-lookback')).toHaveValue('45', { timeout: 60_000 });
    } finally {
      await cleanupOmnibusTenantActor(request, superadminToken, actor);
    }
  });
});
