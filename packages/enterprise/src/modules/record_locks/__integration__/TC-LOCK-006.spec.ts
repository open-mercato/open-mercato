import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  acquireRecordLock,
  buildScopeCookieFromToken,
  cleanupCompany,
  getRecordLockSettings,
  releaseRecordLock,
  saveRecordLockSettings,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-006: Lock payload exposes editor identity and IP for viewer banner
 */
test.describe('TC-LOCK-006: Lock payload exposes editor identity and IP for viewer banner', () => {
  test.describe.configure({ timeout: 90_000 });

  test('should return lock owner identity and ip when another user views the same record', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const superadminScopeCookie = buildScopeCookieFromToken(superadminToken);
    const superadminScopeHeaders = superadminScopeCookie ? { cookie: superadminScopeCookie } : undefined;
    const ownerIp = '198.51.100.24';

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
        allowForceUnlock: true,
      });

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-006 Company ${Date.now()}`);

      const ownerAcquire = await acquireRecordLock(
        request,
        superadminToken,
        'customers.company',
        companyId,
        {
          ...(superadminScopeHeaders ?? {}),
          'x-forwarded-for': `${ownerIp}, 10.0.0.1`,
        },
      );
      expect(ownerAcquire.status).toBe(200);
      ownerLockToken = (ownerAcquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      expect(ownerLockToken).toBeTruthy();

      const viewerAcquire = await acquireRecordLock(
        request,
        adminToken,
        'customers.company',
        companyId,
      );
      expect(viewerAcquire.status).toBe(200);
      expect(viewerAcquire.body?.acquired).toBe(false);

      const lock = (viewerAcquire.body?.lock as {
        lockedByUserId?: string;
        lockedByName?: string | null;
        lockedByEmail?: string | null;
        lockedByIp?: string | null;
      } | null | undefined) ?? null;

      expect(lock).toBeTruthy();
      expect(lock?.lockedByUserId).toBeTruthy();
      expect(lock?.lockedByIp).toBe(ownerIp);
      expect(Boolean(lock?.lockedByName || lock?.lockedByEmail)).toBe(true);

      const viewerId =
        (viewerAcquire.body as { currentUserId?: string | null } | null)?.currentUserId ?? null;
      expect(viewerId).toBeTruthy();
      expect(viewerId).not.toBe(lock?.lockedByUserId ?? null);
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
