import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  acquireRecordLock,
  buildScopeCookieFromToken,
  cleanupCompany,
  forceReleaseRecordLock,
  getCompanyDisplayName,
  getRecordLockSettings,
  releaseRecordLock,
  saveRecordLockSettings,
  updateCompany,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CRM-company: Phase 1 record-locks coverage for the CRM v2 company screen.
 *
 * The companies-v2 detail page now publishes explicit presence context, so
 * `customers.company` gets page-load presence/acquire that the hardcoded path
 * allowlist (which only matched `/backend/customers/companies/<id>`) missed.
 * Verifies pessimistic block, force-release, and an optimistic 409 conflict with
 * accept-incoming / accept-mine resolution.
 *
 * Self-contained: creates its own company via API in setup; restores settings and
 * deletes the company in `finally`.
 */
test.describe('TC-LOCK-CRM-company: record locks on the CRM v2 company screen', () => {
  test.describe.configure({ timeout: 120_000 });

  test('presence + pessimistic block + force release', async ({ request }) => {
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
        allowForceUnlock: true,
      });

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-CRM-company ${Date.now()}`);

      const ownerAcquire = await acquireRecordLock(request, superadminToken, 'customers.company', companyId);
      expect(ownerAcquire.status).toBe(200);
      expect(ownerAcquire.body?.ok).toBe(true);
      ownerLockToken = (ownerAcquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      expect(ownerLockToken).toBeTruthy();

      const blocked = await updateCompany(
        request,
        adminToken,
        companyId,
        `QA TC-LOCK-CRM-company Blocked ${Date.now()}`,
      );
      expect(blocked.status).toBe(423);
      expect(blocked.body?.code).toBe('record_locked');

      const forceRelease = await forceReleaseRecordLock(
        request,
        adminToken,
        'customers.company',
        companyId,
        'qa_tc_lock_crm_company_takeover',
      );
      expect(forceRelease.status).toBe(200);
      expect(forceRelease.body?.released).toBe(true);
      ownerLockToken = null;

      const afterRelease = await updateCompany(
        request,
        adminToken,
        companyId,
        `QA TC-LOCK-CRM-company Unblocked ${Date.now()}`,
      );
      expect(afterRelease.status).toBe(200);
      expect(afterRelease.body?.ok).toBe(true);
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

  test('optimistic conflict resolves via accept-incoming', async ({ request }) => {
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

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-CRM-company Opt ${Date.now()}`);

      const acquire = await acquireRecordLock(
        request,
        superadminToken,
        'customers.company',
        companyId,
        superadminScopeHeaders,
      );
      expect(acquire.status).toBe(200);
      ownerLockToken = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      const baseLogId = (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
      expect(ownerLockToken).toBeTruthy();
      expect(baseLogId).toBeTruthy();

      const incomingName = `QA TC-LOCK-CRM-company Incoming ${Date.now()}`;
      const incomingUpdate = await updateCompany(request, adminToken, companyId, incomingName);
      expect(incomingUpdate.status).toBe(200);

      const staleUpdate = await updateCompany(
        request,
        superadminToken,
        companyId,
        `QA TC-LOCK-CRM-company Mine ${Date.now()}`,
        { token: ownerLockToken, baseLogId, resolution: 'normal' },
        superadminScopeHeaders,
      );
      expect(staleUpdate.status).toBe(409);
      expect(staleUpdate.body?.code).toBe('record_lock_conflict');
      const conflictId = (staleUpdate.body?.conflict as { id?: string } | undefined)?.id ?? null;
      expect(conflictId).toBeTruthy();

      const resolution = await releaseRecordLock(
        request,
        superadminToken,
        'customers.company',
        companyId,
        ownerLockToken as string,
        'conflict_resolved',
        { conflictId, resolution: 'accept_incoming' },
        superadminScopeHeaders,
      );
      expect(resolution.status).toBe(200);
      expect(resolution.body?.conflictResolved).toBe(true);
      ownerLockToken = null;

      const finalName = await getCompanyDisplayName(request, adminToken, companyId);
      expect(finalName).toBe(incomingName);
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

  test('optimistic conflict resolves via accept-mine', async ({ request }) => {
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

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-CRM-company AM ${Date.now()}`);

      const acquire = await acquireRecordLock(
        request,
        superadminToken,
        'customers.company',
        companyId,
        superadminScopeHeaders,
      );
      expect(acquire.status).toBe(200);
      ownerLockToken = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      const baseLogId = (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
      expect(ownerLockToken).toBeTruthy();
      expect(baseLogId).toBeTruthy();

      const incomingName = `QA TC-LOCK-CRM-company AM Incoming ${Date.now()}`;
      const incomingUpdate = await updateCompany(request, adminToken, companyId, incomingName);
      expect(incomingUpdate.status).toBe(200);

      const conflictAttempt = await updateCompany(
        request,
        superadminToken,
        companyId,
        `QA TC-LOCK-CRM-company AM Mine ${Date.now()}`,
        { token: ownerLockToken, baseLogId, resolution: 'normal' },
        superadminScopeHeaders,
      );
      expect(conflictAttempt.status).toBe(409);
      const conflictId = (conflictAttempt.body?.conflict as { id?: string } | undefined)?.id ?? null;
      expect(conflictId).toBeTruthy();

      const mineName = `QA TC-LOCK-CRM-company AM Keep Mine ${Date.now()}`;
      const resolveAttempt = await updateCompany(
        request,
        superadminToken,
        companyId,
        mineName,
        { token: ownerLockToken, baseLogId, resolution: 'accept_mine', conflictId },
        superadminScopeHeaders,
      );
      expect(resolveAttempt.status).toBe(200);
      ownerLockToken = null;

      const finalName = await getCompanyDisplayName(request, adminToken, companyId);
      expect(finalName).toBe(mineName);
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
