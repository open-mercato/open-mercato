import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import {
  deleteGeneralEntityIfExists,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import { expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi';
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui';
import {
  ASSORTMENT_COUNT_PATH,
  CHANNEL_BINDINGS_PATH,
  DOMAIN_BINDINGS_PATH,
  STORES_PATH,
  cleanupStorefrontFixture,
  createDomainMappingFixture,
  createStoreFixture,
  createStorefrontFixture,
  deleteDomainMappingIfExists,
  deleteStoreIfExists,
  readStoreRecord,
  storefrontHostname,
  uniqueStamp,
  type StorefrontFixture,
} from './helpers';
import {
  cleanupStorefrontCatalogFixtures,
  createCategoryFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  type StorefrontFixtureTracker,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-006: store admin UI (SPEC-029 Phases 2–3 gate).
 * Source: .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md §16 "UI paths" — store
 * list with status filter, store create, General edit with an optimistic-lock conflict between
 * two pages, store-default availability policy, branding live preview and bad-colour rejection,
 * domain binding against an active and a verified-only mapping (warning), channel binding with
 * include/exclude pickers and the live count of unsaved changes plus `require_authentication`,
 * the SEO tab, and Cmd+K finding a store by code.
 *
 * Fixtures are created through the admin API (domain mapping status set in the database, see
 * helpers.ts) and removed in `finally`. Form labels are not associated with their inputs, so
 * fields are addressed through CrudForm's `data-crud-field-id` containers.
 */

const STORE_LIST_URL = '/backend/config/ecommerce';
const AVAILABILITY_POLICIES_PATH = '/api/availability/policies';
const UI_TIMEOUT = 15_000;

type PolicyRow = {
  id: string;
  storeId: string | null;
  productId: string | null;
  variantId: string | null;
  allowBackorder: boolean;
  backorderLeadTimeDays: number | null;
  hideWhenOutOfStock: boolean;
};

type ChannelBindingRow = {
  id: string;
  requireAuthentication: boolean;
  assortmentScope: Record<string, string[] | undefined> | null;
};

function storeEditUrl(storeId: string, tab?: string): string {
  return `${STORE_LIST_URL}/${encodeURIComponent(storeId)}${tab ? `?tab=${tab}` : ''}`;
}

function crudField(scope: Page | Locator, fieldId: string): Locator {
  return scope.locator(`[data-crud-field-id="${fieldId}"]`).first();
}

function crudInput(scope: Page | Locator, fieldId: string): Locator {
  return crudField(scope, fieldId).locator('input').first();
}

async function attachScreenshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
}

async function selectRadixOption(page: Page, trigger: Locator, optionName: string | RegExp): Promise<void> {
  await trigger.click();
  await page.getByRole('option', { name: optionName }).first().click();
}

async function pickLookupOption(page: Page, field: Locator, query: string, optionName: string): Promise<void> {
  const input = field.locator('input').first();
  await input.click();
  await input.fill(query);
  await field.getByRole('button', { name: optionName }).first().click({ timeout: UI_TIMEOUT });
  await expect(field.getByText(optionName, { exact: true }).first()).toBeVisible({ timeout: UI_TIMEOUT });
}

async function listStoreDefaultPolicies(request: APIRequestContext, token: string, storeId: string): Promise<PolicyRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${AVAILABILITY_POLICIES_PATH}?storeId=${encodeURIComponent(storeId)}&pageSize=100`,
    { token },
  );
  expect(response.status()).toBe(200);
  const items = (await readJsonSafe<{ items?: PolicyRow[] }>(response))?.items ?? [];
  return items.filter((item) => item.storeId === storeId && !item.productId && !item.variantId);
}

async function deleteStorePolicies(request: APIRequestContext, token: string, storeId: string | null): Promise<void> {
  if (!storeId) return;
  const policies = await listStoreDefaultPolicies(request, token, storeId).catch(() => []);
  for (const policy of policies) await deleteGeneralEntityIfExists(request, token, AVAILABILITY_POLICIES_PATH, policy.id);
}

async function readChannelBinding(request: APIRequestContext, token: string, bindingId: string): Promise<ChannelBindingRow> {
  const response = await apiRequest(request, 'GET', `${CHANNEL_BINDINGS_PATH}?id=${encodeURIComponent(bindingId)}`, {
    token,
  });
  expect(response.status()).toBe(200);
  const item = (await readJsonSafe<{ items?: ChannelBindingRow[] }>(response))?.items?.[0];
  expect(item, 'channel binding should be listed').toBeTruthy();
  return item as ChannelBindingRow;
}

async function findStoreIdByCode(request: APIRequestContext, token: string, code: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `${STORES_PATH}?search=${encodeURIComponent(code)}&pageSize=100`, {
    token,
  });
  if (response.status() !== 200) return null;
  const items = (await readJsonSafe<{ items?: Array<{ id: string; code: string }> }>(response))?.items ?? [];
  return items.find((item) => item.code === code)?.id ?? null;
}

test.describe('TC-ECOM-006: store admin UI', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the store list filters by status and the create dialog creates a draft store', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const createdCode = `qa_ecom_ui_${stamp}`.replace(/-/g, '_');
    let activeStoreId: string | null = null;
    let draftStoreId: string | null = null;
    let createdStoreId: string | null = null;
    try {
      activeStoreId = await createStoreFixture(request, token, { stamp: `${stamp}-act`, status: 'active' });
      draftStoreId = await createStoreFixture(request, token, { stamp: `${stamp}-drf`, status: 'draft' });
      const activeName = `QA ECOM Store ${stamp}-act`;
      const draftName = `QA ECOM Store ${stamp}-drf`;

      await login(page, 'admin');
      await page.goto(STORE_LIST_URL);
      await page.getByPlaceholder('Search by name, code or slug').fill(stamp);
      await expect(page.getByRole('row', { name: new RegExp(activeName) })).toBeVisible({ timeout: UI_TIMEOUT });
      await expect(page.getByRole('row', { name: new RegExp(draftName) })).toBeVisible({ timeout: UI_TIMEOUT });

      await page.getByRole('button', { name: /^Filters(?:\s+\d+)?$/i }).first().click();
      const overlay = page.locator('div.fixed.inset-0').last();
      await expect(overlay).toBeVisible({ timeout: UI_TIMEOUT });
      await selectRadixOption(page, overlay.locator('[role="combobox"]').first(), 'Active');
      await overlay.getByRole('button', { name: 'Apply' }).first().click();

      await expect(page.getByRole('row', { name: new RegExp(activeName) })).toBeVisible({ timeout: UI_TIMEOUT });
      await expect(page.getByRole('row', { name: new RegExp(draftName) })).toHaveCount(0, { timeout: UI_TIMEOUT });
      await attachScreenshot(page, 'store-list-status-filter');

      await page.getByRole('button', { name: 'Create store' }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT });
      await fillControlledInput(crudInput(dialog, 'name'), `QA ECOM UI Created ${stamp}`);
      await fillControlledInput(crudInput(dialog, 'code'), createdCode);
      await fillControlledInput(crudInput(dialog, 'slug'), `qa-ecom-ui-${stamp}`);
      await fillControlledInput(crudInput(dialog, 'defaultLocale'), 'en');
      await fillControlledInput(crudInput(dialog, 'defaultCurrencyCode'), 'EUR');
      await dialog.getByRole('button', { name: 'Create store' }).click();

      await expect(page.getByText('Store created').first()).toBeVisible({ timeout: UI_TIMEOUT });
      await expect(dialog).toBeHidden({ timeout: UI_TIMEOUT });
      await expect
        .poll(async () => (createdStoreId = await findStoreIdByCode(request, token, createdCode)), { timeout: UI_TIMEOUT })
        .not.toBeNull();
      const created = await readStoreRecord(request, token, createdStoreId ?? '');
      expect(created.status).toBe('draft');
      expect(created.name).toBe(`QA ECOM UI Created ${stamp}`);
      await page.getByPlaceholder('Search by name, code or slug').fill(createdCode);
      await expect(page.getByRole('row', { name: new RegExp(`QA ECOM UI Created ${stamp}`) })).toBeVisible({
        timeout: UI_TIMEOUT,
      });
      await attachScreenshot(page, 'store-created');
    } finally {
      await deleteStoreIfExists(request, token, createdStoreId);
      await deleteStoreIfExists(request, token, activeStoreId);
      await deleteStoreIfExists(request, token, draftStoreId);
    }
  });

  test('General edit from a stale page surfaces the conflict bar instead of overwriting', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let storeId: string | null = null;
    try {
      storeId = await createStoreFixture(request, token, { stamp, status: 'draft' });
      await login(page, 'admin');
      const stalePage = page;
      const freshPage = await page.context().newPage();

      await stalePage.goto(storeEditUrl(storeId, 'general'));
      await expect(crudInput(stalePage, 'name')).toHaveValue(`QA ECOM Store ${stamp}`, { timeout: UI_TIMEOUT });
      await freshPage.goto(storeEditUrl(storeId, 'general'));
      await expect(crudInput(freshPage, 'name')).toHaveValue(`QA ECOM Store ${stamp}`, { timeout: UI_TIMEOUT });

      await fillControlledInput(crudInput(freshPage, 'name'), `QA ECOM Fresh ${stamp}`);
      await freshPage.getByRole('button', { name: 'Save changes' }).click();
      await expect(freshPage.getByText('Store saved').first()).toBeVisible({ timeout: UI_TIMEOUT });
      await expect
        .poll(async () => (await readStoreRecord(request, token, storeId ?? '')).name, { timeout: UI_TIMEOUT })
        .toBe(`QA ECOM Fresh ${stamp}`);

      await fillControlledInput(crudInput(stalePage, 'name'), `QA ECOM Stale ${stamp}`);
      await stalePage.getByRole('button', { name: 'Save changes' }).click();
      await expectConflictBanner(stalePage, { timeout: UI_TIMEOUT });
      await attachScreenshot(stalePage, 'general-optimistic-lock-conflict');

      const persisted = await readStoreRecord(request, token, storeId);
      expect(persisted.name, 'the stale save must not overwrite the fresh one').toBe(`QA ECOM Fresh ${stamp}`);
      await freshPage.close();
    } finally {
      await deleteStoreIfExists(request, token, storeId);
    }
  });

  test('the General tab edits the store-default availability policy', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let storeId: string | null = null;
    try {
      storeId = await createStoreFixture(request, token, { stamp, status: 'draft' });
      await login(page, 'admin');
      await page.goto(storeEditUrl(storeId, 'general'));

      const backorder = page.getByRole('checkbox', { name: 'Allow backorders' });
      await expect(backorder).toBeVisible({ timeout: UI_TIMEOUT });
      await page.getByRole('checkbox', { name: 'Hide out-of-stock products' }).click();
      await backorder.click();
      await fillControlledInput(crudInput(page, 'backorderLeadTimeDays'), '5');
      await page.getByRole('button', { name: 'Save availability defaults' }).click();
      await expect(page.getByText('Availability defaults saved').first()).toBeVisible({ timeout: UI_TIMEOUT });
      await attachScreenshot(page, 'availability-defaults-saved');

      const policies = await listStoreDefaultPolicies(request, token, storeId);
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject({ allowBackorder: true, backorderLeadTimeDays: 5, hideWhenOutOfStock: true });
    } finally {
      await deleteStorePolicies(request, token, storeId);
      await deleteStoreIfExists(request, token, storeId);
    }
  });

  test('the Branding tab previews live, rejects a bad colour and saves only the branding', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let storeId: string | null = null;
    try {
      storeId = await createStoreFixture(request, token, { stamp, status: 'draft' });
      const before = await readStoreRecord(request, token, storeId);
      await login(page, 'admin');
      await page.goto(storeEditUrl(storeId, 'branding'));

      const primary = crudInput(page, 'primaryColor');
      const preview = page.getByTestId('branding-preview-frame');
      await expect(primary).toBeVisible({ timeout: UI_TIMEOUT });
      await fillControlledInput(primary, '#1a2b3c');
      await expect(preview).toHaveAttribute('srcdoc', /--primary:#1a2b3c/, { timeout: UI_TIMEOUT });
      await expect(page.getByTestId('branding-swatch-primaryColor')).toHaveAttribute('style', /background-color/);
      await attachScreenshot(page, 'branding-live-preview');

      await fillControlledInput(primary, 'red; } body { color: red');
      await expect(preview).not.toHaveAttribute('srcdoc', /color: red/, { timeout: UI_TIMEOUT });
      await page.getByRole('button', { name: 'Save branding' }).click();
      await expect(crudField(page, 'primaryColor').getByText(/Colour must be an OKLCH value/)).toBeVisible({
        timeout: UI_TIMEOUT,
      });
      await attachScreenshot(page, 'branding-bad-colour-rejected');
      expect((await readStoreRecord(request, token, storeId)).settings?.branding ?? {}).toEqual({});

      await fillControlledInput(primary, '#1a2b3c');
      await page.getByRole('button', { name: 'Save branding' }).click();
      await expect(page.getByText('Branding saved').first()).toBeVisible({ timeout: UI_TIMEOUT });
      await expect
        .poll(async () => (await readStoreRecord(request, token, storeId ?? '')).settings?.branding, { timeout: UI_TIMEOUT })
        .toEqual({ primaryColor: '#1a2b3c' });
      const after = await readStoreRecord(request, token, storeId);
      expect(after.settings?.display).toEqual(before.settings?.display);
      expect(after.settings?.seo).toEqual(before.settings?.seo);
      expect(after.name).toBe(before.name);
    } finally {
      await deleteStoreIfExists(request, token, storeId);
    }
  });

  test('the Domains tab binds an active and a verified-only domain and warns about the one that does not serve', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const { organizationId } = getTokenContext(token);
    const activeHost = storefrontHostname(stamp, 'live');
    const verifiedHost = storefrontHostname(stamp, 'next');
    let storeId: string | null = null;
    let activeMappingId: string | null = null;
    let verifiedMappingId: string | null = null;
    try {
      storeId = await createStoreFixture(request, token, { stamp, status: 'draft' });
      activeMappingId = await createDomainMappingFixture(request, token, { hostname: activeHost, organizationId });
      verifiedMappingId = await createDomainMappingFixture(request, token, {
        hostname: verifiedHost,
        organizationId,
        status: 'verified',
      });
      await login(page, 'admin');
      await page.goto(storeEditUrl(storeId, 'domains'));

      await page.getByRole('button', { name: 'Add domain binding' }).first().click();
      let dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT });
      await selectRadixOption(page, crudField(dialog, 'domainMappingId').getByRole('combobox'), new RegExp(`^${activeHost.replace(/\./g, '\\.')}`));
      await expect(dialog.getByText(/Only an active domain serves, so the store does not answer/)).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Add binding' }).click();
      await expect(page.getByText('Domain binding added').first()).toBeVisible({ timeout: UI_TIMEOUT });
      await expect(dialog).toBeHidden({ timeout: UI_TIMEOUT });

      await page.getByRole('button', { name: 'Add domain binding' }).first().click();
      dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT });
      await selectRadixOption(page, crudField(dialog, 'domainMappingId').getByRole('combobox'), new RegExp(`^${verifiedHost.replace(/\./g, '\\.')}`));
      await expect(
        dialog.getByText(`Only an active domain serves, so the store does not answer at ${verifiedHost} yet.`, { exact: false }),
      ).toBeVisible({ timeout: UI_TIMEOUT });
      await attachScreenshot(page, 'domain-binding-verified-warning');
      await fillControlledInput(crudInput(dialog, 'pathPrefix'), '/de');
      await dialog.getByRole('button', { name: 'Add binding' }).click();
      await expect(dialog).toBeHidden({ timeout: UI_TIMEOUT });

      await expect(page.getByRole('row', { name: new RegExp(activeHost.replace(/\./g, '\\.')) })).toBeVisible({
        timeout: UI_TIMEOUT,
      });
      const verifiedRow = page.getByRole('row', { name: new RegExp(verifiedHost.replace(/\./g, '\\.')) });
      await expect(verifiedRow).toBeVisible({ timeout: UI_TIMEOUT });
      await expect(verifiedRow.getByText(/Only an active domain serves/)).toBeVisible();
      await attachScreenshot(page, 'domain-bindings-table');

      const bindings = await apiRequest(request, 'GET', `${DOMAIN_BINDINGS_PATH}?storeId=${storeId}&pageSize=100`, { token });
      const items =
        (await readJsonSafe<{ items?: Array<{ domainMappingId: string; pathPrefix: string | null }> }>(bindings))?.items ?? [];
      const byMapping = new Map(items.map((item) => [item.domainMappingId, item.pathPrefix]));
      expect(byMapping.get(activeMappingId)).toBeNull();
      expect(byMapping.get(verifiedMappingId)).toBe('/de');
    } finally {
      await deleteStoreIfExists(request, token, storeId);
      await deleteDomainMappingIfExists(request, token, verifiedMappingId);
      await deleteDomainMappingIfExists(request, token, activeMappingId);
    }
  });

  test('the Channels tab counts unsaved include/exclude changes live and saves require_authentication', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const tracker: StorefrontFixtureTracker = createStorefrontFixtureTracker();
    let fixture: StorefrontFixture | null = null;
    try {
      const includedCategory = `QA ECOM Inc ${stamp}`;
      const addedCategory = `QA ECOM Add ${stamp}`;
      const includedId = await createCategoryFixture(request, token, tracker, { name: includedCategory });
      const addedId = await createCategoryFixture(request, token, tracker, { name: addedCategory });
      const hiddenTitle = `QA ECOM Hidden ${stamp}`;
      const hiddenProductId = await createProductFixture(request, token, tracker, {
        title: hiddenTitle,
        handle: `qa-ecom-hidden-${stamp}`,
        sku: `QA-ECOM-HID-${stamp}`,
        categoryIds: [includedId],
      });
      await createProductFixture(request, token, tracker, {
        title: `QA ECOM Kept ${stamp}`,
        handle: `qa-ecom-kept-${stamp}`,
        sku: `QA-ECOM-KEPT-${stamp}`,
        categoryIds: [includedId],
      });
      await createProductFixture(request, token, tracker, {
        title: `QA ECOM Added ${stamp}`,
        handle: `qa-ecom-added-${stamp}`,
        sku: `QA-ECOM-ADD-${stamp}`,
        categoryIds: [addedId],
      });
      fixture = await createStorefrontFixture(request, token, {
        stamp,
        status: 'draft',
        channelAssortmentScope: { categoryIds: [includedId] },
      });
      const bindingId = fixture.channelBindingId ?? '';

      await login(page, 'admin');
      await page.goto(storeEditUrl(fixture.storeId, 'channels'));
      const row = page.getByRole('row', { name: new RegExp(`QA ECOM Channel ${stamp}`) });
      await expect(row).toBeVisible({ timeout: UI_TIMEOUT });
      await row.getByRole('button', { name: 'Open actions' }).click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();

      const dialog = page.getByRole('dialog');
      const count = dialog.getByTestId('channel-assortment-count');
      await expect(count).toContainText('Products matching this scope: 2.', { timeout: UI_TIMEOUT });

      await pickLookupOption(page, crudField(dialog, 'categoryIds'), addedCategory, addedCategory);
      await expect(count).toContainText('Products matching this scope: 3.', { timeout: UI_TIMEOUT });

      await pickLookupOption(page, crudField(dialog, 'excludeProductIds'), hiddenTitle, hiddenTitle);
      await expect(count).toContainText('Products matching this scope: 2.', { timeout: UI_TIMEOUT });
      await attachScreenshot(page, 'channel-live-count-unsaved');

      const savedCount = await apiRequest(request, 'GET', ASSORTMENT_COUNT_PATH(bindingId), { token });
      expect(await readJsonSafe<{ count?: number; scopeSource?: string }>(savedCount)).toMatchObject({
        count: 2,
        scopeSource: 'saved',
      });
      expect((await readChannelBinding(request, token, bindingId)).assortmentScope).toEqual({ categoryIds: [includedId] });

      await dialog.getByRole('checkbox', { name: 'Require sign-in to see products' }).click();
      await expect(count).toContainText(
        '0 products for anonymous visitors because sign-in is required; 2 without that requirement.',
        { timeout: UI_TIMEOUT },
      );
      await attachScreenshot(page, 'channel-require-authentication-count');
      await dialog.getByRole('button', { name: 'Save binding' }).click();
      await expect(page.getByText('Channel binding updated').first()).toBeVisible({ timeout: UI_TIMEOUT });
      await expect(row.getByText('Sign-in required')).toBeVisible({ timeout: UI_TIMEOUT });

      const saved = await readChannelBinding(request, token, bindingId);
      expect(saved.requireAuthentication).toBe(true);
      expect([...(saved.assortmentScope?.categoryIds ?? [])].sort((left, right) => left.localeCompare(right))).toEqual(
        [includedId, addedId].sort((left, right) => left.localeCompare(right)),
      );
      expect(saved.assortmentScope?.excludeProductIds).toEqual([hiddenProductId]);
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
    }
  });

  test('the SEO tab saves settings.seo and rejects an invalid verification token', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let storeId: string | null = null;
    try {
      storeId = await createStoreFixture(request, token, { stamp, status: 'draft' });
      const before = await readStoreRecord(request, token, storeId);
      await login(page, 'admin');
      await page.goto(storeEditUrl(storeId, 'seo'));

      const siteName = crudInput(page, 'siteName');
      await expect(siteName).toBeVisible({ timeout: UI_TIMEOUT });
      await fillControlledInput(siteName, `QA ECOM Site ${stamp}`);
      await fillControlledInput(crudInput(page, 'googleSiteVerification'), 'not a token!');
      await page.getByRole('button', { name: 'Save SEO settings' }).click();
      await expect(
        crudField(page, 'googleSiteVerification').getByText(/Enter the token from Google Search Console/),
      ).toBeVisible({ timeout: UI_TIMEOUT });
      expect((await readStoreRecord(request, token, storeId)).settings?.seo ?? {}).toEqual({});

      await fillControlledInput(crudInput(page, 'googleSiteVerification'), `qa-token-${stamp}`);
      await page.getByRole('button', { name: 'Save SEO settings' }).click();
      await expect(page.getByText('SEO settings saved').first()).toBeVisible({ timeout: UI_TIMEOUT });
      await attachScreenshot(page, 'seo-saved');
      await expect
        .poll(async () => (await readStoreRecord(request, token, storeId ?? '')).settings?.seo, { timeout: UI_TIMEOUT })
        .toEqual({ siteName: `QA ECOM Site ${stamp}`, googleSiteVerification: `qa-token-${stamp}` });
      const after = await readStoreRecord(request, token, storeId);
      expect(after.settings?.branding).toEqual(before.settings?.branding);
      expect(after.settings?.display).toEqual(before.settings?.display);
    } finally {
      await deleteStoreIfExists(request, token, storeId);
    }
  });

  test('Cmd+K finds a store by its code and opens it', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const code = `qacmdk${stamp.replace(/[^a-z0-9]/g, '').slice(-12)}`;
    const name = `QA ECOM Palette ${stamp}`;
    let storeId: string | null = null;
    try {
      const response = await apiRequest(request, 'POST', STORES_PATH, {
        token,
        data: {
          code,
          name,
          slug: `qa-ecom-palette-${stamp}`,
          defaultLocale: 'en',
          supportedLocales: ['en'],
          defaultCurrencyCode: 'EUR',
        },
      });
      expect(response.status(), `palette store create should be 201 (${await response.text()})`).toBe(201);
      storeId = (await readJsonSafe<{ id?: string }>(response))?.id ?? null;
      await expect
        .poll(
          async () => {
            const search = await apiRequest(
              request,
              'GET',
              `/api/search/search?${new URLSearchParams({ q: code, limit: '10', entityTypes: 'ecommerce:ecommerce_store' }).toString()}`,
              { token },
            );
            const results = (await readJsonSafe<{ results?: Array<{ recordId?: string }> }>(search))?.results ?? [];
            return results.some((result) => result.recordId === storeId);
          },
          { timeout: 30_000, message: 'the store should be indexed for global search' },
        )
        .toBe(true);

      await login(page, 'admin');
      await page.goto('/backend');
      await expect(page.locator('header').getByRole('button', { name: 'Open global search' })).toBeVisible({
        timeout: UI_TIMEOUT,
      });
      const input = page.locator('input[aria-controls="topbar-search-results"]');
      await expect(async () => {
        await page.keyboard.press('ControlOrMeta+K');
        await expect(input).toBeFocused({ timeout: 2_000 });
      }).toPass({ timeout: UI_TIMEOUT });
      await input.fill(code);
      const option = page.locator('#topbar-search-results').getByRole('option', { name: new RegExp(name) });
      await expect(option).toBeVisible({ timeout: UI_TIMEOUT });
      await attachScreenshot(page, 'command-palette-store');
      await option.click();
      await expect(page).toHaveURL(new RegExp(`${STORE_LIST_URL}/${storeId}`), { timeout: UI_TIMEOUT });
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: UI_TIMEOUT });
    } finally {
      await deleteStoreIfExists(request, token, storeId);
    }
  });
});
