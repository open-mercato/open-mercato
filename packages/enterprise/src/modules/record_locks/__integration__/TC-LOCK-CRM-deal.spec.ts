import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createDealFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  acquireRecordLock,
  buildScopeCookieFromToken,
  cleanupDeal,
  forceReleaseRecordLock,
  getDealTitle,
  getRecordLockSettings,
  releaseRecordLock,
  saveRecordLockSettings,
  updateDeal,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CRM-deal: Phase 1 record-locks coverage for the CRM v2 deal screen.
 *
 * The deal page already had path-allowlist presence, but its DealForm passed no
 * `injectionSpotId` (save-time widget never mounted) and its stage-change /
 * Won-Lost closure writes sent no lock header. Phase 1 mounts the form widget,
 * publishes explicit presence context, and attaches the OSS lock header to the
 * stage/closure command calls. All deal mutations ride the `customers/deals` CRUD
 * route, so the server guard is auto-covered by the record_locks
 * `crudMutationGuardService` decorator once `customers.deal` is enabled.
 *
 * Verifies pessimistic block + force-release and an optimistic 409 conflict with
 * accept-incoming / accept-mine resolution against the deal aggregate.
 *
 * Self-contained: creates its own deal via API in setup; restores settings and
 * deletes the deal in `finally`.
 */
test.describe('TC-LOCK-CRM-deal: record locks on the CRM v2 deal screen', () => {
  test.describe.configure({ timeout: 120_000 });

  test('presence + pessimistic block + force release', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let dealId: string | null = null;
    let ownerLockToken: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'pessimistic',
        enabledResources: ['customers.deal'],
        allowForceUnlock: true,
      });

      dealId = await createDealFixture(request, adminToken, { title: `QA TC-LOCK-CRM-deal ${Date.now()}` });

      const ownerAcquire = await acquireRecordLock(request, superadminToken, 'customers.deal', dealId);
      expect(ownerAcquire.status).toBe(200);
      expect(ownerAcquire.body?.ok).toBe(true);
      ownerLockToken = (ownerAcquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      expect(ownerLockToken).toBeTruthy();

      const blocked = await updateDeal(request, adminToken, dealId, `QA TC-LOCK-CRM-deal Blocked ${Date.now()}`);
      expect(blocked.status).toBe(423);
      expect(blocked.body?.code).toBe('record_locked');

      const forceRelease = await forceReleaseRecordLock(
        request,
        adminToken,
        'customers.deal',
        dealId,
        'qa_tc_lock_crm_deal_takeover',
      );
      expect(forceRelease.status).toBe(200);
      expect(forceRelease.body?.released).toBe(true);
      ownerLockToken = null;

      const afterRelease = await updateDeal(request, adminToken, dealId, `QA TC-LOCK-CRM-deal Unblocked ${Date.now()}`);
      expect(afterRelease.status).toBe(200);
      expect(afterRelease.body?.ok).toBe(true);
    } finally {
      if (ownerLockToken && dealId) {
        await releaseRecordLock(request, superadminToken, 'customers.deal', dealId, ownerLockToken).catch(() => {});
      }
      await cleanupDeal(request, adminToken, dealId);
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
    let dealId: string | null = null;
    let ownerLockToken: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.deal'],
        notifyOnConflict: true,
      });

      dealId = await createDealFixture(request, adminToken, { title: `QA TC-LOCK-CRM-deal Opt ${Date.now()}` });

      const acquire = await acquireRecordLock(
        request,
        superadminToken,
        'customers.deal',
        dealId,
        superadminScopeHeaders,
      );
      expect(acquire.status).toBe(200);
      ownerLockToken = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      const baseLogId = (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
      expect(ownerLockToken).toBeTruthy();
      expect(baseLogId).toBeTruthy();

      const incomingTitle = `QA TC-LOCK-CRM-deal Incoming ${Date.now()}`;
      const incomingUpdate = await updateDeal(request, adminToken, dealId, incomingTitle);
      expect(incomingUpdate.status).toBe(200);

      const staleUpdate = await updateDeal(
        request,
        superadminToken,
        dealId,
        `QA TC-LOCK-CRM-deal Mine ${Date.now()}`,
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
        'customers.deal',
        dealId,
        ownerLockToken as string,
        'conflict_resolved',
        { conflictId, resolution: 'accept_incoming' },
        superadminScopeHeaders,
      );
      expect(resolution.status).toBe(200);
      expect(resolution.body?.conflictResolved).toBe(true);
      ownerLockToken = null;

      const finalTitle = await getDealTitle(request, adminToken, dealId);
      expect(finalTitle).toBe(incomingTitle);
    } finally {
      if (ownerLockToken && dealId) {
        await releaseRecordLock(
          request,
          superadminToken,
          'customers.deal',
          dealId,
          ownerLockToken,
          'cancelled',
          undefined,
          superadminScopeHeaders,
        ).catch(() => {});
      }
      await cleanupDeal(request, adminToken, dealId);
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
    let dealId: string | null = null;
    let ownerLockToken: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.deal'],
        notifyOnConflict: true,
      });

      dealId = await createDealFixture(request, adminToken, { title: `QA TC-LOCK-CRM-deal AM ${Date.now()}` });

      const acquire = await acquireRecordLock(
        request,
        superadminToken,
        'customers.deal',
        dealId,
        superadminScopeHeaders,
      );
      expect(acquire.status).toBe(200);
      ownerLockToken = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      const baseLogId = (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
      expect(ownerLockToken).toBeTruthy();
      expect(baseLogId).toBeTruthy();

      const incomingTitle = `QA TC-LOCK-CRM-deal AM Incoming ${Date.now()}`;
      const incomingUpdate = await updateDeal(request, adminToken, dealId, incomingTitle);
      expect(incomingUpdate.status).toBe(200);

      const conflictAttempt = await updateDeal(
        request,
        superadminToken,
        dealId,
        `QA TC-LOCK-CRM-deal AM Mine ${Date.now()}`,
        { token: ownerLockToken, baseLogId, resolution: 'normal' },
        superadminScopeHeaders,
      );
      expect(conflictAttempt.status).toBe(409);
      const conflictId = (conflictAttempt.body?.conflict as { id?: string } | undefined)?.id ?? null;
      expect(conflictId).toBeTruthy();

      const mineTitle = `QA TC-LOCK-CRM-deal AM Keep Mine ${Date.now()}`;
      const resolveAttempt = await updateDeal(
        request,
        superadminToken,
        dealId,
        mineTitle,
        { token: ownerLockToken, baseLogId, resolution: 'accept_mine', conflictId },
        superadminScopeHeaders,
      );
      expect(resolveAttempt.status).toBe(200);
      ownerLockToken = null;

      const finalTitle = await getDealTitle(request, adminToken, dealId);
      expect(finalTitle).toBe(mineTitle);
    } finally {
      if (ownerLockToken && dealId) {
        await releaseRecordLock(
          request,
          superadminToken,
          'customers.deal',
          dealId,
          ownerLockToken,
          'cancelled',
          undefined,
          superadminScopeHeaders,
        ).catch(() => {});
      }
      await cleanupDeal(request, adminToken, dealId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
