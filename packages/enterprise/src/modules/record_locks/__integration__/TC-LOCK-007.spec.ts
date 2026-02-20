import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  acquireRecordLock,
  buildScopeCookieFromToken,
  cleanupCompany,
  executeNotificationAction,
  getCompanyDisplayName,
  getRecordLockSettings,
  releaseRecordLock,
  saveRecordLockSettings,
  updateCompany,
  waitForNotification,
  type RecordLockSettings,
  type NotificationItem,
} from './helpers/recordLocks';

type ConflictContext = {
  conflictId: string;
  notification: NotificationItem;
  ownerLockToken: string;
  baseLogId: string;
  incomingName: string;
};

async function createConflictScenario(
  request: APIRequestContext,
  superadminToken: string,
  adminToken: string,
  companyId: string,
  superadminScopeHeaders?: Record<string, string>,
): Promise<ConflictContext> {
  const acquire = await acquireRecordLock(
    request,
    superadminToken,
    'customers.company',
    companyId,
    superadminScopeHeaders,
  );
  expect(acquire.status).toBe(200);

  const ownerLockToken = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
  const baseLogId =
    (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
  expect(ownerLockToken).toBeTruthy();
  expect(baseLogId).toBeTruthy();

  const incomingName = `QA TC-LOCK-007 Incoming ${Date.now()}`;
  const incomingUpdate = await updateCompany(request, adminToken, companyId, incomingName);
  expect(incomingUpdate.status).toBe(200);

  const conflictAttempt = await updateCompany(
    request,
    superadminToken,
    companyId,
    `QA TC-LOCK-007 Mine ${Date.now()}`,
    {
      token: ownerLockToken,
      baseLogId,
      resolution: 'normal',
    },
    superadminScopeHeaders,
  );
  expect(conflictAttempt.status).toBe(409);
  expect(conflictAttempt.body?.code).toBe('record_lock_conflict');

  const conflictId = (conflictAttempt.body?.conflict as { id?: string } | undefined)?.id ?? null;
  expect(conflictId).toBeTruthy();

  const notification = await waitForNotification(
    request,
    superadminToken,
    'record_locks.conflict.detected',
    (item) => item.sourceEntityId === conflictId,
  );

  return {
    conflictId: conflictId as string,
    notification,
    ownerLockToken: ownerLockToken as string,
    baseLogId: baseLogId as string,
    incomingName,
  };
}

/**
 * TC-LOCK-007: Conflict notification changed fields and apply/reject actions
 */
test.describe('TC-LOCK-007: Conflict notification changed fields and apply/reject actions', () => {
  test.describe.configure({ timeout: 90_000 });

  test('should include changed incoming fields and execute accept_incoming action from notification', async ({ request }) => {
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

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-007 Company A ${Date.now()}`);

      const conflict = await createConflictScenario(
        request,
        superadminToken,
        adminToken,
        companyId,
        superadminScopeHeaders,
      );
      ownerLockToken = conflict.ownerLockToken;

      expect(conflict.notification.bodyVariables?.changedFields?.toLowerCase()).toContain('display');
      const actionIds = (conflict.notification.actions ?? []).map((item) => item.id);
      expect(actionIds).toContain('accept_incoming');
      expect(actionIds).toContain('accept_mine');

      const actionResult = await executeNotificationAction(
        request,
        superadminToken,
        conflict.notification.id,
        'accept_incoming',
      );
      expect(actionResult.status).toBe(200);
      expect(actionResult.body?.ok).toBe(true);
      expect((actionResult.body?.result as { ok?: boolean } | undefined)?.ok).toBe(true);

      const actionedNotification = await waitForNotification(
        request,
        superadminToken,
        'record_locks.conflict.detected',
        (item) => item.id === conflict.notification.id && item.status === 'actioned',
      );
      expect(actionedNotification.status).toBe('actioned');

      const finalName = await getCompanyDisplayName(request, adminToken, companyId);
      expect(finalName).toBe(conflict.incomingName);

      await waitForNotification(
        request,
        adminToken,
        'record_locks.conflict.resolved',
        (item) => item.sourceEntityId === conflict.conflictId && item.bodyVariables?.resolution === 'accept_incoming',
      );
      ownerLockToken = null;
    } finally {
      if (ownerLockToken && companyId) {
        await releaseRecordLock(
          request,
          superadminToken,
          'customers.company',
          companyId,
          ownerLockToken,
          'cancelled',
          undefined,
          superadminScopeHeaders,
        ).catch(() => {});
      }
      await cleanupCompany(request, adminToken, companyId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });

  test('should execute accept_mine action from notification and emit resolved notification', async ({ request }) => {
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

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-007 Company B ${Date.now()}`);

      const conflict = await createConflictScenario(
        request,
        superadminToken,
        adminToken,
        companyId,
        superadminScopeHeaders,
      );
      ownerLockToken = conflict.ownerLockToken;

      const actionResult = await executeNotificationAction(
        request,
        superadminToken,
        conflict.notification.id,
        'accept_mine',
      );
      expect(actionResult.status).toBe(200);
      expect(actionResult.body?.ok).toBe(true);
      expect((actionResult.body?.result as { ok?: boolean } | undefined)?.ok).toBe(true);

      const actionedNotification = await waitForNotification(
        request,
        superadminToken,
        'record_locks.conflict.detected',
        (item) => item.id === conflict.notification.id && item.status === 'actioned',
      );
      expect(actionedNotification.status).toBe('actioned');

      await waitForNotification(
        request,
        adminToken,
        'record_locks.conflict.resolved',
        (item) => item.sourceEntityId === conflict.conflictId && item.bodyVariables?.resolution === 'accept_mine',
      );
      ownerLockToken = null;
    } finally {
      if (ownerLockToken && companyId) {
        await releaseRecordLock(
          request,
          superadminToken,
          'customers.company',
          companyId,
          ownerLockToken,
          'cancelled',
          undefined,
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
