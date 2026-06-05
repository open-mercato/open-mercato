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
 * TC-CRM-EMAIL-002: Inbound auto-link by From address.
 *
 * The hub emits `communication_channels.message.received` for an inbound message
 * whose From address matches a CRM Person. The persistent
 * `customers:link-channel-message-received` subscriber resolves the Person by
 * address and creates ONE `CustomerInteraction` (interactionType='email',
 * author_user_id = the channel owner, visibility='private' for a user-owned
 * channel) on that Person's timeline.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`),
 * which seeds the MessageChannelLink + emits the hub event against real Postgres.
 * Skips when the gate is off.
 */
test.describe('TC-CRM-EMAIL-002: inbound auto-link by From address', () => {
  test(
    'an inbound email From a known Person creates one email interaction on their timeline',
    async ({ request }) => {
      test.slow();

      const stamp = Date.now();
      let adminToken: string | null = null;
      let userToken: string | null = null;
      let userId: string | null = null;
      let roleId: string | null = null;
      let personId: string | null = null;
      let channelId: string | null = null;
      let interactionId: string | null = null;

      try {
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        const seedingAvailable = await isChannelSeedingAvailable(request, adminToken);
        test.skip(
          !seedingAvailable,
          'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot emit inbound messages.',
        );

        const roleName = `qa_crm_email_002_${stamp}`;
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

        // The channel owner — authorUserId on the resulting interaction.
        const userEmail = `qa-crm-email-002-${stamp}@acme.com`;
        const userPassword = 'Valid1!Pass';
        userId = await createUserFixture(request, adminToken, {
          email: userEmail,
          password: userPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Email 002 User',
        });
        userToken = await getAuthToken(request, userEmail, userPassword);
        const userScope = getTokenScope(userToken);

        const personEmail = `crm-email-002-person-${stamp}@example.com`;
        personId = await createPersonWithEmail(request, userToken, {
          firstName: 'CrmEmail002',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail002 Person ${stamp}`,
          primaryEmail: personEmail,
        });

        channelId = await seedConnectedChannel(request, userToken, {
          displayName: `TC-CRM-EMAIL-002 channel ${stamp}`,
          externalIdentifier: `tc-crm-email-002-${stamp}@test-seed.local`,
        });

        // Emit an inbound message FROM the person's address.
        const seeded = await seedInboundMessage(request, userToken, {
          channelId,
          from: personEmail,
          to: [`tc-crm-email-002-${stamp}@test-seed.local`],
          subject: `Inbound from person ${stamp}`,
          bodyText: 'Hello, this is an inbound email.',
          messageId: `<inbound-002-${stamp}@example.com>`,
        });

        const items = await drainAndListEmailInteractions(request, userToken, personId, {
          expectedMin: 1,
        });
        expect(items.length, 'exactly one email interaction must be linked to the Person').toBe(1);
        const interaction = items[0];
        interactionId = interaction.id;

        expect(interaction.interactionType, 'interactionType must be email').toBe('email');
        expect(
          interaction.externalMessageId,
          'externalMessageId must equal the seeded MessageChannelLink id',
        ).toBe(seeded.channelLinkId);
        expect(
          interaction.authorUserId,
          'authorUserId must equal the channel owner (the user)',
        ).toBe(userScope.userId);
        expect(
          interaction.visibility,
          'a user-owned channel produces a private inbound interaction',
        ).toBe('private');
      } finally {
        if (adminToken) {
          await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId);
        }
        await deleteChannelIfExists(request, userToken, channelId);
        if (adminToken) {
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
        }
        await deleteUserIfExists(request, adminToken, userId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );
});
