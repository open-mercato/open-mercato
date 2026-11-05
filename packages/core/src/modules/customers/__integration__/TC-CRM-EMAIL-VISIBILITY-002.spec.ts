import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext } from '@playwright/test';
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
 * TC-CRM-EMAIL-VISIBILITY-002: per-email visibility on the Person Emails tab
 * (`GET /api/customers/people/[id]/email-threads`).
 *
 * This guards the just-landed fix that wired `buildEmailVisibilityMikroFilter`
 * into `lib/personEmailThreads.ts`, so the Emails tab applies the SAME
 * per-email rule as `/api/customers/interactions`:
 *   (a) a SHARED email authored by User A appears in User B's /email-threads,
 *   (b) a PRIVATE email authored by User A is ABSENT from User B's
 *       /email-threads but present for User A,
 *   (c) an admin holding customers.email.view_private gets NO bypass — a
 *       teammate's private email stays hidden (v1 strict owner-only).
 *
 * Threads only render when an interaction's externalMessageId resolves to a real
 * MessageChannelLink, so the emails are produced by composing through the real
 * outbound chain (env-gated `OM_ENABLE_TEST_CHANNEL_SEEDING` channel fixture).
 * The chain is async (outbound delivery → .message.sent → link subscriber), so
 * the test drains the outbound + events queues before asserting.
 */

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const OUTBOUND_QUEUE = 'communication-channels-outbound'
const EVENTS_QUEUE = 'events'

type EmailThread = {
  threadKey: string
  messages: Array<{ id: string }>
}

