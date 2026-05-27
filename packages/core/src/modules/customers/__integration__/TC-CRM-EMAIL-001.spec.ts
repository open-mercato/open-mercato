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

/**
 * TC-CRM-EMAIL-001: Outbound compose → subscriber → cross-user visibility chain
 *
 * Verifies the full path:
 *   POST /api/customers/people/{id}/emails
 *     → hub send-as-user route
 *     → persistent subscriber (communication_channels.message.sent)
 *     → CustomerInteraction row with correct visibility
 *     → GET /api/customers/interactions filters correctly per-user
 *
 * SKIP REASON — Channel fixture blocker:
 *
 *   The compose route requires a real `CommunicationChannel` row with
 *   `userId = userA.id`, `status = 'connected'`, `isActive = true`.
 *   Creating such a row via HTTP requires POST
 *   /api/communication_channels/channels/connect/credentials, which calls
 *   `ConnectCredentialChannelCommand.execute()` → validates credentials against
 *   a live provider adapter, returning 404 for any `providerKey` that has no
 *   registered adapter. Since the test environment has no adapter installed
 *   (provider packages are independent npm workspaces not mounted in the core
 *   package's test runner), there is no way to create a channel fixture via the
 *   HTTP API without either (a) a live IMAP/Gmail credential or (b) a stub
 *   adapter registration accessible from the integration test harness.
 *
 *   Additionally, there is no HTTP DELETE route for CommunicationChannel rows,
 *   so teardown would require a direct DB delete — which integration tests MUST
 *   NOT do (tests are API-fixture-only per AGENTS.md).
 *
 * HOW TO ENABLE:
 *
 *   Option A — Admin channel-create endpoint:
 *     Add a `POST /api/communication_channels/channels/admin/seed` route (test-
 *     env only, gated by an env flag `OM_ENABLE_TEST_CHANNEL_SEEDING=true`) that
 *     inserts a CommunicationChannel row directly without adapter validation.
 *     Add a matching `DELETE /api/communication_channels/channels/{id}` route
 *     (admin only, or same test-env gate) for teardown. Then remove test.skip
 *     from the two tests below and wire the channel create/delete via `apiRequest`.
 *
 *   Option B — Expose DisconnectChannel command via HTTP:
 *     Add `DELETE /api/communication_channels/channels/{id}` backed by the
 *     existing disconnect-channel command. For creation, add a command that
 *     skips validation when `OM_ENABLE_TEST_CHANNEL_SEEDING=true`. Remove skip.
 *
 *   Option C — Direct DB fixture helper:
 *     If the integration test harness gains a `createDbFixture(sql, params)`
 *     helper (like Prisma's `$executeRawUnsafe` equivalent), use it to INSERT
 *     directly. Update `createChannelFixtureViaDb` below and remove skip.
 *
 *   Whichever option is chosen, also replace the stub `channelId` placeholder
 *   with the real channel.id returned from the fixture.
 */

// ── Polling helper ────────────────────────────────────────────────────────────

