import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { apiRequest, getAuthToken } from '../helpers/api';

/**
 * TC-INT-006: Embedded Settings Headings on Resource and Team Member Detail
 */
test.describe('TC-INT-006: Embedded Settings Headings on Resource and Team Member Detail', () => {
  test('should render embedded settings sections without the old edit-form header rows', async ({ page, request }) => {
    const stamp = Date.now();
    const resourceName = `QA Resource ${stamp}`;
    const memberName = `QA Team Member ${stamp}`;

    let token: string | null = null;
    let resourceId: string | null = null;
    let teamMemberId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      await login(page, 'admin');

      const resourceCreateResponse = await apiRequest(request, 'POST', '/api/resources/resources', {
        token,
        data: { name: resourceName },
      });
      expect(resourceCreateResponse.ok(), 'Resource fixture should be created').toBeTruthy();
      const resourceCreateBody = (await resourceCreateResponse.json()) as { id?: string | null };
      resourceId = typeof resourceCreateBody.id === 'string' ? resourceCreateBody.id : null;
      expect(resourceId, 'Resource id should be returned by create response').toBeTruthy();

      const teamMemberCreateResponse = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { displayName: memberName },
      });
      expect(teamMemberCreateResponse.ok(), 'Team member fixture should be created').toBeTruthy();
      const teamMemberCreateBody = (await teamMemberCreateResponse.json()) as { id?: string | null };
      teamMemberId = typeof teamMemberCreateBody.id === 'string' ? teamMemberCreateBody.id : null;
      expect(teamMemberId, 'Team member id should be returned by create response').toBeTruthy();

      await page.goto(`/backend/resources/resources/${encodeURIComponent(resourceId ?? '')}`);
      await expect(page.getByRole('heading', { name: 'Resource settings' })).toBeVisible();
      await expect(page.getByText('Name *', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
      await expect(page.getByText('Edit resource', { exact: true })).toHaveCount(0);

      await page.goto(`/backend/staff/team-members/${encodeURIComponent(teamMemberId ?? '')}`);
      await expect(page.getByRole('heading', { name: 'Member settings' })).toBeVisible();
      await expect(page.getByText('Display name *', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
      await expect(page.getByText('Edit team member', { exact: true })).toHaveCount(0);
    } finally {
      if (token && resourceId) {
        await apiRequest(request, 'DELETE', `/api/resources/resources?id=${encodeURIComponent(resourceId)}`, {
          token,
        }).catch(() => {});
      }
      if (token && teamMemberId) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(teamMemberId)}`, {
          token,
        }).catch(() => {});
      }
    }
  });
});
