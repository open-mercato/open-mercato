import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-085: Deals map view tab (UI)
 * Spec: .ai/specs/2026-06-10-deals-map-view-tab.md → Integration Test Coverage (TC-CRM-085)
 *
 * Selector contract verified against the implementation:
 * - View tabs are `role=tab` inside the `ViewTabsRow` tablist; the active view renders as a
 *   selected span, inactive views as links (`aria-selected` true/false).
 * - Panel card: `role=button` with `data-map-panel-card="<dealId>"` (DealsLocationPanel).
 * - Marker: Leaflet divIcon `.om-deal-map-marker` wrapping `span[data-deal-id="<dealId>"]`
 *   inside `[data-map-canvas]` — pure DOM, independent of tile-network loading.
 * - Preview card: `[data-map-preview-card="<dealId>"]` with an "Open deal" link
 *   (`/backend/customers/deals/<id>`), opened by selection (marker click).
 * - Panel count label renders the located-only count `"{count} located"` (single number, no denominator).
 * - The map endpoint is located-only: deals without a coordinate-bearing address are
 *   excluded server-side (not shown in the panel), so there is no client-side toggle.
 *
 * Fixture coordinates are placed far (>3500 km) from the demo-seeded US addresses so the
 * fixture pin can never be swallowed by a marker cluster at fitBounds zoom levels, and they
 * sit on the /16 grid so float round-trips are exact for API readbacks.
 */

const ADDRESSES_PATH = '/api/customers/addresses';
const COMPANIES_PATH = '/api/customers/companies';
const DEALS_PATH = '/api/customers/deals';
const PIPELINES_PATH = '/api/customers/pipelines';
const PIPELINE_STAGES_PATH = '/api/customers/pipeline-stages';

type AddressListItem = {
  id: string;
  address_line1?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

async function createAddressFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', ADDRESSES_PATH, { token, data });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), `POST ${ADDRESSES_PATH} should return 201`).toBe(201);
  return expectId(body?.id, 'Address creation response should include id');
}

