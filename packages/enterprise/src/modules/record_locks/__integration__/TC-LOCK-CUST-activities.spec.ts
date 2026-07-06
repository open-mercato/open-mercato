import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createPersonFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  cleanupInteraction,
  cleanupPerson,
  createInteractionFixture,
  getInteractionUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateInteractionTitle,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CUST-activities: Phase 2 record-locks coverage for the customers
 * activities/interactions subform (`customers:customer_interaction`).
 *
 * The interaction update command was migrated to the async DI-aware seam
 * (`enforceCommandOptimisticLockWithGuards`), so a stale edit through the
 * `customers/interactions` route 409s with the unified conflict body — both via
 * the makeCrudRoute PUT and the legacy /todos + /activities command dispatch.
 *
 * Self-contained: creates its own person + interaction via the API, restores
 * settings and deletes both in `finally`.
 */
test.describe('TC-LOCK-CUST-activities: optimistic conflict on interaction edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale interaction edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let personId: string | null = null;
    let interactionId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.interaction'],
      });

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Activity ${Date.now()}`,
        displayName: `QA TC-LOCK-CUST-activities ${Date.now()}`,
      });

      interactionId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        title: 'Initial activity',
      });

      const baseUpdatedAt = await getInteractionUpdatedAt(request, adminToken, personId, interactionId);
      expect(baseUpdatedAt).toBeTruthy();

      // A concurrent edit advances the interaction's version.
      const incoming = await updateInteractionTitle(request, adminToken, interactionId, 'Incoming edit', baseUpdatedAt);
      expect(incoming.status).toBe(200);

      // The second editor still holds the stale version → 409 conflict.
      const stale = await updateInteractionTitle(request, adminToken, interactionId, 'Stale edit', baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      // Re-reading the fresh version lets the editor save successfully.
      const freshUpdatedAt = await getInteractionUpdatedAt(request, adminToken, personId, interactionId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateInteractionTitle(request, adminToken, interactionId, 'Resaved edit', freshUpdatedAt);
      expect(resaved.status).toBe(200);
    } finally {
      await cleanupInteraction(request, adminToken, interactionId);
      await cleanupPerson(request, adminToken, personId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });

  test('a no-header interaction edit is never blocked (strictly additive)', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let personId: string | null = null;
    let interactionId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.interaction'],
      });

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `ActivityAdditive ${Date.now()}`,
        displayName: `QA TC-LOCK-CUST-activities additive ${Date.now()}`,
      });
      interactionId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        title: 'Initial activity',
      });

      // No expected-version header → the floor is a no-op, the write succeeds.
      const noHeader = await updateInteractionTitle(request, adminToken, interactionId, 'No-header edit');
      expect(noHeader.status).toBe(200);
    } finally {
      await cleanupInteraction(request, adminToken, interactionId);
      await cleanupPerson(request, adminToken, personId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
