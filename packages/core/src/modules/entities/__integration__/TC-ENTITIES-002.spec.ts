import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  deleteCustomEntityIfExists,
  listCustomEntities,
  rawRequest,
  uniqueEntityId,
} from './helpers/entitiesApi';

/**
 * TC-ENTITIES-002: Unauthorized access to entity management is rejected  [P0] (api)
 * Source: issue #2471.
 *
 * Entity-definition management requires the `entities.definitions.manage` feature.
 *   - No Authorization header                → 401 { error: 'Unauthorized' }
 *   - Authenticated employee (lacks feature) → 403 { error: 'Forbidden', requiredFeatures: [...] }
 * The seeded `employee` role has NO `entities.*` features (only `admin` does), so it
 * is the canonical "authenticated but unauthorized" actor. No entity is created.
 */
test.describe('TC-ENTITIES-002: Unauthorized access to entity management is rejected', () => {
  test('returns 401 without auth and 403 for a feature-less user; creates nothing', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const entityId = uniqueEntityId('forbidden');
    const body = { entityId, label: 'TC-ENTITIES-002 should never persist' };

    try {
      // POST without authentication → 401
      const unauthPost = await rawRequest(request, 'POST', '/api/entities/entities', body);
      expect(unauthPost.status(), 'POST without auth → 401').toBe(401);

      // POST as employee (missing entities.definitions.manage) → 403 with requiredFeatures
      const employeePost = await apiRequest(request, 'POST', '/api/entities/entities', { token: employeeToken, data: body });
      expect(employeePost.status(), 'POST as employee → 403').toBe(403);
      const forbiddenBody = await readJsonSafe<{ error?: string; requiredFeatures?: string[] }>(employeePost);
      expect(forbiddenBody?.requiredFeatures ?? [], '403 body lists the required feature').toContain('entities.definitions.manage');

      // DELETE without authentication → 401
      const unauthDelete = await rawRequest(request, 'DELETE', '/api/entities/entities', { entityId });
      expect(unauthDelete.status(), 'DELETE without auth → 401').toBe(401);

      // DELETE as employee → 403
      const employeeDelete = await apiRequest(request, 'DELETE', '/api/entities/entities', { token: employeeToken, data: { entityId } });
      expect(employeeDelete.status(), 'DELETE as employee → 403').toBe(403);

      // Nothing should have been created — admin must not see the probe entity.
      const listRes = await listCustomEntities(request, adminToken);
      const listBody = await readJsonSafe<{ items?: Array<{ entityId?: string }> }>(listRes);
      const present = (listBody?.items ?? []).some((it) => it.entityId === entityId);
      expect(present, 'rejected requests created no entity').toBe(false);
    } finally {
      // Defensive: if any call unexpectedly persisted, remove it.
      await deleteCustomEntityIfExists(request, adminToken, entityId);
    }
  });
});
