import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { createDealFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { CONFLICT_DIALOG_TESTID } from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi';
import {
  OPTIMISTIC_LOCK_HEADER,
  acquireRecordLock,
  buildScopeCookieFromToken,
  cleanupDeal,
  getDealTitle,
  getDealUpdatedAt,
  getRecordLockSettings,
  releaseRecordLock,
  saveRecordLockSettings,
  updateDeal,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CRM-keep-mine-floor: "Keep my changes" must save although the retried
 * write still carries the `updated_at` the page loaded.
 *
 * The OSS optimistic-lock floor runs before the record-lock check, so a
 * keep-mine retry with the loaded version used to end in 409
 * `optimistic_lock_conflict` and nothing was saved. record_locks now lets a
 * keep-mine retry through the floor when it verifies the conflict id itself and
 * nobody wrote the record since the conflict was shown. A third write in
 * between still blocks the retry.
 *
 * Self-contained: creates its own deal via the API, restores the lock settings
 * and deletes the deal in `finally`.
 */

type Session = {
  request: APIRequestContext;
  superadminToken: string;
  adminToken: string;
  scopeHeaders: Record<string, string>;
};

async function openSession(request: APIRequestContext): Promise<Session> {
  const superadminToken = await getAuthToken(request, 'superadmin');
  const adminToken = await getAuthToken(request, 'admin');
  const scopeCookie = buildScopeCookieFromToken(superadminToken);
  return { request, superadminToken, adminToken, scopeHeaders: scopeCookie ? { cookie: scopeCookie } : {} };
}

async function enableOptimisticLocking(session: Session): Promise<RecordLockSettings> {
  const previous = await getRecordLockSettings(session.request, session.superadminToken);
  await saveRecordLockSettings(session.request, session.superadminToken, {
    ...previous,
    enabled: true,
    strategy: 'optimistic',
    enabledResources: ['customers.deal'],
    allowIncomingOverride: true,
  });
  return previous;
}

async function raiseConflict(session: Session, dealId: string, label: string) {
  const loadedUpdatedAt = await getDealUpdatedAt(session.request, session.superadminToken, dealId);
  expect(loadedUpdatedAt, 'the deal exposes its version').toBeTruthy();

  const acquire = await acquireRecordLock(session.request, session.superadminToken, 'customers.deal', dealId, session.scopeHeaders);
  expect(acquire.status).toBe(200);
  const token = (acquire.body?.lock as { token?: string | null } | undefined)?.token ?? null;
  const baseLogId = (acquire.body as { latestActionLogId?: string | null } | null)?.latestActionLogId ?? null;
  expect(token).toBeTruthy();
  expect(baseLogId).toBeTruthy();

  const incoming = await updateDeal(session.request, session.adminToken, dealId, `${label} incoming`);
  expect(incoming.status).toBe(200);

  const conflictAttempt = await updateDeal(
    session.request,
    session.superadminToken,
    dealId,
    `${label} mine`,
    { token: token as string, baseLogId: baseLogId as string, resolution: 'normal' },
    session.scopeHeaders,
  );
  expect(conflictAttempt.status).toBe(409);
  expect(conflictAttempt.body?.code).toBe('record_lock_conflict');
  const conflictId = (conflictAttempt.body?.conflict as { id?: string } | undefined)?.id ?? null;
  expect(conflictId).toBeTruthy();

  return { loadedUpdatedAt: loadedUpdatedAt as string, token: token as string, baseLogId: baseLogId as string, conflictId: conflictId as string };
}

async function keepMine(session: Session, dealId: string, title: string, conflict: Awaited<ReturnType<typeof raiseConflict>>) {
  return updateDeal(
    session.request,
    session.superadminToken,
    dealId,
    title,
    { token: conflict.token, baseLogId: conflict.baseLogId, resolution: 'accept_mine', conflictId: conflict.conflictId },
    { ...session.scopeHeaders, [OPTIMISTIC_LOCK_HEADER]: conflict.loadedUpdatedAt },
  );
}

test.describe('TC-LOCK-CRM-keep-mine-floor: Keep my changes vs the optimistic-lock floor', () => {
  test.describe.configure({ timeout: 180_000 });

  test('Keep my changes saves a retry that still carries the loaded version', async ({ request }) => {
    const session = await openSession(request);
    const label = `QA TC-LOCK-CRM-keep-mine-floor ${Date.now()}`;
    let previousSettings: RecordLockSettings | null = null;
    let dealId: string | null = null;
    let lockToken: string | null = null;

    try {
      previousSettings = await enableOptimisticLocking(session);
      dealId = await createDealFixture(request, session.adminToken, { title: label });
      const conflict = await raiseConflict(session, dealId, label);
      lockToken = conflict.token;

      const saved = await keepMine(session, dealId, `${label} kept`, conflict);
      expect(saved.status, `keep mine is refused: ${JSON.stringify(saved.body)}`).toBe(200);
      lockToken = null;
      expect(await getDealTitle(request, session.adminToken, dealId)).toBe(`${label} kept`);
    } finally {
      if (lockToken && dealId) {
        await releaseRecordLock(request, session.superadminToken, 'customers.deal', dealId, lockToken, 'cancelled', undefined, session.scopeHeaders).catch(() => {});
      }
      await cleanupDeal(request, session.adminToken, dealId);
      if (previousSettings) await saveRecordLockSettings(request, session.superadminToken, previousSettings).catch(() => {});
    }
  });

  test('a write by someone else after the conflict still blocks Keep my changes', async ({ request }) => {
    const session = await openSession(request);
    const label = `QA TC-LOCK-CRM-keep-mine-floor third ${Date.now()}`;
    let previousSettings: RecordLockSettings | null = null;
    let dealId: string | null = null;
    let lockToken: string | null = null;

    try {
      previousSettings = await enableOptimisticLocking(session);
      dealId = await createDealFixture(request, session.adminToken, { title: label });
      const conflict = await raiseConflict(session, dealId, label);
      lockToken = conflict.token;

      const thirdWrite = await updateDeal(request, session.adminToken, dealId, `${label} third`);
      expect(thirdWrite.status).toBe(200);

      const refused = await keepMine(session, dealId, `${label} kept`, conflict);
      expect(refused.status).toBe(409);
      expect(refused.body?.code).toBe('optimistic_lock_conflict');
      expect(await getDealTitle(request, session.adminToken, dealId)).toBe(`${label} third`);
    } finally {
      if (lockToken && dealId) {
        await releaseRecordLock(request, session.superadminToken, 'customers.deal', dealId, lockToken, 'cancelled', undefined, session.scopeHeaders).catch(() => {});
      }
      await cleanupDeal(request, session.adminToken, dealId);
      if (previousSettings) await saveRecordLockSettings(request, session.superadminToken, previousSettings).catch(() => {});
    }
  });

  test('Keep my changes in the deal details form saves my title', async ({ page, request }) => {
    const session = await openSession(request);
    const originalTitle = `QA TC-LOCK-CRM-keep-mine-floor form ${Date.now()}`;
    const incomingTitle = `${originalTitle} incoming`;
    const myTitle = `${originalTitle} mine`;
    let previousSettings: RecordLockSettings | null = null;
    let dealId: string | null = null;

    try {
      previousSettings = await enableOptimisticLocking(session);
      dealId = await createDealFixture(request, session.adminToken, { title: originalTitle });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' });
      const formLockAcquired = page
        .waitForResponse((response) => response.url().includes('/api/record_locks/acquire') && response.ok(), { timeout: 20_000 })
        .catch(() => null);
      await page.getByRole('button', { name: 'Expand form panel' }).click({ timeout: 60_000 });
      const titleInput = page.locator('[data-crud-field-id="title"] input').first();
      await expect(titleInput).toHaveValue(originalTitle, { timeout: 60_000 });
      await formLockAcquired;

      const incoming = await updateDeal(request, session.superadminToken, dealId, incomingTitle, undefined, session.scopeHeaders);
      expect(incoming.status).toBe(200);

      await titleInput.fill(myTitle);
      await expect(titleInput).toHaveValue(myTitle);
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      const dialog = page.getByTestId(CONFLICT_DIALOG_TESTID);
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      const retried = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/api/customers/deals'),
        { timeout: 30_000 },
      );
      await dialog.getByRole('button', { name: 'Keep my changes', exact: true }).click();

      const retry = await retried;
      expect(retry.status(), `keep mine is refused: ${await retry.text().catch(() => '')}`).toBe(200);
      await expect
        .poll(async () => getDealTitle(request, session.adminToken, dealId as string), { timeout: 15_000 })
        .toBe(myTitle);
    } finally {
      await cleanupDeal(request, session.adminToken, dealId);
      if (previousSettings) await saveRecordLockSettings(request, session.superadminToken, previousSettings).catch(() => {});
    }
  });
});