async function fetchThreadLinkIds(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<Set<string>> {
  const resp = await apiRequest(
    request,
    'GET',
    `/api/customers/people/${encodeURIComponent(personId)}/email-threads`,
    { token },
  )
  expect(resp.ok(), `GET /email-threads should succeed (got ${resp.status()})`).toBeTruthy()
  const body = await readJsonSafe<{ threads?: EmailThread[] }>(resp)
  const ids = new Set<string>()
  for (const thread of body?.threads ?? []) {
    for (const message of thread.messages ?? []) {
      if (typeof message.id === 'string') ids.add(message.id)
    }
  }
  return ids
}

/**
 * Compose an email as the author and drive the async chain until the resulting
 * CustomerInteraction is visible to the author. Returns the interaction's
 * externalMessageId (the MessageChannelLink id that appears in thread DTOs).
 */
async function composeAndResolveLinkId(
  request: APIRequestContext,
  args: {
    authorToken: string
    channelId: string
    personId: string
    subject: string
    visibility: 'private' | 'shared'
  },
): Promise<{ interactionId: string; linkId: string }> {
  const composeResp = await apiRequest(
    request,
    'POST',
    `/api/customers/people/${args.personId}/emails`,
    {
      token: args.authorToken,
      data: {
        userChannelId: args.channelId,
        to: ['threads-target@example.com'],
        subject: args.subject,
        body: `Body for ${args.subject}`,
        bodyFormat: 'text',
        visibility: args.visibility,
      },
    },
  )
  expect(composeResp.ok(), `compose (${args.visibility}) should return 200`).toBeTruthy()

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await drainIntegrationQueue(OUTBOUND_QUEUE, { appRoot: APP_ROOT })
    await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
    const listResp = await apiRequest(
      request,
      'GET',
      `/api/customers/interactions?entityId=${encodeURIComponent(args.personId)}&interactionType=email`,
      { token: args.authorToken },
    )
    if (listResp.ok()) {
      const body = await readJsonSafe<{
        items?: Array<{ id?: string; title?: string; externalMessageId?: string; visibility?: string }>
      }>(listResp)
      const match = (body?.items ?? []).find((item) => item.title === args.subject)
      if (match?.id && match.externalMessageId) {
        expect(match.visibility, `seeded ${args.visibility} email must have that visibility`).toBe(
          args.visibility,
        )
        return { interactionId: match.id, linkId: match.externalMessageId }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out resolving the ${args.visibility} email interaction for "${args.subject}"`)
}

test.describe('TC-CRM-EMAIL-VISIBILITY-002: per-email visibility on /email-threads', () => {
  test(
    'shared emails appear for teammates; private emails are author-only (no admin bypass)',
    async ({ request }) => {
      test.slow();

      const stamp = Date.now();
      let adminToken: string | null = null;
      let userAToken: string | null = null;
      let userBToken: string | null = null;
      let adminUserToken: string | null = null;
      let userAId: string | null = null;
      let userBId: string | null = null;
      let adminUserId: string | null = null;
      let employeeRoleId: string | null = null;
      let adminRoleId: string | null = null;
      let personId: string | null = null;
      let channelId: string | null = null;
      let sharedInteractionId: string | null = null;
      let privateInteractionId: string | null = null;

      try {
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        const seedingAvailable = await isChannelSeedingAvailable(request, adminToken);
        test.skip(
          !seedingAvailable,
          'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed email threads.',
        );

        // Employee role: people.view + email.compose + connect_user_channel, NO view_private.
        const employeeRoleName = `qa_crm_email_vis2_emp_${stamp}`;
        employeeRoleId = await createRoleFixture(request, adminToken, {
          name: employeeRoleName,
          tenantId: scope.tenantId,
        });
        const empAclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: {
            roleId: employeeRoleId,
            features: [
              'customers.people.view',
              'customers.interactions.view',
              'customers.email.compose',
              'communication_channels.connect_user_channel',
            ],
          },
        });
        expect(empAclResp.ok(), 'PUT employee ACL should succeed').toBeTruthy();

        // Admin-ish role: same PLUS customers.email.view_private — to PROVE the
        // feature grants no read bypass for a teammate's private email in v1.
        const adminRoleName = `qa_crm_email_vis2_adm_${stamp}`;
        adminRoleId = await createRoleFixture(request, adminToken, {
          name: adminRoleName,
          tenantId: scope.tenantId,
        });
        const admAclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: {
            roleId: adminRoleId,
            features: [
              'customers.people.view',
              'customers.interactions.view',
              'customers.email.compose',
              'customers.email.view_private',
              'communication_channels.connect_user_channel',
            ],
          },
        });
        expect(admAclResp.ok(), 'PUT admin ACL should succeed').toBeTruthy();

        // User A — author of both emails (channel owner).
        const userAEmail = `qa-crm-email-vis2-a-${stamp}@acme.com`;
        const userAPassword = 'Valid1!Pass';
        userAId = await createUserFixture(request, adminToken, {
          email: userAEmail,
          password: userAPassword,
          organizationId: scope.organizationId,
          roles: [employeeRoleName],
          name: 'QA CRM Email Vis2 User A',
        });
        userAToken = await getAuthToken(request, userAEmail, userAPassword);

        // User B — teammate with CRM access, no view_private.
        const userBEmail = `qa-crm-email-vis2-b-${stamp}@acme.com`;
        const userBPassword = 'Valid1!Pass';
        userBId = await createUserFixture(request, adminToken, {
          email: userBEmail,
          password: userBPassword,
          organizationId: scope.organizationId,
          roles: [employeeRoleName],
          name: 'QA CRM Email Vis2 User B',
        });
        userBToken = await getAuthToken(request, userBEmail, userBPassword);

        // Admin user — holds view_private (must still NOT see A's private email).
        const adminUserEmail = `qa-crm-email-vis2-adm-${stamp}@acme.com`;
        const adminUserPassword = 'Valid1!Pass';
        adminUserId = await createUserFixture(request, adminToken, {
          email: adminUserEmail,
          password: adminUserPassword,
          organizationId: scope.organizationId,
          roles: [adminRoleName],
          name: 'QA CRM Email Vis2 Admin User',
        });
        adminUserToken = await getAuthToken(request, adminUserEmail, adminUserPassword);

        personId = await createPersonFixture(request, adminToken, {
          firstName: 'EmailVis2',
          lastName: `Person${stamp}`,
          displayName: `EmailVis2 Person ${stamp}`,
        });

        channelId = await seedConnectedChannel(request, userAToken, {
          displayName: `TC-CRM-EMAIL-VIS2 channel ${stamp}`,
          externalIdentifier: `tc-crm-email-vis2-${stamp}@test-seed.local`,
        });

        // Compose a SHARED then a PRIVATE email through the real chain.
        const shared = await composeAndResolveLinkId(request, {
          authorToken: userAToken,
          channelId,
          personId,
          subject: `Vis2 shared ${stamp}`,
          visibility: 'shared',
        });
        sharedInteractionId = shared.interactionId;

        const priv = await composeAndResolveLinkId(request, {
          authorToken: userAToken,
          channelId,
          personId,
          subject: `Vis2 private ${stamp}`,
          visibility: 'private',
        });
        privateInteractionId = priv.interactionId;

        // ── (a) + author view: User A sees BOTH the shared and private link ─
        const userAThreadIds = await fetchThreadLinkIds(request, userAToken, personId);
        expect(
          userAThreadIds.has(shared.linkId),
          'User A (author) must see the shared email in /email-threads',
        ).toBe(true);
        expect(
          userAThreadIds.has(priv.linkId),
          'User A (author) must see their own private email in /email-threads',
        ).toBe(true);

        // ── (a)+(b): User B sees the shared link but NOT the private one ────
        const userBThreadIds = await fetchThreadLinkIds(request, userBToken, personId);
        expect(
          userBThreadIds.has(shared.linkId),
          'User B (teammate) must see the SHARED email in /email-threads',
        ).toBe(true);
        expect(
          userBThreadIds.has(priv.linkId),
          "User B (teammate) must NOT see User A's PRIVATE email in /email-threads",
        ).toBe(false);

        // ── (c): admin holding view_private also does NOT see the private one ─
        const adminThreadIds = await fetchThreadLinkIds(request, adminUserToken, personId);
        expect(
          adminThreadIds.has(shared.linkId),
          'Admin must see the SHARED email in /email-threads',
        ).toBe(true);
        expect(
          adminThreadIds.has(priv.linkId),
          "Admin (view_private) must STILL NOT see a teammate's PRIVATE email — v1 has no bypass",
        ).toBe(false);
      } finally {
        if (adminToken) {
          await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', sharedInteractionId);
          await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', privateInteractionId);
        }
        await deleteChannelIfExists(request, userAToken, channelId);
        if (adminToken) {
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
        }
        await deleteUserIfExists(request, adminToken, userAId);
        await deleteUserIfExists(request, adminToken, userBId);
        await deleteUserIfExists(request, adminToken, adminUserId);
        await deleteRoleIfExists(request, adminToken, employeeRoleId);
        await deleteRoleIfExists(request, adminToken, adminRoleId);
      }
    },
  );
});
