import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/modules/core/__integration__/helpers/communicationChannelsFixtures';
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue';

/**
 * TC-CRM-EMAIL-001: Outbound compose → subscriber → cross-user visibility chain
 *
 * Verifies the full path:
 *   POST /api/customers/people/{id}/emails
 *     → hub send-as-user facade (enqueues outbound delivery)
 *     → outbound delivery worker (communication-channels-outbound) emits .message.sent
 *     → persistent subscriber (customers:link-channel-message-sent, via the `events` queue)
 *     → CustomerInteraction row with author_user_id=A, visibility='private'
 *     → GET /api/customers/interactions filters correctly per-user
 *
 * The channel + send transport are seeded by the env-gated test fixture
 * (`OM_ENABLE_TEST_CHANNEL_SEEDING`) — see
 * `packages/core/src/modules/communication_channels/lib/test-seed.ts`. When the
 * gate is off (e.g. an environment that didn't opt in) the suite skips instead of
 * failing, because a connected channel cannot be provisioned without it.
 */

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

// Local (non-standalone) runs need QUEUE_BASE_DIR pointed at the app's queue dir
// so `drainIntegrationQueue` reads the same file-backed queue the app writes to.
if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const OUTBOUND_QUEUE = 'communication-channels-outbound'
const EVENTS_QUEUE = 'events'

/**
 * Drain the outbound-delivery queue (provider send + .message.sent emit) and then
 * the events queue (persistent link subscriber), repeatedly, until the customers
 * interaction row materializes for the author. Returns the author's email
 * interactions list once non-empty.
 */
