import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createCompanyFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  createDealFixture,
  deleteEntityIfExists,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-083: Deals list redesign UI (`/backend/customers/deals`).
 * Source spec: .ai/specs/2026-06-08-deals-list-redesign.md ("Integration Test Coverage" → UI paths).
 *
 * Verifies the redesigned list renders end to end:
 * - The 4-card KPI strip (`DealsKpiStrip`) shows the four card titles — Pipeline value, Active deals,
 *   Won this quarter, Win rate — and a delta chip (`Compared to previous period`).
 * - The restyled cells render: a `StatusBadge` (dictionary label "Open"), an OWNER `Avatar` + name,
 *   and a STAGE name, on a seeded row.
 * - No regression: the search box, the row-actions (⋮) menu, and the advanced-filter ("Filters")
 *   trigger are all present.
 *
 * Self-contained: a deal (owned by the admin, with a known stage + open status) is seeded via API in
 * `beforeAll` so a deterministic row exists to assert on regardless of demo data, and every fixture
 * is cleaned up in `afterAll` (deal → stage → pipeline → company, FK-safe order).
 */

const stamp = Date.now();
const stageLabel = `TC-CRM-083 Stage ${stamp}`;
const dealTitle = `QA TC-CRM-083 Deal ${stamp}`;

let token: string | null = null;
let companyId: string | null = null;
let pipelineId: string | null = null;
let stageId: string | null = null;
let dealId: string | null = null;

test.describe('TC-CRM-083: Deals list redesign UI', () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
    token = await getAuthToken(request, 'admin');
    const scope = getTokenScope(token);
    companyId = await createCompanyFixture(request, token, `TC-CRM-083 Co ${stamp}`);
    pipelineId = await createPipelineFixture(request, token, { name: `TC-CRM-083 Pipe ${stamp}` });
    stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageLabel, order: 0 });
    dealId = await createDealFixture(request, token, {
      title: dealTitle,
      companyIds: [companyId],
      pipelineId,
      pipelineStageId: stageId,
      status: 'open',
      valueAmount: 12000,
      valueCurrency: 'USD',
      // Own the deal so the OWNER cell resolves to an avatar + name for the logged-in admin.
      ownerUserId: scope.userId,
    });
  });

  test.afterAll(async ({ request }: { request: APIRequestContext }) => {
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
    await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
    await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
  });

  test('renders the KPI strip, restyled cells, and keeps search / row-actions / filters', async ({ page }) => {
    test.slow();

    await login(page, 'admin');
    await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

    // List is ready when the page heading and the search box are visible.
    await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible({ timeout: 30_000 });
    const searchBox = page.getByPlaceholder(/Search by title/i);
    await expect(searchBox, 'search box should be present (no regression)').toBeVisible({ timeout: 30_000 });

    // --- KPI strip: the four card titles render (they show in loading + loaded states) ---
    await expect(page.getByText('Pipeline value', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Active deals', { exact: true })).toBeVisible();
    await expect(page.getByText('Won this quarter', { exact: true })).toBeVisible();
    await expect(page.getByText('Win rate', { exact: true })).toBeVisible();

    // A delta chip carries the title "Compared to previous period" (BadgeDelta). At least one should
    // appear once the summary resolves — poll so we wait through the loading state.
    const deltaChip = page.locator('[title="Compared to previous period"]');
    await expect(deltaChip.first(), 'at least one KPI delta chip should render').toBeVisible({ timeout: 30_000 });

    // --- Table cells: focus assertions on the deterministic seeded row ---
    await searchBox.fill(dealTitle);
    const dealRow = page.locator('tr').filter({ hasText: dealTitle }).first();
    await expect(dealRow, 'seeded deal row should appear after searching by title').toBeVisible({ timeout: 30_000 });

    // STATUS badge → dictionary label "Open" (seeded status='open').
    await expect(dealRow.getByText('Open', { exact: true }), 'status badge should render the "Open" label').toBeVisible();

    // STAGE name → the dictionary label for the seeded stage.
    await expect(dealRow.getByText(stageLabel, { exact: true }), 'stage name cell should render the seeded stage label').toBeVisible();

    // OWNER → an avatar plus the resolved owner name. The `Avatar` primitive renders a
    // `<div role="img" aria-label="{name}">`; the owner column resolves owner_user_id → a non-empty
    // name (or the id as a fallback), so a row owned by the admin always shows an avatar (role=img,
    // the only one in the row — DEAL uses a lucide SVG, not role=img) plus a visible name span.
    const ownerAvatar = dealRow.getByRole('img').first();
    await expect(ownerAvatar, 'owner avatar (role=img) should render for the owned deal row').toBeVisible();
    const ownerName = await ownerAvatar.getAttribute('aria-label');
    expect(ownerName && ownerName.trim().length > 0, 'owner avatar should carry a non-empty name').toBe(true);
    await expect(dealRow.getByText(ownerName!.trim(), { exact: true }).first(), 'owner name should render next to the avatar').toBeVisible();

    // --- No regression: row-actions (⋮) trigger + advanced-filter ("Filters") trigger exist ---
    const rowActionsTrigger = dealRow.getByRole('button', { name: /Open actions/i }).first();
    await expect(rowActionsTrigger, 'row-actions (⋮) trigger should be present').toBeVisible();

    const filtersTrigger = page.getByRole('button', { name: /Filters/i }).first();
    await expect(filtersTrigger, 'advanced-filter trigger should be present').toBeVisible();
  });
});
