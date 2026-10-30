import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-5117: a saved DataTable view describes every column (#5117, PR #5823).
 *
 * Before the fix, `columnVisibility` was persisted as a sparse map — only the
 * keys a user had explicitly toggled — and `meta.hidden` defaults were skipped
 * entirely whenever any stored view was active. A legacy sparse view therefore
 * reopened with late-registering `meta.hidden` columns (custom fields, columns
 * injected by other modules) shown, even though the view never named them.
 *
 * This spec reproduces that exact shape via an API fixture — a personal
 * perspective on `customers.people.list` that only names `email` — and proves:
 *  - the `meta.hidden` columns the view does not name (LinkedIn, Twitter,
 *    Description) stay hidden, alongside the one column it does name (Email);
 *  - a late-registering custom-field column ("Buying role") still renders,
 *    since it is not `meta.hidden`;
 *  - re-showing a `meta.hidden` column from the column chooser survives a hard
 *    reload (dense-on-write persistence, not just an in-memory decision);
 *  - clearing to "No view" restores every declared default.
 */
test.describe('TC-CRM-5117: sparse saved view keeps meta.hidden columns hidden', () => {
  test('a legacy sparse personal view hides unnamed meta.hidden columns, persists a re-shown column densely, and "No view" restores defaults', async ({ page, request }) => {
    test.setTimeout(120_000);
    test.slow();

    const stamp = Date.now();
    const tableId = 'customers.people.list';
    const viewName = `QA TC-CRM-5117 sparse ${stamp}`;
    let token: string | null = null;
    let personId: string | null = null;
    let perspectiveId: string | null = null;

    const waitForTableReady = async () => {
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10_000 });
    };

    const headerButton = (label: string) => page.locator('thead button', { hasText: label }).first();

    try {
      token = await getAuthToken(request);

      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM5117 ${stamp}`,
        displayName: `QA TC-CRM-5117 ${stamp}`,
      });

      // Deliberately sparse: only `email` is named. This reproduces the
      // pre-fix stored shape #5117 was reported against — a view saved by the
      // fixed code would be dense (one boolean per leaf column) and would
      // prove nothing about the regression.
      const createRes = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: {
          name: viewName,
          isDefault: true,
          settings: {
            columnVisibility: { email: false },
            sorting: [{ id: 'name', desc: false }],
          },
        },
      });
      expect(createRes.status(), 'create sparse perspective').toBe(200);
      const createBody = await readJsonSafe<{ perspective?: { id?: string } }>(createRes);
      perspectiveId = createBody?.perspective?.id ?? null;
      expect(perspectiveId, 'perspective id in create response').toBeTruthy();

      await login(page, 'admin');
      await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });
      await waitForTableReady();

      // "Buying role" is a custom-field column that registers after the
      // initial mount. Waiting for it settles the hydration window before the
      // header snapshot below — the exact race #5117 exploited.
      const buyingRoleHeader = headerButton('Buying role');
      await buyingRoleHeader.waitFor({ state: 'visible', timeout: 15_000 });

      // -- The #5117 regression guard: the sparse default view is applied on
      //    load, so the column it names (email) is hidden, and so are the
      //    meta.hidden columns it never mentions (they must fall back to
      //    their declared default instead of defaulting to visible).
      await expect(headerButton('Email')).toHaveCount(0);
      await expect(headerButton('LinkedIn')).toHaveCount(0);
      await expect(headerButton('Twitter')).toHaveCount(0);
      await expect(headerButton('Description')).toHaveCount(0);
      await expect(buyingRoleHeader).toBeVisible();

      // -- Re-show Twitter from the column chooser (hosted in the Views
      //    sidebar). The sidebar autosaves the active personal view 400ms
      //    after a toggle (PerspectiveSidebar.scheduleAutosave); wait for that
      //    save request instead of a fixed delay.
      const viewsButton = page.getByTestId('data-table-open-views-sidebar');
      await expect(viewsButton).toBeVisible();
      await viewsButton.click();

      const searchInput = page.getByPlaceholder('Search columns...');
      await searchInput.fill('Twitter');
      const twitterRow = page.locator('div')
        .filter({ hasText: /^Twitter$/ })
        .filter({ has: page.locator('[role="switch"]') })
        .first();
      const twitterSwitch = twitterRow.getByRole('switch');
      await expect(twitterSwitch).toBeVisible();
      await expect(twitterSwitch).toHaveAttribute('aria-checked', 'false');

      const autosaveResponse = page.waitForResponse((res) =>
        res.url().includes(`/api/perspectives/${encodeURIComponent(tableId)}`)
        && res.request().method() === 'POST'
        && res.status() === 200);
      await twitterSwitch.click();
      await autosaveResponse;

      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(headerButton('Twitter')).toBeVisible();

      // -- Dense persistence: the reconciled decision (an explicit `true` for
      //    Twitter) survives a hard reload. LinkedIn/Description, never turned
      //    on, stay hidden — a sparse map could not have recorded "shown on
      //    purpose" for Twitter (`handleColumnChooserToggle` deletes rather
      //    than sets), so this is the part that only the dense-on-write half
      //    of the fix protects.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTableReady();
      await headerButton('Buying role').waitFor({ state: 'visible', timeout: 15_000 });
      await expect(headerButton('Twitter')).toBeVisible();
      await expect(headerButton('LinkedIn')).toHaveCount(0);
      await expect(headerButton('Description')).toHaveCount(0);

      // -- Switching to "No view" clears the per-column decisions and
      //    restores the module's declared defaults: email visible again, the
      //    meta.hidden set (including the just-shown Twitter) hidden again.
      const viewSwitcherTrigger = page.getByRole('button', { name: viewName, exact: true });
      await viewSwitcherTrigger.click();
      await page.getByRole('button', { name: '— No view —', exact: true }).click();

      await expect(headerButton('Email')).toBeVisible();
      await expect(headerButton('Twitter')).toHaveCount(0);
      await expect(headerButton('LinkedIn')).toHaveCount(0);
      await expect(headerButton('Description')).toHaveCount(0);
    } finally {
      if (perspectiveId && token) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${perspectiveId}`, { token }).catch(() => {});
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
