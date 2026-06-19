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
  drainAndExpectNoEmailInteractions,
} from './helpers/inboundEmail';

/**
 * TC-CRM-EMAIL-004: Inbound with no matching Person creates ZERO interactions.
 *
 * An inbound message whose From/To/Cc addresses match no CRM Person (and that
 * carries no crmPersonId hint and no threading references) must NOT create any
 * `CustomerInteraction`. The email is still persisted as a platform message (the
 * seed returns a messageId proving the Messages-inbox row exists) — it simply
 * isn't anchored to anyone's CRM timeline.
 *
 * Driven via the env-gated test-seed fixture. Skips when the gate is off.
 */
test.describe('TC-CRM-EMAIL-004: inbound with no matching Person', () => {
  test(
    'an inbound email matching no Person creates zero interactions but still persists a message',
    async ({ request }) => {
      test.slow();

      const stamp = Date.now();
      let adminToken: string | null = null;
      let userToken: string | null = null;
      let userId: string | null = null;
      let roleId: string | null = null;
      let personId: string | null = null;
      let channelId: string | null = null;

      try {
        adminToken = await getAuthToken(request, 'admin');
        const scope = getTokenScope(adminToken);

        const seedingAvailable = await isChannelSeedingAvailable(request, adminToken);
        test.skip(
          !seedingAvailable,
          'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot emit inbound messages.',
        );

        const roleName = `qa_crm_email_004_${stamp}`;
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

        const userEmail = `qa-crm-email-004-${stamp}@acme.com`;
        const userPassword = 'Valid1!Pass';
        userId = await createUserFixture(request, adminToken, {
          email: userEmail,
          password: userPassword,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Email 004 User',
        });
        userToken = await getAuthToken(request, userEmail, userPassword);

        // A known Person whose address is deliberately NOT referenced by the inbound.
        const personEmail = `crm-email-004-known-${stamp}@example.com`;
        personId = await createPersonWithEmail(request, userToken, {
          firstName: 'CrmEmail004',
          lastName: `Person${stamp}`,
          displayName: `CrmEmail004 Person ${stamp}`,
          primaryEmail: personEmail,
        });

        channelId = await seedConnectedChannel(request, userToken, {
          displayName: `TC-CRM-EMAIL-004 channel ${stamp}`,
          externalIdentifier: `tc-crm-email-004-${stamp}@test-seed.local`,
        });

        // Inbound from/to addresses that match nobody in this tenant.
        const seeded = await seedInboundMessage(request, userToken, {
          channelId,
          from: `stranger-${stamp}@nowhere.invalid`,
          to: [`another-stranger-${stamp}@nowhere.invalid`],
          subject: `Inbound no-match ${stamp}`,
          bodyText: 'Nobody here matches a CRM person.',
          messageId: `<inbound-004-${stamp}@example.com>`,
        });

        // The message itself was persisted (proves it lands in the inbox, just unlinked).
        expect(seeded.messageId, 'inbound message row must exist even with no CRM match').toBeTruthy();

        // The known Person must have zero email interactions from this event.
        const items = await drainAndExpectNoEmailInteractions(request, userToken, personId);
        expect(
          items.length,
          'no interaction should be created for an inbound that matches no Person',
        ).toBe(0);
      } finally {
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
