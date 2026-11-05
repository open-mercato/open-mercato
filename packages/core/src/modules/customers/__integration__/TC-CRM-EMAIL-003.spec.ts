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
 * TC-CRM-EMAIL-003: Inbound auto-link across From + To + Cc (3 known People).
 *
 * One inbound message whose From/To/Cc addresses match three distinct CRM People
 * must produce exactly one email interaction PER matched Person (3 total), each
 * anchored to its own timeline and all sharing the same source MessageChannelLink
 * id (the dedupe key is per (entity_id, external_message_id)).
 *
 * Driven via the env-gated test-seed fixture. Skips when the gate is off.
 */
test.describe('TC-CRM-EMAIL-003: inbound auto-link across From/To/Cc', () => {
  test(
    'an inbound email with 3 known recipients creates 3 interactions (one per Person)',
    async ({ request }) => {
      test.slow();

      const stamp = Date.now();
      let adminToken: string | null = null;
      let userToken: string | null = null;
      let userId: string | null = null;
      let roleId: string | null = null;
      let personAId: string | null = null;
      let personBId: string | null = null;
      let personCId: string | null = null;
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

        const roleName = `qa_crm_email_003_${stamp}`;
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

        const userEmail = `qa-crm-email-003-${stamp}@acme.com`;
        const userPassword = 'Valid1!Pass';
        userId = await createUserFixture(request, adminToken, {
          email: userEmail,
          password: userPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Email 003 User',
        });
        userToken = await getAuthToken(request, userEmail, userPassword);

        const emailA = `crm-email-003-a-${stamp}@example.com`;
        const emailB = `crm-email-003-b-${stamp}@example.com`;
        const emailC = `crm-email-003-c-${stamp}@example.com`;
        personAId = await createPersonWithEmail(request, userToken, {
          firstName: 'CrmEmail003A',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail003 A ${stamp}`,
          primaryEmail: emailA,
        });
        personBId = await createPersonWithEmail(request, userToken, {
          firstName: 'CrmEmail003B',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail003 B ${stamp}`,
          primaryEmail: emailB,
        });
        personCId = await createPersonWithEmail(request, userToken, {
          firstName: 'CrmEmail003C',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail003 C ${stamp}`,
          primaryEmail: emailC,
        });

        channelId = await seedConnectedChannel(request, userToken, {
          displayName: `TC-CRM-EMAIL-003 channel ${stamp}`,
          externalIdentifier: `tc-crm-email-003-${stamp}@test-seed.local`,
        });

        // Inbound message: From=A, To=B, Cc=C — three distinct known People.
        const seeded = await seedInboundMessage(request, userToken, {
          channelId,
          from: emailA,
          to: [emailB],
          cc: [emailC],
          subject: `Inbound 3-party ${stamp}`,
          bodyText: 'Hello all three of you.',
          messageId: `<inbound-003-${stamp}@example.com>`,
        });

        // Each Person should get exactly one interaction tied to the same link.
        for (const [label, personId] of [
          ['A (From)', personAId],
          ['B (To)', personBId],
          ['C (Cc)', personCId],
        ] as const) {
          const items = await drainAndListEmailInteractions(request, userToken, personId, {
            expectedMin: 1,
          });
          expect(items.length, `Person ${label} must have exactly one email interaction`).toBe(1);
          expect(
            items[0].externalMessageId,
            `Person ${label} interaction must reference the seeded link`,
          ).toBe(seeded.channelLinkId);
          interactionIds.push(items[0].id);
        }

        expect(interactionIds.length, 'three interactions must have been created in total').toBe(3);
      } finally {
        if (adminToken) {
          for (const id of interactionIds) {
            await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', id);
          }
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personAId);
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personBId);
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personCId);
        }
        await deleteChannelIfExists(request, userToken, channelId);
        await deleteUserIfExists(request, adminToken, userId);
        await deleteRoleIfExists(request, adminToken, roleId);
      }
    },
  );
});
