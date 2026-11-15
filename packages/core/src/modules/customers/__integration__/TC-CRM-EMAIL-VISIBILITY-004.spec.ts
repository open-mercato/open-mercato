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
 * TC-CRM-EMAIL-VISIBILITY-004: whole-channel sharing (the "team mailbox" flag).
 *
 * Where -002 pins the per-MESSAGE rule and -003 the per-PERSON conversation
 * grant, this pins the per-CHANNEL flag:
 *   (a) before sharing, User A's private email is hidden from teammate User B,
 *   (b) A marks the channel shared → B sees mail sent BEFORE the flip
 *       (retroactive), on /email-threads AND /interactions, and the private-email
 *       count drops to 0,
 *   (c) A's SECOND, still-private mailbox stays hidden from B throughout — the
 *       case an author-keyed rule would have leaked, since both mailboxes share
 *       the same author_user_id,
 *   (d) A flips back → B loses access again (reversible), while A keeps their own
 *       (lossless — per-message visibility was never rewritten),
 *   (e) User B cannot flip A's channel (404 existence masking), and an admin
 *       holding the reserved communication_channels.admin gets no bypass.
 *
 * The email is produced through the real outbound chain (env-gated
 * `OM_ENABLE_TEST_CHANNEL_SEEDING`) so `channel_id` is populated by the ingestion
 * path rather than by the test. That chain is async, so the queues are drained
 * before asserting.
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

type EmailThread = { threadKey: string; messages: Array<{ id: string }> }

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

async function setChannelVisibility(
  request: APIRequestContext,
  token: string,
  channelId: string,
  visibility: 'private' | 'shared',
): Promise<number> {
  const resp = await apiRequest(
    request,
    'PUT',
    `/api/communication_channels/channels/${encodeURIComponent(channelId)}/visibility`,
    { token, data: { visibility } },
  )
  return resp.status()
}

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

/** Compose a private email and drive the async chain until it is queryable. */
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
        to: ['channel-share-target@example.com'],
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

