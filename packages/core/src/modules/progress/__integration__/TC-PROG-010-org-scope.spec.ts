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

type CreateJobResponse = { id?: string };
type JobDetailResponse = { id?: string; status?: string; progressPercent?: number; organizationId?: string | null };
type JobListResponse = { items?: Array<{ id: string }> };
type ActiveJobsResponse = { active?: Array<{ id: string }>; recentlyCompleted?: Array<{ id: string }> };

/**
 * TC-PROG-010: Progress job read/write endpoints stay scoped to the
 * organization SELECTED via the header/cookie override, not the caller's
 * home organization.
 *
 * `GET/PUT/DELETE /api/progress/jobs/:id`, `GET /api/progress/jobs`, and
 * `GET /api/progress/active` used to filter/scope strictly by `auth.orgId`
 * (the caller's home organization). For a non-superadmin user with a
 * different organization selected, a job created under the selected
 * organization was invisible (404 / absent from lists) to that same user
 * while still working in that organization — the exact gap the UI QA
 * report on PR #6534 found: after the catalog bulk-delete fix, the
 * progress top bar showed no feedback for a non-home-org operation.
 */
test.describe('TC-PROG-010: progress job endpoints organization scope', () => {
  test('progress job read/write endpoints respect the selected organization', async ({ request }) => {
    test.slow();
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const password = 'QaProg010!Pass1';
    const email = `qa-tc-prog-010-${stamp}@acme.com`;

    let superadminToken: string | null = null;
    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    let userToken: string | null = null;
    let jobId: string | null = null;

    try {
      superadminToken = await getAuthToken(request, 'superadmin');
      const scope = getTokenScope(superadminToken);

      orgAId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-PROG-010 Org A ${stamp}`,
        tenantId: scope.tenantId,
      });
      orgBId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-PROG-010 Org B ${stamp}`,
        tenantId: scope.tenantId,
      });

      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa_tc_prog_010_${stamp}`,
        tenantId: scope.tenantId,
      });
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['progress.view', 'progress.create', 'progress.update', 'progress.cancel'],
        organizations: [orgAId, orgBId],
      });

      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgAId,
        roles: [roleId],
      });
      userToken = await getAuthToken(request, email, password);

      // Create the job with org B explicitly selected — the fixed POST route
      // must scope it to org B, not the caller's home org (org A).
      const createRes = await apiRequestWithSelectedOrg(request, 'POST', '/api/progress/jobs', {
        token: userToken,
        selectedOrgId: orgBId,
        data: {
          jobType: 'integration-test',
          name: `QA TC-PROG-010 ${stamp}`,
          totalCount: 100,
          cancellable: true,
        },
      });
      const createBody = await readJsonSafe<CreateJobResponse>(createRes);
      expect(createRes.status(), 'creating a progress job with org B selected should return 201').toBe(201);
      jobId = expectId(createBody?.id, 'progress job creation response should include id');

      // --- GET detail: visible with org B selected, hidden with org A selected ---
      const detailWithB = await apiRequestWithSelectedOrg(request, 'GET', `/api/progress/jobs/${jobId}`, {
        token: userToken,
        selectedOrgId: orgBId,
      });
      const detailWithBBody = await readJsonSafe<JobDetailResponse>(detailWithB);
      expect(detailWithB.status(), 'job detail should be visible with org B selected').toBe(200);
      expect(detailWithBBody?.id).toBe(jobId);
      expect(detailWithBBody?.organizationId).toBe(orgBId);

      const detailWithA = await apiRequest(request, 'GET', `/api/progress/jobs/${jobId}`, { token: userToken });
      expect(detailWithA.status(), 'job detail must not leak into the home org (org A) view').toBe(404);

      // --- GET list: present with org B selected, absent with org A selected ---
      const listWithB = await apiRequestWithSelectedOrg(request, 'GET', '/api/progress/jobs?includeCompleted=true', {
        token: userToken,
        selectedOrgId: orgBId,
      });
      const listWithBBody = await readJsonSafe<JobListResponse>(listWithB);
      expect(listWithB.status()).toBe(200);
      expect(listWithBBody?.items?.some((item) => item.id === jobId)).toBe(true);

      const listWithA = await apiRequest(request, 'GET', '/api/progress/jobs?includeCompleted=true', { token: userToken });
      const listWithABody = await readJsonSafe<JobListResponse>(listWithA);
      expect(listWithA.status()).toBe(200);
      expect(listWithABody?.items?.some((item) => item.id === jobId)).toBe(false);

      // --- GET active: present with org B selected, absent with org A selected ---
      const activeWithB = await apiRequestWithSelectedOrg(request, 'GET', '/api/progress/active', {
        token: userToken,
        selectedOrgId: orgBId,
      });
      const activeWithBBody = await readJsonSafe<ActiveJobsResponse>(activeWithB);
      expect(activeWithB.status()).toBe(200);
      expect(activeWithBBody?.active?.some((item) => item.id === jobId)).toBe(true);

      const activeWithA = await apiRequest(request, 'GET', '/api/progress/active', { token: userToken });
      const activeWithABody = await readJsonSafe<ActiveJobsResponse>(activeWithA);
      expect(activeWithA.status()).toBe(200);
      expect(activeWithABody?.active?.some((item) => item.id === jobId)).toBe(false);

      // --- PUT update: rejected with org A selected, accepted with org B selected ---
      const updateWithA = await apiRequest(request, 'PUT', `/api/progress/jobs/${jobId}`, {
        token: userToken,
        data: { processedCount: 50, totalCount: 100 },
      });
      expect(updateWithA.status(), 'updating the job from the home org must not find it').toBe(404);

      const updateWithB = await apiRequestWithSelectedOrg(request, 'PUT', `/api/progress/jobs/${jobId}`, {
        token: userToken,
        selectedOrgId: orgBId,
        data: { processedCount: 50, totalCount: 100 },
      });
      const updateWithBBody = await readJsonSafe<{ ok?: boolean; progressPercent?: number }>(updateWithB);
      expect(updateWithB.status(), 'updating the job with org B selected should succeed').toBe(200);
      expect(updateWithBBody?.ok).toBe(true);
      expect(updateWithBBody?.progressPercent).toBe(50);

      // --- DELETE (cancel): rejected with org A selected, accepted with org B selected ---
      const cancelWithA = await apiRequest(request, 'DELETE', `/api/progress/jobs/${jobId}`, { token: userToken });
      expect(cancelWithA.status(), 'cancelling the job from the home org must fail').toBe(400);

      const cancelWithB = await apiRequestWithSelectedOrg(request, 'DELETE', `/api/progress/jobs/${jobId}`, {
        token: userToken,
        selectedOrgId: orgBId,
      });
      const cancelWithBBody = await readJsonSafe<{ ok?: boolean }>(cancelWithB);
      expect(cancelWithB.status(), 'cancelling the job with org B selected should succeed').toBe(200);
      expect(cancelWithBBody?.ok).toBe(true);

      const finalDetail = await apiRequestWithSelectedOrg(request, 'GET', `/api/progress/jobs/${jobId}`, {
        token: userToken,
        selectedOrgId: orgBId,
      });
      const finalDetailBody = await readJsonSafe<JobDetailResponse>(finalDetail);
      expect(finalDetailBody?.status).toBe('cancelled');
      jobId = null;
    } finally {
      if (userToken && jobId && orgBId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/progress/jobs/${jobId}`, {
          token: userToken,
          selectedOrgId: orgBId,
        }).catch(() => undefined);
      }
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, orgBId);
      await deleteOrganizationIfExists(request, superadminToken, orgAId);
    }
  });
});
