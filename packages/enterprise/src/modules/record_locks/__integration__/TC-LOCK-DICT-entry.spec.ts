import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupDictionary,
  createDictionaryEntryFixture,
  createDictionaryFixture,
  getDictionaryEntryUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateDictionaryEntryLabel,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-DICT-entry: Phase 6 record-locks coverage for the DICTIONARY ENTRY
 * entity (`dictionaries.entry`).
 *
 * Dictionary entries are edited inline in `DictionaryEntriesEditor` (dialog), not
 * via a `[id]` detail page. The PATCH route
 * (`api/[dictionaryId]/entries/[entryId]`) is a hand-rolled command route that
 * calls `enforceCommandOptimisticLock` on the entry's `updated_at`. The client
 * captures `updatedAt` at edit time and replays it via the OSS optimistic-lock
 * header; a stale value 409s, a fresh-version edit succeeds. Presence is mounted
 * on `DictionariesManager` for the open `dictionaries.dictionary`; the entry
 * editor routes its 409 through the unified conflict surface.
 *
 * Self-contained: creates its own dictionary + entry, restores settings and
 * deletes the dictionary (cascading the entry) in `finally`.
 */
test.describe('TC-LOCK-DICT-entry: optimistic conflict on dictionary entry edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale dictionary-entry edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let dictionaryId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['dictionaries.entry'],
      });

      dictionaryId = await createDictionaryFixture(request, adminToken, {
        key: `qa_lock_dict_${suffix}`,
        name: `QA Lock Dictionary ${suffix}`,
      });

      const { entryId } = await createDictionaryEntryFixture(request, adminToken, dictionaryId, {
        value: `qa_value_${suffix}`,
        label: `QA Label ${suffix}`,
      });

      const baseUpdatedAt = await getDictionaryEntryUpdatedAt(request, adminToken, dictionaryId, entryId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateDictionaryEntryLabel(
        request,
        adminToken,
        dictionaryId,
        entryId,
        `Incoming ${suffix}`,
        baseUpdatedAt,
      );
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateDictionaryEntryLabel(
        request,
        adminToken,
        dictionaryId,
        entryId,
        `Stale ${suffix}`,
        baseUpdatedAt,
      );
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getDictionaryEntryUpdatedAt(request, adminToken, dictionaryId, entryId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateDictionaryEntryLabel(
        request,
        adminToken,
        dictionaryId,
        entryId,
        `Resaved ${suffix}`,
        freshUpdatedAt,
      );
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupDictionary(request, adminToken, dictionaryId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
