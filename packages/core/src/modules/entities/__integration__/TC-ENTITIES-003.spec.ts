import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomEntity,
  deleteCustomEntityIfExists,
  listFieldDefinitions,
  saveFieldDefinitions,
  uniqueEntityId,
} from './helpers/entitiesApi';

type ManagedDefinition = {
  id?: string;
  key?: string;
  kind?: string;
  configJson?: { label?: string; priority?: number } | null;
};

/**
 * TC-ENTITIES-003: Create custom field definitions for an entity  [P0] (api)
 * Source: issue #2471.
 *
 *   - POST /api/entities/definitions.batch  → 200 { ok: true }
 *   - GET  /api/entities/definitions.manage → scoped definitions for the entity
 *
 * Verified contract notes (differ from the issue's prose):
 *   - The batch route is `/api/entities/definitions.batch` (dot, not `/definitions/batch`).
 *   - The read-back route is `/api/entities/definitions.manage` and requires
 *     `entities.definitions.manage` (not `.view`).
 *   - Field `key` must be snake_case `^[a-z0-9_]+$`; the batch route stamps
 *     `configJson.priority` from the definition's array index.
 */
test.describe('TC-ENTITIES-003: Create custom field definitions for an entity', () => {
  test('saves text + integer field definitions and reads them back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const entityId = uniqueEntityId('fielded');

    try {
      const createRes = await createCustomEntity(request, token, { entityId, label: 'TC-ENTITIES-003 Entity' });
      expect(createRes.status(), 'entity create 200').toBe(200);

      const batchRes = await saveFieldDefinitions(request, token, entityId, [
        { key: 'name', kind: 'text', configJson: { label: 'Name' } },
        { key: 'quantity', kind: 'integer', configJson: { label: 'Quantity' } },
      ]);
      expect(batchRes.status(), 'POST /api/entities/definitions.batch 200').toBe(200);
      const batchBody = await readJsonSafe<{ ok?: boolean }>(batchRes);
      expect(batchBody?.ok, 'batch response ok=true').toBe(true);

      const manageRes = await listFieldDefinitions(request, token, entityId);
      expect(manageRes.status(), 'GET /api/entities/definitions.manage 200').toBe(200);
      const manageBody = await readJsonSafe<{ items?: ManagedDefinition[]; deletedKeys?: string[] }>(manageRes);
      const items = manageBody?.items ?? [];

      const nameDef = items.find((d) => d.key === 'name');
      const quantityDef = items.find((d) => d.key === 'quantity');
      expect(nameDef, 'name definition is returned').toBeTruthy();
      expect(nameDef?.kind, 'name kind is text').toBe('text');
      expect(nameDef?.configJson?.label, 'name label persisted').toBe('Name');
      expect(typeof nameDef?.configJson?.priority, 'name priority stamped').toBe('number');

      expect(quantityDef, 'quantity definition is returned').toBeTruthy();
      expect(quantityDef?.kind, 'quantity kind is integer').toBe('integer');
      expect(quantityDef?.configJson?.label, 'quantity label persisted').toBe('Quantity');
    } finally {
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });
});
