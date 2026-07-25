import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  formatToolbarRangeLabel,
  gridBlockName,
  INTERACTIONS_PATH,
  localTimeAt,
  mondayWeekRange,
  pressKeyUntil,
  seedShowWeekendsPreference,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-006: Calendar conflict surfacing.
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage").
 *
 * Two overlapping planned meetings sharing the same owner (tomorrow
 * 09:00–10:30 and 09:30–11:00, `ownerUserId` = admin — `findConflicts` pairs
 * items only when they share an owner or a participant) produce upcoming
 * cards with the "1 Conflicted" badge. "See Conflict" switches to the week
 * view anchored at the conflicted item: the toolbar range label shows that
 * week and the overlapping block renders with the conflict ring.
 *
 * Determinism notes:
 * - The agenda view is activated first; its fetch window (today..+7d) always
 *   contains tomorrow, regardless of where the current Monday-week ends.
 * - The unique-title search keeps seeded/demo interactions from occupying the
 *   four upcoming-card slots.
 * - The pulse highlight clears after 3s, so the spec asserts the persistent
 *   conflict ring class and the range label instead of the transient pulse.
 */
test.describe('TC-CAL-006: Calendar conflict surfacing', () => {
  test('overlapping meetings show a Conflicted card and See Conflict navigates to the week view', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const runToken = `QA Conflict ${stamp}`;
    const titleA = `${runToken} A`;
    const titleB = `${runToken} B`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let meetingAId: string | null = null;
    let meetingBId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalConflict',
        lastName: `Person${stamp}`,
        displayName: `CalConflict Person ${stamp}`,
      });
      const startA = localTimeAt(1, 9, 0);
      meetingAId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: titleA,
        status: 'planned',
        scheduledAt: startA,
        durationMinutes: 90,
        ownerUserId: scope.userId,
      });
      meetingBId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: titleB,
        status: 'planned',
        scheduledAt: localTimeAt(1, 9, 30),
        durationMinutes: 90,
        ownerUserId: scope.userId,
      });

      // Force "Show weekends" on so tomorrow's fixtures are visible even on a weekend.
      await seedShowWeekendsPreference(page, scope.userId);

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      // Agenda first: its window always includes tomorrow's fixtures.
      const viewSwitcher = page.getByRole('radiogroup', { name: 'Calendar view' });
      await pressKeyUntil(page, 'a', async () => {
        await expect(viewSwitcher.getByRole('radio', { name: 'Agenda', exact: true })).toBeChecked({ timeout: 1_000 });
      });
      await page.locator('[data-calendar-search]').fill(runToken);

      // -- Upcoming card for meeting A shows the Conflicted badge --------------
      const cardA = page.locator('article').filter({ hasText: titleA });
      await expect(cardA).toBeVisible();
      await expect(cardA.getByText('1 Conflicted')).toBeVisible();
      const seeConflict = cardA.getByRole('button', { name: 'See Conflict' });
      await expect(seeConflict).toBeVisible();

      // -- See Conflict navigates to the week containing the overlap ------------
      await seeConflict.click();
      await expect(viewSwitcher.getByRole('radio', { name: 'Week', exact: true })).toBeChecked();
      const conflictWeek = mondayWeekRange(startA);
      await expect(
        page.getByRole('button', { name: formatToolbarRangeLabel(conflictWeek.from, conflictWeek.to) }),
      ).toBeVisible();

      const blockA = page.getByRole('button', { name: gridBlockName(titleA) });
      const blockB = page.getByRole('button', { name: gridBlockName(titleB) });
      await expect(blockA).toBeVisible();
      await expect(blockB).toBeVisible();
      await expect(blockA).toHaveClass(/ring-status-warning-icon/);
      await expect(blockB).toHaveClass(/ring-status-warning-icon/);
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingAId);
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingBId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
