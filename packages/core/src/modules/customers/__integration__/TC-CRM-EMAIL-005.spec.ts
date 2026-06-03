import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/modules/core/__integration__/helpers/communicationChannelsFixtures';
import {
  createPersonWithEmail,
  drainAndListEmailInteractions,
} from './helpers/inboundEmail';

/**
 * TC-CRM-EMAIL-005: Threading inheritance.
 *
 * A reply from an UNKNOWN address (matches no Person directly) is still anchored
 * to the original Person's timeline because it shares the hub message thread
 * with the original email. The link subscriber's hub-thread inheritance join
 * (messages.thread_id → existing email interaction in that thread) resolves the
 * Person even though address matching fails.
 *
 * Sequence:
 *   1. Inbound #1 From person P (thread T) → interaction on P (address match).
 *   2. Inbound #2 From a stranger, same thread T → inherits P via the thread,
 *      producing a SECOND interaction on P's timeline.
 *
 * Driven via the env-gated test-seed fixture. Skips when the gate is off.
 */
test.describe('TC-CRM-EMAIL-005: threading inheritance via shared hub thread', () => {
  test(
    'a reply from an unknown address inherits the Person of the original thread',
    async ({ request }) => {
      test.slow();

      const stamp = Date.now();
      const threadId = crypto.randomUUID();
      let adminToken: string | null = null;
      let userToken: string | null = null;
      let userId: string | null = null;
      let roleId: string | null = null;
      let personId: string | null = null;
      let channelId: string | null = null;
      const interactionIds: string[] = [];

      try {
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        const seedingAvailable = await isChannelSeedingAvailable(request, adminToken);
        test.skip(
          !seedingAvailable,
          'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot emit inbound messages.',
        );

        const roleName = `qa_crm_email_005_${stamp}`;
        roleId = await createRoleFixture(request, adminToken, {
          name: roleName,
          tenantId: scope.tenantId,
        });
        const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: {
            roleId,
            features: [
              'customers.people.view',
              'customers.people.manage',
              'customers.interactions.view',
              'communication_channels.connect_user_channel',
            ],
          },
        });
        expect(aclResp.ok(), 'PUT ACL should succeed').toBeTruthy();

        const userEmail = `qa-crm-email-005-${stamp}@acme.com`;
        const userPassword = 'Valid1!Pass';
        userId = await createUserFixture(request, adminToken, {
          email: userEmail,
          password: userPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Email 005 User',
        });
        userToken = await getAuthToken(request, userEmail, userPassword);

        const personEmail = `crm-email-005-person-${stamp}@example.com`;
        personId = await createPersonWithEmail(request, userToken, {
          firstName: 'CrmEmail005',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail005 Person ${stamp}`,
          primaryEmail: personEmail,
        });

        channelId = await seedConnectedChannel(request, userToken, {
          displayName: `TC-CRM-EMAIL-005 channel ${stamp}`,
          externalIdentifier: `tc-crm-email-005-${stamp}@test-seed.local`,
        });

        // (1) Original inbound FROM the person, on hub thread T → links to P.
        const original = await seedInboundMessage(request, userToken, {
          channelId,
          from: personEmail,
          to: [`tc-crm-email-005-${stamp}@test-seed.local`],
          subject: `Threaded original ${stamp}`,
          bodyText: 'Original message in the thread.',
          messageId: `<inbound-005-original-${stamp}@example.com>`,
          messageThreadId: threadId,
        });
        const afterOriginal = await drainAndListEmailInteractions(request, userToken, personId, {
          expectedMin: 1,
        });
        expect(afterOriginal.length, 'original inbound must create one interaction on P').toBe(1);
        expect(
          afterOriginal[0].externalMessageId,
          'original interaction references the original link',
        ).toBe(original.channelLinkId);
        interactionIds.push(afterOriginal[0].id);

        // (2) Reply from an UNKNOWN address, SAME hub thread T → inherits P.
        const reply = await seedInboundMessage(request, userToken, {
          channelId,
          from: `stranger-005-${stamp}@nowhere.invalid`,
          to: [`tc-crm-email-005-${stamp}@test-seed.local`],
          subject: `Re: Threaded original ${stamp}`,
          bodyText: 'A reply from an address we do not know.',
          messageId: `<inbound-005-reply-${stamp}@example.com>`,
          inReplyTo: `<inbound-005-original-${stamp}@example.com>`,
          messageThreadId: threadId,
        });

        const afterReply = await drainAndListEmailInteractions(request, userToken, personId, {
          expectedMin: 2,
        });
        expect(
          afterReply.length,
          'the threaded reply must inherit P and add a second interaction',
        ).toBe(2);
        const replyInteraction = afterReply.find(
          (item) => item.externalMessageId === reply.channelLinkId,
        );
        expect(
          replyInteraction,
          'the reply (unknown sender) must be linked to P via thread inheritance',
        ).toBeTruthy();
        for (const item of afterReply) interactionIds.push(item.id);
      } finally {
        if (adminToken) {
          for (const id of Array.from(new Set(interactionIds))) {
            await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', id);
          }
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
        }
        await deleteChannelIfExists(request, userToken, channelId);
        await deleteUserIfExists(request, adminToken, userId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );
});
