import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  acquireRecordLock,
  cleanupCompany,
  buildScopeCookieFromToken,
  getCompanyDisplayName,
  getRecordLockSettings,
  releaseRecordLock,
  saveRecordLockSettings,
  updateCompany,
  waitForNotification,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-003: Accept mine conflict resolution and notification
 */
test.describe('TC-LOCK-003: Accept mine conflict resolution and notification', () => {
  test('should resolve conflict with accept_mine and notify incoming actor', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const superadminScopeCookie = buildScopeCookieFromToken(superadminToken);
    const superadminScopeHeaders = superadminScopeCookie ? { cookie: superadminScopeCookie } : undefined;

    let previousSettings: RecordLockSettings | null = null;
    let companyId: string | null = null;
    let ownerLockToken: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.company'],
        notifyOnConflict: true,
      });

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-003 Company ${Date.now()}`);

      const acquire = await acquireRecordLock(
        request,
        superadminToken,
        'customers.company',
        companyId,
        superadminScopeHeaders,
      );
      expect(acquire.status).toBe(200);
      ownerLockToken = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      const baseLogId =
        (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
      expect(ownerLockToken).toBeTruthy();
      expect(baseLogId).toBeTruthy();

      const incomingName = `QA TC-LOCK-003 Incoming ${Date.now()}`;
      const incomingUpdate = await updateCompany(request, adminToken, companyId, incomingName);
      expect(incomingUpdate.status).toBe(200);

      const conflictAttempt = await updateCompany(
        request,
        superadminToken,
        companyId,
        `QA TC-LOCK-003 Mine ${Date.now()}`,
        {
          token: ownerLockToken,
          baseLogId,
          resolution: 'normal',
        },
        superadminScopeHeaders,
      );
      expect(conflictAttempt.status).toBe(409);
      expect(conflictAttempt.body?.code).toBe('record_lock_conflict');

      const conflictId =
        (conflictAttempt.body?.conflict as { id?: string } | undefined)?.id ?? null;
      expect(conflictId).toBeTruthy();

      await waitForNotification(
        request,
        superadminToken,
        'record_locks.conflict.detected',
        (item) => item.sourceEntityId === conflictId,
      );

      const mineName = `QA TC-LOCK-003 Keep Mine ${Date.now()}`;
      const resolveAttempt = await updateCompany(
        request,
        superadminToken,
        companyId,
        mineName,
        {
          token: ownerLockToken,
          baseLogId,
          resolution: 'accept_mine',
          conflictId,
        },
        superadminScopeHeaders,
      );
      expect(resolveAttempt.status).toBe(200);

      ownerLockToken = null;

      const finalName = await getCompanyDisplayName(request, adminToken, companyId);
      expect(finalName).toBe(mineName);

      const resolvedNotification = await waitForNotification(
        request,
        adminToken,
        'record_locks.conflict.resolved',
        (item) => item.sourceEntityId === conflictId,
      );
      expect(resolvedNotification.bodyVariables?.resolution ?? 'accept_mine').toBe('accept_mine');
    } finally {
      if (ownerLockToken && companyId) {
        await releaseRecordLock(
          request,
          superadminToken,
          'customers.company',
          companyId,
          ownerLockToken,
          'cancelled',
          superadminScopeHeaders,
        ).catch(() => {});
      }
      await cleanupCompany(request, adminToken, companyId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
