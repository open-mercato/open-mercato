import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupChannel,
  createSalesChannelFixture,
  getChannelUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateChannelName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-SALES-channel: Phase 3 record-locks coverage for the sales CHANNEL
 * config entity (`sales.channel`).
 *
 * Channels are a flat `makeCrudRoute` config resource (a list/dialog editor, no
 * detail-screen presence), so the server-side optimistic-lock guard is
 * auto-covered by the CRUD mutation-guard decorator on the channel's OWN row.
 * A stale channel edit 409s; a fresh-version edit succeeds.
 *
 * Self-contained: creates its own channel via the API, restores settings and
 * deletes the channel in `finally`.
 */
test.describe('TC-LOCK-SALES-channel: optimistic conflict on channel config edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale channel edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let channelId: string | null = null;
    const channelCode = `qa_lock_ch_${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['sales.channel'],
      });

      const suffix = `${Date.now()}`;
      channelId = await createSalesChannelFixture(request, adminToken, {
        name: `QA Lock Channel ${suffix}`,
        code: channelCode,
      });

      const baseUpdatedAt = await getChannelUpdatedAt(request, adminToken, channelId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateChannelName(request, adminToken, channelId, channelCode, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateChannelName(request, adminToken, channelId, channelCode, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getChannelUpdatedAt(request, adminToken, channelId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateChannelName(request, adminToken, channelId, channelCode, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupChannel(request, adminToken, channelId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
