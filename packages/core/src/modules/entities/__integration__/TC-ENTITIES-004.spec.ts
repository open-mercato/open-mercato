import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomEntity,
  createRecord,
  deleteCustomEntityIfExists,
  deleteRecordIfExists,
  expectUuid,
  listRecords,
  saveFieldDefinitions,
  uniqueEntityId,
} from './helpers/entitiesApi';

type RecordItem = { id?: string; name?: unknown; quantity?: unknown };

/**
 * TC-ENTITIES-004: Create a custom entity record with field values  [P0] (api)
 * Source: issue #2471.
 *
 * End-to-end happy path: define an entity + fields, then create and read a record.
 *   - POST /api/entities/records → 200 { ok: true, item: { entityId, recordId } }
 *   - GET  /api/entities/records → record present with its field values
 *
 * Verified contract notes (differ from the issue's prose):
 *   - The record payload is nested under `values` ({ entityId, values:{...} }),
 *     NOT flat top-level fields, and the response is `item.recordId` (a UUID),
 *     not `{ id, items: [...] }`.
 *   - Field keys must be declared first; the generic records endpoint rejects
 *     undeclared keys (see TC-ENTITIES-005), so definitions are created up front.
 *   - List items expose bare field keys (the `cf_` prefix is stripped).
 */
test.describe('TC-ENTITIES-004: Create a custom entity record with field values', () => {
  test('creates a record and reads its values back from the list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const entityId = uniqueEntityId('record');
    let recordId: string | null = null;

    try {
      expect((await createCustomEntity(request, token, { entityId, label: 'TC-ENTITIES-004 Entity' })).status()).toBe(200);
      expect(
        (await saveFieldDefinitions(request, token, entityId, [
          { key: 'name', kind: 'text', configJson: { label: 'Name' } },
          { key: 'quantity', kind: 'integer', configJson: { label: 'Quantity' } },
        ])).status(),
        'field definitions saved',
      ).toBe(200);

      const createRes = await createRecord(request, token, entityId, { name: 'Test Widget', quantity: 42 });
      expect(createRes.status(), 'POST /api/entities/records 200').toBe(200);
      const created = await readJsonSafe<{ ok?: boolean; item?: { entityId?: string; recordId?: string } }>(createRes);
      expect(created?.ok, 'create response ok=true').toBe(true);
      expect(created?.item?.entityId, 'echoed entityId').toBe(entityId);
      recordId = expectUuid(created?.item?.recordId, 'created record id');

      const listRes = await listRecords(request, token, entityId);
      expect(listRes.status(), 'GET /api/entities/records 200').toBe(200);
      const listBody = await readJsonSafe<{ items?: RecordItem[]; total?: number }>(listRes);
      expect((listBody?.total ?? 0), 'list total includes the new record').toBeGreaterThanOrEqual(1);
      const mine = (listBody?.items ?? []).find((it) => String(it.id) === recordId);
      expect(mine, 'created record present in list').toBeTruthy();
      expect(mine?.name, 'text value preserved').toBe('Test Widget');
      expect(mine?.quantity, 'integer value preserved').toBe(42);
    } finally {
      await deleteRecordIfExists(request, token, entityId, recordId);
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });
});
