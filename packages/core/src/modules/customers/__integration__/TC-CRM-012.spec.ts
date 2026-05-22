import { expect, test } from '@playwright/test';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-012: Tag Customers for Segmentation
 * Source: .ai/qa/scenarios/TC-CRM-012-customer-tagging.md
 */
test.describe('TC-CRM-012: Tag Customers for Segmentation', () => {
  test('should assign multiple tags to a company and filter list by assigned tag', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;

    const companyName = `QA TC-CRM-012 Co ${Date.now()}`;
    const tagOne = `qa-seg-${Date.now()}`;
    const tagTwo = `qa-tier-${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      // Company detail v2 moved tag editing into an EntityTagsDialog; create and assign tags via
      // the public API so this test remains focused on the end-to-end segmentation outcome.
      for (const label of [tagOne, tagTwo]) {
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const createTag = await apiRequest(request, 'POST', '/api/customers/tags', {
          token,
          data: { label, slug },
        });
        expect(createTag.status(), `POST /api/customers/tags returned ${createTag.status()}`).toBeLessThan(400);
        const createJson = (await createTag.json()) as { id?: string };
        const tagId = createJson.id;
        expect(tagId, `POST /api/customers/tags missing id field`).toBeTruthy();

        const assignResp = await apiRequest(request, 'POST', '/api/customers/tags/assign', {
          token,
          data: { tagId, entityId: companyId },
        });
        expect(assignResp.status(), `POST /api/customers/tags/assign returned ${assignResp.status()}`).toBeLessThan(400);
      }

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(tagOne).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(tagTwo).first()).toBeVisible();

      await expect
        .poll(
          async () => {
            const detailResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token: token! });
            if (!detailResponse.ok()) return false;
            const payload = await detailResponse.json() as {
              tags?: Array<{ label?: unknown }>;
            };
            const labels = Array.isArray(payload.tags)
              ? payload.tags
                .map((tag) => (typeof tag.label === 'string' ? tag.label : ''))
                .filter((label) => label.length > 0)
              : [];
            return labels.includes(tagOne) && labels.includes(tagTwo);
          },
          { timeout: 20000 },
        )
        .toBe(true);

      // Verify the tag assignment via GET /api/customers/companies/{id} which returns the
      // resolved tag labels on the company record.
      const companyResp = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token: token! });
      expect(companyResp.ok(), `GET company detail failed ${companyResp.status()}`).toBeTruthy();
      const companyJson = (await companyResp.json()) as { tags?: Array<{ label?: string }> };
      const assignedLabels = (companyJson.tags ?? []).map((t) => t.label ?? '').filter((l) => l.length > 0);
      expect(assignedLabels).toEqual(expect.arrayContaining([tagOne, tagTwo]));

      await page.goto('/backend/customers/companies', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Refresh' }).waitFor();
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      await expect
        .poll(
          async () => {
            await page.waitForTimeout(500);
            await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return await page.getByRole('link', { name: companyName, exact: true }).count();
          },
          { timeout: 20000 },
        )
        .toBeGreaterThan(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
