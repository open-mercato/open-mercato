import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  escapeRegExp,
  INTERACTIONS_PATH,
  mondayWeekRange,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

for (const width of [320, 390, 428, 900, 1280]) {
  test(`TC-CAL-015: Week event peeks stay within a ${width}px viewport and dismiss normally (#8868)`, async ({ page, request }) => {
    test.slow();
    await page.setViewportSize({ width, height: 844 });
    const stamp = Date.now();
    const titlePrefix = `QA Calendar Bounds ${width} ${stamp}`;
    const meetingIds: string[] = [];
    let token: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      personId = await createPersonFixture(request, token, {
        firstName: 'Calendar',
        lastName: `Bounds${stamp}`,
        displayName: titlePrefix,
      });
      const monday = mondayWeekRange(new Date()).from;
      for (const dayOffset of [1, 2, 3]) {
        meetingIds.push(await createInteractionFixture(request, token, {
          entityId: personId,
          interactionType: 'meeting',
          title: `${titlePrefix} ${dayOffset}`,
          scheduledAt: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayOffset, 9),
          durationMinutes: 60,
          location: 'https://meet.google.com/calendar-bounds',
        }));
      }

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);
      await page.getByRole('radio', { name: 'Week', exact: true }).click();
      await page.locator('[data-calendar-search]').fill(titlePrefix);
      await page.locator('[data-calendar-search]').blur();

      for (const dayOffset of [1, 2, 3]) {
        const title = `${titlePrefix} ${dayOffset}`;
        const trigger = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)},`) });
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        const peek = page.locator('[data-slot="popover-content"]').filter({ hasText: title });
        await expect(peek).toBeVisible();
        await expect.poll(async () => {
          const bounds = await peek.boundingBox();
          return bounds !== null && bounds.x >= 0 && bounds.y >= 0
            && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 844;
        }).toBe(true);
        await expect(peek.getByText(title, { exact: true })).toBeVisible();
        await expect(peek.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
        await expect(peek.getByRole('button', { name: 'Join', exact: true })).toBeEnabled();
        await expect(peek.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(peek).toBeHidden();
        await expect(trigger).toBeFocused();

        await trigger.click();
        await expect(peek).toBeVisible();
        await page.getByRole('radio', { name: 'Week', exact: true }).click();
        await expect(peek).toBeHidden();
      }
    } finally {
      for (const meetingId of meetingIds) {
        await deleteEntityIfExists(request, token, INTERACTIONS_PATH, meetingId);
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
}

test('TC-CAL-015: phone Day all-day peeks stay inside the viewport', async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  const title = `QA Day All Day Bounds ${Date.now()}`;
  let token: string | null = null;
  let personId: string | null = null;
  let interactionId: string | null = null;

  try {
    token = await getAuthToken(request, 'admin');
    personId = await createPersonFixture(request, token, {
      firstName: 'Calendar',
      lastName: 'Day bounds',
      displayName: title,
    });
    const scheduledAt = new Date();
    scheduledAt.setHours(0, 0, 0, 0);
    interactionId = await createInteractionFixture(request, token, {
      entityId: personId,
      interactionType: 'meeting',
      title,
      scheduledAt,
      allDay: true,
      durationMinutes: 60,
      location: 'https://meet.google.com/calendar-day-bounds',
    });

    await login(page, 'admin');
    await page.goto('/backend/calendar');
    await waitForCalendarLoaded(page);
    await page.getByRole('radio', { name: 'Day', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search events…', exact: true }).fill(title);
    await page.getByRole('searchbox', { name: 'Search events…', exact: true }).blur();
    const trigger = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)},`) });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const peek = page.getByRole('dialog').filter({ hasText: title });
    await expect(peek).toBeVisible();
    await expect.poll(async () => {
      const bounds = await peek.boundingBox();
      return bounds !== null && bounds.x >= 0 && bounds.y >= 0
        && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844;
    }).toBe(true);
    await expect(peek.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await expect(peek.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(peek).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await deleteEntityIfExists(request, token, INTERACTIONS_PATH, interactionId);
    await deleteEntityIfExists(request, token, '/api/customers/people', personId);
  }
});