test.describe('TC-CRM-EMAIL-VISIBILITY-004: whole-channel team mailbox sharing', () => {
  test(
    'sharing a channel hands over its mail retroactively without leaking a sibling private mailbox',
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
      let sharedChannelId: string | null = null;
      let otherChannelId: string | null = null;
      let sharedInteractionId: string | null = null;
      let otherInteractionId: string | null = null;

      try {
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        const seedingAvailable = await isChannelSeedingAvailable(request, adminToken);
        test.skip(
          !seedingAvailable,
          'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed email threads.',
        );

        // Employee role: CRM read + compose + share_own_channel. NO view_private,
        // NO communication_channels.admin.
        const employeeRoleName = `qa_crm_email_vis4_emp_${stamp}`;
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
              'communication_channels.share_own_channel',
            ],
          },
        });
        expect(empAclResp.ok(), 'PUT employee ACL should succeed').toBeTruthy();

        // Admin-ish role: PLUS the two reserved features, to PROVE they stay inert.
        const adminRoleName = `qa_crm_email_vis4_adm_${stamp}`;
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
              'communication_channels.admin',
            ],
          },
        });
        expect(admAclResp.ok(), 'PUT admin ACL should succeed').toBeTruthy();

        // User A — owns BOTH mailboxes.
        const userAEmail = `qa-crm-email-vis4-a-${stamp}@acme.com`;
        const userAPassword = 'Valid1!Pass';
        userAId = await createUserFixture(request, adminToken, {
          email: userAEmail,
          password: userAPassword,
          organizationId: scope.organizationId,
          roles: [employeeRoleName],
          name: 'QA CRM Email Vis4 User A',
        });
        userAToken = await getAuthToken(request, userAEmail, userAPassword);

        // User B — teammate.
        const userBEmail = `qa-crm-email-vis4-b-${stamp}@acme.com`;
        const userBPassword = 'Valid1!Pass';
        userBId = await createUserFixture(request, adminToken, {
          email: userBEmail,
          password: userBPassword,
          organizationId: scope.organizationId,
          roles: [employeeRoleName],
          name: 'QA CRM Email Vis4 User B',
        });
        userBToken = await getAuthToken(request, userBEmail, userBPassword);

        // Admin user — holds both reserved features.
        const adminUserEmail = `qa-crm-email-vis4-adm-${stamp}@acme.com`;
        const adminUserPassword = 'Valid1!Pass';
        adminUserId = await createUserFixture(request, adminToken, {
          email: adminUserEmail,
          password: adminUserPassword,
          organizationId: scope.organizationId,
          roles: [adminRoleName],
          name: 'QA CRM Email Vis4 Admin User',
        });
        adminUserToken = await getAuthToken(request, adminUserEmail, adminUserPassword);

        personId = await createPersonFixture(request, adminToken, {
          firstName: 'EmailVis4',
          lastName: `Person${stamp}`,
          displayName: `EmailVis4 Person ${stamp}`,
        });

        // TWO mailboxes for the same owner. Only the first gets shared; the
        // second is the leak canary.
        sharedChannelId = await seedConnectedChannel(request, userAToken, {
          displayName: `TC-CRM-EMAIL-VIS4 shared ${stamp}`,
          externalIdentifier: `tc-crm-email-vis4-shared-${stamp}@test-seed.local`,
        });
        otherChannelId = await seedConnectedChannel(request, userAToken, {
          displayName: `TC-CRM-EMAIL-VIS4 other ${stamp}`,
          externalIdentifier: `tc-crm-email-vis4-other-${stamp}@test-seed.local`,
        });

        const viaShared = await composePrivateEmail(request, {
          authorToken: userAToken,
          channelId: sharedChannelId,
          personId,
          subject: `Vis4 via-shared ${stamp}`,
        });
        sharedInteractionId = viaShared.interactionId;

        const viaOther = await composePrivateEmail(request, {
          authorToken: userAToken,
          channelId: otherChannelId,
          personId,
          subject: `Vis4 via-other ${stamp}`,
        });
        otherInteractionId = viaOther.interactionId;

        // ── (a) Before sharing: both hidden from B, both visible to A ───────
        const beforeB = await fetchThreadLinkIds(request, userBToken, personId);
        expect(beforeB.has(viaShared.linkId), 'B must not see mailbox 1 before sharing').toBe(false);
        expect(beforeB.has(viaOther.linkId), 'B must not see mailbox 2 before sharing').toBe(false);
        const beforeA = await fetchThreadLinkIds(request, userAToken, personId);
        expect(beforeA.has(viaShared.linkId), 'A sees their own mailbox 1').toBe(true);
        expect(beforeA.has(viaOther.linkId), 'A sees their own mailbox 2').toBe(true);

        // ── (e) B cannot flip a channel they do not own ─────────────────────
        const bFlip = await setChannelVisibility(request, userBToken, sharedChannelId, 'shared');
        expect(
          [403, 404].includes(bFlip),
          `B flipping A's channel must be refused (404 masking or 403 ACL), got ${bFlip}`,
        ).toBe(true);
        const afterBAttempt = await fetchThreadLinkIds(request, userBToken, personId);
        expect(
          afterBAttempt.has(viaShared.linkId),
          'a refused flip must not expose anything',
        ).toBe(false);

        // Admin holding communication_channels.admin also cannot flip it —
        // the feature stays inert for this capability.
        const adminFlip = await setChannelVisibility(
          request,
          adminUserToken,
          sharedChannelId,
          'shared',
        );
        expect(
          [403, 404].includes(adminFlip),
          `admin flipping another user's channel must be refused, got ${adminFlip}`,
        ).toBe(true);

        // ── (b) A shares mailbox 1 → B gains its PRE-EXISTING mail ─────────
        const flipStatus = await setChannelVisibility(
          request,
          userAToken,
          sharedChannelId,
          'shared',
        );
        expect(flipStatus, 'owner flipping their own channel should succeed').toBe(200);

        const sharedB = await fetchThreadLinkIds(request, userBToken, personId);
        expect(
          sharedB.has(viaShared.linkId),
          'RETROACTIVE: B must now see mail sent BEFORE the channel was shared',
        ).toBe(true);

        // ── (c) THE LEAK CANARY ────────────────────────────────────────────
        // Mailbox 2 has the SAME author_user_id as mailbox 1. If the predicate
        // keyed on author instead of channel_id, this would now be visible.
        expect(
          sharedB.has(viaOther.linkId),
          "B must NOT see A's OTHER still-private mailbox — same author, different channel",
        ).toBe(false);

        // The canonical timeline must agree with the Emails tab on both counts.
        const sharedInteractionsB = await fetchInteractionIds(request, userBToken, personId);
        expect(
          sharedInteractionsB.has(viaShared.interactionId),
          '/interactions must agree that the shared channel is readable',
        ).toBe(true);
        expect(
          sharedInteractionsB.has(viaOther.interactionId),
          '/interactions must agree that the other mailbox is still hidden',
        ).toBe(false);

        // The private count drops to exactly the still-hidden mailbox, not to 0.
        const sharedCountB = await fetchPrivateEmailCount(request, userBToken, personId);
        if (sharedCountB !== null) {
          expect(
            sharedCountB,
            'the count must drop by the shared mailbox only — the other one is still private',
          ).toBe(1);
        }

        // Idempotent: re-sharing is a no-op, not an error.
        expect(
          await setChannelVisibility(request, userAToken, sharedChannelId, 'shared'),
          're-sharing an already-shared channel should be idempotent',
        ).toBe(200);

        // ── (d) A flips back → B loses access, A keeps it ───────────────────
        const revertStatus = await setChannelVisibility(
          request,
          userAToken,
          sharedChannelId,
          'private',
        );
        expect(revertStatus, 'owner making the channel private again should succeed').toBe(200);

        const revertedB = await fetchThreadLinkIds(request, userBToken, personId);
        expect(
          revertedB.has(viaShared.linkId),
          'REVERSIBLE: B must lose access as soon as the channel is private again',
        ).toBe(false);

        const revertedA = await fetchThreadLinkIds(request, userAToken, personId);
        expect(
          revertedA.has(viaShared.linkId),
          'LOSSLESS: A keeps their own access — per-message visibility was never rewritten',
        ).toBe(true);
        expect(
          revertedA.has(viaOther.linkId),
          'A still sees their other mailbox too',
        ).toBe(true);

        // Admin with view_private still sees nothing once un-shared.
        const adminAfter = await fetchThreadLinkIds(request, adminUserToken, personId);
        expect(
          adminAfter.has(viaShared.linkId),
          'admin holding customers.email.view_private must STILL get no read bypass',
        ).toBe(false);
      } finally {
        if (adminToken) {
          // Best-effort: return the channel to private so the fixture is clean.
          if (userAToken && sharedChannelId) {
            await setChannelVisibility(request, userAToken, sharedChannelId, 'private').catch(() => 0);
          }
          await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', sharedInteractionId);
          await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', otherInteractionId);
          if (userAToken) {
            await deleteChannelIfExists(request, userAToken, sharedChannelId);
            await deleteChannelIfExists(request, userAToken, otherChannelId);
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
