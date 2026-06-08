import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomEntity,
  createRecord,
  deleteCustomEntityIfExists,
  deleteRecordIfExists,
  listCustomEntities,
  listRecords,
  saveFieldDefinitions,
  uniqueEntityId,
} from './helpers/entitiesApi';

/**
 * TC-ENTITIES-006: Soft-deleting a custom entity hides it from the list  [P1] (api)
 * Source: issue #2471.
 *
 *   - DELETE /api/entities/entities → 200 { ok: true } (soft delete: isActive=false, deletedAt set)
 *   - GET    /api/entities/entities → the entity no longer appears (default list filters isActive)
 *
 * Verified behavior note (corrects the issue's premise):
 *   The issue expected records to disappear after deleting the entity definition.
 *   In reality, records live in `custom_entities_storage` independently of the
 *   `custom_entities` definition row, and the records endpoint detects the entity
 *   from its storage rows — so the entity-definition soft delete is metadata-only
 *   and its stored records REMAIN queryable. This spec asserts the true invariant:
 *   the entity vanishes from the entity list while its records persist.
 */
test.describe('TC-ENTITIES-006: Soft-deleting a custom entity hides it from the list', () => {
  test('removes the entity from the default list; stored records persist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const entityId = uniqueEntityId('doomed');
    let recordId: string | null = null;

    try {
      expect((await createCustomEntity(request, token, { entityId, label: 'TC-ENTITIES-006 Entity' })).status()).toBe(200);
      expect(
        (await saveFieldDefinitions(request, token, entityId, [{ key: 'name', kind: 'text', configJson: { label: 'Name' } }])).status(),
        'field definition saved',
      ).toBe(200);
      const createRec = await createRecord(request, token, entityId, { name: 'Doomed record' });
      expect(createRec.status(), 'record created').toBe(200);
      recordId = (await readJsonSafe<{ item?: { recordId?: string } }>(createRec))?.item?.recordId ?? null;

      // Precondition: entity is visible before deletion.
      const beforeBody = await readJsonSafe<{ items?: Array<{ entityId?: string }> }>(await listCustomEntities(request, token));
      expect((beforeBody?.items ?? []).some((it) => it.entityId === entityId), 'entity visible before delete').toBe(true);

      // Soft delete the entity definition.
      const delRes = await apiRequest(request, 'DELETE', '/api/entities/entities', { token, data: { entityId } });
      expect(delRes.status(), 'DELETE /api/entities/entities 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(delRes))?.ok, 'delete ok=true').toBe(true);

      // The entity must no longer appear in the default list.
      const afterBody = await readJsonSafe<{ items?: Array<{ entityId?: string }> }>(await listCustomEntities(request, token));
      expect((afterBody?.items ?? []).some((it) => it.entityId === entityId), 'entity hidden after soft delete').toBe(false);

      // Stored records remain queryable (definition delete does not purge storage):
      // the exact record survives AND its values still read back (cf_ mapping intact).
      const recordsBody = await readJsonSafe<{ total?: number; items?: Array<{ id?: string; name?: unknown }> }>(
        await listRecords(request, token, entityId),
      );
      expect(recordsBody?.total ?? 0, 'records persist after entity soft delete').toBeGreaterThanOrEqual(1);
      const survivor = (recordsBody?.items ?? []).find((it) => String(it.id) === recordId);
      expect(survivor, 'the created record survives the entity soft delete').toBeTruthy();
      expect(survivor?.name, 'record field values still read back after soft delete').toBe('Doomed record');
    } finally {
      await deleteRecordIfExists(request, token, entityId, recordId);
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });
});
