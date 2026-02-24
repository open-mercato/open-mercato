import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-INT-007: Team Members list page — renders table, shows created member, supports navigation to detail
 */
test.describe('TC-INT-007: Team Members list page', () => {
  test('should render the team members table and allow navigating to a member detail page', async ({ page, request }) => {
    const stamp = Date.now();
    const memberName = `QA Member ${stamp}`;

    let token: string | null = null;
    let memberId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      await login(page, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { displayName: memberName, isActive: true },
      });
      expect(createResponse.ok(), 'Team member fixture should be created').toBeTruthy();
      const createBody = (await createResponse.json()) as { id?: string };
      memberId = typeof createBody.id === 'string' ? createBody.id : null;
      expect(memberId, 'Team member id should be returned by create response').toBeTruthy();

      await page.goto('/backend/staff/team-members');

      await expect(
        page.getByRole('heading', { name: /team members/i }),
      ).toBeVisible();

      await expect(
        page.getByRole('link', { name: /add team member/i }).or(
          page.getByRole('button', { name: /add team member/i }),
        ),
      ).toBeVisible();

      await expect(page.getByText(memberName)).toBeVisible();

      await page.goto(`/backend/staff/team-members/${encodeURIComponent(memberId ?? '')}`);

      await expect(page.getByText(memberName)).toBeVisible();
    } finally {
      if (token && memberId) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(memberId)}`, {
          token,
        }).catch(() => {});
      }
    }
  });
});
