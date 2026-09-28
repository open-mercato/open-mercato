import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

type CreateResponse = { id?: string };
type ProductListResponse = { items?: Array<Record<string, unknown>> };
type BulkDeleteResponse = { ok?: boolean; progressJobId?: string | null; message?: string };
type ProgressJobResponse = { id?: string; status?: string; errorMessage?: string | null };

const PROGRESS_POLL_INTERVAL_MS = 300;
const PROGRESS_POLL_TIMEOUT_MS = 30_000;

/**
 * TC-CAT-036: Bulk-delete progress job and worker payload stay scoped to the
 * organization SELECTED via the header/cookie override, not the caller's home
 * organization (#6523 / PR #6534).
 *
 * `POST /api/catalog/bulk-delete` used to scope its progress job and
 * queue payload with `auth.orgId` (the caller's home organization) instead of
 * `resolveOrganizationScopeForRequest(...).selectedId ?? auth.orgId`. For a
 * non-superadmin user with access to two organizations, selecting the non-home
 * organization before bulk-deleting used to run the operation against the
 * wrong organization: the request looked like it targeted org B but silently
 * touched org A (or failed to touch org B at all).
 *
 * This test proves the real boundary end-to-end (API + queue worker), not the
 * unit test's mocked `resolveOrganizationScopeForRequest`/queue:
 * - a non-superadmin user homed in org A, with role-ACL access to org A and
 *   org B, bulk-deletes product P_B with org B selected -> P_B must be gone.
 * - the same user bulk-deletes product P_A (which lives in org A) with org B
 *   still selected -> P_A must be left alone, because a cross-organization
 *   delete is rejected by the command's own organization-scope guard
 *   (`ensureOrganizationScope`) once the worker payload correctly carries the
 *   selected organization.
 */
