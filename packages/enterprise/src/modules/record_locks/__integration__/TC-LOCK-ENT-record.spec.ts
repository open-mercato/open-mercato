import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupCustomEntityDefinition,
  cleanupCustomEntityRecord,
  createCustomEntityDefinitionFixture,
  createCustomEntityRecordFixture,
  getCustomEntityRecordUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateCustomEntityRecord,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-ENT-record: Phase 6b record-locks coverage for the EAV CUSTOM-ENTITY
 * RECORD surface (`entities.record`).
 *
 * Custom-entity records are doc-storage rows mutated via the hand-rolled
 * `PUT /api/entities/records` route, which (after Phase 6b) routes through the
 * async DI-aware seam `enforceCommandOptimisticLockWithGuards` on the record's
 * `updated_at`. The client replays the loaded version via the OSS optimistic-lock
 * header; a stale value 409s, a fresh-version edit succeeds. With record_locks
 * enabled the richer `record_lock_conflict` may be returned instead.
 *
 * Self-contained: registers its own custom entity definition + record, restores
 * settings and deletes the record + definition in `finally`.
 */
test.describe('TC-LOCK-ENT-record: optimistic conflict on EAV custom-entity record edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale custom-entity record edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    const suffix = `${Date.now()}`;
    const entityId = `qa_lock:ent_${suffix}`;
    let recordId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['entities.record'],
      });

      await createCustomEntityDefinitionFixture(request, adminToken, {
        entityId,
        label: `QA Lock Entity ${suffix}`,
      });

      recordId = await createCustomEntityRecordFixture(request, adminToken, {
        entityId,
        values: { name: `QA Record ${suffix}` },
      });

      const baseUpdatedAt = await getCustomEntityRecordUpdatedAt(request, adminToken, entityId, recordId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateCustomEntityRecord(
        request,
        adminToken,
        { entityId, recordId, values: { name: `Incoming ${suffix}` } },
        baseUpdatedAt,
      );
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateCustomEntityRecord(
        request,
        adminToken,
        { entityId, recordId, values: { name: `Stale ${suffix}` } },
        baseUpdatedAt,
      );
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getCustomEntityRecordUpdatedAt(request, adminToken, entityId, recordId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateCustomEntityRecord(
        request,
        adminToken,
        { entityId, recordId, values: { name: `Resaved ${suffix}` } },
        freshUpdatedAt,
      );
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupCustomEntityRecord(request, adminToken, entityId, recordId);
      await cleanupCustomEntityDefinition(request, adminToken, entityId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