async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  predicate: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const intervalMs = options.intervalMs ?? 250
  const deadline = Date.now() + timeoutMs
  let lastValue: T | null = null
  while (Date.now() < deadline) {
    const value = await fn()
    if (value != null && predicate(value)) return value
    lastValue = (value as T) ?? lastValue
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms; last value: ${JSON.stringify(lastValue)}`)
}

// ── Main test suite ───────────────────────────────────────────────────────────

test.describe('TC-CRM-EMAIL-001: outbound compose → subscriber → cross-user visibility', () => {
  /**
   * Happy-path end-to-end test.
   *
   * Skipped because a `CommunicationChannel` fixture cannot be created via the
   * HTTP API without a live provider adapter. See file-level SKIP REASON above
   * for how to enable once test infrastructure supports channel fixtures.
   */
  test.skip(
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

        // ── Setup: role with required features, deliberately WITHOUT
        //    customers.email.view_private ────────────────────────────────────
        const roleName = `qa_crm_email_001_${stamp}`;
        roleId = await createRoleFixture(request, adminToken, {
          name: roleName,
          tenantId: scope.tenantId,
        });

        const aclResp = await apiRequest(request, 'PUT', `/api/auth/roles/${roleId}/acl`, {
          token: adminToken,
          data: {
            features: [
              'customers.interactions.view',
              'customers.email.compose',
              'customers.interactions.manage',
              'customers.people.view',
              'communication_channels.manage',
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

        const userAScope = getTokenScope(userAToken);

        // ── Setup: Person with a known primary email ───────────────────────
        personId = await createPersonFixture(request, adminToken, {
          firstName: 'CrmEmail001',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail001 Person ${stamp}`,
        });

        // ── Setup: CommunicationChannel for User A (BLOCKED) ──────────────
        //
        // TODO: replace this block with a real fixture once Option A / B / C
        // (see SKIP REASON above) is implemented. The placeholder UUID below
        // will cause the compose call to return 404 / 403 — the test is skipped
        // anyway so this code path is never reached.
        //
        // Example (Option A):
        //   const channelResp = await apiRequest(
        //     request,
        //     'POST',
        //     '/api/communication_channels/channels/admin/seed',
        //     {
        //       token: adminToken,
        //       data: {
        //         userId: userAScope.userId,
        //         providerKey: '__stub__',
        //         channelType: 'email',
        //         displayName: `TC-CRM-EMAIL-001 stub channel ${stamp}`,
        //         status: 'connected',
        //         isActive: true,
        //       },
        //     },
        //   );
        //   expect(channelResp.status(), 'channel seed should return 201').toBe(201);
        //   const channelBody = await readJsonSafe<{ id?: string }>(channelResp);
        //   channelId = channelBody?.id ?? null;
        //   expect(channelId, 'channel seed response must include id').toBeTruthy();
        channelId = '00000000-0000-0000-0000-000000000000'; // placeholder — never reached

        // ── Action: compose outbound email as User A ───────────────────────
        const composeResp = await apiRequest(
          request,
          'POST',
          `/api/customers/people/${personId}/emails`,
          {
            token: userAToken,
            data: {
              userChannelId: channelId,
              to: ['target@example.com'],
              subject: 'TC-CRM-EMAIL-001 outbound test',
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

        // ── Assertion 1: User A polls for the interaction (async subscriber) ─
        //
        // The `customers:link-channel-message-sent` subscriber is persistent
        // (retried by the event bus worker). Allow up to 10 s for the row to
        // appear.
        const userAItems = await pollUntil(
          async () => {
            const resp = await apiRequest(
              request,
              'GET',
              `/api/customers/interactions?entityId=${encodeURIComponent(personId!)}&interactionType=email`,
              { token: userAToken! },
            );
            if (!resp.ok()) return null;
            const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(resp);
            return body?.items ?? null;
          },
          (items) => items.length > 0,
          { timeoutMs: 10_000, intervalMs: 250 },
        );

        expect(userAItems.length, 'User A must see exactly 1 email interaction').toBe(1);
        const interaction = userAItems[0];
        interactionId = typeof interaction.id === 'string' ? interaction.id : null;

        expect(
          interaction.visibility,
          'interaction visibility must be "private"',
        ).toBe('private');
        expect(
          interaction.authorUserId,
          'authorUserId must equal User A\'s user id',
        ).toBe(userAScope.userId);
        expect(
          interaction.interactionType,
          'interactionType must be "email"',
        ).toBe('email');
        expect(
          typeof interaction.externalMessageId === 'string' && interaction.externalMessageId.length > 0,
          'externalMessageId must be a non-null string (the MessageChannelLink id)',
        ).toBe(true);

        // ── Assertion 2: User B sees 0 interactions (visibility filter) ───────
        const userBResp = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId!)}&interactionType=email`,
          { token: (await getAuthToken(request, userBEmail, userBPassword)) },
        );
        expect(
          userBResp.ok(),
          'User B GET /api/customers/interactions should return 200 (empty list)',
        ).toBeTruthy();
        const userBBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(userBResp);
        const userBItems = Array.isArray(userBBody?.items) ? userBBody!.items : [];
        expect(
          userBItems.length,
          'User B (no view_private) must see 0 email interactions',
        ).toBe(0);
      } finally {
        // Cleanup is best-effort, ordered interactions → channel → person →
        // users → role. Channel delete is a no-op until an HTTP DELETE route
        // exists.
        if (adminToken) {
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/interactions',
            interactionId,
          );
          // TODO: delete channelId once DELETE /api/communication_channels/channels/{id} exists.
          // await apiRequest(request, 'DELETE', `/api/communication_channels/channels/${channelId}`, { token: adminToken })
          //   .catch(() => undefined);
          await deleteEntityIfExists(
            request,
            adminToken,
            '/api/customers/people',
            personId,
          );
        }
        await deleteUserIfExists(request, adminToken, userAId);
        await deleteUserIfExists(request, adminToken, userBId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );

  /**
   * Smoke-test: the compose route rejects a non-existent channel with 4xx (not 5xx).
   *
   * This test does NOT require a channel fixture — it uses a nil UUID and
   * verifies the route fails gracefully. It runs unconditionally.
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
        const aclResp = await apiRequest(request, 'PUT', `/api/auth/roles/${roleId}/acl`, {
          token: adminToken,
          data: {
            features: [
              'customers.interactions.view',
              'customers.email.compose',
              'customers.interactions.manage',
              'customers.people.view',
              'communication_channels.manage',
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
        // exist (or belongs to another user). The compose proxy forwards that
        // status. Any 4xx response confirms the route is wired and the guard
        // fires correctly.
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
