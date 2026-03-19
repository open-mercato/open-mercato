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
      const resourceSettingsHeading = page.getByRole('heading', {
        name: /resource settings|ressourceneinstellungen|configuración del recurso|ustawienia zasobu/i,
      });
      await expect(resourceSettingsHeading).toBeVisible();
      const resourceCard = page.locator('div.rounded-lg.border.bg-card.p-4').filter({ has: resourceSettingsHeading }).first();
      await expect(resourceCard.locator('button[type="submit"]')).toBeVisible();
      await expect(resourceCard.getByText(/edit resource|ressource bearbeiten|editar recurso|edytuj zasób/i)).toHaveCount(0);

      await page.goto(`/backend/staff/team-members/${encodeURIComponent(teamMemberId ?? '')}`);
      const memberSettingsHeading = page.getByRole('heading', {
        name: /member settings|mitgliedseinstellungen|configuración del miembro|ustawienia członka/i,
      });
      await expect(memberSettingsHeading).toBeVisible();
      const memberCard = page.locator('div.rounded-lg.border.bg-card.p-4').filter({ has: memberSettingsHeading }).first();
      await expect(memberCard.locator('button[type="submit"]')).toBeVisible();
      await expect(memberCard.getByText(/edit team member|teammitglied bearbeiten|editar miembro|edytuj członka/i)).toHaveCount(0);
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
