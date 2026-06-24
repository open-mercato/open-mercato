import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * Shared fixtures + date helpers for the CRM Calendar integration specs
 * (TC-CAL-001…006, spec: .ai/specs/2026-06-11-crm-calendar.md).
 *
 * All date helpers compute in HOST-LOCAL time. Playwright does not override
 * `timezoneId`, so the browser context and this Node process share the host
 * timezone — wall-clock expectations computed here match what the page renders
 * (the calendar renders everything in the browser timezone by design).
 */

export const INTERACTIONS_PATH = '/api/customers/interactions';

export type InteractionParticipant = { userId: string; name?: string; email?: string; status?: string };

export type InteractionFixtureInput = {
  entityId: string;
  interactionType: string;
  title: string;
  scheduledAt: Date;
  status?: 'planned' | 'done' | 'canceled';
  durationMinutes?: number | null;
  occurredAt?: Date | null;
  participants?: InteractionParticipant[] | null;
  location?: string | null;
  allDay?: boolean | null;
  ownerUserId?: string | null;
  priority?: number | null;
};

export async function createInteractionFixture(
  request: APIRequestContext,
  token: string,
  input: InteractionFixtureInput,
): Promise<string> {
  const data: Record<string, unknown> = {
    entityId: input.entityId,
    interactionType: input.interactionType,
    title: input.title,
    status: input.status ?? 'planned',
    scheduledAt: input.scheduledAt.toISOString(),
  };
  if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;
  if (input.occurredAt !== undefined && input.occurredAt !== null) data.occurredAt = input.occurredAt.toISOString();
  if (input.participants !== undefined) data.participants = input.participants;
  if (input.location !== undefined) data.location = input.location;
  if (input.allDay !== undefined) data.allDay = input.allDay;
  if (input.ownerUserId !== undefined) data.ownerUserId = input.ownerUserId;
  if (input.priority !== undefined) data.priority = input.priority;

  const response = await apiRequest(request, 'POST', INTERACTIONS_PATH, { token, data });
  const body = await readJsonSafe<{ id?: string | null }>(response);
  expect(response.status(), `POST ${INTERACTIONS_PATH} should return 201`).toBe(201);
  expect(typeof body?.id === 'string' && body.id.length > 0, 'Interaction create response should include id').toBe(true);
  return body?.id as string;
}

export type InteractionListItem = {
  id: string;
  entityId: string | null;
  interactionType: string;
  title: string | null;
  status: string;
  scheduledAt: string | null;
  occurredAt: string | null;
  durationMinutes: number | null;
  participants: InteractionParticipant[] | null;
  ownerUserId: string | null;
  updatedAt: string | null;
};

export async function listInteractionsInWindow(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; from: Date; to: Date },
): Promise<InteractionListItem[]> {
  const params = new URLSearchParams({
    entityId: input.entityId,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    limit: '100',
  });
  const response = await apiRequest(request, 'GET', `${INTERACTIONS_PATH}?${params.toString()}`, { token });
  expect(response.status(), `GET ${INTERACTIONS_PATH} window read should return 200`).toBe(200);
  const body = await readJsonSafe<{ items?: InteractionListItem[] }>(response);
  return Array.isArray(body?.items) ? body.items : [];
}

/**
 * Resolve an interaction id by exact title within a window. Used to find the
 * record created through the calendar editor UI so teardown can delete it.
 * Deliberately scans the decrypted list response instead of `?search=` —
 * title is encrypted at rest on encryption-enabled tenants, so server-side
 * ILIKE would not match.
 */
export async function findInteractionIdByTitle(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; title: string; from: Date; to: Date },
): Promise<string | null> {
  const items = await listInteractionsInWindow(request, token, input);
  const match = items.find((item) => item.title === input.title);
  return match?.id ?? null;
}

/** Local wall-clock Date at `daysFromToday` days from today, at hours:minutes. */
export function localTimeAt(daysFromToday: number, hours: number, minutes = 0): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday, hours, minutes, 0, 0);
}

/** Monday-start week range containing `anchor` (from Monday 00:00 to Sunday 23:59:59.999, local). */
export function mondayWeekRange(anchor: Date): { from: Date; to: Date } {
  const mondayOffset = (anchor.getDay() + 6) % 7;
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - mondayOffset, 0, 0, 0, 0);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6, 23, 59, 59, 999);
  return { from, to };
}

const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Mirrors `CalendarToolbar.formatRangeLabel` (date-fns `'MMM dd' – 'MMM dd, yyyy'`,
 * default English locale) so specs can assert the visible range label.
 */
export function formatToolbarRangeLabel(from: Date, to: Date): string {
  return `${EN_MONTHS_SHORT[from.getMonth()]} ${pad2(from.getDate())} – ${EN_MONTHS_SHORT[to.getMonth()]} ${pad2(to.getDate())}, ${to.getFullYear()}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locator regex for a week/day TimeGrid event block: its accessible name is
 * `${title}, ${timeRange}` (see EventBlock aria-label), so anchoring on
 * `title + ", "` distinguishes grid blocks from month pills / agenda rows
 * (which use `${title} · …`).
 */
export function gridBlockName(title: string): RegExp {
  return new RegExp(`^${escapeRegExp(title)}, `);
}

/** Month pill / agenda row accessible name: `${title} · …` (or bare title for all-day month pills). */
export function dotSeparatedItemName(title: string): RegExp {
  return new RegExp(`^${escapeRegExp(title)}( · |$)`);
}

/**
 * Press a global calendar shortcut until its effect is observable. The
 * keydown listener attaches on CalendarScreen mount, so a key press racing
 * hydration can be lost — re-pressing inside an expect-poll keeps the spec
 * free of hard waits while staying deterministic.
 */
export async function pressKeyUntil(page: Page, key: string, assertion: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.keyboard.press(key);
    await assertion();
  }).toPass();
}

/** Wait for the calendar screen to finish its initial load (grid rendered, loader gone). */
export async function waitForCalendarLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('radiogroup', { name: 'Calendar view' })).toBeVisible();
  await expect(page.getByText('Loading calendar…')).toBeHidden();
}

/**
 * Seeds the per-user calendar preference `showWeekends: true` in localStorage
 * before navigation, so weekend-day fixtures and "today" assertions stay visible
 * regardless of the run-day (the Mon–Fri default is covered by TC-CAL-007). Call
 * before `login`/`page.goto`. `userId` comes from `getTokenScope(token).userId`.
 */
export async function seedShowWeekendsPreference(page: Page, userId: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
    },
    [
      `om.customers.calendar.preferences.v1:${userId}`,
      JSON.stringify({
        showWeekends: true,
        conflictWarnings: true,
        showCrmActivities: true,
        aiSummaries: true,
        eventCategories: [],
        activityTypes: [],
      }),
    ],
  );
}