async function listAddresses(
  request: APIRequestContext,
  token: string,
  entityId: string,
): Promise<AddressListItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${ADDRESSES_PATH}?entityId=${encodeURIComponent(entityId)}&pageSize=100`,
    { token },
  );
  if (!response.ok()) return [];
  const body = await readJsonSafe<{ items?: AddressListItem[] }>(response);
  return body?.items ?? [];
}

test.describe('TC-CRM-085: deals map view tab (UI)', () => {
  test('navigates from the deals list to the map view tab', async ({ page }) => {
    test.slow();
    await login(page, 'admin');
    await page.goto('/backend/customers/deals');

    const mapTab = page.getByRole('tab', { name: 'Map', exact: true });
    await expect(mapTab, 'Map tab is visible on the deals list view').toBeVisible();
    await expect(mapTab, 'Map tab starts unselected on the list view').toHaveAttribute('aria-selected', 'false');

    await mapTab.click();
    await page.waitForURL(/\/backend\/customers\/deals\/map(?:[?#].*)?$/);

    await expect(
      page.getByRole('tab', { name: 'Map', exact: true }),
      'Map tab is selected on the map view',
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('tab', { name: 'List', exact: true }),
      'List tab is unselected on the map view',
    ).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('heading', { name: 'Deals Map' }), 'map page title renders').toBeVisible();
  });

  test('shows a located fixture deal in the panel with a map marker', async ({ page, request }) => {
    test.slow();
    const stamp = Date.now();
    const companyName = `TC-CRM-085 Map Co ${stamp}`;
    const dealTitle = `TC-CRM-085 Located Deal ${stamp}`;
    const stageLabel = `Map Stage ${stamp}`;
    let token: string | null = null;
    let companyId: string | null = null;
    let addressId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, token, companyName);
      addressId = await createAddressFixture(request, token, {
        entityId: companyId,
        addressLine1: `8 Panel St ${stamp}`,
        city: 'Cape Town',
        country: 'ZA',
        latitude: -33.875,
        longitude: 18.4375,
        isPrimary: true,
      });
      pipelineId = await createPipelineFixture(request, token, { name: `TC-CRM-085 Pipeline ${stamp}` });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageLabel, order: 1 });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
        valueAmount: 540000,
        valueCurrency: 'PLN',
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/map');

      const card = page.locator(`[data-map-panel-card="${dealId}"]`);
      await expect(card, 'panel lists the located fixture deal').toBeVisible();
      await expect(card, 'card shows the company label').toContainText(companyName);
      await expect(card, 'card shows the deal title').toContainText(dealTitle);
      await expect(card, 'card shows the stage badge').toContainText(stageLabel);
      await expect(card, 'card shows the formatted deal value').toContainText(/540/);

      const countLabel = page.getByText(/^\d+ located$/).first();
      await expect(countLabel, 'located count is rendered in the panel header').toBeVisible();
      const located = Number((await countLabel.innerText()).replace(/\D+/g, ''));
      expect(located, 'at least the fixture deal counts as located').toBeGreaterThanOrEqual(1);

      const marker = page.locator(`[data-map-canvas] .om-deal-map-marker span[data-deal-id="${dealId}"]`);
      await expect(marker, 'a DOM marker renders for the located deal (tile-network independent)').toBeVisible();

      // Zoom control is repositioned to the top-LEFT so it never overlaps the top-right preview card.
      await expect(
        page.locator('[data-map-canvas] .leaflet-top.leaflet-left .leaflet-control-zoom'),
        'zoom control renders in the top-left corner',
      ).toBeVisible();
      await expect(
        page.locator('[data-map-canvas] .leaflet-top.leaflet-right .leaflet-control-zoom'),
        'zoom control is NOT in the (preview-card) top-right corner',
      ).toHaveCount(0);

      // Mobile: the located panel is height-capped (max-h-[60vh]) so its card list scrolls within a
      // bounded region instead of stacking the full set above the map; the cap is lifted at lg.
      const readPanelMaxHeight = () =>
        page.evaluate(() => {
          const node = Array.from(document.querySelectorAll('div')).find(
            (el) => typeof el.className === 'string' && el.className.includes('max-h-[60vh]'),
          );
          return node ? getComputedStyle(node).maxHeight : 'MISSING';
        });
      await page.setViewportSize({ width: 375, height: 812 });
      const mobileMaxHeight = await readPanelMaxHeight();
      expect(mobileMaxHeight, 'panel height-cap element is present').not.toBe('MISSING');
      expect(mobileMaxHeight, 'panel is height-capped on mobile (scrollable region)').not.toBe('none');
      await page.setViewportSize({ width: 1280, height: 900 });
      expect(await readPanelMaxHeight(), 'panel height-cap is lifted at lg (lg:max-h-none)').toBe('none');
    } finally {
      await deleteEntityIfExists(request, token, DEALS_PATH, dealId);
      await deleteEntityByBody(request, token, PIPELINE_STAGES_PATH, stageId);
      await deleteEntityByBody(request, token, PIPELINES_PATH, pipelineId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });

  test('opens the deal preview card from a marker click', async ({ page, request }) => {
    test.slow();
    const stamp = Date.now();
    const companyName = `TC-CRM-085 Preview Co ${stamp}`;
    const dealTitle = `TC-CRM-085 Preview Deal ${stamp}`;
    let token: string | null = null;
    let companyId: string | null = null;
    let addressId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, token, companyName);
      addressId = await createAddressFixture(request, token, {
        entityId: companyId,
        addressLine1: `9 Preview Rd ${stamp}`,
        city: 'Sydney',
        country: 'AU',
        latitude: -33.875,
        longitude: 151.25,
        isPrimary: true,
      });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/map');

      const marker = page.locator(`[data-map-canvas] .om-deal-map-marker span[data-deal-id="${dealId}"]`);
      await expect(marker, 'fixture deal marker renders on the map').toBeVisible();
      await marker.click();

      const previewCard = page.locator(`[data-map-preview-card="${dealId}"]`);
      await expect(previewCard, 'preview card opens after the marker click').toBeVisible();
      await expect(previewCard, 'preview card shows the deal title').toContainText(dealTitle);
      await expect(previewCard, 'preview card shows the company label').toContainText(companyName);

      const openLink = previewCard.getByRole('link', { name: 'Open deal' });
      await expect(openLink, 'preview card exposes the Open deal link').toBeVisible();
      await expect(openLink, 'Open deal links to the deal detail page').toHaveAttribute(
        'href',
        `/backend/customers/deals/${dealId}`,
      );

      // Escape clears the selection from anywhere via the document-level listener — focus the panel
      // card first to prove it fires even when focus is NOT on the canvas region.
      await page.locator(`[data-map-panel-card="${dealId}"]`).focus();
      await page.keyboard.press('Escape');
      await expect(previewCard, 'Escape closes the preview card regardless of focus').toHaveCount(0);
    } finally {
      await deleteEntityIfExists(request, token, DEALS_PATH, dealId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });

  test('excludes deals without coordinates from the located-only panel', async ({ page, request }) => {
    test.slow();
    const stamp = Date.now();
    let token: string | null = null;
    let locatedCompanyId: string | null = null;
    let coordlessCompanyId: string | null = null;
    let addressId: string | null = null;
    let locatedDealId: string | null = null;
    let coordlessDealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      locatedCompanyId = await createCompanyFixture(request, token, `TC-CRM-085 Located Co ${stamp}`);
      coordlessCompanyId = await createCompanyFixture(request, token, `TC-CRM-085 Coordless Co ${stamp}`);
      addressId = await createAddressFixture(request, token, {
        entityId: locatedCompanyId,
        addressLine1: `10 Located St ${stamp}`,
        city: 'Tokyo',
        country: 'JP',
        latitude: 35.6875,
        longitude: 139.6875,
        isPrimary: true,
      });
      locatedDealId = await createDealFixture(request, token, {
        title: `TC-CRM-085 Located Deal ${stamp}`,
        companyIds: [locatedCompanyId],
      });
      coordlessDealId = await createDealFixture(request, token, {
        title: `TC-CRM-085 Coordless Deal ${stamp}`,
        companyIds: [coordlessCompanyId],
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/map');

      // Wait for the panel to render the located deal first, then assert the coordless deal is
      // absent — the map endpoint filters out deals without a coordinate-bearing address.
      const locatedCard = page.locator(`[data-map-panel-card="${locatedDealId}"]`);
      await expect(locatedCard, 'located fixture deal is listed').toBeVisible();
      await expect(
        page.locator(`[data-map-panel-card="${coordlessDealId}"]`),
        'coordless fixture deal is excluded from the located-only map',
      ).toHaveCount(0);
    } finally {
      await deleteEntityIfExists(request, token, DEALS_PATH, locatedDealId);
      await deleteEntityIfExists(request, token, DEALS_PATH, coordlessDealId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, locatedCompanyId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, coordlessCompanyId);
    }
  });

  test('persists address coordinates entered through the company address editor', async ({ page, request }) => {
    test.slow();
    const stamp = Date.now();
    const line1 = `12 Coordinate St ${stamp}`;
    let token: string | null = null;
    let companyId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, token, `TC-CRM-085 Coord Editor Co ${stamp}`);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies/${companyId}?tab=addresses`);
      await expect(
        page.getByRole('tab', { name: 'Addresses' }),
        'addresses tab is active on the company detail page',
      ).toHaveAttribute('aria-selected', 'true');

      await page.getByRole('button', { name: 'Add address' }).first().click();

      // The editor renders placeholder-labeled inputs; the line1 placeholder depends on
      // the tenant address format ('Address line 1' for line_first, 'Street' for street_first).
      const line1Input = page.getByPlaceholder(/^(address line 1|street)$/i).first();
      await expect(line1Input, 'address editor form is open').toBeVisible();
      await line1Input.fill(line1);

      // Coordinate inputs per the spec's AddressEditor extension — match by accessible
      // label or placeholder so either labeling implementation passes.
      const latitudeInput = page.getByLabel(/latitude/i).or(page.getByPlaceholder(/latitude/i)).first();
      const longitudeInput = page.getByLabel(/longitude/i).or(page.getByPlaceholder(/longitude/i)).first();
      await expect(latitudeInput, 'latitude input is exposed by the address editor').toBeVisible();
      await expect(longitudeInput, 'longitude input is exposed by the address editor').toBeVisible();
      await latitudeInput.fill('50.0625');
      await longitudeInput.fill('19.9375');

      await page.getByRole('button', { name: 'Save address' }).click();

      // Persistence is asserted through the addresses API readback, not UI text.
      await expect
        .poll(
          async () => {
            const items = await listAddresses(request, token as string, companyId as string);
            const match = items.find((item) => item.address_line1 === line1);
            if (!match) return null;
            return { latitude: Number(match.latitude), longitude: Number(match.longitude) };
          },
          { message: 'coordinates entered in the editor persist through the addresses API' },
        )
        .toEqual({ latitude: 50.0625, longitude: 19.9375 });
    } finally {
      if (token && companyId) {
        const leftovers = await listAddresses(request, token, companyId).catch(() => [] as AddressListItem[]);
        for (const item of leftovers) {
          await deleteEntityByBody(request, token, ADDRESSES_PATH, item.id);
        }
      }
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });
});