async function drainAndPollForInteraction(
  request: Parameters<typeof apiRequest>[0],
  authorToken: string,
  personId: string,
): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 30_000
  let lastItems: Array<Record<string, unknown>> = []
  while (Date.now() < deadline) {
    await drainIntegrationQueue(OUTBOUND_QUEUE, { appRoot: APP_ROOT })
    await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })

    const resp = await apiRequest(
      request,
      'GET',
      `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
      { token: authorToken },
    )
    if (resp.ok()) {
      const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(resp)
      lastItems = Array.isArray(body?.items) ? body!.items : []
      if (lastItems.length > 0) return lastItems
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return lastItems
}

test.describe('TC-CRM-EMAIL-001: outbound compose → subscriber → cross-user visibility', () => {
  test(
    'POST /emails creates interaction visible to author but not to other user',
    async ({ request }) => {
      test.slow();

      // ── Fixture state tracked for cleanup ──────────────────────────────
      const stamp = Date.now();
      let adminToken: string | null = null;
      let userAToken: string | null = null;
      let userBToken: string | null = null;
      let userAId: string | null = null;
      let userBId: string | null = null;
      let roleId: string | null = null;
      let personId: string | null = null;
      let channelId: string | null = null;
      let interactionId: string | null = null;

      try {
        // ── Setup: admin token and tenant scope ────────────────────────────
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        // Skip when the env-gated channel-seeding fixture isn't enabled — a
        // connected channel can't be provisioned over HTTP without it.
        const seedingAvailable = await isChannelSeedingAvailable(request, adminToken);
        test.skip(
          !seedingAvailable,
          'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot provision a connected channel.',
        );

        // ── Setup: role with required features, deliberately WITHOUT
        //    customers.email.view_private ────────────────────────────────────
        const roleName = `qa_crm_email_001_${stamp}`;
        roleId = await createRoleFixture(request, adminToken, {
          name: roleName,
          tenantId: scope.tenantId,
        });

        const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: {
            roleId,
            features: [
              'customers.interactions.view',
              'customers.email.compose',
              'customers.interactions.manage',
              'customers.people.view',
              'communication_channels.connect_user_channel',
            ],
          },
        });
        expect(aclResp.ok(), `PUT /api/auth/roles/${roleId}/acl should succeed`).toBeTruthy();

        // ── Setup: User A (author, channel owner) ──────────────────────────
        const userAEmail = `qa-crm-email-001-a-${stamp}@acme.com`;
        const userAPassword = 'Valid1!Pass';
        userAId = await createUserFixture(request, adminToken, {
          email: userAEmail,
          password: userAPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Email 001 User A',
        });
        userAToken = await getAuthToken(request, userAEmail, userAPassword);

        // ── Setup: User B (other employee — same role, no view_private) ────
        const userBEmail = `qa-crm-email-001-b-${stamp}@acme.com`;
        const userBPassword = 'Valid1!Pass';
        userBId = await createUserFixture(request, adminToken, {
          email: userBEmail,
          password: userBPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Email 001 User B',
        });
        userBToken = await getAuthToken(request, userBEmail, userBPassword);

        const userAScope = getTokenScope(userAToken);

        // ── Setup: Person (compose target) ─────────────────────────────────
        personId = await createPersonFixture(request, adminToken, {
          firstName: 'CrmEmail001',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail001 Person ${stamp}`,
        });

        // ── Setup: connected channel owned by User A (env-gated fixture) ───
        channelId = await seedConnectedChannel(request, userAToken, {
          displayName: `TC-CRM-EMAIL-001 channel ${stamp}`,
          externalIdentifier: `tc-crm-email-001-${stamp}@test-seed.local`,
        });

        // ── Action: compose outbound PRIVATE email as User A ───────────────
        const composeResp = await apiRequest(
          request,
          'POST',
          `/api/customers/people/${personId}/emails`,
          {
            token: userAToken,
            data: {
              userChannelId: channelId,
              to: ['target@example.com'],
              subject: `TC-CRM-EMAIL-001 outbound ${stamp}`,
              body: 'Hello from the integration test',
              bodyFormat: 'text',
              visibility: 'private',
            },
          },
        );
        expect(composeResp.ok(), 'POST /api/customers/people/{id}/emails should return 200').toBeTruthy();
        const composeBody = await readJsonSafe<{ messageId?: string | null }>(composeResp);
        expect(
          typeof composeBody?.messageId === 'string' && composeBody.messageId.length > 0,
          'compose response must include a non-null messageId string',
        ).toBe(true);

        // ── Assertion 1: drive the async chain, then User A sees the row ────
        const userAItems = await drainAndPollForInteraction(request, userAToken, personId);
        expect(userAItems.length, 'User A must see exactly 1 email interaction').toBe(1);
        const interaction = userAItems[0];
        interactionId = typeof interaction.id === 'string' ? interaction.id : null;

        expect(interaction.visibility, 'interaction visibility must be "private"').toBe('private');
        expect(
          interaction.authorUserId,
          "authorUserId must equal User A's user id",
        ).toBe(userAScope.userId);
        expect(interaction.interactionType, 'interactionType must be "email"').toBe('email');
        expect(
          typeof interaction.externalMessageId === 'string' && interaction.externalMessageId.length > 0,
          'externalMessageId must be a non-null string (the MessageChannelLink id)',
        ).toBe(true);

        // ── Assertion 2: User B sees 0 interactions (visibility filter) ─────
        const userBResp = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
          { token: userBToken },
        );
        expect(
          userBResp.ok(),
          'User B GET /api/customers/interactions should return 200 (empty list)',
        ).toBeTruthy();
        const userBBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(userBResp);
        const userBItems = Array.isArray(userBBody?.items) ? userBBody!.items : [];
        expect(
          userBItems.some((item) => item.id === interactionId),
          'User B (not author, no view_private) must NOT see the private email interaction',
        ).toBe(false);
        expect(
          userBItems.length,
          'User B (no view_private) must see 0 email interactions',
        ).toBe(0);
      } finally {
        // Cleanup is best-effort, ordered: interaction → channel → person →
        // users → role.
        if (adminToken) {
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/interactions',
            interactionId,
          );
        }
        // The channel is owned by User A — delete it with the owner's token.
        await deleteChannelIfExists(request, userAToken, channelId);
        if (adminToken) {
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
        }
        await deleteUserIfExists(request, adminToken, userAId);
        await deleteUserIfExists(request, adminToken, userBId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );

  /**
   * Smoke-test: the compose route rejects a non-existent channel with 4xx (not 5xx).
   * Runs unconditionally — no channel fixture required.
   */
  test(
    'POST /emails with non-existent channelId returns 4xx (route is wired)',
    async ({ request }) => {
      const stamp = Date.now();
      let adminToken: string | null = null;
      let userAToken: string | null = null;
      let userAId: string | null = null;
      let roleId: string | null = null;
      let personId: string | null = null;

      try {
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        const roleName = `qa_crm_email_001_smoke_${stamp}`;
        roleId = await createRoleFixture(request, adminToken, {
          name: roleName,
          tenantId: scope.tenantId,
        });
        const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: {
            roleId,
            features: [
              'customers.interactions.view',
              'customers.email.compose',
              'customers.interactions.manage',
              'customers.people.view',
              'communication_channels.connect_user_channel',
            ],
          },
        });
        expect(aclResp.ok(), 'PUT ACL should succeed').toBeTruthy();

        const userAEmail = `qa-crm-email-001-smoke-a-${stamp}@acme.com`;
        const userAPassword = 'Valid1!Pass';
        userAId = await createUserFixture(request, adminToken, {
          email: userAEmail,
          password: userAPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Email 001 Smoke User A',
        });
        userAToken = await getAuthToken(request, userAEmail, userAPassword);

        personId = await createPersonFixture(request, adminToken, {
          firstName: 'CrmEmail001Smoke',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail001Smoke Person ${stamp}`,
        });

        const composeResp = await apiRequest(
          request,
          'POST',
          `/api/customers/people/${personId}/emails`,
          {
            token: userAToken,
            data: {
              userChannelId: '00000000-0000-0000-0000-000000000000',
              to: ['target@example.com'],
              subject: 'TC-CRM-EMAIL-001 smoke test',
              body: 'Smoke test body',
              bodyFormat: 'text',
              visibility: 'private',
            },
          },
        );

        // The hub send-as-user route returns 404 when the channel does not
        // exist (or belongs to another user). Any 4xx confirms the route is
        // wired and the guard fires correctly.
        expect(
          composeResp.status() >= 400 && composeResp.status() < 500,
          `Expected 4xx but got ${composeResp.status()} — route may not be wired`,
        ).toBe(true);
        expect(
          composeResp.status(),
          'Route must not 5xx for an unknown channel',
        ).toBeLessThan(500);
      } finally {
        if (adminToken) {
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
        }
        await deleteUserIfExists(request, adminToken, userAId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );
});
