import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  acquireRecordLock,
  cleanupCompany,
  getRecordLockSettings,
  releaseRecordLock,
  saveRecordLockSettings,
  updateCompany,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-001: Pessimistic lock blocks a second editor
 */
test.describe('TC-LOCK-001: Pessimistic lock blocks a second editor', () => {
  test.describe.configure({ timeout: 90_000 });

  test('should return 423 for secondary editor update while lock is active', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let companyId: string | null = null;
    let ownerLockToken: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'pessimistic',
        enabledResources: ['customers.company'],
      });

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-001 Company ${Date.now()}`);

      const ownerAcquire = await acquireRecordLock(request, superadminToken, 'customers.company', companyId);
      expect(ownerAcquire.status).toBe(200);
      expect(ownerAcquire.body?.ok).toBe(true);
      ownerLockToken =
        (ownerAcquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      expect(ownerLockToken).toBeTruthy();

      const blockedUpdate = await updateCompany(
        request,
        adminToken,
        companyId,
        `QA TC-LOCK-001 Blocked Update ${Date.now()}`,
      );
      expect(blockedUpdate.status).toBe(423);
      expect(blockedUpdate.body?.code).toBe('record_locked');

      const ownerRelease = await releaseRecordLock(
        request,
        superadminToken,
        'customers.company',
        companyId,
        ownerLockToken as string,
      );
      expect(ownerRelease.status).toBe(200);
      expect(ownerRelease.body?.released).toBe(true);
      ownerLockToken = null;

      const updateAfterRelease = await updateCompany(
        request,
        adminToken,
        companyId,
        `QA TC-LOCK-001 Unblocked Update ${Date.now()}`,
      );
      expect(updateAfterRelease.status).toBe(200);
      expect(updateAfterRelease.body?.ok).toBe(true);
    } finally {
      if (ownerLockToken && companyId) {
        await releaseRecordLock(request, superadminToken, 'customers.company', companyId, ownerLockToken).catch(() => {});
      }
      await cleanupCompany(request, adminToken, companyId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
