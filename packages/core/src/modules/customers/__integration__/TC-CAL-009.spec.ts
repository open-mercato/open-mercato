import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  escapeRegExp,
  INTERACTIONS_PATH,
  mondayWeekRange,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-009: Editor conflict detection.
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage").
 *
 * The editor's save-time conflict warning uses the SAME `findConflicts` logic as
 * the grid (overlap + shared owner/participant) — so a conflict the grid shows is
 * always surfaced in the editor too. Two overlapping planned meetings sharing an
 * owner → opening the editor on one shows the "Overlaps with: …" warning.
 *
 * Determinism notes:
 * - Both meetings are anchored to this week's Wednesday (10:00–11:00 and
 *   10:30–11:30), always inside the visible Mon–Fri week (weekends default OFF).
 * - They share `ownerUserId` (the test user) so `findConflicts` pairs them.
 * - A unique run token keeps seeded/demo interactions out of the assertions.
 */
test.describe('TC-CAL-009: Calendar editor conflict detection', () => {
  test('editing one of two overlapping owner-shared meetings surfaces the conflict warning', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const runToken = `QA Cal Conflict ${stamp}`;
    const titleA = `${runToken} A`;
    const titleB = `${runToken} B`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let meetingAId: string | null = null;
    let meetingBId: string | null = null;

    // This week's Wednesday — always inside the visible Mon–Fri week.
    const monday = mondayWeekRange(new Date()).from;
    const wednesday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 2);
    const startA = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 10, 0, 0, 0);
    const startB = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 10, 30, 0, 0);

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalConflict',
        lastName: `Person${stamp}`,
        displayName: `CalConflict Person ${stamp}`,
      });
      meetingAId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: titleA,
        status: 'planned',
        scheduledAt: startA,
        durationMinutes: 60,
        ownerUserId: scope.userId,
      });
      meetingBId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: titleB,
        status: 'planned',
        scheduledAt: startB,
        durationMinutes: 60,
        ownerUserId: scope.userId,
      });

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      // Open meeting B from the grid → peek popover → Edit (edit mode passes the
      // item's ownerUserId to the probe).
      const blockB = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(titleB)},.*10:30`) });
      await expect(blockB).toBeVisible();
      await blockB.click();
      const peekEdit = page.getByRole('button', { name: 'Edit', exact: true });
      await expect(peekEdit).toBeVisible();
      await peekEdit.click();

      const editor = page.getByRole('dialog');
      await expect(editor).toBeVisible();
      await expect(editor.getByText('Edit event').first()).toBeVisible();

      // The save-time conflict warning surfaces meeting A (overlapping, shared owner).
      await expect(editor.getByText(/Overlaps with/i)).toBeVisible({ timeout: 10_000 });
      await expect(editor.getByText(new RegExp(escapeRegExp(titleA)))).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingAId);
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingBId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
