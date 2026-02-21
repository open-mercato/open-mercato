import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  acquireRecordLock,
  cleanupCompany,
  forceReleaseRecordLock,
  getRecordLockSettings,
  listNotificationsByType,
  saveRecordLockSettings,
  updateCompany,
  waitForNotification,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-005: Pessimistic force release and takeover
 */
test.describe('TC-LOCK-005: Pessimistic force release and takeover', () => {
  test.describe.configure({ timeout: 90_000 });

  test('admin can force release lock and continue mutation flow', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let companyId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'pessimistic',
        enabledResources: ['customers.company'],
        allowForceUnlock: true,
      });

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-005 Company ${Date.now()}`);

      const ownerAcquire = await acquireRecordLock(request, superadminToken, 'customers.company', companyId);
      expect(ownerAcquire.status).toBe(200);
      expect(ownerAcquire.body?.ok).toBe(true);
      const ownerLockToken =
        (ownerAcquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      expect(ownerLockToken).toBeTruthy();

      const blockedUpdate = await updateCompany(
        request,
        adminToken,
        companyId,
        `QA TC-LOCK-005 Blocked ${Date.now()}`,
      );
      expect(blockedUpdate.status).toBe(423);
      expect(blockedUpdate.body?.code).toBe('record_locked');

      const existingForceReleaseNotifications = await listNotificationsByType(
        request,
        superadminToken,
        'record_locks.lock.force_released',
      );
      const knownNotificationIds = new Set(existingForceReleaseNotifications.map((entry) => entry.id));

      const forceRelease = await forceReleaseRecordLock(
        request,
        adminToken,
        'customers.company',
        companyId,
        'qa_tc_lock_005_takeover',
      );
      expect(forceRelease.status).toBe(200);
      expect(forceRelease.body?.released).toBe(true);

      const releasedLock = (forceRelease.body?.lock as { id?: string; status?: string; lockedByUserId?: string } | undefined) ?? null;
      expect(releasedLock?.id).toBeTruthy();
      expect(releasedLock?.status).toBe('force_released');
      expect(releasedLock?.lockedByUserId).toBeTruthy();

      const forceReleaseNotification = await waitForNotification(
        request,
        superadminToken,
        'record_locks.lock.force_released',
        (item) =>
          !knownNotificationIds.has(item.id)
          && (releasedLock?.id ? item.sourceEntityId === releasedLock.id : true),
        30_000,
        500,
      );
      expect(forceReleaseNotification.type).toBe('record_locks.lock.force_released');

      const updateAfterForceRelease = await updateCompany(
        request,
        adminToken,
        companyId,
        `QA TC-LOCK-005 Updated ${Date.now()}`,
      );
      expect(updateAfterForceRelease.status).toBe(200);
      expect(updateAfterForceRelease.body?.ok).toBe(true);
    } finally {
      await cleanupCompany(request, adminToken, companyId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
