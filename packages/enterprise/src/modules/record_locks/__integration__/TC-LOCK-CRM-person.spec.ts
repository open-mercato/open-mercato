import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createPersonFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  acquireRecordLock,
  buildScopeCookieFromToken,
  cleanupPerson,
  forceReleaseRecordLock,
  getPersonDisplayName,
  getRecordLockSettings,
  releaseRecordLock,
  saveRecordLockSettings,
  updatePerson,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CRM-person: Phase 1 record-locks coverage for the CRM v2 person screen.
 *
 * Verifies the `customers.person` resource participates in the full record_locks
 * experience now that people-v2 publishes explicit presence context:
 *   - presence: a second session can acquire/see the lock on a person record;
 *   - pessimistic: a contended lock blocks a second editor's write (423);
 *   - optimistic: a stale save 409s with the record_lock_conflict shape and is
 *     resolvable via accept-incoming / accept-mine;
 *   - admin force-release clears a stale lock.
 *
 * Self-contained: creates its own person via the API in setup, restores settings
 * and deletes the person in `finally`.
 */
test.describe('TC-LOCK-CRM-person: record locks on the CRM v2 person screen', () => {
  test.describe.configure({ timeout: 120_000 });

  test('presence + pessimistic block + force release', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let personId: string | null = null;
    let ownerLockToken: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'pessimistic',
        enabledResources: ['customers.person'],
        allowForceUnlock: true,
      });

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Lock ${Date.now()}`,
        displayName: `QA TC-LOCK-CRM-person ${Date.now()}`,
      });

      // Presence: the owning session acquires the lock (what page-load presence does).
      const ownerAcquire = await acquireRecordLock(request, superadminToken, 'customers.person', personId);
      expect(ownerAcquire.status).toBe(200);
      expect(ownerAcquire.body?.ok).toBe(true);
      ownerLockToken = (ownerAcquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      expect(ownerLockToken).toBeTruthy();

      // Pessimistic: a second editor's write is blocked while the lock is active.
      const blocked = await updatePerson(
        request,
        adminToken,
        personId,
        `QA TC-LOCK-CRM-person Blocked ${Date.now()}`,
      );
      expect(blocked.status).toBe(423);
      expect(blocked.body?.code).toBe('record_locked');

      // Admin force-release clears the stale lock and the takeover write succeeds.
      const forceRelease = await forceReleaseRecordLock(
        request,
        adminToken,
        'customers.person',
        personId,
        'qa_tc_lock_crm_person_takeover',
      );
      expect(forceRelease.status).toBe(200);
      expect(forceRelease.body?.released).toBe(true);
      ownerLockToken = null;

      const afterRelease = await updatePerson(
        request,
        adminToken,
        personId,
        `QA TC-LOCK-CRM-person Unblocked ${Date.now()}`,
      );
      expect(afterRelease.status).toBe(200);
      expect(afterRelease.body?.ok).toBe(true);
    } finally {
      if (ownerLockToken && personId) {
        await releaseRecordLock(request, superadminToken, 'customers.person', personId, ownerLockToken).catch(() => {});
      }
      await cleanupPerson(request, adminToken, personId);
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
    let personId: string | null = null;
    let ownerLockToken: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.person'],
        notifyOnConflict: true,
      });

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Optimistic ${Date.now()}`,
        displayName: `QA TC-LOCK-CRM-person Opt ${Date.now()}`,
      });

      const acquire = await acquireRecordLock(
        request,
        superadminToken,
        'customers.person',
        personId,
        superadminScopeHeaders,
      );
      expect(acquire.status).toBe(200);
      ownerLockToken = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      const baseLogId = (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
      expect(ownerLockToken).toBeTruthy();
      expect(baseLogId).toBeTruthy();

      const incomingName = `QA TC-LOCK-CRM-person Incoming ${Date.now()}`;
      const incomingUpdate = await updatePerson(request, adminToken, personId, incomingName);
      expect(incomingUpdate.status).toBe(200);

      const staleUpdate = await updatePerson(
        request,
        superadminToken,
        personId,
        `QA TC-LOCK-CRM-person Mine ${Date.now()}`,
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
        'customers.person',
        personId,
        ownerLockToken as string,
        'conflict_resolved',
        { conflictId, resolution: 'accept_incoming' },
        superadminScopeHeaders,
      );
      expect(resolution.status).toBe(200);
      expect(resolution.body?.conflictResolved).toBe(true);
      ownerLockToken = null;

      const finalName = await getPersonDisplayName(request, adminToken, personId);
      expect(finalName).toBe(incomingName);
    } finally {
      if (ownerLockToken && personId) {
        await releaseRecordLock(
          request,
          superadminToken,
          'customers.person',
          personId,
          ownerLockToken,
          'cancelled',
          undefined,
          superadminScopeHeaders,
        ).catch(() => {});
      }
      await cleanupPerson(request, adminToken, personId);
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
    let personId: string | null = null;
    let ownerLockToken: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.person'],
        notifyOnConflict: true,
      });

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `AcceptMine ${Date.now()}`,
        displayName: `QA TC-LOCK-CRM-person AM ${Date.now()}`,
      });

      const acquire = await acquireRecordLock(
        request,
        superadminToken,
        'customers.person',
        personId,
        superadminScopeHeaders,
      );
      expect(acquire.status).toBe(200);
      ownerLockToken = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
      const baseLogId = (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
      expect(ownerLockToken).toBeTruthy();
      expect(baseLogId).toBeTruthy();

      const incomingName = `QA TC-LOCK-CRM-person AM Incoming ${Date.now()}`;
      const incomingUpdate = await updatePerson(request, adminToken, personId, incomingName);
      expect(incomingUpdate.status).toBe(200);

      const conflictAttempt = await updatePerson(
        request,
        superadminToken,
        personId,
        `QA TC-LOCK-CRM-person AM Mine ${Date.now()}`,
        { token: ownerLockToken, baseLogId, resolution: 'normal' },
        superadminScopeHeaders,
      );
      expect(conflictAttempt.status).toBe(409);
      const conflictId = (conflictAttempt.body?.conflict as { id?: string } | undefined)?.id ?? null;
      expect(conflictId).toBeTruthy();

      const mineName = `QA TC-LOCK-CRM-person AM Keep Mine ${Date.now()}`;
      const resolveAttempt = await updatePerson(
        request,
        superadminToken,
        personId,
        mineName,
        { token: ownerLockToken, baseLogId, resolution: 'accept_mine', conflictId },
        superadminScopeHeaders,
      );
      expect(resolveAttempt.status).toBe(200);
      ownerLockToken = null;

      const finalName = await getPersonDisplayName(request, adminToken, personId);
      expect(finalName).toBe(mineName);
    } finally {
      if (ownerLockToken && personId) {
        await releaseRecordLock(
          request,
          superadminToken,
          'customers.person',
          personId,
          ownerLockToken,
          'cancelled',
          undefined,
          superadminScopeHeaders,
        ).catch(() => {});
      }
      await cleanupPerson(request, adminToken, personId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
