import { expect, request as playwrightRequest, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  INTERACTIONS_PATH,
  listInteractionsInWindow,
  localTimeAt,
  type InteractionListItem,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-001: Calendar API range read (`GET /api/customers/interactions?from&to`).
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage").
 *
 * Verified-against-source contract (`api/interactions/route.ts`):
 * - `from`/`to` filter on `coalesce(occurred_at, scheduled_at, created_at)`.
 * - Items return camelCase fields incl. `scheduledAt` (ISO), `durationMinutes`,
 *   `participants` and `updatedAt` (always non-null).
 * - GET requires `customers.interactions.view`; unauthenticated → 401, an
 *   authenticated user lacking the feature → 403.
 *
 * Self-contained: creates a person + three interactions (planned meeting
 * tomorrow 10:00–11:00, done call yesterday, planned task next week) via API
 * and removes everything in `finally`. Assertions are scoped with `entityId`
 * so seeded/demo interactions can never interfere.
 */
test.describe('TC-CAL-001: Calendar API range read', () => {
  test('windowed read returns exactly the in-range items; 401 unauthenticated; 403 without interactions.view', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    let adminToken: string | null = null;
    let personId: string | null = null;
    let meetingId: string | null = null;
    let callId: string | null = null;
    let taskId: string | null = null;
    let roleId: string | null = null;
    let restrictedUserId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalRange',
        lastName: `Person${stamp}`,
        displayName: `CalRange Person ${stamp}`,
      });

      const meetingStart = localTimeAt(1, 10, 0);
      meetingId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: `QA Cal Range Meeting ${stamp}`,
        status: 'planned',
        scheduledAt: meetingStart,
        durationMinutes: 60,
        participants: [{ userId: scope.userId, name: 'QA Admin', email: 'admin@acme.com' }],
      });

      const callOccurredAt = localTimeAt(-1, 15, 0);
      callId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'call',
        title: `QA Cal Range Call ${stamp}`,
        status: 'done',
        scheduledAt: callOccurredAt,
        occurredAt: callOccurredAt,
      });

      taskId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'task',
        title: `QA Cal Range Task ${stamp}`,
        status: 'planned',
        scheduledAt: localTimeAt(8, 9, 0),
      });

      // -- Window covering only tomorrow returns exactly the meeting ---------
      const windowFrom = localTimeAt(1, 0, 0);
      const windowTo = new Date(localTimeAt(2, 0, 0).getTime() - 1);
      const windowItems = await listInteractionsInWindow(request, adminToken, {
        entityId: personId,
        from: windowFrom,
        to: windowTo,
      });
      expect(windowItems.length, 'Tomorrow window should contain exactly one fixture interaction').toBe(1);
      const meeting = windowItems[0] as InteractionListItem;
      expect(meeting.id).toBe(meetingId);
      expect(meeting.interactionType).toBe('meeting');
      expect(meeting.title).toBe(`QA Cal Range Meeting ${stamp}`);
      expect(meeting.status).toBe('planned');
      expect(meeting.scheduledAt, 'scheduledAt should be returned as an ISO string').toBeTruthy();
      expect(new Date(meeting.scheduledAt as string).getTime()).toBe(meetingStart.getTime());
      expect(meeting.durationMinutes).toBe(60);
      expect(Array.isArray(meeting.participants), 'participants should round-trip').toBe(true);
      expect((meeting.participants ?? [])[0]?.userId).toBe(scope.userId);
      expect(typeof meeting.updatedAt === 'string' && meeting.updatedAt.length > 0, 'updatedAt must be present for optimistic locking').toBe(true);

      // -- Wide window returns all three fixtures ----------------------------
      const wideItems = await listInteractionsInWindow(request, adminToken, {
        entityId: personId,
        from: localTimeAt(-3, 0, 0),
        to: localTimeAt(10, 0, 0),
      });
      const wideIds = new Set(wideItems.map((item) => item.id));
      expect(wideIds.has(meetingId)).toBe(true);
      expect(wideIds.has(callId)).toBe(true);
      expect(wideIds.has(taskId)).toBe(true);
      expect(wideItems.length, 'Wide window should contain exactly the three fixtures for this person').toBe(3);

      // -- The done call resolves through occurredAt -------------------------
      const call = wideItems.find((item) => item.id === callId) as InteractionListItem;
      expect(call.status).toBe('done');
      expect(call.occurredAt).toBeTruthy();
      expect(new Date(call.occurredAt as string).getTime()).toBe(callOccurredAt.getTime());

      // -- 401 when unauthenticated -------------------------------------------
      // The shared `request` fixture holds the `auth_token` cookie set by the
      // login POST (getAuthFromRequest falls back to it when no Bearer header
      // is present), so the anonymous probe needs a pristine request context.
      const anonymousContext = await playwrightRequest.newContext({
        baseURL: process.env.BASE_URL?.trim() || 'http://localhost:3000',
      });
      try {
        const unauthenticated = await anonymousContext.get(
          `${INTERACTIONS_PATH}?from=${encodeURIComponent(windowFrom.toISOString())}&to=${encodeURIComponent(windowTo.toISOString())}`,
        );
        expect(unauthenticated.status(), 'Unauthenticated GET should return 401').toBe(401);
      } finally {
        await anonymousContext.dispose();
      }

      // -- 403 for a user lacking customers.interactions.view -----------------
      const roleName = `qa_cal_range_${stamp}`;
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['customers.people.view'],
      });
      const restrictedEmail = `qa-cal-range-${stamp}@acme.com`;
      const restrictedPassword = 'Valid1!Pass';
      restrictedUserId = await createUserFixture(request, adminToken, {
        email: restrictedEmail,
        password: restrictedPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Cal Range Restricted',
      });
      const restrictedToken = await getAuthToken(request, restrictedEmail, restrictedPassword);
      const forbidden = await apiRequest(
        request,
        'GET',
        `${INTERACTIONS_PATH}?from=${encodeURIComponent(windowFrom.toISOString())}&to=${encodeURIComponent(windowTo.toISOString())}`,
        { token: restrictedToken },
      );
      const forbiddenBody = await readJsonSafe<Record<string, unknown>>(forbidden);
      expect(forbidden.status(), `GET without interactions.view should return 403 (body: ${JSON.stringify(forbiddenBody)})`).toBe(403);
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingId);
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, callId);
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, taskId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
      await deleteUserIfExists(request, adminToken, restrictedUserId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
