import { test, expect } from '@playwright/test';
import { login, DEFAULT_CREDENTIALS } from '../helpers/auth';
import { apiRequest, getAuthToken } from '../helpers/api';

type DashboardLayoutItem = {
  id: string;
  widgetId: string;
  order?: number;
  priority?: number;
  size?: 'sm' | 'md' | 'lg';
  settings?: unknown;
};

type DashboardLayoutResponse = {
  layout?: {
    items?: DashboardLayoutItem[];
  };
};

type UserWidgetsResponse = {
  mode?: 'inherit' | 'override';
  widgetIds?: string[];
  scope?: {
    tenantId?: string | null;
    organizationId?: string | null;
  };
};

type UsersListResponse = {
  items?: Array<{
    id?: string;
    email?: string;
  }>;
};

const BRANCH_WIDGET_IDS = ['sales.dashboard.newOrders', 'sales.dashboard.newQuotes'] as const;

type JsonReadableResponse = {
  json: () => Promise<unknown>;
};

async function readJsonSafe<T>(response: JsonReadableResponse): Promise<T | null> {
  return response.json().catch(() => null) as Promise<T | null>;
}

/**
 * TC-ADMIN-011: User Widget Override And Dashboard Enablement
 *
 * Verifies that an admin can:
 * 1) enable a widget override for their own user account in Dashboard Widgets
 * 2) switch the selected widget on in Dashboard customize mode.
 */
test.describe('TC-ADMIN-011: User Widget Override And Dashboard Enablement', () => {
  test('should enable widgets for current admin user and switch them on in dashboard', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const adminEmail = DEFAULT_CREDENTIALS.admin.email;

    let adminUserId: string | null = null;
    let originalWidgetMode: 'inherit' | 'override' = 'inherit';
    let originalWidgetIds: string[] = [];
    let originalTenantId: string | null = null;
    let originalOrganizationId: string | null = null;
    let originalLayoutItems: DashboardLayoutItem[] = [];

    try {
      const usersResponse = await apiRequest(request, 'GET', '/api/auth/users?page=1&pageSize=50', { token });
      const usersBody = await readJsonSafe<UsersListResponse>(usersResponse);
      const adminUser = usersBody?.items?.find((item) => item.email === adminEmail);
      adminUserId = typeof adminUser?.id === 'string' ? adminUser.id : null;
      expect(adminUserId, 'Admin user ID should exist in users list').toBeTruthy();

      const userWidgetsResponse = await apiRequest(
        request,
        'GET',
        `/api/dashboards/users/widgets?userId=${encodeURIComponent(String(adminUserId))}`,
        { token },
      );
      const userWidgetsBody = await readJsonSafe<UserWidgetsResponse>(userWidgetsResponse);
      originalWidgetMode = userWidgetsBody?.mode === 'override' ? 'override' : 'inherit';
      originalWidgetIds = Array.isArray(userWidgetsBody?.widgetIds) ? userWidgetsBody?.widgetIds : [];
      originalTenantId = userWidgetsBody?.scope?.tenantId ?? null;
      originalOrganizationId = userWidgetsBody?.scope?.organizationId ?? null;

      await apiRequest(request, 'PUT', '/api/dashboards/users/widgets', {
        token,
        data: {
          userId: adminUserId,
          tenantId: originalTenantId,
          organizationId: originalOrganizationId,
          mode: 'inherit',
          widgetIds: [],
        },
      });

      const layoutResponse = await apiRequest(request, 'GET', '/api/dashboards/layout', { token });
      const layoutBody = await readJsonSafe<DashboardLayoutResponse>(layoutResponse);
      originalLayoutItems = Array.isArray(layoutBody?.layout?.items) ? layoutBody.layout.items : [];

      const filteredLayout = originalLayoutItems.filter((item) => !BRANCH_WIDGET_IDS.includes(item.widgetId as (typeof BRANCH_WIDGET_IDS)[number]));
      if (filteredLayout.length !== originalLayoutItems.length) {
        await apiRequest(request, 'PUT', '/api/dashboards/layout', {
          token,
          data: { items: filteredLayout },
        });
      }

      await login(page, 'admin');
      await page.goto(`/backend/users/${encodeURIComponent(String(adminUserId))}/edit`);

      await expect(page.getByText('Dashboard Widgets')).toBeVisible();
      await page.getByRole('radio', { name: 'Override for this user' }).check();
      await page.getByRole('checkbox', { name: /New Orders/i }).check();
      await page.getByRole('checkbox', { name: /New Quotes/i }).check();
      await page.getByRole('button', { name: 'Save widgets' }).click();
      await expect(page.getByText('Dashboard widgets updated').first()).toBeVisible();

      await page.goto('/backend');
      await expect(page.getByText('No widgets selected yet.')).toBeVisible();

      await page.getByRole('button', { name: 'Customize', exact: true }).click();
      await page.getByRole('button', { name: 'New Orders' }).click();
      await page.getByRole('button', { name: 'New Quotes' }).click();
      await expect(page.getByText('New Orders').first()).toBeVisible();
      await expect(page.getByText('New Quotes').first()).toBeVisible();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible();
      await expect(page.getByText('No widgets selected yet.')).toHaveCount(0);
      await expect(page.getByText('New Orders').first()).toBeVisible();
      await expect(page.getByText('New Quotes').first()).toBeVisible();
    } finally {
      if (adminUserId) {
        await apiRequest(request, 'PUT', '/api/dashboards/users/widgets', {
          token,
          data: {
            userId: adminUserId,
            tenantId: originalTenantId,
            organizationId: originalOrganizationId,
            mode: originalWidgetMode,
            widgetIds: originalWidgetIds,
          },
        }).catch(() => {});
      }

      await apiRequest(request, 'PUT', '/api/dashboards/layout', {
        token,
        data: {
          items: originalLayoutItems,
        },
      }).catch(() => {});
    }
  });
});
