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
 * TC-CRM-EMAIL-VISIBILITY-003: owner-initiated CONVERSATION sharing
 * (`GET`/`PUT /api/customers/people/[id]/email-share`).
 *
 * Where -002 pins the per-MESSAGE rule, this pins the conversation-level grant:
 *   (a) before any share, User A's private email is hidden from teammate User B
 *       and B's private-email count for the Person is non-zero,
 *   (b) User A shares the conversation → B sees the ALREADY-SENT history
 *       (retroactive) on /email-threads AND on /interactions, and the private
 *       count drops to 0 — the two surfaces must agree,
 *   (c) User A un-shares → B loses access again (reversible, lossless),
 *   (d) User B cannot share User A's conversation: B has no private email with
 *       the Person, so the write is refused and B's GET reports canShare=false,
 *   (e) an admin holding the reserved `customers.email.view_private` STILL gets
 *       no read bypass — the reserved feature remains inert.
 *
 * Threads only render when an interaction's externalMessageId resolves to a real
 * MessageChannelLink, so the email is produced through the real outbound chain
 * (env-gated `OM_ENABLE_TEST_CHANNEL_SEEDING`). That chain is async, so the test
 * drains the outbound + events queues before asserting.
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

type ShareState = {
  sharedByMe?: boolean
  canShare?: boolean
  updatedAt?: string | null
  sharedBy?: Array<{ userId?: string; userName?: string | null }>
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

/** Interaction ids the caller can see for this Person via the canonical timeline. */
async function fetchInteractionIds(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<Set<string>> {
  const resp = await apiRequest(
    request,
    'GET',
    `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
    { token },
  )
  expect(resp.ok(), `GET /interactions should succeed (got ${resp.status()})`).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(resp)
  const ids = new Set<string>()
  for (const item of body?.items ?? []) {
    if (typeof item.id === 'string') ids.add(item.id)
  }
  return ids
}

async function getShareState(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<ShareState> {
  const resp = await apiRequest(
    request,
    'GET',
    `/api/customers/people/${encodeURIComponent(personId)}/email-share`,
    { token },
  )
  expect(resp.ok(), `GET /email-share should succeed (got ${resp.status()})`).toBeTruthy()
  return (await readJsonSafe<ShareState>(resp)) ?? {}
}

async function setShared(
  request: APIRequestContext,
  token: string,
  personId: string,
  shared: boolean,
): Promise<number> {
  const resp = await apiRequest(
    request,
    'PUT',
    `/api/customers/people/${encodeURIComponent(personId)}/email-share`,
    { token, data: { shared } },
  )
  return resp.status()
}

/** Private-email count the Person-list enricher reports for this caller. */
async function fetchPrivateEmailCount(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<number | null> {
  const resp = await apiRequest(
    request,
    'GET',
    `/api/customers/people?id=${encodeURIComponent(personId)}`,
    { token },
  )
  if (!resp.ok()) return null
  const body = await readJsonSafe<{ items?: Array<{ id?: string; _privateEmailCount?: number }> }>(resp)
  const match = (body?.items ?? []).find((item) => item.id === personId)
  return typeof match?._privateEmailCount === 'number' ? match._privateEmailCount : null
}

/**
 * Compose a PRIVATE email as the author and drive the async chain until the
 * resulting CustomerInteraction is visible to the author.
 */
async function composePrivateEmail(
  request: APIRequestContext,
  args: { authorToken: string; channelId: string; personId: string; subject: string },
): Promise<{ interactionId: string; linkId: string }> {
  const composeResp = await apiRequest(
    request,
    'POST',
    `/api/customers/people/${args.personId}/emails`,
    {
      token: args.authorToken,
      data: {
        userChannelId: args.channelId,
        to: ['share-target@example.com'],
        subject: args.subject,
        body: `Body for ${args.subject}`,
        bodyFormat: 'text',
        visibility: 'private',
      },
    },
  )
  expect(composeResp.ok(), 'compose (private) should return 200').toBeTruthy()

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
        expect(match.visibility, 'seeded email must be private').toBe('private')
        return { interactionId: match.id, linkId: match.externalMessageId }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out resolving the private email interaction for "${args.subject}"`)
}

test.describe('TC-CRM-EMAIL-VISIBILITY-003: owner-initiated conversation sharing', () => {
  test(
    'sharing hands over history retroactively and reversibly; only the owner may share',
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
      let privateInteractionId: string | null = null;

      try {
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        const seedingAvailable = await isChannelSeedingAvailable(request, adminToken);
        test.skip(
          !seedingAvailable,
          'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed email threads.',
        );

        // Employee role: CRM read + compose + share_conversation, NO view_private.
        const employeeRoleName = `qa_crm_email_vis3_emp_${stamp}`;
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
              'customers.email.share_conversation',
              'communication_channels.connect_user_channel',
            ],
          },
        });
        expect(empAclResp.ok(), 'PUT employee ACL should succeed').toBeTruthy();

        // Admin-ish role: same PLUS the reserved view_private, to PROVE it stays inert.
        const adminRoleName = `qa_crm_email_vis3_adm_${stamp}`;
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

        // User A — mailbox owner and author of the private email.
        const userAEmail = `qa-crm-email-vis3-a-${stamp}@acme.com`;
        const userAPassword = 'Valid1!Pass';
        userAId = await createUserFixture(request, adminToken, {
          email: userAEmail,
          password: userAPassword,
          organizationId: scope.organizationId,
          roles: [employeeRoleName],
          name: 'QA CRM Email Vis3 User A',
        });
        userAToken = await getAuthToken(request, userAEmail, userAPassword);

        // User B — teammate with CRM access, no view_private.
        const userBEmail = `qa-crm-email-vis3-b-${stamp}@acme.com`;
        const userBPassword = 'Valid1!Pass';
        userBId = await createUserFixture(request, adminToken, {
          email: userBEmail,
          password: userBPassword,
          organizationId: scope.organizationId,
          roles: [employeeRoleName],
          name: 'QA CRM Email Vis3 User B',
        });
        userBToken = await getAuthToken(request, userBEmail, userBPassword);

        // Admin user — holds the reserved view_private.
        const adminUserEmail = `qa-crm-email-vis3-adm-${stamp}@acme.com`;
        const adminUserPassword = 'Valid1!Pass';
        adminUserId = await createUserFixture(request, adminToken, {
          email: adminUserEmail,
          password: adminUserPassword,
          organizationId: scope.organizationId,
          roles: [adminRoleName],
          name: 'QA CRM Email Vis3 Admin User',
        });
        adminUserToken = await getAuthToken(request, adminUserEmail, adminUserPassword);

        personId = await createPersonFixture(request, adminToken, {
          firstName: 'EmailVis3',
          lastName: `Person${stamp}`,
          displayName: `EmailVis3 Person ${stamp}`,
        });

        channelId = await seedConnectedChannel(request, userAToken, {
          displayName: `TC-CRM-EMAIL-VIS3 channel ${stamp}`,
          externalIdentifier: `tc-crm-email-vis3-${stamp}@test-seed.local`,
        });

        const priv = await composePrivateEmail(request, {
          authorToken: userAToken,
          channelId,
          personId,
          subject: `Vis3 private ${stamp}`,
        });
        privateInteractionId = priv.interactionId;

        // ── (a) Before sharing: hidden from B, visible to its author ────────
        const beforeThreadsB = await fetchThreadLinkIds(request, userBToken, personId);
        expect(
          beforeThreadsB.has(priv.linkId),
          "User B must NOT see User A's private email before it is shared",
        ).toBe(false);
        const beforeThreadsA = await fetchThreadLinkIds(request, userAToken, personId);
        expect(
          beforeThreadsA.has(priv.linkId),
          'User A (author) must see their own private email',
        ).toBe(true);

        const beforeCountB = await fetchPrivateEmailCount(request, userBToken, personId);
        if (beforeCountB !== null) {
          expect(
            beforeCountB,
            'User B should see a non-zero opaque private-email count before sharing',
          ).toBeGreaterThan(0);
        }

        // ── (d) User B cannot share a conversation they do not own ──────────
        const bShareState = await getShareState(request, userBToken, personId);
        expect(
          bShareState.canShare,
          'User B has no private email with this Person, so canShare must be false',
        ).toBe(false);
        const bWriteStatus = await setShared(request, userBToken, personId, true);
        expect(
          [400, 404].includes(bWriteStatus),
          `User B sharing must be refused (400 nothing-to-share or 404 masking), got ${bWriteStatus}`,
        ).toBe(true);

        // Refusing B must not have leaked anything to B.
        const afterBAttempt = await fetchThreadLinkIds(request, userBToken, personId);
        expect(
          afterBAttempt.has(priv.linkId),
          "A refused share attempt must not expose User A's private email",
        ).toBe(false);

        // ── (b) User A shares → B gains the ALREADY-SENT history ───────────
        const aStateBefore = await getShareState(request, userAToken, personId);
        expect(aStateBefore.canShare, 'User A owns a private conversation, so canShare').toBe(true);
        expect(aStateBefore.sharedByMe, 'User A has not shared yet').toBe(false);

        const shareStatus = await setShared(request, userAToken, personId, true);
        expect(shareStatus, 'User A sharing should succeed').toBe(200);

        const sharedThreadsB = await fetchThreadLinkIds(request, userBToken, personId);
        expect(
          sharedThreadsB.has(priv.linkId),
          'RETROACTIVE: User B must now see the email that was sent BEFORE the share',
        ).toBe(true);

        // The Emails tab and the canonical timeline must agree (one shared rule).
        const sharedInteractionsB = await fetchInteractionIds(request, userBToken, personId);
        expect(
          sharedInteractionsB.has(priv.interactionId),
          '/interactions must agree with /email-threads about the shared conversation',
        ).toBe(true);

        const sharedCountB = await fetchPrivateEmailCount(request, userBToken, personId);
        if (sharedCountB !== null) {
          expect(
            sharedCountB,
            'the private-email count must drop to 0 once the conversation is readable',
          ).toBe(0);
        }

        // B now sees who shared it.
        const bStateShared = await getShareState(request, userBToken, personId);
        expect(
          (bStateShared.sharedBy ?? []).some((entry) => entry.userId === userAId),
          'User B should see User A listed as the sharer',
        ).toBe(true);

        // Idempotent: sharing again is a no-op, not a duplicate or an error.
        const reShareStatus = await setShared(request, userAToken, personId, true);
        expect(reShareStatus, 'sharing an already-shared conversation should be idempotent').toBe(200);

        // ── (e) The reserved feature is still inert for a NON-shared owner ──
        // The admin holds customers.email.view_private. It must grant nothing by
        // itself: what the admin can see here comes from A's share, not the feature.
        const adminThreads = await fetchThreadLinkIds(request, adminUserToken, personId);
        expect(
          adminThreads.has(priv.linkId),
          'the admin sees the email only because it is SHARED, which is expected',
        ).toBe(true);

        // ── (c) User A un-shares → B loses access again ─────────────────────
        const unshareStatus = await setShared(request, userAToken, personId, false);
        expect(unshareStatus, 'User A un-sharing should succeed').toBe(200);

        const unsharedThreadsB = await fetchThreadLinkIds(request, userBToken, personId);
        expect(
          unsharedThreadsB.has(priv.linkId),
          'REVERSIBLE: User B must lose access as soon as the share is revoked',
        ).toBe(false);

        const unsharedInteractionsB = await fetchInteractionIds(request, userBToken, personId);
        expect(
          unsharedInteractionsB.has(priv.interactionId),
          '/interactions must also re-hide the revoked conversation',
        ).toBe(false);

        // LOSSLESS: the author still sees their own email — un-sharing never
        // rewrote the per-message visibility.
        const unsharedThreadsA = await fetchThreadLinkIds(request, userAToken, personId);
        expect(
          unsharedThreadsA.has(priv.linkId),
          'un-sharing must not destroy the owner\'s own access',
        ).toBe(true);

        // The admin with view_private is back to seeing nothing — feature is inert.
        const adminThreadsAfter = await fetchThreadLinkIds(request, adminUserToken, personId);
        expect(
          adminThreadsAfter.has(priv.linkId),
          'admin holding customers.email.view_private must STILL get no bypass once un-shared',
        ).toBe(false);
      } finally {
        if (adminToken) {
          // Best-effort: revoke any surviving share so the fixture Person is clean.
          if (userAToken && personId) {
            await setShared(request, userAToken, personId, false).catch(() => 0);
          }
          await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', privateInteractionId);
          if (channelId && userAToken) {
            await deleteChannelIfExists(request, userAToken, channelId);
          }
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
          await deleteUserIfExists(request, adminToken, userAId);
          await deleteUserIfExists(request, adminToken, userBId);
          await deleteUserIfExists(request, adminToken, adminUserId);
          await deleteRoleIfExists(request, adminToken, employeeRoleId);
          await deleteRoleIfExists(request, adminToken, adminRoleId);
        }
      }
    },
  );
});
