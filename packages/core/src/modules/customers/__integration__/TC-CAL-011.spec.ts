import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import { INTERACTIONS_PATH, localTimeAt } from './helpers/calendarFixtures';

/**
 * TC-CAL-011: Calendar event resource links (`linkedEntities` type `resource`).
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md (#3552 — "Resources &
 * staff assignment").
 *
 * The editor stores assigned bookable resources as FK-id + label snapshots in
 * the interaction's `linkedEntities` JSONB (never resource entities), tagged
 * with `type: 'resource'`. `interactionCreateSchema` (via
 * `interactionLinkedEntitySchema`) gates the allowed link types, so this test
 * pins the contract at the API boundary:
 * - a `resource` link (mixed with a `deal` link) is accepted and round-trips
 *   through the list read with its id/type/label intact;
 * - an unknown link type is rejected with 400, guarding the enum against an
 *   accidental narrowing that would silently drop resource assignment.
 *
 * API-only and self-contained: creates its own person, posts directly, and
 * deletes the interaction + person in teardown.
 */
test.describe('TC-CAL-011: Calendar event resource links', () => {
  test('resource + deal links round-trip through the interactions API; unknown link type is rejected', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    let adminToken: string | null = null;
    let personId: string | null = null;
    let interactionId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      getTokenScope(adminToken);

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalResource',
        lastName: `Person${stamp}`,
        displayName: `CalResource Person ${stamp}`,
      });

      const resourceId = randomUUID();
      const dealId = randomUUID();
      const resourceLabel = `QA Room ${stamp}`;
      const dealLabel = `QA Deal ${stamp}`;
      const scheduledAt = localTimeAt(1, 11, 0);

      // -- A resource link (mixed with a deal link) is accepted -----------------
      const createResponse = await apiRequest(request, 'POST', INTERACTIONS_PATH, {
        token: adminToken,
        data: {
          entityId: personId,
          interactionType: 'meeting',
          title: `QA Cal Resource Link ${stamp}`,
          status: 'planned',
          scheduledAt: scheduledAt.toISOString(),
          linkedEntities: [
            { id: resourceId, type: 'resource', label: resourceLabel },
            { id: dealId, type: 'deal', label: dealLabel },
          ],
        },
      });
      const createBody = await readJsonSafe<{ id?: string | null }>(createResponse);
      expect(createResponse.status(), 'POST with a resource link should return 201').toBe(201);
      interactionId = typeof createBody?.id === 'string' ? createBody.id : null;
      expect(interactionId, 'Create response should include an id').toBeTruthy();

      // -- The links round-trip through the list read ---------------------------
      const from = localTimeAt(0, 0, 0);
      const to = localTimeAt(3, 0, 0);
      const listResponse = await apiRequest(
        request,
        'GET',
        `${INTERACTIONS_PATH}?entityId=${encodeURIComponent(personId)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        { token: adminToken },
      );
      expect(listResponse.status(), 'Windowed GET should return 200').toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse);
      const created = (listBody?.items ?? []).find((item) => item?.id === interactionId);
      expect(created, 'Created interaction should be present in the window read').toBeTruthy();

      const linked = Array.isArray(created?.linkedEntities)
        ? (created!.linkedEntities as Array<{ id: string; type: string; label: string }>)
        : [];
      const resourceLink = linked.find((entry) => entry.type === 'resource');
      expect(resourceLink, 'A resource-typed link should round-trip').toBeTruthy();
      expect(resourceLink?.id).toBe(resourceId);
      expect(resourceLink?.label).toBe(resourceLabel);
      const dealLink = linked.find((entry) => entry.type === 'deal');
      expect(dealLink?.id, 'The deal link should survive alongside the resource link').toBe(dealId);

      // -- An unknown link type is rejected (enum boundary guard) ----------------
      const rejectedResponse = await apiRequest(request, 'POST', INTERACTIONS_PATH, {
        token: adminToken,
        data: {
          entityId: personId,
          interactionType: 'meeting',
          title: `QA Cal Bad Link ${stamp}`,
          status: 'planned',
          scheduledAt: scheduledAt.toISOString(),
          linkedEntities: [{ id: randomUUID(), type: 'not_a_real_type', label: 'Nope' }],
        },
      });
      expect(rejectedResponse.status(), 'POST with an unknown link type should be rejected with 400').toBe(400);
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, interactionId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
