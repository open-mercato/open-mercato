import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives', 'auth'],
};

type FeatureItem = { id?: string; module?: string; dependsOn?: string[] };
type FeaturesResponse = { items?: FeatureItem[] };

/**
 * TC-PERSP-ACL-DEPS-001 (#2157): the ACL feature catalog served to the role/user ACL editor
 * exposes the perspectives dependency declarations from spec 2026-05-27-acl-dependency-bundles §6.17.
 */
test.describe('TC-PERSP-ACL-DEPS-001: perspectives ACL feature dependencies', () => {
  test('exposes dependsOn for perspectives features through /api/auth/features', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const response = await apiRequest(request, 'GET', '/api/auth/features', { token });
    expect(response.status()).toBe(200);
    const body = await readJsonSafe<FeaturesResponse>(response);
    const items = body?.items ?? [];
    const byId = new Map(items.map((item): [string | undefined, FeatureItem] => [item.id, item]));

    const roleDefaults = byId.get('perspectives.role_defaults');
    expect(roleDefaults, 'perspectives.role_defaults is in the catalog').toBeTruthy();
    expect([...(roleDefaults?.dependsOn ?? [])].sort()).toEqual(['auth.roles.list', 'perspectives.use']);

    const use = byId.get('perspectives.use');
    expect(use, 'perspectives.use is in the catalog').toBeTruthy();
    expect(use?.dependsOn ?? []).toEqual([]);

    for (const dependency of roleDefaults?.dependsOn ?? []) {
      expect(byId.has(dependency), `dependency ${dependency} resolves to a declared feature`).toBe(true);
    }
  });
});