test.describe('TC-CAT-036: catalog bulk-delete organization scope (#6523)', () => {
  test('bulk-delete respects the selected organization, not the caller home org', async ({ request }) => {
    test.slow();
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const password = 'QaCat036!Pass1';
    const email = `qa-tc-cat-036-${stamp}@acme.com`;

    let superadminToken: string | null = null;
    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    let userToken: string | null = null;
    let productAId: string | null = null;
    let productBId: string | null = null;

    try {
      superadminToken = await getAuthToken(request, 'superadmin');
      const scope = getTokenScope(superadminToken);

      orgAId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-CAT-036 Org A ${stamp}`,
        tenantId: scope.tenantId,
      });
      orgBId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-CAT-036 Org B ${stamp}`,
        tenantId: scope.tenantId,
      });

      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa_tc_cat_036_${stamp}`,
        tenantId: scope.tenantId,
      });
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'catalog.products.view',
          'catalog.products.manage',
          'currencies.view',
          'dictionaries.view',
        ],
        organizations: [orgAId, orgBId],
      });

      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgAId,
        roles: [roleId],
      });
      userToken = await getAuthToken(request, email, password);

      // P_A lives in the user's home organization (org A) — no selection override needed.
      const productAResponse = await apiRequest(request, 'POST', '/api/catalog/products', {
        token: userToken,
        data: { title: `QA TC-CAT-036 Product A ${stamp}` },
      });
      const productABody = await readJsonSafe<CreateResponse>(productAResponse);
      expect(productAResponse.status(), 'creating product A should return 201').toBe(201);
      productAId = expectId(productABody?.id, 'Product A creation response should include id');

      // P_B is created with org B explicitly selected via the same cookie override
      // the bulk-delete route now honors.
      const productBResponse = await apiRequestWithSelectedOrg(request, 'POST', '/api/catalog/products', {
        token: userToken,
        selectedOrgId: orgBId,
        data: { title: `QA TC-CAT-036 Product B ${stamp}` },
      });
      const productBBody = await readJsonSafe<CreateResponse>(productBResponse);
      expect(productBResponse.status(), 'creating product B (org B selected) should return 201').toBe(201);
      productBId = expectId(productBBody?.id, 'Product B creation response should include id');

      // Sanity check the fixture setup: product B must actually be visible when
      // org B is selected, proving the role ACL granted access to both orgs and
      // the selection was honored (not silently rejected/fell back to org A).
      const productBReadback = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productBId)}`,
        { token: userToken, selectedOrgId: orgBId },
      );
      const productBReadbackBody = await readJsonSafe<ProductListResponse>(productBReadback);
      expect(productBReadback.status(), 'reading product B with org B selected should return 200').toBe(200);
      expect(
        productBReadbackBody?.items?.length,
        'product B should be visible with org B selected',
      ).toBe(1);

      // --- Scenario 1: correct scope. Bulk-delete P_B with org B selected. ---
      const bulkDeleteBResponse = await apiRequestWithSelectedOrg(
        request,
        'POST',
        '/api/catalog/bulk-delete',
        {
          token: userToken,
          selectedOrgId: orgBId,
          data: { confirm: true, ids: [productBId], scope: 'selected' },
        },
      );
      const bulkDeleteBBody = await readJsonSafe<BulkDeleteResponse>(bulkDeleteBResponse);
      expect(bulkDeleteBResponse.status(), 'bulk-delete of product B should be accepted').toBe(202);
      const jobBId = expectId(
        bulkDeleteBBody?.progressJobId ?? undefined,
        'bulk-delete response should include a progressJobId',
      );

      // The progress job is scoped to org B, not the caller's home org (org A), so
      // it can only be read back with org B selected. Superadmin's `om_selected_org`
      // override changes `auth.orgId` itself (see `applySuperAdminScope`), letting
      // the job-detail route's plain `auth.orgId` filter resolve to org B.
      const jobB = await waitForProgressJob(request, superadminToken, orgBId, jobBId);
      expect(
        jobB.status,
        `progress job for product B deletion should complete when org B is selected (job: ${JSON.stringify(jobB)})`,
      ).toBe('completed');

      const productBAfterDelete = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productBId)}`,
        { token: userToken, selectedOrgId: orgBId },
      );
      const productBAfterDeleteBody = await readJsonSafe<ProductListResponse>(productBAfterDelete);
      expect(productBAfterDelete.status(), 'reading product B after deletion should return 200').toBe(200);
      expect(
        productBAfterDeleteBody?.items?.length,
        'product B must be gone after the org-B-scoped bulk-delete',
      ).toBe(0);

      // --- Scenario 2: wrong scope. Bulk-delete P_A (org A) with org B selected. ---
      const bulkDeleteAResponse = await apiRequestWithSelectedOrg(
        request,
        'POST',
        '/api/catalog/bulk-delete',
        {
          token: userToken,
          selectedOrgId: orgBId,
          data: { confirm: true, ids: [productAId], scope: 'selected' },
        },
      );
      const bulkDeleteABody = await readJsonSafe<BulkDeleteResponse>(bulkDeleteAResponse);
      expect(bulkDeleteAResponse.status(), 'bulk-delete request for product A should be accepted').toBe(202);
      const jobAId = expectId(
        bulkDeleteABody?.progressJobId ?? undefined,
        'bulk-delete response should include a progressJobId',
      );

      const jobA = await waitForProgressJob(request, superadminToken, orgBId, jobAId);
      // With org B selected, the worker's command-level organization-scope guard
      // (`ensureOrganizationScope`) must reject deleting a product that belongs to
      // org A, so the job fails rather than silently succeeding across orgs.
      expect(
        jobA.status,
        `deleting an org-A product while org B is selected must not succeed (job: ${JSON.stringify(jobA)})`,
      ).toBe('failed');

      const productAAfterWrongScopeDelete = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productAId)}`,
        { token: userToken },
      );
      const productAAfterWrongScopeDeleteBody = await readJsonSafe<ProductListResponse>(
        productAAfterWrongScopeDelete,
      );
      expect(productAAfterWrongScopeDelete.status(), 'reading product A should return 200').toBe(200);
      expect(
        productAAfterWrongScopeDeleteBody?.items?.length,
        'product A must survive a bulk-delete request scoped to a different organization',
      ).toBe(1);
      productAId = null;
    } finally {
      if (userToken && orgBId && productBId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productBId)}`, {
          token: userToken,
          selectedOrgId: orgBId,
        }).catch(() => undefined);
      }
      if (userToken && productAId) {
        await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productAId)}`, {
          token: userToken,
        }).catch(() => undefined);
      }
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, orgBId);
      await deleteOrganizationIfExists(request, superadminToken, orgAId);
    }
  });
});

async function waitForProgressJob(
  request: import('@playwright/test').APIRequestContext,
  superadminToken: string,
  selectedOrgId: string,
  jobId: string,
): Promise<ProgressJobResponse> {
  const deadline = Date.now() + PROGRESS_POLL_TIMEOUT_MS;
  let last: ProgressJobResponse | null = null;
  while (Date.now() < deadline) {
    const response = await apiRequestWithSelectedOrg(request, 'GET', `/api/progress/jobs/${jobId}`, {
      token: superadminToken,
      selectedOrgId,
    });
    if (response.ok()) {
      const body = await readJsonSafe<ProgressJobResponse>(response);
      if (body) {
        last = body;
        if (body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled') {
          return body;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, PROGRESS_POLL_INTERVAL_MS));
  }
  throw new Error(`Progress job ${jobId} did not finish within ${PROGRESS_POLL_TIMEOUT_MS}ms (last: ${JSON.stringify(last)})`);
}
