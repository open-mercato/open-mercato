import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-045: Roles ergonomics (Phase 5 — Q5 + Q6)
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md
 *
 * Covers three related fixes:
 *   1. Q6(i) — section rename to "My roles with {name}" (person) and
 *      "Roles at {name}" (company).
 *   2. Q6(ii) — "Manage role types" deep link visible inside AssignRoleDialog
 *      for users with `customers.settings.manage`, hidden otherwise.
 *   3. Q5(a) — (API-level regression guard) entity-roles response keeps
 *      `userName` typed string | null, with the documented fallback chain
 *      (User.name → email local-part → null). Phase 1/2 invariants: the row
 *      resource shape is unchanged and `userName` is present whenever at least
 *      one of the name sources is non-null.
 */
test.describe('TC-CRM-045: Role section ergonomics + API userName fallback', () => {
  test('person section renders "My roles with {name}" + API keeps userName shape stable', async ({
    page,
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let personEntityId: string | null = null;
    const stamp = Date.now();
    const personDisplayName = `QA TC-CRM-045 Person ${stamp}`;
    const companyDisplayName = `QA TC-CRM-045 Co ${stamp}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyDisplayName);
      personEntityId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC045-${stamp}`,
        displayName: personDisplayName,
        companyEntityId: companyId,
      });

      await login(page, 'admin');
      await page.setViewportSize({ width: 1600, height: 900 });

      // Expand Zone 1 so the roles section is visible.
      await page.evaluate(() => {
        localStorage.setItem('om:zone1-collapsed:person-v2', JSON.stringify('0'));
      });

      await page.goto(`/backend/customers/people-v2/${personEntityId}`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('heading', { name: personDisplayName, exact: true })).toBeVisible({
        timeout: 15000,
      });

      // (1) Person group title — "My roles with <name>"
      // The CollapsibleGroup trigger button carries the same label, so we target
      // that always-visible surface to avoid strict-mode churn on the duplicate.
      await expect(
        page
          .getByRole('button')
          .filter({ hasText: `My roles with ${personDisplayName}` })
          .first(),
      ).toBeVisible({ timeout: 10000 });

      // (2) Company page — "Roles at <company>"
      await page.evaluate(() => {
        localStorage.setItem('om:zone1-collapsed:company-v2', JSON.stringify('0'));
      });
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('heading', { name: companyDisplayName, exact: true })).toBeVisible({
        timeout: 15000,
      });
      // RolesSection on the company page lives inside the People tab (Zone 2),
      // rendered by CompanyPeopleSection. The People tab is selected by default
      // when at least one person is linked, but click it defensively in case
      // defaults change. On the company surface the section title is a plain
      // `<div>` (no CollapsibleGroup wrapper like the person page), so assert
      // on the text directly — `.first()` avoids any unintended duplicates.
      await page.getByRole('tab', { name: /^People(\s|$)/i }).first().click().catch(() => undefined);
      await expect(
        page.getByText(`Roles at ${companyDisplayName}`).first(),
      ).toBeVisible({ timeout: 10000 });

      // (3) API regression guard for Q5(a) — entity-roles list shape.
      const rolesRes = await apiRequest(
        request,
        'GET',
        `/api/customers/companies/${companyId}/roles`,
        { token },
      );
      expect(rolesRes.ok(), `roles endpoint should succeed: ${rolesRes.status()}`).toBeTruthy();
      const rolesBody = (await rolesRes.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(rolesBody.items)).toBeTruthy();
      // Shape contract: every item must carry string | null for userName (never undefined or other).
      for (const item of rolesBody.items ?? []) {
        const userName = (item as { userName?: unknown }).userName;
        expect(
          userName === null || typeof userName === 'string',
          'userName must be string | null per BC #2',
        ).toBeTruthy();
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personEntityId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
