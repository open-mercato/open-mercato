import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomEntity,
  deleteCustomEntityIfExists,
  expectUuid,
  listCustomEntities,
  uniqueEntityId,
} from './helpers/entitiesApi';

/**
 * TC-ENTITIES-001: Create custom entity definition via API  [P0] (api)
 * Source: issue #2471 (entities integration coverage).
 *
 * Covers the core CRUD happy path for entity-definition management:
 *   - POST /api/entities/entities  → 200 { ok, item:{ id, entityId, label, description } }
 *   - GET  /api/entities/entities  → the entity appears with source 'custom'
 *
 * Verified contract notes (differ from the issue's prose):
 *   - The route is `/api/entities/entities` (not `/api/entities`).
 *   - POST returns HTTP 200 (not 201). The UUID lives on the POST `item.id`;
 *     the GET list items expose `{ entityId, source, label, description?, count }`
 *     and do NOT echo `id`/`isActive`. Appearing in the default (isActive-only)
 *     list is the observable proxy for "active".
 */
test.describe('TC-ENTITIES-001: Create custom entity definition via API', () => {
  test('creates a custom entity and lists it as source=custom', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const entityId = uniqueEntityId('widget');
    const label = 'TC-ENTITIES-001 Widget';
    const description = 'Created by TC-ENTITIES-001';

    try {
      const createRes = await createCustomEntity(request, token, { entityId, label, description });
      expect(createRes.status(), 'POST /api/entities/entities returns 200').toBe(200);
      const created = await readJsonSafe<{ ok?: boolean; item?: { id?: string; entityId?: string; label?: string; description?: string } }>(createRes);
      expect(created?.ok, 'create response ok=true').toBe(true);
      expectUuid(created?.item?.id, 'created entity id');
      expect(created?.item?.entityId, 'echoed entityId').toBe(entityId);
      expect(created?.item?.label, 'echoed label').toBe(label);
      expect(created?.item?.description, 'echoed description').toBe(description);

      const listRes = await listCustomEntities(request, token);
      expect(listRes.status(), 'GET /api/entities/entities returns 200').toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<{ entityId?: string; source?: string; label?: string }> }>(listRes);
      const mine = (listBody?.items ?? []).find((it) => it.entityId === entityId);
      expect(mine, 'created entity appears in the list').toBeTruthy();
      expect(mine?.source, 'entity source is custom').toBe('custom');
      expect(mine?.label, 'listed label matches').toBe(label);
    } finally {
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });
});
