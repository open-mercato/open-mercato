import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  findFeatureToggleOverrideTarget,
  getFeatureToggleOverrideUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  setFeatureToggleOverride,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-FT-override: Phase 6b record-locks coverage for the FEATURE-TOGGLE
 * OVERRIDE surface (`feature_toggles.feature_toggle_override`).
 *
 * Per-tenant toggle overrides are written via `PUT /api/feature_toggles/overrides`,
 * which (after Phase 6b — correcting the spec's earlier "exempt") routes through
 * the async DI-aware seam `enforceCommandOptimisticLockWithGuards` on the
 * existing override row's `updated_at`. The lock only engages once an override
 * row exists (the first set has no prior version). A stale overwrite 409s; a
 * fresh-version overwrite succeeds.
 *
 * Self-contained: requires at least one seeded toggle to override. Restores the
 * record-lock settings in `finally`. The override row itself is left in place
 * (overrides are an idempotent per-tenant config toggle, not a created record),
 * so the test does not assume a delete endpoint.
 */
test.describe('TC-LOCK-FT-override: optimistic conflict on feature toggle override edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale override edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');

    let previousSettings: RecordLockSettings | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['feature_toggles.feature_toggle_override'],
      });

      const target = await findFeatureToggleOverrideTarget(request, superadminToken);
      test.skip(!target, 'No feature toggle available to override in this environment');
      const toggleId = (target as { toggleId: string }).toggleId;

      // First set — establishes (or refreshes) the override row so a version exists.
      const firstSet = await setFeatureToggleOverride(request, superadminToken, {
        toggleId,
        isOverride: true,
        overrideValue: true,
      });
      expect(firstSet.status).toBeLessThan(300);

      const baseUpdatedAt = await getFeatureToggleOverrideUpdatedAt(request, superadminToken, toggleId);
      expect(baseUpdatedAt).toBeTruthy();

      // Incoming writer wins and advances the version.
      const incoming = await setFeatureToggleOverride(
        request,
        superadminToken,
        { toggleId, isOverride: true, overrideValue: false },
        baseUpdatedAt,
      );
      expect(incoming.status).toBeLessThan(300);

      // Stale writer replays the now-outdated version → conflict.
      const stale = await setFeatureToggleOverride(
        request,
        superadminToken,
        { toggleId, isOverride: true, overrideValue: true },
        baseUpdatedAt,
      );
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getFeatureToggleOverrideUpdatedAt(request, superadminToken, toggleId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await setFeatureToggleOverride(
        request,
        superadminToken,
        { toggleId, isOverride: true, overrideValue: true },
        freshUpdatedAt,
      );
      expect(resaved.status).toBeLessThan(300);
    } finally {
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
