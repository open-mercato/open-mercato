import { test, expect } from '@playwright/test';
import { readJsonSafe as parseJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createDealFixture,
  createPersonFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-065: People bulk delete with partial dependency failure
 * Source: .ai/qa/scenarios/TC-CRM-065-bulk-delete-partial-failure.md
 *
 * Verifies that bulk-deleting people surfaces per-failure diagnostics:
 * - 2 rows without dependents are deleted
 * - 1 row blocked by a linked deal stays visible
 * - A grouped error toast names the dependency reason
 */
test.describe('TC-CRM-065: People bulk delete partial failure', () => {
  test('keeps blocked row, deletes eligible rows, surfaces grouped dependency toast', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    const deletableIds: string[] = [];
    let blockedId: string | null = null;
    let dealId: string | null = null;
    const stamp = Date.now();
    const prefix = `QA TC-CRM-065 ${stamp}`;

    try {
      token = await getAuthToken(request);

      for (let i = 0; i < 2; i++) {
        const id = await createPersonFixture(request, token, {
          firstName: `Bulk${i}`,
          lastName: `Free${stamp}`,
          displayName: `${prefix} Free${i}`,
        });
        deletableIds.push(id);
      }

      blockedId = await createPersonFixture(request, token, {
        firstName: 'Bulk2',
        lastName: `Blocked${stamp}`,
        displayName: `${prefix} Blocked`,
      });

      dealId = await createDealFixture(request, token, {
        title: `${prefix} Deal`,
        personIds: [blockedId],
      });

      await login(page, 'admin');
      await Promise.all([
        page.waitForResponse((response) => {
          const url = new URL(response.url());
          return response.request().method() === 'GET'
            && url.pathname === '/api/customers/people'
            && response.ok();
        }),
        page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' }),
      ]);

      const selectableRows = page.getByRole('row').filter({
        has: page.getByRole('cell').getByRole('checkbox'),
      });
      await expect(selectableRows.first()).toBeVisible();

      const searchInput = page.getByPlaceholder(/Search by name/i);
      const filteredResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'GET'
          && url.pathname === '/api/customers/people'
          && url.searchParams.get('search') === prefix;
      });
      await searchInput.fill(prefix);
      const filteredResponse = await filteredResponsePromise;
      expect(filteredResponse.status()).toBe(200);
      const filteredPayload = (await parseJsonSafe<{ items?: Array<{ id?: unknown }> }>(await filteredResponse.text())) ?? {};
      expect((filteredPayload.items ?? [])
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => id !== null)
        .sort()).toEqual([...deletableIds, blockedId].sort());

      await expect(selectableRows).toHaveCount(3);
      for (const name of ['Free0', 'Free1', 'Blocked']) {
        await expect(page.getByRole('link', { name: `${prefix} ${name}`, exact: true })).toBeVisible();
      }
      const fixtureIds = [...deletableIds, blockedId].sort();
      const deletedPersonIds: string[] = [];
      page.on('request', (sentRequest) => {
        const url = new URL(sentRequest.url());
        const id = url.searchParams.get('id');
        if (sentRequest.method() === 'DELETE' && url.pathname === '/api/customers/people' && id) {
          deletedPersonIds.push(id);
        }
      });

      const selectAllCheckbox = page.getByRole('checkbox', { name: 'Select all', exact: true });
      await expect(selectAllCheckbox).toBeVisible();
      await selectAllCheckbox.check();
      await expect(page.getByRole('checkbox', { name: 'Select row', exact: true, checked: true })).toHaveCount(3);
      await expect(page.getByText('3 selected', { exact: true })).toBeVisible();

      const deleteButton = page.getByRole('button', { name: /Delete selected/i });
      await expect(deleteButton).toBeVisible();
      await deleteButton.click();

      const confirmDialog = page.getByRole('alertdialog');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog).toContainText('Delete 3 people?');
      await confirmDialog.getByRole('button', { name: /Delete|Confirm/i }).click();

      // Grouped failure toast must surface the dependency reason from the server.
      await expect(page.getByText(/linked deals/i).first()).toBeVisible({ timeout: 10_000 });
      expect(deletedPersonIds.sort()).toEqual(fixtureIds);

      // Server state: blocked person remains; deletable people are gone.
      await expect
        .poll(
          async () => {
            const listResponse = await apiRequest(
              request,
              'GET',
              `/api/customers/people?search=${encodeURIComponent(prefix)}&pageSize=20`,
              { token: token! },
            );
            if (!listResponse.ok()) return null;
            const payload = (await readJsonSafe<{ items?: Array<{ id?: unknown }> }>(listResponse)) ?? {};
            if (!Array.isArray(payload.items)) return null;
            return payload.items
              .map((item) => (typeof item?.id === 'string' ? item.id : null))
              .filter((id): id is string => !!id)
              .sort();
          },
          { timeout: 15_000, message: 'expected only the blocked person to remain on the server' },
        )
        .toEqual([blockedId]);

      deletableIds.length = 0;

      // Blocked row is still in the rendered table after a refetch.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('link', { name: `${prefix} Blocked`, exact: true })).toBeVisible();
      await expect(page.locator('tbody').getByRole('row')).toHaveCount(1);
    } finally {
      if (dealId) {
        await deleteEntityByBody(request, token, '/api/customers/deals', dealId);
      }
      if (blockedId) {
        await deleteEntityIfExists(request, token, '/api/customers/people', blockedId);
      }
      for (const id of deletableIds) {
        await deleteEntityIfExists(request, token, '/api/customers/people', id);
      }
    }
  });
});
